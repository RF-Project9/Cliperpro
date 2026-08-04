import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL environment variable is not set. " +
        "On Railway: add a DATABASE_URL variable referencing your Postgres service. " +
        "Locally: check your .env file."
    );
  }

  // node-postgres connection pool — pure JS, no native libssl dependency.
  const pool = new Pool({
    connectionString: databaseUrl,
    // Railway Postgres requires SSL; accept it. Local dev (no SSL) still works
    // because pg falls back to plain connection when ssl rejectUnauthorized fails.
    ssl:
      databaseUrl.includes("railway.app") ||
      databaseUrl.includes("up.railway.app")
        ? { rejectUnauthorized: false }
        : false,
    max: 5,
    idleTimeoutMillis: 30000,
  });

  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    // In production, only log errors & warnings (not every query).
    // In development, log queries for debugging.
    log:
      process.env.NODE_ENV === "production"
        ? ["error", "warn"]
        : ["error", "warn", "query"],
  });
}

/**
 * Lazy-initialized Prisma client.
 *
 * We use a Proxy so that the PrismaClient is only created the first time a
 * property is accessed (e.g. `db.video.findMany()`), NOT when the module is
 * imported. This is critical for Next.js builds:
 *
 *   During `next build`, Next.js imports all route modules to "collect page
 *   data". At that point DATABASE_URL is not available (it's a runtime-only
 *   Railway variable). If we eagerly created the PrismaClient here, the import
 *   would throw and the build would fail with:
 *     "Error: Failed to collect page data for /api/..."
 *
 *   With lazy init, the module imports fine at build time (no client created),
 *   and the client is only created at runtime when a request comes in and
 *   DATABASE_URL is set.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol) {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createPrismaClient();
    }
    const client = globalForPrisma.prisma;
    const value = Reflect.get(client, prop);
    // Bind methods so `this` stays correct when destructured/ called standalone.
    return typeof value === "function" ? value.bind(client) : value;
  },
}) as PrismaClient;
