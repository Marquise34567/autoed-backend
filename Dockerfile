# Dockerfile for Auto-Editor backend (Node + ffmpeg)
FROM debian:bookworm-slim

# Install Node.js (18.x) from NodeSource, ffmpeg and essential tools
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates gnupg wget lsb-release \
  && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
  && apt-get install -y --no-install-recommends nodejs ffmpeg \
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
# Only run build when `tsc` appears in `package.json` scripts
RUN if [ -f package.json ] && grep -q '"tsc"' package.json; then \
      npm run build || true; \
    fi

# Use a non-root user
RUN useradd -ms /bin/bash appuser || true
USER appuser

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "index.js"]
