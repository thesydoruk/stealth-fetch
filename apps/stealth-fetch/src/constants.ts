/**
 * Stealth-oriented defaults — real Chrome viewport when defaultViewport is null.
 */

/** Used only when callers explicitly set a viewport; otherwise Chrome window size wins. */
export const FALLBACK_VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1 };

/**
 * Same Chromium flags as apps/browser-fetch. Extra `--disable-*` can itself be
 * a fingerprint tell, but this is the path that fetched Bloomberg before the
 * external-stealth-fetch merge.
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
