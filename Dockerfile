### ── Stage 1: build ──────────────────────────────────────────────
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y openssl --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force

COPY . .
RUN npx prisma generate
ENV NODE_ENV=production
RUN npm run build

### ── Stage 2: runtime (lean) ────────────────────────────────────
FROM node:22-slim

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    openssl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# Copy only production node_modules
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the built app + prisma client from the builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma

EXPOSE 8080

# 1. Run migrations
# 2. "exec" replaces sh with node as PID 1 so Railway's SIGTERM reaches Node directly
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node ./node_modules/@react-router/serve/bin.js ./build/server/index.js"]
