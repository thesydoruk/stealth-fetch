/**
 * HTTP service: accept a URL, return rendered HTML with disk-backed caching.
 *
 * Endpoints:
 *  - `GET  /health`  → `{ ok: true }`
 *  - `POST /fetch`   → `{ ok, cached, url, finalUrl, statusCode, contentType, html }`
 *
 * Optional `X-Api-Key` header is enforced when `FETCH_API_KEY` is set.
 */

import http from "node:http";
import { URL } from "node:url";

import { drainPool, fetchRenderedHtml } from "./fetch-page";
import { normalizeFetchUrl, readDiskCache, writeDiskCache } from "./disk-cache";
import { createLogger } from "./logger";

const log = createLogger("server");

const port = parseInt(process.env.PORT || "3040", 10);
const cacheTtlMs = Math.max(0, parseInt(process.env.CACHE_TTL_SECONDS || "86400", 10) * 1000);
const cacheDir = `${process.env.DATA_DIR || "/data"}/response-cache`;
const apiKey = process.env.FETCH_API_KEY?.trim() || "";
const maxRequestBodyBytes = Math.max(
  1024,
  parseInt(process.env.MAX_REQUEST_BODY_BYTES || "65536", 10),
);

interface FetchBody {
  url?: string;
  waitForSelector?: string;
  waitForNetworkIdle?: boolean;
  skipCache?: boolean;
  /** Override default 90s page timeout. */
  timeoutMs?: number;
  /** Override default 15s selector wait. */
  waitForSelectorTimeoutMs?: number;
  /** Extra HTTP headers (merged with stealth defaults). */
  headers?: Record<string, string>;
  /** Override stealth User-Agent. */
  userAgent?: string;
  /** `Referer` header for the navigation (sets Sec-Fetch-Site=cross-site). */
  referer?: string;
  /** IANA timezone for `Intl`/`Date` (default `America/New_York`). */
  timezone?: string;
  hubLoadMoreSelector?: string;
  hubLoadMoreMaxRepeats?: number;
  hubScrollMaxRepeats?: number;
}

function json(res: http.ServerResponse, code: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseBody(raw: string): FetchBody {
  if (!raw.trim()) return {};
  return JSON.parse(raw) as FetchBody;
}

function assertAllowedUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  return parsed;
}

async function readRequestBody(req: http.IncomingMessage, limitBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > limitBytes) {
      throw new Error(`Request body exceeds ${limitBytes} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url?.startsWith("/health")) {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && req.url?.startsWith("/info")) {
      json(res, 200, {
        ok: true,
        chromiumPath: process.env.CHROMIUM_PATH ?? null,
        headless: (process.env.BROWSER_HEADLESS ?? "true").toLowerCase() !== "false",
        display: process.env.DISPLAY ?? null,
        cacheTtlSeconds: cacheTtlMs / 1000,
      });
      return;
    }

    if (apiKey) {
      const provided = req.headers["x-api-key"];
      const key = Array.isArray(provided) ? provided[0] : provided;
      if (key !== apiKey) {
        json(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }
    }

    if (req.method === "POST" && req.url === "/fetch") {
      let body: FetchBody;
      try {
        body = parseBody(await readRequestBody(req, maxRequestBodyBytes));
      } catch (e) {
        json(res, 400, {
          ok: false,
          error: e instanceof Error ? e.message : "Invalid JSON body",
        });
        return;
      }

      const url = body.url?.trim();
      if (!url) {
        json(res, 400, { ok: false, error: 'Missing "url"' });
        return;
      }

      try {
        assertAllowedUrl(url);
      } catch (e) {
        json(res, 400, { ok: false, error: e instanceof Error ? e.message : "Bad URL" });
        return;
      }

      const normalized = normalizeFetchUrl(url);

      if (!body.skipCache) {
        const hit = await readDiskCache(cacheDir, normalized, cacheTtlMs);
        if (hit) {
          json(res, 200, {
            ok: true,
            cached: true,
            url,
            finalUrl: hit.finalUrl,
            statusCode: hit.statusCode,
            contentType: hit.contentType,
            html: hit.html,
          });
          return;
        }
      }

      const fetched = await fetchRenderedHtml(url, {
        waitForSelector: body.waitForSelector,
        waitForNetworkIdle: body.waitForNetworkIdle,
        timeoutMs: body.timeoutMs,
        waitForSelectorTimeoutMs: body.waitForSelectorTimeoutMs,
        extraHeaders: body.headers,
        userAgent: body.userAgent,
        referer: body.referer,
        timezone: body.timezone,
        hubLoadMoreSelector: body.hubLoadMoreSelector,
        hubLoadMoreMaxRepeats: body.hubLoadMoreMaxRepeats,
        hubScrollMaxRepeats: body.hubScrollMaxRepeats,
      });

      const cacheable =
        !body.skipCache &&
        fetched.statusCode !== null &&
        fetched.statusCode >= 200 &&
        fetched.statusCode < 300 &&
        fetched.html.length > 0;

      if (cacheable) {
        await writeDiskCache(cacheDir, normalized, {
          url,
          finalUrl: fetched.finalUrl,
          statusCode: fetched.statusCode,
          contentType: fetched.contentType,
          html: fetched.html,
        });
      }

      json(res, 200, {
        ok: true,
        cached: false,
        url,
        finalUrl: fetched.finalUrl,
        statusCode: fetched.statusCode,
        contentType: fetched.contentType,
        html: fetched.html,
      });
      return;
    }

    json(res, 404, { ok: false, error: "Not found" });
  } catch (e) {
    log.warn("Request failed", {
      err: e instanceof Error ? e.message : String(e),
    });
    json(res, 500, { ok: false, error: e instanceof Error ? e.message : "Internal error" });
  }
});

server.listen(port, "0.0.0.0", () => {
  log.info("Listening", {
    port,
    cacheDir,
    cacheTtlMs,
    chromiumPath: process.env.CHROMIUM_PATH ?? null,
    headless: (process.env.BROWSER_HEADLESS ?? "true").toLowerCase() !== "false",
  });
});

async function shutdown(signal: string) {
  log.info("Shutting down", { signal });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await drainPool();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
