# Standalone browser fetch microservice (Google Chrome + puppeteer-extra stealth).
# Real Chrome (not Chromium) is required to look credible to advanced anti-bot
# fingerprinters such as DataDome (used by NYT) and Cloudflare's bot manager.
FROM node:20-slim AS builder
WORKDIR /build

COPY apps/browser-fetch/package.json ./
RUN npm install

COPY apps/browser-fetch/tsconfig.build.json ./
COPY apps/browser-fetch/src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:20-slim
WORKDIR /app

# Install Google Chrome stable plus Xvfb. Chrome runs in headful mode under
# Xvfb because DataDome and similar fingerprinters reliably detect the new
# headless mode. `dumb-init` keeps PID 1 sane so SIGTERM reaches both Xvfb
# and node when docker stops the container.
# Note: we deliberately skip `apt-get autoremove` after the install — it can
# decide to drop google-chrome-stable along with the temporary wget/gnupg
# helpers because some shared dependencies were pulled in by both.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates fonts-liberation fonts-noto-color-emoji fonts-noto-cjk \
    xvfb xauth dumb-init \
  && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub \
    | gpg --dearmor -o /etc/apt/trusted.gpg.d/google.gpg \
  && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends google-chrome-stable \
  && apt-mark manual google-chrome-stable \
  && rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_PATH=/usr/bin/google-chrome-stable

COPY apps/browser-fetch/package.json ./
RUN npm install --omit=dev

COPY --from=builder /build/dist ./dist

RUN addgroup --system --gid 1001 bf \
  && adduser --system --uid 1001 --gid 1001 --home /home/bf --shell /bin/sh bf \
  && mkdir -p /home/bf /data \
  && chown -R bf:bf /home/bf /app /data

USER bf
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV HOME=/home/bf
ENV BROWSER_HEADLESS=false
ENV DISPLAY=:99

EXPOSE 3040
# `xvfb-run` boots a virtual X server on $DISPLAY before exec'ing the server.
# `--auto-servernum` picks a free display, and `-screen 0 1920x1080x24` matches
# the viewport advertised in puppeteer's stealth profile.
ENTRYPOINT ["dumb-init", "--"]
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1920x1080x24 -ac +extension RANDR -nolisten tcp", "node", "dist/server.js"]
