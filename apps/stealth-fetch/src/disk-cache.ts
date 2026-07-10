/**
 * File-backed response cache (normalized URL → HTML payload).
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface CachedFetchPayload {
  storedAt: number;
  url: string;
  finalUrl: string | null;
  statusCode: number | null;
  contentType: string | null;
  html: string;
}

function cacheKeyForUrl(normalizedUrl: string): string {
  return crypto.createHash("sha256").update(normalizedUrl, "utf8").digest("hex");
}

function entryPath(cacheDir: string, normalizedUrl: string): string {
  return path.join(cacheDir, `${cacheKeyForUrl(normalizedUrl)}.json`);
}

/** Builds a stable URL string (drops `#fragment`) for cache keys. */
export function normalizeFetchUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  return u.href;
}

/** Reads a cache entry if present and younger than `ttlMs`. */
export async function readDiskCache(
  cacheDir: string,
  normalizedUrl: string,
  ttlMs: number,
): Promise<CachedFetchPayload | null> {
  const file = entryPath(cacheDir, normalizedUrl);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as CachedFetchPayload;
    if (!parsed || typeof parsed.storedAt !== "number" || typeof parsed.html !== "string") {
      return null;
    }
    if (Date.now() - parsed.storedAt > ttlMs) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Atomically writes a cache entry as JSON under `cacheDir`. */
export async function writeDiskCache(
  cacheDir: string,
  normalizedUrl: string,
  payload: Omit<CachedFetchPayload, "storedAt">,
): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true });
  const full: CachedFetchPayload = { ...payload, storedAt: Date.now() };
  const file = entryPath(cacheDir, normalizedUrl);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(full), "utf8");
  await fs.rename(tmp, file);
}
