# Multi-stage Dockerfile for Auto-Editor backend (Node + ffmpeg)
# Build stage
FROM node:20-slim AS build

WORKDIR /app

# Copy package manifests and tsconfig for caching
COPY package*.json tsconfig.json ./

# Install dependencies (including dev for tsc)
RUN npm ci

# Copy source
COPY . ./

# Build TypeScript into /app/dist
RUN npm run build

# Production stage
FROM node:20-slim

# Install runtime deps (ffmpeg via apt)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only what we need from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Non-root user
RUN useradd -ms /bin/bash appuser || true
USER appuser

ENV NODE_ENV=production
EXPOSE 3000

# Run migrations if DATABASE_URL exists, then start
# Use a shell form so we can run conditional commands
CMD ["node", "index.js"]
