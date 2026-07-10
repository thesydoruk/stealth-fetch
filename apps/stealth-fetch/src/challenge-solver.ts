/**
 * Detect and attempt to solve anti-bot interstitials (PerimeterX, DataDome, Cloudflare).
 */

import type { StealthPage } from "./human-behavior";
import { humanDelay, humanPressAndHold } from "./human-behavior";
import { createLogger } from "./logger";

const log = createLogger("challenge-solver");

const CHALLENGE_MARKERS = [
  "captcha-delivery.com",
  "geo.captcha-delivery",
  "datadome",
  "/cdn-cgi/challenge-platform",
  "cf-browser-verification",
  "perimeterx",
  "px-captcha",
  "press & hold",
  "press and hold",
  "_pxappid",
  "are you a robot",
];

export function looksLikeChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  return CHALLENGE_MARKERS.some((sig) => lower.includes(sig));
}

interface CaptchaTarget {
  x: number;
  y: number;
  holdMs: number;
  kind: "perimeterx" | "generic";
}

/** Locate a press-and-hold or captcha control inside the main frame. */
async function findCaptchaTarget(page: StealthPage): Promise<CaptchaTarget | null> {
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
        const text = (el.innerText || el.textContent || "").toLowerCase();
        const rect = el.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 20) return;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;

        let score = 0;
        let kind: "perimeterx" | "generic" = "generic";
        if (text.includes("press") && text.includes("hold")) score += 10;
        if (el.id.includes("px") || el.className.toLowerCase().includes("px-captcha")) {
          score += 12;
          kind = "perimeterx";
        }
        if (selector === "#px-captcha") score += 15;
        if (score > 0) candidates.push({ el, score, kind });
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

export interface ChallengeSolveResult {
  detected: boolean;
  solved: boolean;
  htmlAfter: string;
}

/**
 * When challenge HTML is present, attempt interactive solve then wait for navigation.
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
    log.warn("Challenge detected but no interactive target found; waiting for auto-navigation");
  }

  try {
    await page.waitForNavigation({
      waitUntil: "networkidle2",
      timeout: Math.max(15_000, navigationTimeoutMs),
    });
    await humanDelay(500, 1_200);
  } catch (err) {
    log.warn("Post-challenge navigation did not complete", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const htmlAfter = await page.content();
  const stillChallenge = looksLikeChallenge(htmlAfter);
  return {
    detected: true,
    solved: !stillChallenge,
    htmlAfter,
  };
}
