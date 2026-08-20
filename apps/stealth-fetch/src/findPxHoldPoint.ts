import type { StealthPage } from "./human-behavior";

export interface PxHoldPoint {
  x: number;
  y: number;
}

/**
 * Viewport center of the Press & Hold widget: `#px-captcha`, visible
 * "Press & Hold" text, or a captcha iframe (including open shadow roots).
 */
export async function findPxHoldPoint(page: StealthPage): Promise<PxHoldPoint | null> {
  return page.evaluate(() => {
    const queryDeep = (root: ParentNode, selector: string): Element | null => {
      const direct = root.querySelector(selector);
      if (direct) return direct;
      const nodes = root.querySelectorAll("*");
      for (let i = 0; i < nodes.length; i++) {
        const shadow = (nodes[i] as Element).shadowRoot;
        if (!shadow) continue;
        const found = queryDeep(shadow, selector);
        if (found) return found;
      }
      return null;
    };

    const centerOf = (el: Element, yBias = 0.5): { x: number; y: number } | null => {
      const r = el.getBoundingClientRect();
      if (r.width < 12 || r.height < 12) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height * yBias };
    };

    const selectors = ["#px-captcha", "#px-captcha-wrapper", "[id*='px-captcha']"];
    for (const selector of selectors) {
      const el = queryDeep(document, selector);
      if (el) {
        const pt = centerOf(el, 0.55);
        if (pt) return pt;
      }
    }

    const labels = document.querySelectorAll("button, div, p, span, a");
    for (let i = 0; i < labels.length; i++) {
      const text = (labels[i].textContent || "").toLowerCase();
      if (!text.includes("press & hold") && !text.includes("press and hold")) continue;
      const pt = centerOf(labels[i], 0.5);
      if (pt) return pt;
    }

    const frames = document.querySelectorAll("iframe");
    for (let i = 0; i < frames.length; i++) {
      const src = (frames[i].getAttribute("src") || "").toLowerCase();
      if (
        !src.includes("captcha") &&
        !src.includes("px-cdn") &&
        !src.includes("px-cloud") &&
        !src.includes("perimeterx") &&
        !src.includes("human")
      ) {
        continue;
      }
      const pt = centerOf(frames[i], 0.58);
      if (pt) return pt;
    }

    return null;
  });
}
