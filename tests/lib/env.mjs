/**
 * Test environment loader and production-safety guard (Phase 0).
 *
 * Rules:
 *  - Only `.env.test` (and the real process environment) is ever read for
 *    configuration. The production `.env` file is read by exactly one
 *    function below — assertNotProduction() — solely to REFUSE running
 *    against it (safety rule 0).
 *  - Secrets and plaintext test passwords live in gitignored artifacts
 *    under tests/.artifacts/ and must never be printed or committed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const ARTIFACTS_DIR = path.join(ROOT, "tests", ".artifacts");
export const MANIFEST_PATH = path.join(ARTIFACTS_DIR, "loadtest-manifest.json");
export const CREDENTIALS_PATH = path.join(ARTIFACTS_DIR, "loadtest-credentials.json");
export const RESEND_CAPTURE_PATH = path.join(ARTIFACTS_DIR, "resend-payloads.jsonl");

/** Minimal KEY="value" .env parser (no dependency). */
export function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = (m[2] ?? "").trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

/**
 * Load `.env.test` into process.env. Real environment variables always win
 * over file values (so CI can override). With allowProcessEnvOnly (dry-run)
 * the file may be missing entirely.
 */
export function loadTestEnv({ allowProcessEnvOnly = false } = {}) {
  const file = path.join(ROOT, ".env.test");
  if (!fs.existsSync(file)) {
    if (!allowProcessEnvOnly) {
      console.error(
        "[env] Missing .env.test — copy .env.test.example and point it at your staging project.",
      );
      process.exit(1);
    }
    console.warn("[env] .env.test not found — using process environment only.");
  }
  const fromFile = parseEnvFile(file);
  for (const [k, v] of Object.entries(fromFile)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return process.env;
}

export function normalizeUrl(u) {
  return String(u ?? "")
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * SAFETY GUARD (safety rule 0): refuses to run when the target Turso/libSQL
 * URL equals the production database referenced by .env. Local `file:`
 * databases are always allowed (they can never be the hosted production DB).
 * The only way past a cloud match is TEST_ALLOW_PRODUCTION_DB=1, which
 * prints a loud warning — never use it.
 */
export function assertNotProduction(testUrl) {
  const prodUrl = parseEnvFile(path.join(ROOT, ".env"))["TURSO_DATABASE_URL"];
  if (!prodUrl || !testUrl) return;
  if (String(prodUrl).startsWith("file:")) return; // dev file DB — never production
  const same = normalizeUrl(testUrl) === normalizeUrl(prodUrl);
  if (same && process.env.TEST_ALLOW_PRODUCTION_DB !== "1") {
    console.error(
      "[safety] REFUSING TO RUN: TURSO_DATABASE_URL points at the PRODUCTION database in .env.",
    );
    console.error(
      "[safety] Point .env.test at a dedicated staging database (safety rule 0).",
    );
    process.exit(1);
  }
  if (same) {
    console.warn(
      "[safety] WARNING: TEST_ALLOW_PRODUCTION_DB=1 — running against the PRODUCTION database!",
    );
  }
}

export function ensureArtifactsDir() {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

export function writeJson(file, data) {
  ensureArtifactsDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
