/**
 * PerimeterX / DataDome cookies on a pooled Chrome profile survive across
 * fetches. After a 403 robot page they mark the slot as a bot even when the
 * same public IP is fine in a normal browser. Drop them so the next navigation
 * is a clean session.
 */

import { looksLikeChallenge } from "./challenge-solver";
import { createLogger } from "./logger";

const log = createLogger("poisoned-session");

interface CookieJarPage {
  cookies?: () => Promise<Array<Record<string, unknown>>>;
  deleteCookie?: (...cookies: Array<Record<string, unknown>>) => Promise<void>;
}

export function looksLikePoisonedSession(html: string, statusCode: number | null): boolean {
  if (statusCode === 403) return true;
  if (looksLikeChallenge(html)) return true;
  const lower = html.toLowerCase();
  return (
    lower.includes("are you a robot") ||
    lower.includes("press & hold to confirm you are") ||
    lower.includes("press and hold to confirm you are")
  );
}

/** Delete cookies on this page when the response is an anti-bot interstitial. */
export async function discardCookiesIfPoisoned(
  page: CookieJarPage,
  html: string,
  statusCode: number | null,
): Promise<void> {
  if (!looksLikePoisonedSession(html, statusCode)) return;
  if (!page.cookies || !page.deleteCookie) return;
  try {
    const cookies = await page.cookies();
    if (cookies.length === 0) return;
    await page.deleteCookie(...cookies);
    log.info("Cleared cookies after anti-bot response", { count: cookies.length, statusCode });
  } catch (err) {
    log.warn("Failed to clear cookies after anti-bot response", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
