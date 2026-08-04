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

# Copy source
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

# Copy standalone Next.js build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy Prisma files (schema + generated client) so db:deploy works at runtime
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma/adapter-pg ./node_modules/@prisma/adapter-pg
COPY --from=builder /app/node_modules/pg ./node_modules/pg
COPY --from=builder /app/node_modules/pg-types ./node_modules/pg-types
COPY --from=builder /app/node_modules/postgres-bytea ./node_modules/postgres-bytea
COPY --from=builder /app/node_modules/postgres-array ./node_modules/postgres-array
COPY --from=builder /app/node_modules/postgres-date ./node_modules/postgres-date
COPY --from=builder /app/node_modules/postgres-interval ./node_modules/postgres-interval
COPY --from=builder /app/node_modules/pg-protocol ./node_modules/pg-protocol
COPY --from=builder /app/node_modules/pg-connection-string ./node_modules/pg-connection-string
COPY --from=builder /app/node_modules/pg-pool ./node_modules/pg-pool
COPY --from=builder /app/node_modules/pg-cloud ./node_modules/pg-cloud
COPY --from=builder /app/node_modules/split2 ./node_modules/split2
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

# Run db:deploy (safe, no data loss) then start the server
CMD ["sh", "-c", "bun run db:deploy && bun run start:prod"]
