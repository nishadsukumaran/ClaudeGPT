# ClaudeGPT — single image, both API and Worker entry points.
#
# Build:    docker build -t claudegpt .
# Run API:  docker run -p 3000:3000 --env-file .env claudegpt pnpm start
# Run Worker: docker run --env-file .env claudegpt pnpm start:worker
#
# On Railway: deploy this once, create two services from the same image,
# override the start command per service (web -> "pnpm start", worker -> "pnpm start:worker").

FROM node:20-bookworm-slim AS base

# Install OS deps: git for clone operations, ca-certs for TLS, curl for the Claude CLI installer.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      ca-certificates \
      curl \
      tini \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# --- DEPENDENCIES LAYER ---
# Copy only manifests first for better Docker layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/queue/package.json ./packages/queue/
COPY packages/github/package.json ./packages/github/
COPY packages/project-registry/package.json ./packages/project-registry/
COPY packages/policy/package.json ./packages/policy/
COPY packages/claim/package.json ./packages/claim/
COPY packages/routing/package.json ./packages/routing/
COPY packages/runner/package.json ./packages/runner/
COPY packages/qa/package.json ./packages/qa/
COPY packages/clickup/package.json ./packages/clickup/

RUN pnpm install --frozen-lockfile --prod=false

# --- SOURCE LAYER ---
COPY . .

# --- CLAUDE CODE CLI ---
# Pre-install so the runner can spawn it. The CLI binary lives at
# /usr/local/share/npm-global/bin/claude. Auth happens at first launch
# via `claude login`; credentials persist to /root/.claude/ — MOUNT A VOLUME
# THERE in production (see docs/railway-deploy.md).
RUN npm install -g @anthropic-ai/claude-code 2>/dev/null || \
    echo "Claude Code CLI install failed — runner will need it installed manually before first build job."

# Healthcheck for Railway's monitoring (only meaningful for the API service).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:${PORT:-3000}/health || exit 1

# Use tini as PID 1 for proper signal forwarding (Railway sends SIGTERM on deploy).
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command runs the API. Worker service overrides with "pnpm start:worker".
EXPOSE 3000
CMD ["pnpm", "start"]
