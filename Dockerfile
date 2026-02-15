# Dockerfile for Auto-Editor backend (Node + ffmpeg)
FROM node:18-bullseye-slim

# Install ffmpeg + tini
RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg \
  ca-certificates \
  wget \
  && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package manifests first for caching
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy source
COPY . .

# Build if needed (project may be TypeScript)
RUN if [ -f package.json ] && grep -q "tsc" package.json || exit 0; then npm run build || true; fi

# Use a non-root user
RUN useradd -ms /bin/bash appuser || true
USER appuser

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "index.js"]
