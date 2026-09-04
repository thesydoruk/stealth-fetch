/**
 * Request/response contracts for the stealth-fetch HTTP service.
 */

/** Cookie injected before navigation (Puppeteer `setCookie` shape). */
export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/**
 * Optional upstream proxy for Chromium.
 * Accepted by the service API; callers may omit it until proxy routing is configured.
 */
export interface ProxyConfig {
  /** e.g. `http://host:port` or `socks5://host:port` */
  url: string;
  /** Optional basic auth — not wired yet; reserved for future proxy auth support. */
  username?: string;
  password?: string;
}

/** Human-behavior knobs applied during warmup and article reading. */
export interface HumanSessionOptions {
  /** Curved mouse moves before/after navigation. Default true. */
  mouseMovement?: boolean;
  /** Light scroll on the warmup page. Default true. */
  warmupScroll?: boolean;
  /** Gradual scroll while “reading” the target page. Default true. */
  readingScroll?: boolean;
  /** Number of reading scroll steps. Default 4. */
  readingScrollSteps?: number;
  /** Min delay between human actions in ms. Default 400. */
  delayMinMs?: number;
  /** Max delay between human actions in ms. Default 1400. */
  delayMaxMs?: number;
}

export interface StealthFetchOptions {
  timeoutMs: number;
  waitForSelector?: string;
  waitForSelectorTimeoutMs: number;
  waitForNetworkIdle: boolean;
  headless: boolean;
  chromiumPath: string;
  extraHeaders?: Record<string, string>;
  /** Only set when the caller must override — real Chrome UA is preferred. */
  userAgent?: string;
  referer?: string;
  timezone?: string;
  hubLoadMoreSelector?: string;
  hubLoadMoreMaxRepeats?: number;
  hubScrollMaxRepeats?: number;
  /** Navigate here first to warm cookies and behavioral score. */
  warmupUrl?: string;
  /** Extra pages visited between warmup and target (same origin recommended). */
  warmupPaths?: string[];
  sessionCookies?: SessionCookie[];
  /** Optional proxy — passed to Chromium when set. */
  proxy?: ProxyConfig;
  humanSession?: HumanSessionOptions;
  /** Attempt PerimeterX / Cloudflare / DataDome solvers. Default true. */
  solveChallenges?: boolean;
  maxChallengeAttempts?: number;
  /** Retry fetch with a fresh pool slot when challenge HTML persists. Default true. */
  retryOnChallenge?: boolean;
  /** Abort the session when the HTTP client disconnects. */
  signal?: AbortSignal;
}

export interface StealthFetchResult {
  finalUrl: string | null;
  statusCode: number | null;
  contentType: string | null;
  html: string;
  challengeDetected: boolean;
  challengeSolved: boolean;
  attempts: number;
}
