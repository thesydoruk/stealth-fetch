/**
 * Camoufox launcher — patched Firefox binary, Playwright API.
 *
 * Stock Chrome + rebrowser only hides the CDP Runtime.enable leak. Camoufox
 * patches the engine (fingerprints, WebGL, fonts) so PerimeterX sees a
 * consistent desktop browser rather than Docker Google Chrome.
 */

import type { BrowserContext } from "playwright-core";

import { createLogger } from "./logger";
import type { ProxyConfig } from "./types";

const log = createLogger("stealth-driver");

export interface LaunchCamoufoxOptions {
  userDataDir: string;
  proxy?: ProxyConfig;
}

interface CamoufoxLaunchArgs {
  user_data_dir: string;
  headless: boolean | "virtual";
  os: "windows";
  humanize: boolean;
  geoip: boolean;
  window: [number, number];
  enable_cache: boolean;
  proxy?: string;
}

async function launchWithGeoip(
  args: CamoufoxLaunchArgs,
): Promise<BrowserContext> {
  const { Camoufox } = await import("camoufox-js");
  return (await Camoufox(args)) as BrowserContext;
}

/** Persistent Camoufox context (cookies survive across pages on this slot). */
export async function launchCamoufoxContext(
  options: LaunchCamoufoxOptions,
): Promise<BrowserContext> {
  const proxy = options.proxy?.url?.trim();
  const headlessEnv = (process.env.BROWSER_HEADLESS ?? "true").toLowerCase();
  const headless = headlessEnv === "virtual" ? "virtual" : headlessEnv !== "false";

  const args: CamoufoxLaunchArgs = {
    user_data_dir: options.userDataDir,
    headless,
    os: "windows",
    humanize: true,
    geoip: true,
    window: [1920, 1080],
    enable_cache: false,
    ...(proxy ? { proxy } : {}),
  };

  try {
    return await launchWithGeoip(args);
  } catch (err) {
    log.warn("Camoufox geoip launch failed, retrying without geoip", {
      error: err instanceof Error ? err.message : String(err),
    });
    return launchWithGeoip({ ...args, geoip: false });
  }
}
