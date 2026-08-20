/**
 * Camoufox (Playwright) browser pool with per-slot persistent profiles.
 */

import fs from "node:fs";
import path from "node:path";

import type { BrowserContext, Page } from "playwright-core";

import { launchCamoufoxContext } from "./stealth-driver";
import type { ProxyConfig } from "./types";
import { createLogger } from "./logger";
import { resolveWritableDataRoot } from "./resolve-writable-data-root";

export interface PooledBrowser {
  newPage: () => Promise<Page>;
  close: () => Promise<void>;
  context: BrowserContext;
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

function wrapContext(context: BrowserContext): PooledBrowser {
  return {
    context,
    newPage: () => context.newPage(),
    close: () => context.close(),
  };
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

const reservedSlots = new Set<string>();

function slotKey(proxyKey: string, slot: number): string {
  return `${slot}\n${proxyKey}`;
}

function takenSlots(proxyKey: string): Set<number> {
  const taken = new Set<number>();
  for (const meta of inUse.values()) {
    if (meta.proxyKey === proxyKey) taken.add(meta.slot);
  }
  for (const entry of idle) {
    if (entry.proxyKey === proxyKey) taken.add(entry.slot);
  }
  for (const key of reservedSlots) {
    const sep = key.indexOf("\n");
    if (key.slice(sep + 1) === proxyKey) taken.add(Number(key.slice(0, sep)));
  }
  return taken;
}

function pickFreeSlot(proxyKey: string): number {
  const taken = takenSlots(proxyKey);
  for (let i = 0; i < maxPoolSize; i++) {
    if (!taken.has(i)) return i;
  }
  throw new Error(`No free browser slot for proxy partition "${proxyKey}"`);
}

let reserveChain: Promise<void> = Promise.resolve();

function withReserveLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = reserveChain.then(fn, fn);
  reserveChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export interface AcquireBrowserOptions {
  proxy?: ProxyConfig;
}

type ReserveOutcome =
  | { kind: "reuse"; browser: PooledBrowser }
  | { kind: "wait" }
  | { kind: "launch"; slot: number };

function isConnected(browser: PooledBrowser): boolean {
  return browser.context.browser()?.isConnected() !== false;
}

function reserveOrReuse(proxyKey: string): ReserveOutcome {
  for (let i = idle.length - 1; i >= 0; i--) {
    const entry = idle[i];
    if (entry.proxyKey !== proxyKey) continue;
    idle.splice(i, 1);
    if (isConnected(entry.browser)) {
      inUse.set(entry.browser, { slot: entry.slot, proxyKey });
      return { kind: "reuse", browser: entry.browser };
    }
    entry.browser.close().catch(() => {});
  }

  if (takenSlots(proxyKey).size >= maxPoolSize) {
    return { kind: "wait" };
  }

  const slot = pickFreeSlot(proxyKey);
  reservedSlots.add(slotKey(proxyKey, slot));
  return { kind: "launch", slot };
}

/** Returns a pooled Camoufox context or launches one with an isolated profile slot. */
export async function acquireBrowser(options: AcquireBrowserOptions): Promise<PooledBrowser> {
  const proxyKey = proxyPoolKey(options.proxy);

  let slot = -1;
  for (;;) {
    const outcome = await withReserveLock(() => reserveOrReuse(proxyKey));
    if (outcome.kind === "reuse") {
      log.debug("Reused pooled browser", {
        poolIdle: idle.length,
        poolActive: inUse.size,
        slot: inUse.get(outcome.browser)?.slot,
        proxyKey,
      });
      return outcome.browser;
    }
    if (outcome.kind === "wait") {
      log.warn("Browser pool at capacity, waiting", { max: maxPoolSize, proxyKey });
      await waitForRelease();
      continue;
    }
    slot = outcome.slot;
    break;
  }

  ensureReaper();
  const dataDir = resolveWritableDataRoot();
  const profileDir = path.join(
    dataDir,
    "profile",
    `${proxyKey.replace(/[^a-z0-9]+/gi, "_")}-slot-${slot}`,
  );
  fs.mkdirSync(profileDir, { recursive: true });
  for (const lockName of [".parentlock", "parent.lock", "lock"]) {
    try {
      fs.unlinkSync(path.join(profileDir, lockName));
    } catch {
      /* missing lock file */
    }
  }

  try {
    const context = await launchCamoufoxContext({ userDataDir: profileDir, proxy: options.proxy });
    for (const extra of context.pages()) {
      await extra.close().catch(() => {});
    }
    const browser = wrapContext(context);
    inUse.set(browser, { slot, proxyKey });
    log.info("Launched browser", { poolIdle: idle.length, poolActive: inUse.size, slot, proxyKey });
    return browser;
  } catch (err) {
    resolveWaiters();
    throw err;
  } finally {
    reservedSlots.delete(slotKey(proxyKey, slot));
  }
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

  if (!isConnected(browser)) {
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
