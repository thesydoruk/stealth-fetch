/**
 * Detect and attempt to solve anti-bot interstitials (PerimeterX, DataDome, Cloudflare).
 *
 * Do not treat vendor telemetry (`perimeterx`, `_pxappid`) as a challenge by
 * itself — those strings ship on successful article pages and used to make
 * every Bloomberg/Reuters fetch look unsolved, wait for network idle, then
 * return `ok: false` while discarding the HTML.
 */

import type { StealthPage } from "./human-behavior";
import { humanDelay, humanPressAndHold } from "./human-behavior";
import { createLogger } from "./logger";

const log = createLogger("challenge-solver");

/** Visible interstitial / widget — not mere bot-script instrumentation. */
const INTERSTITIAL_MARKERS = [
  "captcha-delivery.com",
  "geo.captcha-delivery",
  "datadome",
  "/cdn-cgi/challenge-platform",
  "cf-browser-verification",
  "px-captcha",
  "press & hold to confirm",
  "press and hold to confirm",
  "are you a robot",
];

const PX_INSTRUMENTATION = ["_pxappid", "perimeterx"];

function hasArticlePayload(html: string): boolean {
  const lower = html.toLowerCase();
  return lower.includes("__next_data__") || /<h1[\s>]/i.test(html);
}

/** True only for an interstitial or a PX shell with no article payload. */
export function looksLikeChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  if (INTERSTITIAL_MARKERS.some((sig) => lower.includes(sig))) return true;
  const hasPx = PX_INSTRUMENTATION.some((sig) => lower.includes(sig));
  return hasPx && !hasArticlePayload(html);
}

interface CaptchaTarget {
  x: number;
  y: number;
  holdMs: number;
  kind: "perimeterx" | "generic";
}

type FrameSearchPage = StealthPage & {
  frames?: () => StealthPage[];
};

/**
 * Locate a press-and-hold control. Requires "press"+"hold" in the visible
 * label — a bare `#px-captcha` shell at a fixed point was being clicked
 * every time (always 473,233) while the real widget sat in an iframe.
 */
async function findCaptchaTargetInFrame(page: StealthPage): Promise<CaptchaTarget | null> {
  return page.evaluate(() => {
    const candidates: Array<{ el: Element; score: number; kind: "perimeterx" | "generic" }> = [];

    const selectors = [
      "#px-captcha",
      ".px-captcha-error",
      "[class*='px-captcha']",
      "button",
      "[role='button']",
      "div",
    ];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        const label = `${el.innerText || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
        const rect = el.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 28) return;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        if (!label.includes("press") || !label.includes("hold")) return;

        let score = 10;
        let kind: "perimeterx" | "generic" = "generic";
        if (el.id.includes("px") || el.className.toLowerCase().includes("px-captcha")) {
          score += 12;
          kind = "perimeterx";
        }
        if (selector === "#px-captcha") score += 8;
        candidates.push({ el, score, kind });
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best) return null;

    const rect = best.el.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      holdMs: best.kind === "perimeterx" ? 3_200 + Math.floor(Math.random() * 900) : 1_800,
      kind: best.kind,
    };
  });
}

/**
 * Cross-origin PX widgets cannot be queried inside the iframe. Hold the
 * center of a visible captcha iframe in page coordinates instead.
 */
async function findPxIframeTarget(page: StealthPage): Promise<CaptchaTarget | null> {
  return page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll("iframe"));
    const scored: Array<{ x: number; y: number; score: number }> = [];

    for (const iframe of iframes) {
      if (!(iframe instanceof HTMLElement)) continue;
      const rect = iframe.getBoundingClientRect();
      if (rect.width < 180 || rect.height < 50) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;

      const hint = [
        iframe.id,
        iframe.className,
        iframe.getAttribute("src") ?? "",
        iframe.getAttribute("title") ?? "",
        iframe.getAttribute("aria-label") ?? "",
      ]
        .join(" ")
        .toLowerCase();

      let score = 0;
      if (hint.includes("px") || hint.includes("perimeter")) score += 8;
      if (hint.includes("captcha") || hint.includes("human")) score += 8;
      if (hint.includes("press") || hint.includes("hold")) score += 6;
      if (score === 0 && iframes.length === 1) score = 2;
      if (score === 0) continue;

      scored.push({
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) return null;
    return { x: best.x, y: best.y, holdMs: 3_400 + Math.floor(Math.random() * 800), kind: "perimeterx" as const };
  });
}

/** Search labeled controls, then same-origin frames, then captcha iframes. */
async function findCaptchaTarget(page: FrameSearchPage): Promise<CaptchaTarget | null> {
  const frames: StealthPage[] = [page];
  if (typeof page.frames === "function") {
    frames.push(...page.frames());
  }

  for (const frame of frames) {
    try {
      const found = await findCaptchaTargetInFrame(frame);
      if (found) return found;
    } catch {
      /* cross-origin frame */
    }
  }

  try {
    return await findPxIframeTarget(page);
  } catch {
    return null;
  }
}

export interface ChallengeSolveResult {
  detected: boolean;
  solved: boolean;
  htmlAfter: string;
}

/**
 * When challenge HTML is present, attempt interactive solve then poll until
 * the interstitial is gone. PerimeterX usually stays on the same URL — do not
 * wait for a navigation that never happens.
 */
export async function solveChallengeIfPresent(
  page: StealthPage & {
    content: () => Promise<string>;
    waitForNavigation: (options?: Record<string, unknown>) => Promise<unknown>;
  },
  html: string,
  navigationTimeoutMs: number,
  cursorPage?: object,
): Promise<ChallengeSolveResult> {
  if (!looksLikeChallenge(html)) {
    return { detected: false, solved: false, htmlAfter: html };
  }

  log.info("Anti-bot challenge detected");
  const target = await findCaptchaTarget(page);
  if (target) {
    log.info("Attempting press-and-hold challenge", {
      kind: target.kind,
      x: target.x,
      y: target.y,
    });
    await humanPressAndHold(page, target.x, target.y, target.holdMs, cursorPage);
  } else {
    log.warn("Challenge detected but no interactive target found; polling for auto-clear");
  }

  const deadline = Date.now() + Math.max(15_000, navigationTimeoutMs);
  let htmlAfter = await page.content();
  while (looksLikeChallenge(htmlAfter) && Date.now() < deadline) {
    await humanDelay(400, 900);
    htmlAfter = await page.content();
  }

  const stillChallenge = looksLikeChallenge(htmlAfter);
  if (stillChallenge) {
    log.warn("Challenge HTML still present after solve window");
  }

  return {
    detected: true,
    solved: !stillChallenge,
    htmlAfter,
  };
}
