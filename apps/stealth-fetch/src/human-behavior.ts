/**
 * Human-like delays, ghost-cursor mouse paths, wheel scroll, and click helpers.
 */

import { createCursor, type GhostCursor } from "ghost-cursor";

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

const cursors = new WeakMap<object, GhostCursor>();

/** Attach a ghost-cursor instance to a Puppeteer page (Bezier mouse paths). */
export function attachHumanCursor(page: object): GhostCursor {
  let cursor = cursors.get(page);
  if (!cursor) {
    cursor = createCursor(page as Parameters<typeof createCursor>[0]);
    cursors.set(page, cursor);
  }
  return cursor;
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

/** Move via ghost-cursor when attached; otherwise fall back to eased steps. */
export async function moveMouseHuman(
  page: StealthPage,
  targetX: number,
  targetY: number,
  startX = targetX * 0.4,
  startY = targetY * 0.3,
  cursorPage?: object,
): Promise<void> {
  if (cursorPage) {
    const cursor = cursors.get(cursorPage);
    if (cursor) {
      await cursor.moveTo(
        { x: targetX, y: targetY },
        {
          moveDelay: 8 + Math.floor(Math.random() * 18),
          randomizeMoveDelay: true,
        },
      );
      return;
    }
  }

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
export async function simulateMouseWander(
  page: StealthPage,
  moves = 3,
  cursorPage?: object,
): Promise<void> {
  const cursor = cursorPage ? cursors.get(cursorPage) : undefined;
  if (cursor) {
    for (let i = 0; i < moves; i++) {
      const point = await randomViewportPoint(page);
      await cursor.moveTo(point, {
        moveDelay: 10 + Math.floor(Math.random() * 24),
        randomizeMoveDelay: true,
      });
      await humanDelay(120, 520);
    }
    return;
  }

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

/** Click at viewport coordinates with pre-move and post-click pause. */
export async function humanClickAt(
  page: StealthPage,
  x: number,
  y: number,
  holdMs = 80,
  cursorPage?: object,
): Promise<void> {
  await moveMouseHuman(page, x, y, x * 0.4, y * 0.3, cursorPage);
  await humanDelay(60, 180);
  await page.mouse.down();
  await humanDelay(holdMs, holdMs + 60);
  await page.mouse.up();
  await humanDelay(200, 500);
}

/** Press-and-hold at coordinates (PerimeterX). */
export async function humanPressAndHold(
  page: StealthPage,
  x: number,
  y: number,
  holdMs: number,
  cursorPage?: object,
): Promise<void> {
  await moveMouseHuman(page, x, y, x * 0.35, y * 0.25, cursorPage);
  await humanDelay(120, 320);
  await page.mouse.down();
  const holdUntil = Date.now() + holdMs;
  while (Date.now() < holdUntil) {
    const jitterX = x + Math.round((Math.random() - 0.5) * 4);
    const jitterY = y + Math.round((Math.random() - 0.5) * 3);
    await page.mouse.move(jitterX, jitterY, { steps: 1 });
    await humanDelay(180, 420);
  }
  await page.mouse.up();
  await humanDelay(600, 1_200);
}
