/**
 * HTTP client for the `apps/stealth-fetch` microservice.
 */

import { createLogger } from "./logger";
import type {
  HttpClientOptions,
  StealthProxyConfig,
  StealthSessionCookie,
} from "./http-client-options";
import type { FetchedPage } from "./types";

const log = createLogger("sources:stealth-service");

interface StealthServiceResponse {
  ok: boolean;
  cached?: boolean;
  url?: string;
  finalUrl?: string | null;
  statusCode?: number | null;
  contentType?: string | null;
  html?: string;
  challengeDetected?: boolean;
  challengeSolved?: boolean;
  attempts?: number;
  error?: string;
}

function defaultBrowserTimeoutMs(): number {
  return parseInt(process.env.BROWSER_TIMEOUT_MS || "120000", 10);
}

/** Resolved stealth-fetch base URL (requires `STEALTH_FETCH_URL`). */
export function getStealthServiceUrl(): string {
  const raw = process.env.STEALTH_FETCH_URL?.trim();
  if (!raw) {
    throw new Error("STEALTH_FETCH_URL is not set");
  }
  return raw.replace(/\/+$/, "");
}

/** Fetch a page through the stealth-fetch microservice. */
export async function fetchPageViaStealthService(
  url: string,
  options: HttpClientOptions = {},
): Promise<FetchedPage> {
  const baseUrl = getStealthServiceUrl();
  const timeoutMs = options.timeoutMs ?? defaultBrowserTimeoutMs();
  const apiKey = process.env.STEALTH_FETCH_API_KEY?.trim();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["X-Api-Key"] = apiKey;

  const transportTimeoutMs = timeoutMs + 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), transportTimeoutMs);

  try {
    log.info("Fetching via stealth service", { url, baseUrl });

    const response = await fetch(`${baseUrl}/fetch`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify(buildStealthRequestBody(url, options, timeoutMs)),
    });

    if (!response.ok) {
      throw new Error(
        `stealth-fetch service returned HTTP ${response.status}: ${await safeText(response)}`,
      );
    }

    const body = (await response.json()) as StealthServiceResponse;
    if (typeof body.html !== "string") {
      throw new Error(`stealth-fetch service error: ${body.error ?? "unknown"}`);
    }

    if (!body.ok) {
      throw new Error(body.error ?? "stealth-fetch returned anti-bot challenge HTML after retries");
    }

    log.info("Stealth service responded", {
      url,
      cached: body.cached === true,
      statusCode: body.statusCode ?? null,
      htmlLength: body.html.length,
      attempts: body.attempts ?? 1,
    });

    return {
      url,
      finalUrl: body.finalUrl ?? null,
      statusCode: body.statusCode ?? null,
      contentType: body.contentType ?? null,
      html: body.html,
      fetchedAt: new Date(),
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`stealth-fetch transport timeout after ${transportTimeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function buildStealthRequestBody(
  url: string,
  options: HttpClientOptions,
  timeoutMs: number,
): Record<string, unknown> {
  return {
    url,
    timeoutMs,
    waitForSelector: options.waitForSelector,
    waitForSelectorTimeoutMs: options.waitForSelectorTimeout,
    waitForNetworkIdle: options.waitForNetworkIdle,
    headers: options.headers,
    userAgent: options.userAgent,
    referer: options.referer,
    timezone: options.timezone,
    skipCache: options.skipCache,
    hubLoadMoreSelector: options.hubLoadMoreSelector,
    hubLoadMoreMaxRepeats: options.hubLoadMoreMaxRepeats,
    hubScrollMaxRepeats: options.hubScrollMaxRepeats,
    warmupUrl: options.warmupUrl,
    warmupPaths: options.warmupPaths,
    sessionCookies: options.sessionCookies,
    proxy: options.stealthProxy,
    humanSession: options.humanSession,
    solveChallenges: options.solveChallenges,
    maxChallengeAttempts: options.maxChallengeAttempts,
    retryOnChallenge: options.retryOnChallenge,
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

export type { StealthProxyConfig, StealthSessionCookie };
