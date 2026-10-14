// Scheduled database health check for Turso (libSQL).
//
// Turso does NOT auto-pause like Supabase's free tier, so the original
// "keep-alive" purpose is gone. The workflow keeps its 4-day cadence and now
// verifies that the database is reachable, authenticated, and migrated —
// catching config drift (rotated tokens, missing schema) early.
// Only reads; no writes, no data mutated.
//
// Required env:
//   TURSO_DATABASE_URL libsql://<db>-<org>.turso.io (cloud) or file:... (dev)
//   TURSO_AUTH_TOKEN   required for cloud databases, ignored for file:
//
// Run manually:  node scripts/keep-db-awake.mjs

import { createClient } from "@libsql/client";

import { loadEnv } from "./load-env.mjs";

loadEnv();

const url = process.env.TURSO_DATABASE_URL;

if (!url) {
  console.error("Missing TURSO_DATABASE_URL env var.");
  process.exit(1);
}

const started = Date.now();
const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

try {
  // 1) Connectivity + auth (cheap round trip).
  await db.execute("SELECT 1");
  const connectMs = Date.now() - started;

  // 2) Schema check: _migrations only exists once `npm run db:migrate` ran.
  const migrations = await db.execute("SELECT count(*) AS n FROM _migrations");
  const applied = Number(migrations.rows[0]?.n ?? 0);

  console.log(
    `Connected in ${connectMs}ms (total ${Date.now() - started}ms), migrations applied: ${applied}`,
  );

  if (applied < 1) {
    console.error("Database reachable but NO migrations applied. Run: npm run db:migrate");
    process.exit(1);
  }
  console.log("Database healthy.");
} catch (err) {
  console.error("Health check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
