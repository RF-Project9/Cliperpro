# Dockerfile for ViralClip AI — Railway deployment
# Uses Debian-based image which includes libssl3 (required by Prisma's native engine).
# This eliminates the "libssl.so.3: cannot open shared object file" error.

# ---- Build stage ----
FROM oven/bun:1-debian AS builder
WORKDIR /app

# Copy dependency files first for cache
COPY package.json bun.lock ./

# Install dependencies (including devDependencies for build)
RUN bun install --frozen-lockfile

# Copy source (respect .dockerignore)
COPY . .

# Generate Prisma client & build Next.js standalone
RUN bun run db:generate
RUN bun run build

# ---- Production stage ----
FROM oven/bun:1-debian AS runner
WORKDIR /app

ENV NODE_ENV=production
# Do NOT hardcode PORT — Railway injects it automatically (usually 8080).
# Next.js standalone reads process.env.PORT at startup, so it will bind
# to whatever Railway assigns.
ENV HOSTNAME=0.0.0.0

# Install runtime libraries Prisma needs (libssl3 is already in Debian, but be safe)
RUN apt-get update && \
    apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy standalone Next.js build.
# IMPORTANT: preserve the .next/standalone/ path because package.json's
# start:prod script runs `bun .next/standalone/server.js`.
# The standalone output is self-contained: server.js + traced node_modules
# + .next/static + public + package.json.
COPY --from=builder /app/.next/standalone ./.next/standalone

# Copy the FULL builder node_modules so `bun run db:deploy` (prisma CLI) works.
# Also serves as a fallback for any deps Next.js standalone tracing missed
# (Node resolves from .next/standalone/node_modules/ up to /app/node_modules/).
COPY --from=builder /app/node_modules ./node_modules

# Copy Prisma schema so `prisma db push` works at runtime
COPY --from=builder /app/prisma ./prisma

# Copy package.json (needed for `bun run` scripts: db:deploy / start:prod)
COPY --from=builder /app/package.json ./package.json

# No EXPOSE needed — Railway auto-detects the port from $PORT env var.
# The app listens on $PORT (injected by Railway) at HOSTNAME=0.0.0.0.

# Run db:deploy (safe, no data loss) then start the server
CMD ["sh", "-c", "bun run db:deploy && bun run start:prod"]
