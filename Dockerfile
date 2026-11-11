FROM node:22-bookworm-slim

# Libraries needed by the "canvas" package (in case no prebuilt binary matches)
RUN apt-get update && apt-get install -y --no-install-recommends \
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# users, statistics and logs live outside the image
ENV DATA_DIR=/app/data LOG_DIR=/app/logs
VOLUME ["/app/data", "/app/logs"]

CMD ["node", "index.js"]
