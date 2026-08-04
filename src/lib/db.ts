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
      databaseUrl.includes("railway.app") || databaseUrl.includes("up.railway.app")
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

export const db = globalForPrisma.prisma ?? createPrismaClient();

// Cache on globalThis to avoid creating multiple PrismaClient instances
// during hot-reload (dev) or serverless reuse (prod).
globalForPrisma.prisma = db;
