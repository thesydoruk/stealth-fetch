# Docker-only stealth page-fetch microservice (Google Chrome + rebrowser + Xvfb).
# Run via docker-compose.common.yml — not with npm on the host.
FROM node:20-slim AS builder
WORKDIR /build

COPY apps/stealth-fetch/package.json ./
RUN npm install

COPY apps/stealth-fetch/tsconfig.build.json ./
COPY apps/stealth-fetch/src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:20-slim
WORKDIR /app

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
ENV STEALTH_IN_CONTAINER=true
ENV REBROWSER_PATCHES_RUNTIME_FIX_MODE=addBinding

COPY apps/stealth-fetch/package.json ./
RUN npm install --omit=dev

COPY --from=builder /build/dist ./dist

RUN addgroup --system --gid 1001 sf \
  && adduser --system --uid 1001 --gid 1001 --home /home/sf --shell /bin/sh sf \
  && mkdir -p /home/sf /data \
  && chown -R sf:sf /home/sf /app /data

USER sf
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV HOME=/home/sf
ENV BROWSER_HEADLESS=false
ENV DISPLAY=:99

EXPOSE 3041
ENTRYPOINT ["dumb-init", "--"]
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1920x1080x24 -ac +extension RANDR -nolisten tcp", "node", "dist/server.js"]
