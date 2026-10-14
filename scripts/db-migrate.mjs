// Applies migrations/*.sql to the configured Turso/libSQL database, once each.
//
//   npm run db:migrate
//
// Env:
//   TURSO_DATABASE_URL  libsql://... (Turso cloud) or file:./local.db (dev)
//   TURSO_AUTH_TOKEN    required for cloud databases, ignored for file:

import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadEnv } from "./load-env.mjs";

loadEnv();

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error("Missing TURSO_DATABASE_URL (libsql://... or file:./local.db).");
  process.exit(1);
}

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

await client.execute(
  "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
);
const applied = new Set(
  (await client.execute("SELECT name FROM _migrations")).rows.map((r) => String(r.name)),
);

const dir = path.join(process.cwd(), "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let ran = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = readFileSync(path.join(dir, file), "utf8");
  process.stdout.write(`applying ${file} ... `);
  await client.executeMultiple(sql);
  await client.execute({
    sql: "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)",
    args: [file, new Date().toISOString()],
  });
  console.log("ok");
  ran++;
}
console.log(ran ? `${ran} migration(s) applied.` : "Database already up to date.");
