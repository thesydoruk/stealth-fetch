# Docker-only stealth page-fetch microservice (Camoufox + Playwright).
# Run via docker-compose — not with npm on the host.
FROM node:22-slim AS builder
WORKDIR /build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY apps/stealth-fetch/package.json ./
RUN npm install

COPY apps/stealth-fetch/tsconfig.build.json ./
COPY apps/stealth-fetch/src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:22-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation fonts-noto-color-emoji fonts-noto-cjk \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdbus-1-3 libdrm2 \
    libdbus-glib-1-2 libgbm1 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 libxext6 \
    libxfixes3 libxkbcommon0 libxrandr2 libxrender1 libxt6 \
    python3 make g++ \
    wget dumb-init \
  && rm -rf /var/lib/apt/lists/*

ENV CAMOUFOX_INSTALL_DIR=/opt/camoufox
ENV STEALTH_IN_CONTAINER=true

COPY apps/stealth-fetch/package.json ./
RUN npm install --omit=dev \
  && npx camoufox-js fetch

COPY --from=builder /build/dist ./dist

RUN addgroup --system --gid 1001 sf \
  && adduser --system --uid 1001 --gid 1001 --home /home/sf --shell /bin/sh sf \
  && mkdir -p /home/sf /data /opt/camoufox \
  && chown -R sf:sf /home/sf /app /data /opt/camoufox

USER sf
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV HOME=/home/sf
ENV BROWSER_HEADLESS=true

EXPOSE 3041
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
