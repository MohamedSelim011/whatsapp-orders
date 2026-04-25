FROM node:22-slim AS build

# Install Chromium + dependencies required by Puppeteer on Linux
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    openssl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Tell Puppeteer to skip downloading its own Chrome binary
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json package-lock.json* ./

# Install ALL deps (including devDependencies) for the build step
RUN npm ci && npm cache clean --force

COPY . .

ENV NODE_ENV=production
RUN npm run build

# Remove devDependencies after build to slim down the runtime image
RUN npm prune --omit=dev

EXPOSE 8080

CMD ["npm", "run", "docker-start"]
