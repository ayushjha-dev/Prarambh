#!/usr/bin/env node
/**
 * Removes ONLY loadtest_-marked test data created by tests/seed.mjs.
 *
 *   npm run test:cleanup              # delete seeded data
 *   npm run test:cleanup -- --dry-run # count what would go, delete nothing
 *
 * Strategy: manifest-driven exact-ID deletes first, then a marker-prefix /
 * reserved-domain sweep as a safety net (covers partial or crashed seeds).
 * Deletes participants (cascade removes responses/results) → exams →
 * question sets → organizer accounts, in that order. Never touches anything
 * else, and the same production-safety guard as seed.mjs applies.
 */
import fs from "node:fs";
import {
  loadTestEnv,
  assertNotProduction,
  MANIFEST_PATH,
  CREDENTIALS_PATH,
  RESEND_CAPTURE_PATH,
  readJson,
} from "./lib/env.mjs";
import { EMAIL_DOMAIN } from "./lib/fixtures.mjs";

const dryRun = process.argv.includes("--dry-run");
loadTestEnv({ allowProcessEnvOnly: false });
assertNotProduction(process.env.TURSO_DATABASE_URL);
if (!process.env.TURSO_DATABASE_URL) {
  console.error("[cleanup] Missing TURSO_DATABASE_URL — fill in .env.test (see .env.test.example).");
  process.exit(1);
}

const manifest = readJson(MANIFEST_PATH);
if (
  manifest?.databaseUrl &&
  manifest.databaseUrl.replace(/\/+$/, "") !== process.env.TURSO_DATABASE_URL.replace(/\/+$/, "")
) {
  console.error("[cleanup] Manifest belongs to a different database URL than .env.test.");
  console.error(
    "[cleanup] Refusing to clean the wrong database — delete tests/.artifacts manually if intentional.",
  );
  process.exit(1);
}

const { createClient } = await import("@libsql/client");
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function all(sql, args = []) {
  return (await db.execute({ sql, args })).rows;
}

// ---------------------------------------------------------------- the plan
const plan = {
  participants: new Set(),
  exams: new Set(),
  questionSets: new Set(),
  organizers: new Map(), // id -> email
};

if (manifest) {
  for (const e of manifest.exams ?? []) {
    plan.exams.add(String(e.id));
    if (e.questionSetId) plan.questionSets.add(String(e.questionSetId));
  }
} else {
  console.warn("[cleanup] No manifest found — relying on marker sweep only.");
}

// Marker sweep: reserved loadtest.example email domain + loadtest_ titles/slugs.
{
  for (const r of await all("SELECT id FROM participants WHERE email LIKE ?", [`%@${EMAIL_DOMAIN}`])) {
    plan.participants.add(String(r.id));
  }

  for (const r of await all("SELECT id FROM exams WHERE title LIKE 'loadtest\\_%' ESCAPE '\\' OR slug LIKE 'loadtest-%'")) {
    plan.exams.add(String(r.id));
  }

  // Participants of planned exams (even non-marker emails — the exam owns them).
  for (const c of chunk([...plan.exams], 100)) {
    const ph = c.map(() => "?").join(",");
    for (const r of await all(`SELECT id FROM participants WHERE exam_id IN (${ph})`, c)) {
      plan.participants.add(String(r.id));
    }
  }

  // Question sets whose meta.event carries the marker (belt and braces).
  for (const r of await all(
    "SELECT id FROM question_sets WHERE data LIKE '{\"meta\":{\"event\":\"loadtest%' OR data LIKE '%\"event\":\"loadtest%'",
  )) {
    plan.questionSets.add(String(r.id));
  }

  // Organizer accounts on the reserved domain (or listed in the manifest).
  for (const r of await all("SELECT id, email FROM organizers")) {
    const email = String(r.email).toLowerCase();
    if (
      email.endsWith(`@${EMAIL_DOMAIN}`) ||
      (manifest?.organizers ?? []).some((o) => o.id === r.id)
    ) {
      plan.organizers.set(String(r.id), email);
    }
  }
}

// ------------------------------------------------------------ execute plan
const counts = {
  responses: 0,
  results: 0,
  participants: plan.participants.size,
  exams: plan.exams.size,
  questionSets: plan.questionSets.size,
  organizers: plan.organizers.size,
};
const pids = [...plan.participants];

// Pre-count answers/scores that will vanish with the cascade (for the report).
for (const c of chunk(pids, 100)) {
  const ph = c.map(() => "?").join(",");
  counts.responses += (await all(`SELECT id FROM responses WHERE participant_id IN (${ph})`, c)).length;
  counts.results += (await all(`SELECT id FROM results WHERE participant_id IN (${ph})`, c)).length;
}

if (dryRun) {
  console.log("[cleanup] DRY RUN — nothing deleted. Planned removals:");
  console.log("[cleanup]", counts);
  process.exit(0);
}

// Participants first (responses/results cascade with them), then exams
// (participants also cascade via exam_id), then sets, organizers.
for (const c of chunk(pids, 100)) {
  const ph = c.map(() => "?").join(",");
  await db.execute({ sql: `DELETE FROM participants WHERE id IN (${ph})`, args: c });
}
for (const c of chunk([...plan.exams], 100)) {
  const ph = c.map(() => "?").join(",");
  await db.execute({ sql: `DELETE FROM exams WHERE id IN (${ph})`, args: c });
}
for (const c of chunk([...plan.questionSets], 100)) {
  const ph = c.map(() => "?").join(",");
  await db.execute({ sql: `DELETE FROM question_sets WHERE id IN (${ph})`, args: c });
}
for (const c of chunk([...plan.organizers.keys()], 100)) {
  const ph = c.map(() => "?").join(",");
  await db.execute({ sql: `DELETE FROM organizers WHERE id IN (${ph})`, args: c });
}

// Local artifacts (credentials, manifest, captured payloads) go too.
for (const f of [CREDENTIALS_PATH, MANIFEST_PATH, RESEND_CAPTURE_PATH]) {
  fs.rmSync(f, { force: true });
}

console.log("[cleanup] DONE — removed only loadtest_-marked data:");
console.log("[cleanup]", counts);
