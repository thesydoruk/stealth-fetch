/**
 * Stealth-oriented defaults for browser fetching.
 *
 * `STEALTH_USER_AGENT`/`STEALTH_CH_UA*` must match each other and the installed
 * Chrome version — DataDome and similar systems compare them.
 */

const CHROME_VERSION_MAJOR = "131";

export const STEALTH_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION_MAJOR}.0.0.0 Safari/537.36`;

/** Client Hints sent on navigation requests. */
export const STEALTH_CH_UA = `"Chromium";v="${CHROME_VERSION_MAJOR}", "Not_A Brand";v="24", "Google Chrome";v="${CHROME_VERSION_MAJOR}"`;
export const STEALTH_CH_UA_MOBILE = "?0";
export const STEALTH_CH_UA_PLATFORM = '"Windows"';

export const STEALTH_VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1 };

/**
 * Chromium flags. Notes on inclusions/exclusions:
 * - `--disable-features=IsolateOrigins,site-per-process` is intentionally NOT
 *   set — real Chrome enables site isolation and disabling it is a known
 *   automation tell.
 * - `--no-sandbox` is required because the container runs Chrome as a non-root
 *   user without the SUID sandbox helper.
 */
export const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,AcceptCHFrame,AutoExpandDetailsElement,CertificateTransparencyComponentUpdater,AvoidUnnecessaryBeforeUnloadCheckSync,BackForwardCache",
  "--disable-infobars",
  "--no-first-run",
  "--no-default-browser-check",
  "--no-pings",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-breakpad",
  "--disable-dev-shm-usage",
  "--disable-hang-monitor",
  "--disable-ipc-flooding-protection",
  "--disable-popup-blocking",
  "--disable-prompt-on-repost",
  "--disable-renderer-backgrounding",
  "--disable-sync",
  "--metrics-recording-only",
  "--password-store=basic",
  "--use-mock-keychain",
  "--lang=en-US,en",
  "--window-size=1920,1080",
  "--no-sandbox",
  "--disable-setuid-sandbox",
];
