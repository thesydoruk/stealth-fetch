/**
 * Detect DataDome / Cloudflare interstitials the same way the pre-extract
 * in-tree browser-fetch did. Those pages self-reload after fingerprinting —
 * wait for that navigation. Do not treat PerimeterX telemetry (`perimeterx`,
 * `_pxappid`) as a challenge: those strings ship on successful Bloomberg
 * articles and used to discard valid HTML as `ok: false`.
 */

import type { StealthPage } from "./human-behavior";
import { humanDelay } from "./human-behavior";
import { createLogger } from "./logger";

const log = createLogger("challenge-solver");

/** Same signatures as apps/browser-fetch (in-tree, pre-merge). */
const CHALLENGE_SIGNATURES = [
  "captcha-delivery.com",
  "geo.captcha-delivery",
  "datadome",
  "/cdn-cgi/challenge-platform",
  "cf-browser-verification",
];

export function looksLikeChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  return CHALLENGE_SIGNATURES.some((sig) => lower.includes(sig));
}

export interface ChallengeSolveResult {
  detected: boolean;
  solved: boolean;
  htmlAfter: string;
  response?: { status: () => number | null } | null;
}

/**
 * When a DataDome / Cloudflare interstitial is present, wait for its
 * auto-reload. No press-and-hold — that is not how the working browser-fetch
 * path handled Bloomberg.
 */
export async function solveChallengeIfPresent(
  page: StealthPage & {
    content: () => Promise<string>;
    waitForNavigation: (options?: Record<string, unknown>) => Promise<{ status: () => number | null } | null>;
  },
  html: string,
  navigationTimeoutMs: number,
): Promise<ChallengeSolveResult> {
  if (!looksLikeChallenge(html)) {
    return { detected: false, solved: false, htmlAfter: html };
  }

  log.info("Anti-bot challenge detected, waiting for auto-navigation");
  let response: { status: () => number | null } | null = null;
  try {
    response = await page.waitForNavigation({
      waitUntil: "networkidle2",
      timeout: Math.max(15_000, navigationTimeoutMs),
    });
    await humanDelay(500, 1_200);
  } catch (err) {
    log.warn("Challenge auto-navigation did not complete", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const htmlAfter = await page.content();
  return {
    detected: true,
    solved: !looksLikeChallenge(htmlAfter),
    htmlAfter,
    response,
  };
}
