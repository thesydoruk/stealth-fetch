/**
 * Shared options for browser-fetch and stealth-fetch transports.
 */

/** Cookie injected into a stealth browser session before navigation. */
export interface StealthSessionCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/** Optional upstream proxy for stealth-fetch Chromium launches. */
export interface StealthProxyConfig {
  url: string;
  username?: string;
  password?: string;
}

/** Human-behavior knobs forwarded to stealth-fetch. */
export interface StealthHumanSessionOptions {
  mouseMovement?: boolean;
  warmupScroll?: boolean;
  readingScroll?: boolean;
  readingScrollSteps?: number;
  delayMinMs?: number;
  delayMaxMs?: number;
}

export interface HttpClientOptions {
  timeoutMs?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  waitForSelector?: string;
  waitForSelectorTimeout?: number;
  waitForNetworkIdle?: boolean;
  referer?: string;
  timezone?: string;
  skipCache?: boolean;
  hubLoadMoreSelector?: string;
  hubLoadMoreMaxRepeats?: number;
  hubScrollMaxRepeats?: number;
  warmupUrl?: string;
  warmupPaths?: string[];
  sessionCookies?: StealthSessionCookie[];
  stealthProxy?: StealthProxyConfig;
  humanSession?: StealthHumanSessionOptions;
  solveChallenges?: boolean;
  maxChallengeAttempts?: number;
  retryOnChallenge?: boolean;
}
