import { looksLikePxHoldChallenge } from "./looksLikePxHoldChallenge";

/**
 * Script / iframe hosts that appear on DataDome and Cloudflare interstitials.
 * Residual copies also ship on successful pages (e.g. POLITICO still references
 * `/cdn-cgi/challenge-platform` after the story has loaded).
 */
const CHALLENGE_SIGNATURES = [
  "captcha-delivery.com",
  "geo.captcha-delivery",
  "datadome",
  "/cdn-cgi/challenge-platform",
  "cf-browser-verification",
] as const;

const INTERSTITIAL_TITLE_MARKERS = [
  "just a moment",
  "attention required",
  "access denied",
  "access to this page has been denied",
] as const;

/** Real CF / DataDome interstitials are tiny; story HTML is much larger. */
const CHALLENGE_MAX_HTML_LENGTH = 20_000;

function readTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)/i);
  return (match?.[1] ?? "").trim().toLowerCase();
}

/**
 * Active anti-bot interstitial — not leftover telemetry on a finished story.
 *
 * Same idea as PerimeterX: `datadome` / `cdn-cgi` strings are not enough.
 * A challenge needs an interstitial title or a short document.
 */
export function looksLikeChallenge(html: string): boolean {
  if (looksLikePxHoldChallenge(html)) return true;

  const lower = html.toLowerCase();
  const hasSignature = CHALLENGE_SIGNATURES.some((sig) => lower.includes(sig));
  if (!hasSignature) return false;

  const title = readTitle(html);
  if (INTERSTITIAL_TITLE_MARKERS.some((marker) => title.includes(marker))) return true;
  return html.length < CHALLENGE_MAX_HTML_LENGTH;
}
