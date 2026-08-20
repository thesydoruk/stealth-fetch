/**
 * Stealth page fetch via Camoufox: warm session, human behavior, challenge wait.
 */

import { acquireBrowser, releaseBrowser, type PooledBrowser } from "./browser-pool";
import { looksLikeChallenge, solveChallengeIfPresent } from "./challenge-solver";
import { discardCookiesIfPoisoned } from "./discard-poisoned-session";
import {
  humanDelay,
  resolveHumanDefaults,
  simulateMouseWander,
  simulateReadingScroll,
} from "./human-behavior";
import { createLogger } from "./logger";
import { adaptPlaywrightPage, type AdaptedPage } from "./playwright-page-adapter";
import { applySessionCookies, runWarmupSession } from "./session-flow";
import type { StealthFetchOptions, StealthFetchResult } from "./types";

const log = createLogger("fetch-page");

interface GotoResponse {
  status: () => number | null;
  headers: () => Record<string, string>;
}

async function configurePage(page: AdaptedPage, options: StealthFetchOptions): Promise<void> {
  const baseHeaders: Record<string, string> = {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "max-age=0",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": options.referer ? "cross-site" : "none",
    "Sec-Fetch-User": "?1",
  };
  if (options.referer) baseHeaders.Referer = options.referer;
  await page.setExtraHTTPHeaders({ ...baseHeaders, ...(options.extraHeaders ?? {}) });
  await applySessionCookies(page, options.sessionCookies);
}

async function navigateTarget(
  page: AdaptedPage,
  url: string,
  options: StealthFetchOptions,
): Promise<GotoResponse | null> {
  const waitUntil = options.waitForNetworkIdle ? "networkidle" : "domcontentloaded";
  const gotoOptions: Record<string, unknown> = { waitUntil, timeout: options.timeoutMs };
  if (options.referer) gotoOptions.referer = options.referer;
  return page.goto(url, gotoOptions);
}

async function expandHubListing(page: AdaptedPage, options: StealthFetchOptions): Promise<void> {
  const clickSelector = options.hubLoadMoreSelector?.trim();
  const maxClicks = options.hubLoadMoreMaxRepeats ?? 0;
  const maxScrolls = options.hubScrollMaxRepeats ?? 0;

  if (clickSelector && maxClicks > 0) {
    for (let i = 0; i < maxClicks; i++) {
      const clicked = await page.evaluate((selector) => {
        if (typeof selector !== "string") return false;
        const button = document.querySelector(selector);
        if (!(button instanceof HTMLElement)) return false;
        const rect = button.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        button.scrollIntoView({ block: "center", behavior: "instant" });
        button.click();
        return true;
      }, clickSelector);
      if (!clicked) break;
      await humanDelay(900, 1_800);
    }
  }

  if (maxScrolls > 0) {
    for (let i = 0; i < maxScrolls; i++) {
      await page.evaluate(() => {
        const w = globalThis as unknown as {
          scrollTo: (options: { top: number; behavior: string }) => void;
          scrollHeight: number;
        };
        w.scrollTo({ top: w.scrollHeight, behavior: "instant" });
      });
      await humanDelay(700, 1_400);
    }
  }
}

async function simulateLightScroll(page: AdaptedPage): Promise<void> {
  try {
    await page.evaluate(() => {
      const w = globalThis as unknown as {
        scrollBy: (options: { top: number; behavior: string }) => void;
        innerHeight: number;
      };
      w.scrollBy({ top: Math.floor(w.innerHeight * 0.35), behavior: "instant" });
    });
    await humanDelay(250, 700);
    await page.evaluate(() => {
      const w = globalThis as unknown as {
        scrollBy: (options: { top: number; behavior: string }) => void;
        innerHeight: number;
      };
      w.scrollBy({ top: -Math.floor(w.innerHeight * 0.12), behavior: "instant" });
    });
  } catch {
    /* ignore */
  }
}

async function fetchOnce(url: string, options: StealthFetchOptions): Promise<StealthFetchResult> {
  const human = resolveHumanDefaults(options.humanSession);
  const browser = await acquireBrowser({ proxy: options.proxy });

  let challengeDetected = false;
  let challengeSolved = false;

  try {
    const pwPage = await browser.newPage();
    const page = adaptPlaywrightPage(pwPage, browser.context);
    await configurePage(page, options);

    if (options.warmupUrl) {
      await runWarmupSession(
        page,
        options.warmupUrl,
        options.warmupPaths,
        options.timeoutMs,
        options.humanSession,
      );
      await humanDelay(human.delayMinMs, human.delayMaxMs + 600);
    } else if (human.mouseMovement) {
      await simulateMouseWander(page, 1);
    }

    let response = await navigateTarget(page, url, options);
    await humanDelay(700, 1_600);

    let html = await page.content();

    if (options.solveChallenges !== false && looksLikeChallenge(html)) {
      const solved = await solveChallengeIfPresent(page, html, options.waitForSelectorTimeoutMs);
      challengeDetected = solved.detected;
      challengeSolved = solved.solved;
      html = solved.htmlAfter;
      if (solved.response) response = solved.response as GotoResponse;
    }

    if (options.waitForSelector) {
      try {
        await page.waitForSelector(options.waitForSelector, {
          timeout: options.waitForSelectorTimeoutMs,
        });
        await humanDelay(300, 900);
      } catch (err) {
        log.warn("waitForSelector timed out", {
          url,
          selector: options.waitForSelector,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (human.mouseMovement) {
      await simulateMouseWander(page, 2);
    }
    if (human.readingScroll) {
      await simulateReadingScroll(page, human.readingScrollSteps);
    } else {
      await simulateLightScroll(page);
    }

    await expandHubListing(page, options);

    const finalUrl = page.url();
    html = await page.content();
    if (looksLikeChallenge(html)) {
      challengeDetected = true;
      challengeSolved = false;
    }

    const statusCode = response?.status() ?? null;
    await discardCookiesIfPoisoned(page, html, statusCode);
    await page.close();

    return {
      finalUrl: finalUrl !== url ? finalUrl : null,
      statusCode,
      contentType: response?.headers()?.["content-type"] ?? null,
      html,
      challengeDetected,
      challengeSolved,
      attempts: 1,
    };
  } finally {
    releaseBrowser(browser);
  }
}

/**
 * Fetch rendered HTML with Camoufox, human simulation, and challenge retries.
 */
export async function fetchStealthHtml(
  url: string,
  partial: Partial<StealthFetchOptions> = {},
): Promise<StealthFetchResult> {
  const options: StealthFetchOptions = {
    timeoutMs: partial.timeoutMs ?? parseInt(process.env.FETCH_TIMEOUT_MS || "120000", 10),
    waitForSelectorTimeoutMs:
      partial.waitForSelectorTimeoutMs ??
      parseInt(process.env.FETCH_WAIT_FOR_SELECTOR_MS || "20000", 10),
    waitForNetworkIdle: partial.waitForNetworkIdle ?? true,
    headless: partial.headless ?? process.env.BROWSER_HEADLESS !== "false",
    chromiumPath: partial.chromiumPath ?? process.env.CAMOUFOX_INSTALL_DIR ?? "/opt/camoufox",
    solveChallenges: partial.solveChallenges ?? true,
    retryOnChallenge: partial.retryOnChallenge ?? true,
    maxChallengeAttempts: partial.maxChallengeAttempts ?? 2,
    ...partial,
  };

  const maxAttempts = Math.max(
    1,
    options.retryOnChallenge ? (options.maxChallengeAttempts ?? 2) : 1,
  );
  let last: StealthFetchResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log.info("Stealth fetch attempt", { url, attempt, maxAttempts });
    const result = await fetchOnce(url, options);
    result.attempts = attempt;
    last = result;

    if (!result.challengeDetected || result.challengeSolved) {
      return result;
    }
    if (attempt < maxAttempts) {
      log.warn("Challenge persisted, retrying with fresh browser slot", { url, attempt });
      await humanDelay(1_500, 3_500);
    }
  }

  return last!;
}

export { drainPool } from "./browser-pool";
