/**
 * Warm-up navigation: homepage → optional paths → target article.
 */

import type { StealthPage } from "./human-behavior";
import {
  humanDelay,
  resolveHumanDefaults,
  simulateMouseWander,
  simulateWarmupScroll,
} from "./human-behavior";
import type { HumanSessionOptions, SessionCookie } from "./types";
import { createLogger } from "./logger";

const log = createLogger("session-flow");

export interface NavigablePage extends StealthPage {
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
  setCookie: (...cookies: SessionCookie[]) => Promise<void>;
  url: () => string;
}

/** Inject session cookies before the first navigation. */
export async function applySessionCookies(
  page: NavigablePage,
  cookies?: SessionCookie[],
): Promise<void> {
  if (!cookies?.length) return;
  await page.setCookie(...cookies);
  log.debug("Injected session cookies", { count: cookies.length });
}

/** Visit warmup URL and optional intermediate paths with human-like pauses. */
export async function runWarmupSession(
  page: NavigablePage,
  warmupUrl: string,
  warmupPaths: string[] | undefined,
  timeoutMs: number,
  human?: HumanSessionOptions,
): Promise<void> {
  const opts = resolveHumanDefaults(human);
  const waitUntil = "domcontentloaded";

  log.info("Warmup navigation", { warmupUrl });
  await page.goto(warmupUrl, { waitUntil, timeout: timeoutMs });
  await humanDelay(opts.delayMinMs, opts.delayMaxMs);

  if (opts.mouseMovement) {
    await simulateMouseWander(page, 2);
  }
  if (opts.warmupScroll) {
    await simulateWarmupScroll(page);
  }
  await humanDelay(opts.delayMinMs, opts.delayMaxMs + 400);

  const paths = (warmupPaths ?? []).filter(Boolean);
  for (const path of paths) {
    const nextUrl = new URL(path, warmupUrl).href;
    log.info("Warmup intermediate path", { url: nextUrl });
    await page.goto(nextUrl, { waitUntil, timeout: timeoutMs });
    await humanDelay(opts.delayMinMs, opts.delayMaxMs);
    if (opts.mouseMovement) await simulateMouseWander(page, 1);
    if (opts.warmupScroll) await simulateWarmupScroll(page);
  }
}
