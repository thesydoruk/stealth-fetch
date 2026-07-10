import fs from "node:fs";
import path from "node:path";

import { createLogger } from "./logger";

const log = createLogger("data-root");

let cachedRoot: string | null = null;

function isWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Base path for Chrome profiles, disk cache, and response cache.
 * Bind-mounted `./data/stealth-fetch` is often root-owned on first create;
 * fall back to `$HOME/.stealth-fetch` so launches do not fail with EACCES.
 */
export function resolveWritableDataRoot(): string {
  if (cachedRoot) return cachedRoot;

  const configured = process.env.DATA_DIR?.trim() || "/data";
  const fallback = path.join(process.env.HOME || "/tmp", ".stealth-fetch");

  for (const candidate of [configured, fallback]) {
    if (isWritableDir(candidate)) {
      if (candidate !== configured) {
        log.warn("DATA_DIR is not writable; using fallback", {
          dataDir: configured,
          fallback: candidate,
        });
      }
      cachedRoot = candidate;
      return candidate;
    }
  }

  throw new Error(
    "No writable directory for stealth-fetch data (DATA_DIR and HOME fallback failed)",
  );
}
