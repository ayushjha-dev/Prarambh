#!/usr/bin/env node
/**
 * Seeds the TEST database with loadtest_-marked fixtures.
 *
 *   npm run test:seed              # seed (idempotent: re-running resets students)
 *   npm run test:seed -- --dry-run # print the plan without touching any database
 *
 * Creates: 2 organizer accounts (admin role, in the `organizers` table),
 * 5 exams (10/25/50/120/5 questions, incl. one 100+ question exam), and 318
 * student accounts (300 on the load exam) with known test credentials.
 *
 * SAFETY: refuses to run against the production database (tests/lib/env.mjs).
 * Outputs are gitignored and NEVER printed:
 *   tests/.artifacts/loadtest-manifest.json    (IDs for exact cleanup)
 *   tests/.artifacts/loadtest-credentials.json (plaintext passwords — secret)
 * Afterwards remove everything with: npm run test:cleanup
 */
import {
  loadTestEnv,
  assertNotProduction,
  MANIFEST_PATH,
  CREDENTIALS_PATH,
  writeJson,
} from "./lib/env.mjs";
import {
  EXAMS,
  EMAIL_DOMAIN,
  studentPool,
  unicodeStudent,
  buildQuestionSet,
  generateSecurePassword,
} from "./lib/fixtures.mjs";

const dryRun = process.argv.includes("--dry-run");
loadTestEnv({ allowProcessEnvOnly: dryRun });
assertNotProduction(process.env.TURSO_DATABASE_URL);

if (!dryRun) {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[seed] Missing TURSO_DATABASE_URL — fill in .env.test (see .env.test.example).");
    process.exit(1);
  }
}

const BCRYPT_ROUNDS = 10; // matches src/lib/admin.functions.ts hashPassword()
const organizerEmail = process.env.SEED_ORGANIZER_EMAIL ?? `loadtest_organizer@${EMAIL_DOMAIN}`;
const organizer2Email = process.env.SEED_ORGANIZER2_EMAIL ?? `loadtest_organizer2@${EMAIL_DOMAIN}`;
const loadStudents = Number(process.env.SEED_LOAD_STUDENTS ?? 300);

const pools = [
  { examKey: "standard", students: studentPool("standard", "s", loadStudents) },
  { examKey: "smoke", students: [...studentPool("smoke", "p", 9), unicodeStudent()] },
  { examKey: "long", students: studentPool("long", "l", 5) },
  { examKey: "marathon", students: studentPool("marathon", "m", 3) },
];

const bcryptMod = await import("bcryptjs");
const bcrypt = bcryptMod.default ?? bcryptMod;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

if (dryRun) {
  // Validate the hashing path and print the plan — no network, no database.
  const probe = await bcrypt.hash("loadtest-probe-password", BCRYPT_ROUNDS);
  if (!probe.startsWith("$2")) throw new Error("bcrypt self-check failed");
  const studentTotals = Object.fromEntries(pools.map((p) => [p.examKey, p.students.length]));
  const questionTotals = Object.fromEntries(EXAMS.map((e) => [e.key, e.questions]));
  console.log("[seed] dry-run OK — bcrypt works, NO database touched.");
  console.log("[seed] exam question counts:", questionTotals);
  console.log(
    "[seed] students per exam:",
    studentTotals,
    "total:",
    Object.values(studentTotals).reduce((a, b) => a + b, 0),
  );
  console.log("[seed] would write:", MANIFEST_PATH, "and", CREDENTIALS_PATH);
  process.exit(0);
}

// ================================================================ DB seeding
const { createClient } = await import("@libsql/client");
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

// 0. Sanity: migrations must be applied to the database.
try {
  await db.execute("SELECT id FROM exams LIMIT 1");
} catch (e) {
  console.error(`[seed] Cannot query the exams table: ${e.message}`);
  console.error("[seed] Run `npm run db:migrate` against the test database first, then re-run.");
  process.exit(1);
}

async function one(sql, args = []) {
  const rs = await db.execute({ sql, args });
  return rs.rows[0] ?? null;
}

async function ensureOrganizer(email) {
  const password = generateSecurePassword(16);
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const existing = await one("SELECT id FROM organizers WHERE lower(email) = lower(?)", [email]);
  let id;
  if (existing) {
    id = String(existing.id);
    await db.execute({
      sql: "UPDATE organizers SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?",
      args: [hash, id],
    });
  } else {
    id = crypto.randomUUID();
    await db.execute({
      sql: "INSERT INTO organizers (id, email, password_hash, display_name, role, created_at) VALUES (?, ?, ?, '', 'admin', ?)",
      args: [id, email, hash, new Date().toISOString()],
    });
  }
  return { email, password, id };
}

console.log("[seed] organizers…");
const organizers = [await ensureOrganizer(organizerEmail), await ensureOrganizer(organizer2Email)];
const createdBy = organizers[0].id;

function examWindow(kind) {
  const now = Date.now();
  if (kind === "future") {
    return {
      starts_at: new Date(now + 30 * 864e5).toISOString(),
      ends_at: new Date(now + 31 * 864e5).toISOString(),
    };
  }
  return {
    starts_at: new Date(now - 36e5).toISOString(), // live for 1h already
    ends_at: new Date(now + 7 * 864e5).toISOString(),
  };
}

console.log("[seed] exams + question sets…");
const examManifest = [];
for (const spec of EXAMS) {
  const setDoc = buildQuestionSet(spec);
  const existing = await one("SELECT id, question_set_id FROM exams WHERE slug = ?", [spec.slug]);

  let setId = existing?.question_set_id ?? null;
  if (setId) {
    await db.execute({
      sql: "UPDATE question_sets SET data = ? WHERE id = ?",
      args: [JSON.stringify(setDoc), setId],
    });
  } else {
    setId = crypto.randomUUID();
    await db.execute({
      sql: "INSERT INTO question_sets (id, data, is_active, created_at) VALUES (?, ?, 0, ?)",
      args: [setId, JSON.stringify(setDoc), new Date().toISOString()],
    });
  }

  const w = examWindow(spec.window);
  const row = {
    title: spec.title,
    description: "loadtest fixture exam (seeded — safe to delete)",
    subject: "loadtest",
    duration_minutes: spec.duration,
    marks_correct: spec.marksCorrect,
    marks_wrong: spec.marksWrong,
    total_marks: spec.questions * spec.marksCorrect,
    passing_marks: Math.round(spec.questions * spec.marksCorrect * 0.4),
    status: spec.status,
    is_enabled: 1,
    question_set_id: setId,
    created_by: createdBy,
    ...w,
  };
  let examId;
  if (existing) {
    examId = String(existing.id);
    await db.execute({
      sql: `UPDATE exams SET title = ?, description = ?, subject = ?, duration_minutes = ?,
            marks_correct = ?, marks_wrong = ?, total_marks = ?, passing_marks = ?, status = ?,
            is_enabled = ?, question_set_id = ?, created_by = ?, starts_at = ?, ends_at = ?
            WHERE id = ?`,
      args: [
        row.title, row.description, row.subject, row.duration_minutes,
        row.marks_correct, row.marks_wrong, row.total_marks, row.passing_marks,
        row.status, row.is_enabled, row.question_set_id, row.created_by,
        row.starts_at, row.ends_at, examId,
      ],
    });
  } else {
    examId = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO exams (id, slug, title, description, subject, duration_minutes,
            marks_correct, marks_wrong, total_marks, passing_marks, status, starts_at, ends_at,
            is_enabled, question_set_id, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        examId, spec.slug, row.title, row.description, row.subject, row.duration_minutes,
        row.marks_correct, row.marks_wrong, row.total_marks, row.passing_marks, row.status,
        row.starts_at, row.ends_at, row.is_enabled, row.question_set_id, row.created_by,
        new Date().toISOString(),
      ],
    });
  }
  examManifest.push({
    key: spec.key,
    id: examId,
    slug: spec.slug,
    title: spec.title,
    questionSetId: setId,
  });
}

console.log(`[seed] students (bcrypt cost ${BCRYPT_ROUNDS} — takes a minute)…`);
const manifestPools = {};
let created = 0;
let reset = 0;
for (const pool of pools) {
  const exam = examManifest.find((e) => e.key === pool.examKey);
  if (!exam) throw new Error(`unknown exam key ${pool.examKey}`);

  const existingRows = (
    await db.execute({
      sql: "SELECT id, email FROM participants WHERE exam_id = ?",
      args: [exam.id],
    })
  ).rows;
  const byEmail = new Map(existingRows.map((r) => [String(r.email).toLowerCase(), String(r.id)]));

  const ids = [];
  const fresh = [];
  let done = 0;
  for (const s of pool.students) {
    const hash = await bcrypt.hash(s.password, BCRYPT_ROUNDS);
    const prevId = byEmail.get(s.email.toLowerCase());
    if (prevId) {
      await db.execute({
        sql: `UPDATE participants SET name = ?, roll_no = ?, password_salt = 'bcrypt',
              password_hash = ?, failed_attempts = 0, locked_until = NULL, is_active = 1,
              status = 'not_started', exam_started_at = NULL, exam_submitted_at = NULL,
              time_taken_seconds = NULL, submit_reason = NULL, tab_violation_count = 0,
              group_name = 'loadtest', phone = ''
              WHERE id = ?`,
        args: [s.name, s.roll, hash, prevId],
      });
      ids.push(prevId);
      reset += 1;
    } else {
      fresh.push({
        id: crypto.randomUUID(),
        session_token: crypto.randomUUID(),
        name: s.name,
        email: s.email,
        roll_no: s.roll,
        password_salt: "bcrypt",
        password_hash: hash,
        is_active: 1,
        status: "not_started",
        group_name: "loadtest",
        phone: "",
        exam_id: exam.id,
        question_set_id: exam.questionSetId,
        created_at: new Date().toISOString(),
      });
    }
    done += 1;
    if (done % 50 === 0) console.log(`[seed]   ${pool.examKey}: ${done}/${pool.students.length}`);
  }
  for (const c of chunk(fresh, 50)) {
    await db.batch(
      c.map((r) => ({
        sql: `INSERT INTO participants (id, name, email, session_token, question_set_id, exam_id,
              created_at, tab_violation_count, status, phone, roll_no, group_name, is_active,
              password_salt, password_hash, failed_attempts)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'not_started', ?, ?, ?, 1, ?, ?, 0)`,
        args: [
          r.id, r.name, r.email, r.session_token, r.question_set_id, r.exam_id, r.created_at,
          r.phone, r.roll_no, r.group_name, r.password_salt, r.password_hash,
        ],
      })),
      "write",
    );
    created += c.length;
    ids.push(...c.map((r) => r.id));
  }

  // Re-seed means a fresh attempt: wipe previous answers/results for these students.
  for (const c of chunk(ids, 100)) {
    const ph = c.map(() => "?").join(",");
    await db.execute({
      sql: `DELETE FROM responses WHERE participant_id IN (${ph})`,
      args: c,
    });
    await db.execute({
      sql: `DELETE FROM results WHERE participant_id IN (${ph})`,
      args: c,
    });
  }
  manifestPools[pool.examKey] = pool.students.map((s) => s.email);
  console.log(`[seed]   ${pool.examKey}: ${pool.students.length} students ready`);
}

writeJson(MANIFEST_PATH, {
  createdAt: new Date().toISOString(),
  databaseUrl: process.env.TURSO_DATABASE_URL,
  organizers: organizers.map(({ email, id }) => ({ email, id })),
  exams: examManifest,
  pools: manifestPools,
  counts: { exams: examManifest.length, created, reset },
});
writeJson(CREDENTIALS_PATH, {
  createdAt: new Date().toISOString(),
  note: "SECRET — gitignored. Never print or commit. Regenerate via re-seed.",
  organizers: organizers.map(({ email, password }) => ({ email, password })),
  students: Object.fromEntries(pools.map((p) => [p.examKey, p.students])),
});

console.log(
  `[seed] DONE — exams: ${examManifest.length}, students created: ${created}, reset: ${reset}`,
);
console.log(`[seed] manifest:    ${MANIFEST_PATH}`);
console.log(`[seed] credentials: ${CREDENTIALS_PATH}  (gitignored — never print)`);
console.log("[seed] remove everything afterwards with: npm run test:cleanup");
