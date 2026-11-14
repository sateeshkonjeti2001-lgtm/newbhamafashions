# Stage 1: Build Frontend and Server Bundle
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy application source
COPY . .

# Build Vite frontend and bundled Node server
RUN npm run build

# Download Litestream binary
ADD https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz && chmod +x /usr/local/bin/litestream

# Stage 2: Production Runtime Container
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install CA certificates for secure Google Cloud Storage HTTPS APIs
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy Litestream binary
COPY --from=builder /usr/local/bin/litestream /usr/local/bin/litestream

# Copy configuration and entrypoint
COPY litestream.yml /etc/litestream.yml
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Copy production dependencies and built application
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/firebase-applet-config.json ./firebase-applet-config.json

# Copy initialized initial database seed into /app/seed_data (isolated from /app/data)
# This prevents future container builds from ever overwriting a newer live database in GCS/Litestream
COPY --from=builder /app/data ./seed_data

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
