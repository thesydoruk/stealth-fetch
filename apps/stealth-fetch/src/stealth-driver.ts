/**
 * Patched Puppeteer driver (rebrowser-puppeteer-core) + selective in-page stealth.
 *
 * 2026 hard targets (PerimeterX, Cloudflare, DataDome) detect the CDP
 * `Runtime.enable` leak at the protocol layer — puppeteer-extra-plugin-stealth
 * alone cannot fix that. rebrowser-patches closes the leak; stealth plugin
 * still helps with in-page signals (`navigator.webdriver`, etc.).
 */

/** Default fix mode per rebrowser docs — override via env before process start. */
if (!process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE) {
  process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE = "addBinding";
}

const rebrowserCore = require("rebrowser-puppeteer-core");
const { addExtra } = require("puppeteer-extra") as {
  addExtra: (puppeteer: unknown) => {
    use: (plugin: unknown) => void;
    launch: (options: Record<string, unknown>) => Promise<unknown>;
  };
};
const StealthPlugin = require("puppeteer-extra-plugin-stealth") as () => {
  enabledEvasions: Set<string>;
};

const stealthPlugin = StealthPlugin();
const evasions = (stealthPlugin as { enabledEvasions?: Set<string> }).enabledEvasions;
if (evasions) {
  evasions.delete("chrome.runtime");
  evasions.delete("iframe.contentWindow");
}

const stealthPuppeteer = addExtra(rebrowserCore);
stealthPuppeteer.use(stealthPlugin);

export { stealthPuppeteer };
