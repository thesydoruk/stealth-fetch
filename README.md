# stealth-fetch

Two HTTP microservices that render pages in real Google Chrome (puppeteer-extra + rebrowser-patches), with disk-backed response caching and a shared browser pool.

| Service | Port | Purpose |
|---------|------|---------|
| **browser-fetch** | 3040 | Stealth Chrome rendering + disk cache |
| **stealth-fetch** | 3041 | Warm sessions, ghost-cursor, anti-bot challenge solver |

## Docker

```bash
docker compose up --build
```

- browser-fetch: http://localhost:3040
- stealth-fetch: http://localhost:3041

```bash
curl -s -X POST http://localhost:3040/fetch \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

## Local development

```bash
npm install
npm run build
```

**browser-fetch** (port 3040):

```bash
npm run build:browser-fetch

# Windows
set CHROMIUM_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
set DATA_DIR=.\data\browser-fetch

# Linux / macOS
export CHROMIUM_PATH=/usr/bin/google-chrome-stable
export DATA_DIR=./data/browser-fetch

npm run start:browser-fetch
```

**stealth-fetch** (port 3041) — designed for Docker (`STEALTH_IN_CONTAINER=true`). For a local run:

```bash
set STEALTH_IN_CONTAINER=true   # Windows
export STEALTH_IN_CONTAINER=true # Linux / macOS
set PORT=3041
npm run start:stealth-fetch
```

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | `{ ok: true }` |
| `GET` | `/info` | Runtime info (Chrome path, headless mode, cache TTL) |
| `POST` | `/fetch` | Fetch and return rendered HTML |

`POST /fetch` body (JSON):

```json
{
  "url": "https://example.com",
  "waitForSelector": "#main",
  "waitForNetworkIdle": true,
  "skipCache": false,
  "timeoutMs": 90000,
  "referer": "https://www.google.com/",
  "timezone": "America/New_York"
}
```

stealth-fetch additionally accepts `warmupUrl`, `warmupPaths`, `sessionCookies`, `proxy`, `humanSession`, `solveChallenges`, and related options. `timeoutMs` is the budget for the whole session (pool wait, warmup, target, challenge retries). If the HTTP client disconnects, the session is cancelled and the browser returns to the pool.

## Node clients

Package `@stealth-fetch/clients` provides typed HTTP clients for both services:

```typescript
import { fetchPageViaBrowserService, fetchPageViaStealthService } from "@stealth-fetch/clients";

process.env.BROWSER_FETCH_URL = "http://localhost:3040";
const page = await fetchPageViaBrowserService("https://example.com");
console.log(page.statusCode, page.html.length);
```

## Project layout

```
apps/browser-fetch/     Light stealth page-fetch service
apps/stealth-fetch/     Full stealth (rebrowser + ghost-cursor + challenge solver)
packages/clients/       HTTP clients for calling the services
docker-compose.yml      Runs both services with Google Chrome + Xvfb
```

## When to use which service

| | browser-fetch | stealth-fetch |
|---|---|---|
| **Use for** | JS rendering, moderate anti-bot | DataDome, PerimeterX, Cloudflare challenges |
| **Stack** | puppeteer-extra stealth | rebrowser-patches + ghost-cursor |
| **Cost** | Lower RAM, faster | Higher RAM, slower, more retries |
| **Typical targets** | News sites, SPAs with light protection | Paywalled or heavily protected publishers |

Keep both if you scrape a mix of sites. Use stealth-fetch alone if every target has aggressive bot protection.

## Environment variables

| Variable | Service | Default | Description |
|----------|---------|---------|-------------|
| `PORT` | both | `3040` / `3041` | HTTP listen port |
| `DATA_DIR` | both | `/data` | Chrome profiles, disk cache, response cache |
| `CHROMIUM_PATH` | both | Chrome in container | Path to Google Chrome binary |
| `BROWSER_HEADLESS` | both | `false` in Docker | Headless mode (`false` + Xvfb is recommended) |
| `FETCH_API_KEY` | both | — | Require `X-Api-Key` header when set |
| `CACHE_TTL_SECONDS` | both | `86400` / `3600` | Response cache TTL |
| `BROWSER_POOL_SIZE` | both | `2` | Max concurrent browser instances |
| `FETCH_TIMEOUT_MS` | both | `90000` / `120000` | Whole-session budget (pool wait, warmup, target, challenge retries) |
| `STEALTH_IN_CONTAINER` | stealth-fetch | `true` in Docker | Guard against accidental host runs |

Client-side (callers):

- `BROWSER_FETCH_URL`, `BROWSER_FETCH_API_KEY`
- `STEALTH_FETCH_URL`, `STEALTH_FETCH_API_KEY`
