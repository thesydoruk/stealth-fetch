/**
 * Bloomberg / HUMAN (PerimeterX) Press & Hold interstitial.
 * Do not match `perimeterx` / `_pxappid` — those ship on real articles.
 */
export function looksLikePxHoldChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  if (
    lower.includes("press & hold to confirm you are") ||
    lower.includes("press and hold to confirm you are") ||
    lower.includes("are you a robot")
  ) {
    return true;
  }
  if (!lower.includes("px-captcha")) return false;
  return !lower.includes("__next_data__") && !/<h1[\s>]/i.test(html);
}
