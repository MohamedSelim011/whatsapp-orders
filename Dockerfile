FROM node:20-slim

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
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN npm run build

EXPOSE 8080

CMD ["npm", "run", "docker-start"]
