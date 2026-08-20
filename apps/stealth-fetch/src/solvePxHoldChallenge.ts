import type { ChallengeSolveResult } from "./challenge-solver";
import { findPxHoldPoint } from "./findPxHoldPoint";
import type { StealthPage } from "./human-behavior";
import { humanDelay, moveMouseHuman } from "./human-behavior";
import { looksLikePxHoldChallenge } from "./looksLikePxHoldChallenge";
import { createLogger } from "./logger";

const log = createLogger("challenge-solver");

type HoldPage = StealthPage & {
  content: () => Promise<string>;
  waitForNavigation: (options?: Record<string, unknown>) => Promise<{ status: () => number | null } | null>;
};

/** Stable press-and-hold (no drag jitter) for ~5–7s, then wait for the interstitial to drop. */
export async function solvePxHoldChallenge(
  page: HoldPage,
  html: string,
  navigationTimeoutMs: number,
): Promise<ChallengeSolveResult> {
  let htmlAfter = html;
  let response: { status: () => number | null } | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const point = await waitForHoldPoint(page);
    if (!point) {
      log.warn("Press-and-hold widget not found", { attempt });
      break;
    }

    log.info("Press-and-hold challenge: holding", { attempt, x: Math.round(point.x), y: Math.round(point.y) });
    await moveMouseHuman(page, point.x, point.y, point.x * 0.4, point.y * 0.3, page);
    await humanDelay(140, 360);
    await page.mouse.down();
    await humanDelay(5_200, 7_000);
    await page.mouse.up();
    await humanDelay(400, 900);

    try {
      response = await page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: Math.max(8_000, Math.min(navigationTimeoutMs, 20_000)),
      });
    } catch {
      /* widget may resolve in-place without a full navigation */
    }

    htmlAfter = await page.content();
    if (!looksLikePxHoldChallenge(htmlAfter)) {
      log.info("Press-and-hold challenge cleared", { attempt });
      return { detected: true, solved: true, htmlAfter, response };
    }
    log.warn("Press-and-hold still present after hold", { attempt });
  }

  return { detected: true, solved: false, htmlAfter, response };
}

async function waitForHoldPoint(page: HoldPage): Promise<{ x: number; y: number } | null> {
  for (let i = 0; i < 8; i++) {
    const point = await findPxHoldPoint(page);
    if (point) return point;
    await humanDelay(350, 650);
  }
  return null;
}
