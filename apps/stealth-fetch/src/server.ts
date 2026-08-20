/**
 * HTTP service: stealth page fetch (Docker-only — see assert-docker-runtime.ts).
 *
 * Endpoints:
 *  - `GET  /health`  → `{ ok: true }`
 *  - `POST /fetch`   → stealth fetch result with HTML
 *
 * Optional `X-Api-Key` header is enforced when `FETCH_API_KEY` is set.
 */

import http from "node:http";

import { assertDockerRuntime } from "./assert-docker-runtime";
import { drainPool, fetchStealthHtml } from "./fetch-page";
import { normalizeFetchUrl, readDiskCache, writeDiskCache } from "./disk-cache";
import { createLogger } from "./logger";
import { resolveWritableDataRoot } from "./resolve-writable-data-root";
import type { HumanSessionOptions, ProxyConfig, SessionCookie } from "./types";

const log = createLogger("server");

try {
  assertDockerRuntime();
} catch (err) {
  console.error(
    JSON.stringify({
      level: "error",
      scope: "server",
      msg: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
}

const port = parseInt(process.env.PORT || "3041", 10);
const cacheTtlMs = Math.max(0, parseInt(process.env.CACHE_TTL_SECONDS || "3600", 10) * 1000);
const cacheDir = `${resolveWritableDataRoot()}/response-cache`;
const apiKey = process.env.FETCH_API_KEY?.trim() || "";
const maxRequestBodyBytes = Math.max(
  1024,
  parseInt(process.env.MAX_REQUEST_BODY_BYTES || "131072", 10),
);

interface FetchBody {
  url?: string;
  waitForSelector?: string;
  waitForNetworkIdle?: boolean;
  skipCache?: boolean;
  timeoutMs?: number;
  waitForSelectorTimeoutMs?: number;
  headers?: Record<string, string>;
  userAgent?: string;
  referer?: string;
  timezone?: string;
  hubLoadMoreSelector?: string;
  hubLoadMoreMaxRepeats?: number;
  hubScrollMaxRepeats?: number;
  warmupUrl?: string;
  warmupPaths?: string[];
  sessionCookies?: SessionCookie[];
  /** Optional upstream proxy — wired at Camoufox launch when set. */
  proxy?: ProxyConfig;
  humanSession?: HumanSessionOptions;
  solveChallenges?: boolean;
  maxChallengeAttempts?: number;
  retryOnChallenge?: boolean;
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
        chromiumPath: process.env.CAMOUFOX_INSTALL_DIR ?? null,
        headless: (process.env.BROWSER_HEADLESS ?? "true").toLowerCase() !== "false",
        display: process.env.DISPLAY ?? null,
        cacheTtlSeconds: cacheTtlMs / 1000,
        proxySupported: true,
        driver: "camoufox",
        inContainer: true,
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
            challengeDetected: false,
            challengeSolved: true,
            attempts: 0,
          });
          return;
        }
      }

      const fetched = await fetchStealthHtml(url, {
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
        warmupUrl: body.warmupUrl,
        warmupPaths: body.warmupPaths,
        sessionCookies: body.sessionCookies,
        proxy: body.proxy,
        humanSession: body.humanSession,
        solveChallenges: body.solveChallenges,
        maxChallengeAttempts: body.maxChallengeAttempts,
        retryOnChallenge: body.retryOnChallenge,
      });

      const cacheable =
        !body.skipCache &&
        !fetched.challengeDetected &&
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
        ok: !fetched.challengeDetected || fetched.challengeSolved,
        cached: false,
        url,
        finalUrl: fetched.finalUrl,
        statusCode: fetched.statusCode,
        contentType: fetched.contentType,
        html: fetched.html,
        challengeDetected: fetched.challengeDetected,
        challengeSolved: fetched.challengeSolved,
        attempts: fetched.attempts,
        error:
          fetched.challengeDetected && !fetched.challengeSolved
            ? "Anti-bot challenge page persisted after retries"
            : undefined,
      });
      return;
    }

    json(res, 404, { ok: false, error: "Not found" });
  } catch (e) {
    log.warn("Request failed", { err: e instanceof Error ? e.message : String(e) });
    json(res, 500, { ok: false, error: e instanceof Error ? e.message : "Internal error" });
  }
});

server.listen(port, "0.0.0.0", () => {
  log.info("Listening", {
    port,
    cacheDir,
    cacheTtlMs,
    camoufoxDir: process.env.CAMOUFOX_INSTALL_DIR ?? null,
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
