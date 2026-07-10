/**
 * HTTP client for the standalone `apps/browser-fetch` microservice.
 */

import { createLogger } from "./logger";
import type { HttpClientOptions } from "./http-client-options";
import type { FetchedPage } from "./types";

const log = createLogger("sources:browser-service");

interface BrowserServiceResponse {
  ok: boolean;
  cached?: boolean;
  url?: string;
  finalUrl?: string | null;
  statusCode?: number | null;
  contentType?: string | null;
  html?: string;
  error?: string;
}

function defaultBrowserTimeoutMs(): number {
  return parseInt(process.env.BROWSER_TIMEOUT_MS || "90000", 10);
}

/** Resolved browser-fetch base URL (requires `BROWSER_FETCH_URL`). */
export function getBrowserServiceUrl(): string {
  const raw = process.env.BROWSER_FETCH_URL?.trim();
  if (!raw) {
    throw new Error("BROWSER_FETCH_URL is not set");
  }
  return raw.replace(/\/+$/, "");
}

/** Fetch a page through the browser-fetch microservice. */
export async function fetchPageViaBrowserService(
  url: string,
  options: HttpClientOptions = {},
): Promise<FetchedPage> {
  const baseUrl = getBrowserServiceUrl();
  const timeoutMs = options.timeoutMs ?? defaultBrowserTimeoutMs();
  const apiKey = process.env.BROWSER_FETCH_API_KEY?.trim();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["X-Api-Key"] = apiKey;

  const transportTimeoutMs = timeoutMs + 5_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), transportTimeoutMs);

  try {
    log.info("Fetching via browser service", { url, baseUrl });

    const response = await fetch(`${baseUrl}/fetch`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
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
      }),
    });

    if (!response.ok) {
      throw new Error(
        `browser-fetch service returned HTTP ${response.status}: ${await safeText(response)}`,
      );
    }

    const body = (await response.json()) as BrowserServiceResponse;
    if (!body.ok || typeof body.html !== "string") {
      throw new Error(`browser-fetch service error: ${body.error ?? "unknown"}`);
    }

    log.info("Browser service responded", {
      url,
      cached: body.cached === true,
      statusCode: body.statusCode ?? null,
      htmlLength: body.html.length,
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
      throw new Error(`browser-fetch transport timeout after ${transportTimeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}
