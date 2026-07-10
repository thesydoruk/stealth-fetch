/**
 * Puppeteer-extra browser pool with optional per-launch proxy configuration.
 */

import fs from "node:fs";
import path from "node:path";

import type { ProxyConfig } from "./types";
import { createLogger } from "./logger";
import { resolveWritableDataRoot } from "./resolve-writable-data-root";
import { stealthPuppeteer } from "./stealth-driver";

export interface PooledBrowser {
  newPage: () => Promise<unknown>;
  close: () => Promise<void>;
  connected?: boolean;
}

interface PoolEntry {
  browser: PooledBrowser;
  idleSince: number;
  slot: number;
  proxyKey: string;
}

const log = createLogger("browser-pool");

const maxPoolSize = Math.max(1, parseInt(process.env.BROWSER_POOL_SIZE || "2", 10));
const idleTtlMs = Math.max(60_000, parseInt(process.env.BROWSER_IDLE_TTL_MS || "600000", 10));

const idle: PoolEntry[] = [];
const inUse = new Map<PooledBrowser, { slot: number; proxyKey: string }>();
let reapTimer: ReturnType<typeof setInterval> | null = null;

/** Stable pool partition key — browsers with different proxies must not share a slot. */
export function proxyPoolKey(proxy?: ProxyConfig): string {
  if (!proxy?.url?.trim()) return "direct";
  return proxy.url.trim();
}

/**
 * Maps {@link ProxyConfig} to Chromium launch flags.
 * Auth credentials are reserved for a future `page.authenticate()` hook.
 */
export function chromiumArgsForProxy(baseArgs: string[], proxy?: ProxyConfig): string[] {
  const args = [...baseArgs];
  const url = proxy?.url?.trim();
  if (url) {
    args.push(`--proxy-server=${url}`);
    if (proxy?.username) {
      log.debug("Proxy username provided; auth hook not yet implemented", { proxy: url });
    }
  }
  return args;
}

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

function pickFreeSlot(proxyKey: string): number {
  const taken = new Set<number>();
  for (const meta of inUse.values()) {
    if (meta.proxyKey === proxyKey) taken.add(meta.slot);
  }
  for (const entry of idle) {
    if (entry.proxyKey === proxyKey) taken.add(entry.slot);
  }
  for (let i = 0; i < maxPoolSize; i++) {
    if (!taken.has(i)) return i;
  }
  throw new Error(`No free browser slot for proxy partition "${proxyKey}"`);
}

export interface AcquireBrowserOptions {
  launchOptions: Record<string, unknown>;
  proxy?: ProxyConfig;
}

/** Returns a pooled browser or launches Chromium with an isolated on-disk profile slot. */
export async function acquireBrowser(options: AcquireBrowserOptions): Promise<PooledBrowser> {
  const proxyKey = proxyPoolKey(options.proxy);
  const launchOptions = options.launchOptions;

  for (let i = idle.length - 1; i >= 0; i--) {
    const entry = idle[i];
    if (entry.proxyKey !== proxyKey) continue;
    idle.splice(i, 1);
    if (entry.browser.connected !== false) {
      inUse.set(entry.browser, { slot: entry.slot, proxyKey });
      log.debug("Reused pooled browser", {
        poolIdle: idle.length,
        poolActive: inUse.size,
        slot: entry.slot,
        proxyKey,
      });
      return entry.browser;
    }
    entry.browser.close().catch(() => {});
  }

  const activeForProxy = [...inUse.values()].filter((m) => m.proxyKey === proxyKey).length;
  if (activeForProxy >= maxPoolSize) {
    log.warn("Browser pool at capacity, waiting", { max: maxPoolSize, proxyKey });
    await waitForRelease();
    return acquireBrowser(options);
  }

  ensureReaper();

  const slot = pickFreeSlot(proxyKey);
  const dataDir = resolveWritableDataRoot();
  const profileDir = path.join(
    dataDir,
    "profile",
    `${proxyKey.replace(/[^a-z0-9]+/gi, "_")}-slot-${slot}`,
  );
  const diskCacheDir = path.join(dataDir, "chromium-disk-cache", `${proxyKey}-slot-${slot}`);
  const baseArgs = (launchOptions.args as string[] | undefined) ?? [];
  const args = chromiumArgsForProxy(baseArgs, options.proxy);
  args.push(`--disk-cache-dir=${diskCacheDir}`);

  for (const lockName of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      fs.unlinkSync(path.join(profileDir, lockName));
    } catch {
      /* missing lock file */
    }
  }

  const browser = (await stealthPuppeteer.launch({
    ...launchOptions,
    args,
    userDataDir: launchOptions.userDataDir ?? profileDir,
  })) as PooledBrowser;
  inUse.set(browser, { slot, proxyKey });
  log.info("Launched browser", { poolIdle: idle.length, poolActive: inUse.size, slot, proxyKey });
  return browser;
}

/** Returns a live browser to the idle pool or closes it when the pool is full. */
export function releaseBrowser(browser: PooledBrowser): void {
  const meta = inUse.get(browser);
  inUse.delete(browser);

  if (!meta) {
    browser.close().catch(() => {});
    resolveWaiters();
    return;
  }

  if (browser.connected === false) {
    browser.close().catch(() => {});
    resolveWaiters();
    return;
  }

  const idleForProxy = idle.filter((e) => e.proxyKey === meta.proxyKey).length;
  if (idleForProxy >= maxPoolSize) {
    browser.close().catch(() => {});
    resolveWaiters();
    return;
  }

  idle.push({ browser, idleSince: Date.now(), slot: meta.slot, proxyKey: meta.proxyKey });
  log.debug("Returned browser to pool", {
    poolIdle: idle.length,
    poolActive: inUse.size,
    slot: meta.slot,
  });
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
