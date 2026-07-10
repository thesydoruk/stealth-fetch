/**
 * Minimal puppeteer-extra browser pool for reuse across fetch requests.
 *
 * Each launched Chromium needs its own `--user-data-dir` and `--disk-cache-dir`.
 * Slots are tracked explicitly so that two parallel browsers never share a
 * profile directory (which Chromium locks at startup).
 */

import fs from "node:fs";
import path from "node:path";

import { createLogger } from "./logger";

const { addExtra } = require("puppeteer-extra") as {
  addExtra: (puppeteer: unknown) => {
    use: (plugin: unknown) => void;
    launch: (options: Record<string, unknown>) => Promise<PooledBrowser>;
  };
};
const puppeteerCore = require("puppeteer-core");
const StealthPlugin = require("puppeteer-extra-plugin-stealth") as () => unknown;

const log = createLogger("browser-pool");

export interface PooledBrowser {
  newPage: () => Promise<unknown>;
  close: () => Promise<void>;
  connected?: boolean;
}

interface PoolEntry {
  browser: PooledBrowser;
  /** Wall-clock time when the browser was returned to the idle list. */
  idleSince: number;
  /** Profile/disk-cache slot id this browser owns. */
  slot: number;
}

const stealthPuppeteer = addExtra(puppeteerCore);
stealthPuppeteer.use(StealthPlugin());

const maxPoolSize = Math.max(1, parseInt(process.env.BROWSER_POOL_SIZE || "2", 10));
const idleTtlMs = Math.max(60_000, parseInt(process.env.BROWSER_IDLE_TTL_MS || "600000", 10));

const idle: PoolEntry[] = [];
/** Browsers handed out via acquire() but not yet released. */
const inUse = new Map<PooledBrowser, number>();
let reapTimer: ReturnType<typeof setInterval> | null = null;

function ensureReaper(): void {
  if (reapTimer) return;
  reapTimer = setInterval(() => {
    const now = Date.now();
    const expired = idle.filter((e) => now - e.idleSince > idleTtlMs);
    for (const entry of expired) {
      const idx = idle.indexOf(entry);
      if (idx !== -1) idle.splice(idx, 1);
      entry.browser.close().catch(() => {});
      log.debug("Reaped idle browser", { poolIdle: idle.length, slot: entry.slot });
    }
    if (idle.length === 0 && inUse.size === 0 && reapTimer) {
      clearInterval(reapTimer);
      reapTimer = null;
    }
  }, 30_000);
}

const waiters: (() => void)[] = [];

function waitForRelease(): Promise<void> {
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
  });
}

function resolveWaiters(): void {
  const next = waiters.shift();
  if (next) next();
}

/** Pick the first slot id not held by an active or idle browser. */
function pickFreeSlot(): number {
  const taken = new Set<number>();
  for (const slot of inUse.values()) taken.add(slot);
  for (const entry of idle) taken.add(entry.slot);
  for (let i = 0; i < maxPoolSize; i++) {
    if (!taken.has(i)) return i;
  }
  // Should never happen — capacity is enforced before we get here.
  throw new Error("No free browser slot available");
}

/** Returns a pooled browser or launches Chromium with an isolated on-disk profile slot. */
export async function acquireBrowser(
  launchOptions: Record<string, unknown>,
): Promise<PooledBrowser> {
  while (idle.length > 0) {
    const entry = idle.pop()!;
    if (entry.browser.connected !== false) {
      inUse.set(entry.browser, entry.slot);
      log.debug("Reused pooled browser", {
        poolIdle: idle.length,
        poolActive: inUse.size,
        slot: entry.slot,
      });
      return entry.browser;
    }
    entry.browser.close().catch(() => {});
  }

  if (inUse.size >= maxPoolSize) {
    log.warn("Browser pool at capacity, waiting", { max: maxPoolSize });
    await waitForRelease();
    return acquireBrowser(launchOptions);
  }

  ensureReaper();

  const slot = pickFreeSlot();
  const dataDir = process.env.DATA_DIR || "/data";
  const profileDir = path.join(dataDir, "profile", `slot-${slot}`);
  const diskCacheDir = path.join(dataDir, "chromium-disk-cache", `slot-${slot}`);
  const baseArgs = (launchOptions.args as string[] | undefined) ?? [];
  const args = [...baseArgs, `--disk-cache-dir=${diskCacheDir}`];

  // Stale SingletonLock files survive a hard container kill and prevent the
  // next Chrome instance from opening this profile. Persistent cookies/state
  // remain intact — only the lock is removed.
  for (const lockName of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      fs.unlinkSync(path.join(profileDir, lockName));
    } catch {
      /* missing or not a regular file → nothing to clean */
    }
  }

  const browser = await stealthPuppeteer.launch({
    ...launchOptions,
    args,
    userDataDir: launchOptions.userDataDir ?? profileDir,
  });
  inUse.set(browser, slot);
  log.info("Launched browser", { poolIdle: idle.length, poolActive: inUse.size, slot });
  return browser;
}

/** Returns a live browser to the idle pool or closes it when the pool is full. */
export function releaseBrowser(browser: PooledBrowser): void {
  const slot = inUse.get(browser);
  inUse.delete(browser);

  if (slot === undefined) {
    browser.close().catch(() => {});
    resolveWaiters();
    return;
  }

  if (browser.connected === false) {
    browser.close().catch(() => {});
    resolveWaiters();
    return;
  }

  if (idle.length >= maxPoolSize) {
    browser.close().catch(() => {});
    resolveWaiters();
    return;
  }

  idle.push({ browser, idleSince: Date.now(), slot });
  log.debug("Returned browser to pool", { poolIdle: idle.length, poolActive: inUse.size, slot });
  resolveWaiters();
}

/** Closes all idle pooled browsers (call on shutdown). */
export async function drainPool(): Promise<void> {
  if (reapTimer) {
    clearInterval(reapTimer);
    reapTimer = null;
  }
  await Promise.all(idle.splice(0).map((e) => e.browser.close().catch(() => {})));
}
