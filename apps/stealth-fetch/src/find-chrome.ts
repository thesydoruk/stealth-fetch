/**
 * Chrome discovery for the Docker image (Google Chrome stable on Linux).
 */

import fs from "node:fs";

import { STEALTH_ARGS } from "./constants";

const LINUX_CHROME_CANDIDATES = ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"];

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Resolve Chrome inside the container — `CHROMIUM_PATH` or default Debian install path. */
export function findChromePath(): string {
  const fromEnv = process.env.CHROMIUM_PATH?.trim();
  if (fromEnv) {
    if (fs.existsSync(fromEnv)) return fromEnv;
    throw new Error(`CHROMIUM_PATH missing: ${fromEnv}`);
  }

  const found = firstExisting(LINUX_CHROME_CANDIDATES);
  if (found) return found;
  throw new Error("Chrome not found in container; rebuild the stealth-fetch Docker image.");
}

/**
 * Same launch flags as browser-fetch — the path that fetched Bloomberg
 * before the external-stealth-fetch merge.
 */
export function resolveStealthLaunchArgs(): string[] {
  const args = [...STEALTH_ARGS];

  const extraArgs = process.env.CHROMIUM_LAUNCH_ARGS;
  if (extraArgs) {
    args.push(
      ...extraArgs
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
    );
  }

  return args;
}

/** CDP transport and automation flag hardening for launch(). */
export function resolveStealthLaunchOptions(chromiumPath: string, timeoutMs: number) {
  const headless = process.env.BROWSER_HEADLESS === "true";
  return {
    headless,
    executablePath: chromiumPath,
    args: resolveStealthLaunchArgs(),
    defaultViewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
    timeout: timeoutMs,
    /** Default off — browser-fetch does not use pipe transport. */
    pipe: process.env.STEALTH_CDP_PIPE === "true",
  };
}
