/**
 * Fetch rendered HTML via stealth puppeteer (shared browser pool, incognito per request).
 */

import fs from "node:fs";

import { acquireBrowser, drainPool, releaseBrowser, type PooledBrowser } from "./browser-pool";
import { STEALTH_ARGS, STEALTH_VIEWPORT } from "./constants";
import { looksLikeChallenge } from "./looksLikeChallenge";
import { createLogger } from "./logger";

const log = createLogger("fetch-page");

interface PuppeteerResponse {
  status: () => number | null;
  headers: () => Record<string, string>;
}

interface PuppeteerPage {
  setUserAgent: (ua: string) => Promise<void>;
  setViewport: (vp: { width: number; height: number; deviceScaleFactor?: number }) => Promise<void>;
  setExtraHTTPHeaders: (headers: Record<string, string>) => Promise<void>;
  evaluateOnNewDocument: (script: string) => Promise<void>;
  setJavaScriptEnabled: (enabled: boolean) => Promise<void>;
  emulateTimezone?: (timezone: string) => Promise<void>;
  goto: (url: string, options?: Record<string, unknown>) => Promise<PuppeteerResponse | null>;
  url: () => string;
  content: () => Promise<string>;
  waitForSelector: (selector: string, options?: Record<string, unknown>) => Promise<unknown>;
  waitForNavigation: (options?: Record<string, unknown>) => Promise<PuppeteerResponse | null>;
  evaluate: <T>(fn: (...args: unknown[]) => T, ...args: unknown[]) => Promise<T>;
}

export interface FetchPageOptions {
  timeoutMs: number;
  waitForSelector?: string;
  waitForSelectorTimeoutMs: number;
  waitForNetworkIdle: boolean;
  headless: boolean;
  chromiumPath: string;
  /** Extra HTTP headers merged into the request. */
  extraHeaders?: Record<string, string>;
  /** User-Agent override. */
  userAgent?: string;
  /** `Referer` to send on the navigation request (e.g. https://www.google.com/). */
  referer?: string;
  /** IANA timezone for `Intl` and Date APIs (e.g. "America/New_York"). */
  timezone?: string;
  /** CSS selector for hub “load more” — clicked up to `hubLoadMoreMaxRepeats`. */
  hubLoadMoreSelector?: string;
  hubLoadMoreMaxRepeats?: number;
  /** Scroll-to-bottom cycles for infinite-scroll hub listings. */
  hubScrollMaxRepeats?: number;
}

function findChromePath(): string {
  if (process.env.CHROMIUM_PATH) {
    if (fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
    throw new Error(`CHROMIUM_PATH missing: ${process.env.CHROMIUM_PATH}`);
  }
  const candidates = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Chrome not found; set CHROMIUM_PATH.");
}

/**
 * Opens an isolated incognito context, loads `url`, waits for network/content,
 * simulates light scrolling, and returns final DOM HTML plus HTTP metadata.
 */
export async function fetchRenderedHtml(url: string, options: Partial<FetchPageOptions> = {}) {
  const timeoutMs = options.timeoutMs ?? parseInt(process.env.FETCH_TIMEOUT_MS || "90000", 10);
  const waitForSelectorTimeoutMs =
    options.waitForSelectorTimeoutMs ??
    parseInt(process.env.FETCH_WAIT_FOR_SELECTOR_MS || "15000", 10);
  const waitForNetworkIdle = options.waitForNetworkIdle ?? true;
  const headless = options.headless ?? process.env.BROWSER_HEADLESS !== "false";
  const chromiumPath = options.chromiumPath ?? findChromePath();

  const launchArgs = [...STEALTH_ARGS];

  const extraArgs = process.env.CHROMIUM_LAUNCH_ARGS;
  if (extraArgs) {
    launchArgs.push(
      ...extraArgs
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
    );
  }

  const browser = await acquireBrowser({
    headless,
    executablePath: chromiumPath,
    args: launchArgs,
    defaultViewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
    timeout: timeoutMs,
  });

  // Use the default (persistent) browser context, NOT an incognito one. The
  // default context shares cookies/storage with the on-disk profile, so a
  // `datadome=…` / `cf_clearance=…` cookie obtained on one request is reused
  // by every subsequent request landing on the same pool slot. Cookies are
  // SameSite-isolated per host, so cross-domain leakage is not a concern.
  try {
    const page = (await (
      browser as unknown as {
        newPage: () => Promise<PuppeteerPage>;
      }
    ).newPage()) as PuppeteerPage;

    // Trust Chrome's real UA / Sec-CH-UA / platform — overriding them creates a
    // mismatch between `navigator.userAgent` and `navigator.userAgentData` that
    // DataDome and similar fingerprinters catch instantly. Only set UA when
    // the caller forced one explicitly.
    if (options.userAgent) await page.setUserAgent(options.userAgent);
    await page.setViewport(STEALTH_VIEWPORT);

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
        /* ignore unsupported tz */
      }
    }

    // Stealth plugin already patches navigator.webdriver, plugins, languages,
    // chrome.runtime, WebGL vendor/renderer, etc. Layering extra overrides on
    // top tends to introduce inconsistencies (e.g. spoofed platform vs. real
    // userAgentData) that fingerprinters key on, so we no longer add manual
    // patches here.

    await page.setJavaScriptEnabled(true);

    const waitUntil = waitForNetworkIdle ? "networkidle2" : "domcontentloaded";
    const gotoOptions: Record<string, unknown> = { waitUntil, timeout: timeoutMs };
    if (options.referer) gotoOptions.referer = options.referer;
    let response = await page.goto(url, gotoOptions);

    await delay(700, 1600);

    // DataDome / Cloudflare challenges return a tiny HTML doc whose embedded JS
    // collects fingerprints and reloads the parent on success. Wait for that
    // self-navigation up to the configured selector timeout before giving up.
    let initialHtml = await page.content();
    if (looksLikeChallenge(initialHtml)) {
      log.info("Anti-bot challenge detected, waiting for auto-navigation", {
        url,
        statusCode: response?.status() ?? null,
      });
      try {
        const reloaded = await page.waitForNavigation({
          waitUntil: "networkidle2",
          timeout: Math.max(15_000, waitForSelectorTimeoutMs),
        });
        if (reloaded) response = reloaded;
        await delay(500, 1200);
        initialHtml = await page.content();
      } catch (err) {
        log.warn("Challenge auto-navigation did not complete", {
          url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (options.waitForSelector) {
      try {
        await page.waitForSelector(options.waitForSelector, { timeout: waitForSelectorTimeoutMs });
        await delay(300, 900);
      } catch (err) {
        log.warn("waitForSelector timed out, capturing current HTML", {
          url,
          selector: options.waitForSelector,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await simulateHumanActivity(page);
    await expandHubListing(page, options);

    const finalUrl = page.url();
    const html = await page.content();
    const statusCode = response?.status() ?? null;
    const contentType = response?.headers()?.["content-type"] ?? null;

    await (page as unknown as { close: () => Promise<void> }).close();

    return {
      finalUrl: finalUrl !== url ? finalUrl : null,
      statusCode,
      contentType,
      html,
    };
  } finally {
    releaseBrowser(browser as PooledBrowser);
  }
}

function delay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((r) => setTimeout(r, ms));
}

async function simulateHumanActivity(page: PuppeteerPage): Promise<void> {
  try {
    await page.evaluate(() => {
      const w = globalThis as unknown as {
        scrollBy: (options: { top: number; behavior: string }) => void;
        innerHeight: number;
      };
      w.scrollBy({ top: Math.floor(w.innerHeight * 0.35), behavior: "instant" });
    });
    await delay(250, 700);
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

async function expandHubListing(
  page: PuppeteerPage,
  options: Partial<FetchPageOptions>,
): Promise<void> {
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
      await delay(900, 1_800);
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
      await delay(700, 1_400);
    }
  }
}

export { drainPool };
