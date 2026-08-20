/**
 * Human-like delays, mouse paths, and wheel scroll.
 */

import type { HumanSessionOptions } from "./types";

export interface StealthPage {
  mouse: {
    move: (x: number, y: number, options?: { steps?: number }) => Promise<void>;
    down: (options?: { button?: "left" | "right" | "middle" }) => Promise<void>;
    up: (options?: { button?: "left" | "right" | "middle" }) => Promise<void>;
    wheel?: (options?: { deltaY?: number; deltaX?: number }) => Promise<void>;
    click: (
      x: number,
      y: number,
      options?: { delay?: number; button?: "left" | "right" | "middle" },
    ) => Promise<void>;
  };
  evaluate: <T>(fn: (...args: unknown[]) => T, ...args: unknown[]) => Promise<T>;
  viewport: () => { width: number; height: number } | null;
}

export function resolveHumanDefaults(options?: HumanSessionOptions): Required<HumanSessionOptions> {
  return {
    mouseMovement: options?.mouseMovement ?? true,
    warmupScroll: options?.warmupScroll ?? true,
    readingScroll: options?.readingScroll ?? true,
    readingScrollSteps: Math.max(1, options?.readingScrollSteps ?? 4),
    delayMinMs: Math.max(100, options?.delayMinMs ?? 400),
    delayMaxMs: Math.max(200, options?.delayMaxMs ?? 1_400),
  };
}

/** Random pause between human actions. */
export function humanDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((r) => setTimeout(r, ms));
}

/** Eased mouse move across the viewport. */
export async function moveMouseHuman(
  page: StealthPage,
  targetX: number,
  targetY: number,
  startX = targetX * 0.4,
  startY = targetY * 0.3,
): Promise<void> {
  const steps = 12 + Math.floor(Math.random() * 10);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t * t * (3 - 2 * t);
    const x = startX + (targetX - startX) * ease + (Math.random() - 0.5) * 2;
    const y = startY + (targetY - startY) * ease + (Math.random() - 0.5) * 2;
    await page.mouse.move(Math.round(x), Math.round(y));
    await humanDelay(8, 28);
  }
}

/** Pick a safe point inside the viewport away from edges. */
export async function randomViewportPoint(page: StealthPage): Promise<{ x: number; y: number }> {
  const vp = page.viewport() ?? { width: 1920, height: 1080 };
  const marginX = Math.round(vp.width * 0.12);
  const marginY = Math.round(vp.height * 0.1);
  return {
    x: marginX + Math.floor(Math.random() * (vp.width - marginX * 2)),
    y: marginY + Math.floor(Math.random() * (vp.height - marginY * 2)),
  };
}

/** Light wandering moves — simulates scanning the page before reading. */
export async function simulateMouseWander(page: StealthPage, moves = 3): Promise<void> {
  let last = await randomViewportPoint(page);
  await moveMouseHuman(page, last.x, last.y);
  for (let i = 0; i < moves; i++) {
    const next = await randomViewportPoint(page);
    await moveMouseHuman(page, next.x, next.y, last.x, last.y);
    last = next;
    await humanDelay(120, 420);
  }
}

async function wheelScroll(page: StealthPage, deltaY: number): Promise<void> {
  if (page.mouse.wheel) {
    await page.mouse.wheel({ deltaY });
    return;
  }
  await page.evaluate((...args: unknown[]) => {
    const dy = args[0] as number;
    const w = globalThis as unknown as {
      scrollBy: (options: { top: number; behavior: string }) => void;
    };
    w.scrollBy({ top: dy, behavior: "instant" });
  }, deltaY);
}

/** Small scroll on a landing/warmup page. */
export async function simulateWarmupScroll(page: StealthPage): Promise<void> {
  try {
    const vp = page.viewport() ?? { width: 1920, height: 1080 };
    const down = Math.floor(vp.height * (0.15 + Math.random() * 0.25));
    await wheelScroll(page, down);
    await humanDelay(300, 900);
    await wheelScroll(page, -Math.floor(vp.height * 0.08));
  } catch {
    /* ignore */
  }
}

/** Gradual scroll while “reading” long content. */
export async function simulateReadingScroll(page: StealthPage, steps: number): Promise<void> {
  const vp = page.viewport() ?? { width: 1920, height: 1080 };
  for (let i = 0; i < steps; i++) {
    try {
      const delta = Math.floor(vp.height * (0.22 + Math.random() * 0.18));
      await wheelScroll(page, delta);
    } catch {
      break;
    }
    await humanDelay(700, 2_200);
  }
}
