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
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Install runtime libraries Prisma needs (libssl3 is already in Debian, but be safe)
RUN apt-get update && \
    apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy the entire standalone Next.js build (server.js + minimal node_modules traced by Next)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy the FULL builder node_modules on top of the standalone one.
# This guarantees every runtime dependency (pg, pg-pool, @prisma/adapter-pg,
# postgres-*, split2, etc.) is present, regardless of whether Next.js's
# standalone tracing detected them. Optional packages (pg-cloud) that may be
# absent won't break the build — we copy the whole folder as-is.
#
# This is slightly larger but eliminates all "folder not found" COPY errors.
COPY --from=builder /app/node_modules ./node_modules

# Copy Prisma schema so `prisma db push` works at runtime
COPY --from=builder /app/prisma ./prisma

# Copy package.json (needed for `bun run` scripts: db:deploy / start:prod)
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

# Run db:deploy (safe, no data loss) then start the server
CMD ["sh", "-c", "bun run db:deploy && bun run start:prod"]
