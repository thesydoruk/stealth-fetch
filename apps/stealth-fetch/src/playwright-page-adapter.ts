/**
 * Adapt a Playwright Page to the Puppeteer-shaped helpers used by fetch-page.
 */

import type { BrowserContext, Page, Response } from "playwright-core";

import type { SessionCookie } from "./types";

export interface AdaptedResponse {
  status: () => number | null;
  headers: () => Record<string, string>;
}

function wrapResponse(resp: Response | null): AdaptedResponse | null {
  if (!resp) return null;
  return {
    status: () => resp.status(),
    headers: () => resp.headers(),
  };
}

function playwrightWaitUntil(waitUntil: string | undefined): "load" | "domcontentloaded" | "networkidle" {
  if (waitUntil === "networkidle2" || waitUntil === "networkidle") return "networkidle";
  if (waitUntil === "load") return "load";
  return "domcontentloaded";
}

/** Playwright page + cookie jar with the method names fetch-page already calls. */
export function adaptPlaywrightPage(page: Page, context: BrowserContext) {
  return {
    url: () => page.url(),
    content: () => page.content(),
    close: () => page.close(),
    viewport: () => page.viewportSize(),
    mouse: {
      move: (x: number, y: number, options?: { steps?: number }) => page.mouse.move(x, y, options),
      down: (options?: { button?: "left" | "right" | "middle" }) => page.mouse.down(options),
      up: (options?: { button?: "left" | "right" | "middle" }) => page.mouse.up(options),
      click: (
        x: number,
        y: number,
        options?: { delay?: number; button?: "left" | "right" | "middle" },
      ) => page.mouse.click(x, y, options),
      wheel: (options?: { deltaY?: number; deltaX?: number }) =>
        page.mouse.wheel(options?.deltaX ?? 0, options?.deltaY ?? 0),
    },
    setExtraHTTPHeaders: (headers: Record<string, string>) => page.setExtraHTTPHeaders(headers),
    setCookie: (...cookies: SessionCookie[]) =>
      context.addCookies(
        cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path ?? "/",
          expires: c.expires,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
        })),
      ),
    cookies: () => context.cookies(),
    deleteCookie: async (..._cookies: unknown[]) => {
      await context.clearCookies();
    },
    evaluate: <T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T> => {
      if (args.length === 0) return page.evaluate(fn as () => T);
      return page.evaluate(fn as (arg: unknown) => T, args[0]);
    },
    goto: async (url: string, options?: Record<string, unknown>) => {
      const waitUntil = playwrightWaitUntil(
        typeof options?.waitUntil === "string" ? options.waitUntil : undefined,
      );
      const timeout = typeof options?.timeout === "number" ? options.timeout : undefined;
      const referer = typeof options?.referer === "string" ? options.referer : undefined;
      const resp = await page.goto(url, { waitUntil, timeout, referer });
      return wrapResponse(resp);
    },
    waitForSelector: (selector: string, options?: Record<string, unknown>) =>
      page.waitForSelector(selector, {
        timeout: typeof options?.timeout === "number" ? options.timeout : undefined,
      }),
    waitForNavigation: async (options?: Record<string, unknown>) => {
      const waitUntil = playwrightWaitUntil(
        typeof options?.waitUntil === "string" ? options.waitUntil : undefined,
      );
      const timeout = typeof options?.timeout === "number" ? options.timeout : undefined;
      const resp = await page.waitForNavigation({ waitUntil, timeout });
      return wrapResponse(resp);
    },
  };
}

export type AdaptedPage = ReturnType<typeof adaptPlaywrightPage>;
