import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeChallenge } from "./looksLikeChallenge";

describe("looksLikeChallenge", () => {
  it("ignores leftover Cloudflare scripts on a finished story", () => {
    const html = `<!doctype html><html><head>
      <title>Progressives are learning the hard way how to survive Fox News - POLITICO</title>
      <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
    </head><body><h1>Headline</h1><p class="typescale-body-l">${"word ".repeat(8_000)}</p></body></html>`;
    assert.equal(looksLikeChallenge(html), false);
  });

  it("detects a short Cloudflare interstitial", () => {
    const html = `<!doctype html><html><head>
      <title>Just a moment...</title>
    </head><body>
      <script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>
      <div id="cf-browser-verification"></div>
    </body></html>`;
    assert.equal(looksLikeChallenge(html), true);
  });

  it("still treats a long page with an interstitial title as a challenge", () => {
    const html = `<!doctype html><html><head>
      <title>Just a moment...</title>
      <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
    </head><body>${"x".repeat(30_000)}</body></html>`;
    assert.equal(looksLikeChallenge(html), true);
  });

  it("detects a short DataDome interstitial without a stock title", () => {
    const html = `<html><head><title>News</title></head>
      <body><script src="https://geo.captcha-delivery.com/captcha/"></script></body></html>`;
    assert.equal(looksLikeChallenge(html), true);
  });

  it("detects a PerimeterX press-and-hold interstitial", () => {
    assert.equal(
      looksLikeChallenge("<html><body>Press & Hold to confirm you are a human</body></html>"),
      true,
    );
  });

  it("does not flag ordinary article HTML", () => {
    assert.equal(
      looksLikeChallenge("<html><head><title>Story</title></head><body><h1>Hi</h1></body></html>"),
      false,
    );
  });
});
