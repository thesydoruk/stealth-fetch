/**
 * Full stealth page fetch: warm session, human behavior, challenge solving, reading scroll.
 */

import { acquireBrowser, releaseBrowser, type PooledBrowser } from "./browser-pool";
import { looksLikeChallenge, solveChallengeIfPresent } from "./challenge-solver";
import { findChromePath, resolveStealthLaunchOptions } from "./find-chrome";
import {
  attachHumanCursor,
  humanDelay,
  resolveHumanDefaults,
  simulateMouseWander,
  simulateReadingScroll,
  type StealthPage,
} from "./human-behavior";
import { createLogger } from "./logger";
import { FALLBACK_VIEWPORT } from "./constants";
import { discardCookiesIfPoisoned } from "./discard-poisoned-session";
import {
  createSessionDeadline,
  FetchCancelledError,
  type SessionDeadline,
} from "./session-deadline";
import { applySessionCookies, runWarmupSession, type NavigablePage } from "./session-flow";
import type { StealthFetchOptions, StealthFetchResult } from "./types";

const log = createLogger("fetch-page");

/** Skip a challenge retry when less than this remains on the session clock. */
const MIN_CHALLENGE_RETRY_MS = 8_000;

interface PuppeteerResponse {
  status: () => number | null;
  headers: () => Record<string, string>;
}

interface PuppeteerPage extends NavigablePage, StealthPage {
  setUserAgent: (ua: string) => Promise<void>;
  setViewport?: (vp: { width: number; height: number; deviceScaleFactor?: number }) => Promise<void>;
  setExtraHTTPHeaders: (headers: Record<string, string>) => Promise<void>;
  setJavaScriptEnabled: (enabled: boolean) => Promise<void>;
  emulateTimezone?: (timezone: string) => Promise<void>;
  goto: (url: string, options?: Record<string, unknown>) => Promise<PuppeteerResponse | null>;
  waitForSelector: (selector: string, options?: Record<string, unknown>) => Promise<unknown>;
  waitForNavigation: (options?: Record<string, unknown>) => Promise<PuppeteerResponse | null>;
  content: () => Promise<string>;
  close: () => Promise<void>;
  cookies?: () => Promise<Array<Record<string, unknown>>>;
  deleteCookie?: (...cookies: Array<Record<string, unknown>>) => Promise<void>;
}

async function configurePage(page: PuppeteerPage, options: StealthFetchOptions): Promise<void> {
  if (options.userAgent) await page.setUserAgent(options.userAgent);
  if (page.setViewport) await page.setViewport(FALLBACK_VIEWPORT);

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

  if (page.emulateTimezone) {
    try {
      await page.emulateTimezone(options.timezone ?? "America/New_York");
    } catch {
      /* unsupported tz */
    }
  }

  await page.setJavaScriptEnabled(true);
  await applySessionCookies(page, options.sessionCookies);
}

async function navigateTarget(
  page: PuppeteerPage,
  url: string,
  options: StealthFetchOptions,
  deadline: SessionDeadline,
): Promise<PuppeteerResponse | null> {
  const waitUntil = options.waitForNetworkIdle ? "networkidle2" : "domcontentloaded";
  const gotoOptions: Record<string, unknown> = {
    waitUntil,
    timeout: deadline.capTimeoutMs(options.timeoutMs),
  };
  if (options.referer) gotoOptions.referer = options.referer;
  return page.goto(url, gotoOptions);
}

async function expandHubListing(page: PuppeteerPage, options: StealthFetchOptions): Promise<void> {
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

async function fetchOnce(
  url: string,
  options: StealthFetchOptions,
  deadline: SessionDeadline,
): Promise<StealthFetchResult> {
  const human = resolveHumanDefaults(options.humanSession);
  deadline.throwIfCancelled();

  const browser = await acquireBrowser({
    launchOptions: resolveStealthLaunchOptions(
      options.chromiumPath,
      deadline.capTimeoutMs(options.timeoutMs),
    ),
    proxy: options.proxy,
    signal: deadline.signal,
    waitTimeoutMs: deadline.remainingMs(),
  });

  let challengeDetected = false;
  let challengeSolved = false;
  let page: PuppeteerPage | undefined;
  const onAbort = (): void => {
    void page?.close().catch(() => {});
  };
  deadline.signal?.addEventListener("abort", onAbort);

  try {
    page = (await (
      browser as unknown as { newPage: () => Promise<PuppeteerPage> }
    ).newPage()) as PuppeteerPage;

    attachHumanCursor(page);
    await configurePage(page, options);

    if (options.warmupUrl) {
      await runWarmupSession(
        page,
        options.warmupUrl,
        options.warmupPaths,
        options.timeoutMs,
        options.humanSession,
        page,
        deadline,
      );
      deadline.throwIfCancelled();
      await humanDelay(human.delayMinMs, human.delayMaxMs + 600);
    } else if (human.mouseMovement) {
      await simulateMouseWander(page, 1, page);
    }

    let response = await navigateTarget(page, url, options, deadline);
    deadline.throwIfCancelled();
    await humanDelay(700, 1_600);

    let html = await page.content();

    if (options.solveChallenges !== false && looksLikeChallenge(html)) {
      const solved = await solveChallengeIfPresent(
        page,
        html,
        deadline.capTimeoutMs(options.waitForSelectorTimeoutMs),
      );
      challengeDetected = solved.detected;
      challengeSolved = solved.solved;
      html = solved.htmlAfter;
      if (solved.response) response = solved.response as PuppeteerResponse;
    }

    if (options.waitForSelector) {
      try {
        await page.waitForSelector(options.waitForSelector, {
          timeout: deadline.capTimeoutMs(options.waitForSelectorTimeoutMs),
        });
        await humanDelay(300, 900);
      } catch (err) {
        if (err instanceof FetchCancelledError) throw err;
        log.warn("waitForSelector timed out", {
          url,
          selector: options.waitForSelector,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (human.mouseMovement) {
      await simulateMouseWander(page, 2, page);
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
    deadline.signal?.removeEventListener("abort", onAbort);
    await page?.close().catch(() => {});
    releaseBrowser(browser as PooledBrowser);
  }
}

/** Light in-page scroll — same as in-tree browser-fetch, not a full reading pass. */
async function simulateLightScroll(page: PuppeteerPage): Promise<void> {
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

/**
 * Fetch rendered HTML with warm session, human simulation, and challenge retries.
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
    headless: partial.headless ?? process.env.BROWSER_HEADLESS === "true",
    chromiumPath: partial.chromiumPath ?? findChromePath(),
    solveChallenges: partial.solveChallenges ?? true,
    retryOnChallenge: partial.retryOnChallenge ?? true,
    maxChallengeAttempts: partial.maxChallengeAttempts ?? 2,
    ...partial,
  };

  const deadline = createSessionDeadline(options.timeoutMs, options.signal);
  const maxAttempts = Math.max(
    1,
    options.retryOnChallenge ? (options.maxChallengeAttempts ?? 2) : 1,
  );
  let last: StealthFetchResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    deadline.throwIfCancelled();
    if (attempt > 1 && deadline.remainingMs() < MIN_CHALLENGE_RETRY_MS) {
      log.warn("Skipping challenge retry, session budget exhausted", {
        url,
        remainingMs: deadline.remainingMs(),
      });
      break;
    }
    log.info("Stealth fetch attempt", { url, attempt, maxAttempts });
    const result = await fetchOnce(url, options, deadline);
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
