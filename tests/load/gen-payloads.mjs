/**
 * Precompute every exact server-fn request body k6 will send (Phase 5).
 *
 * k6 cannot serialize seroval cross-JSON itself, so this generator (node +
 * the real seroval + tests/lib/serverfn.mjs) emits payload strings offline:
 *
 *   npm run test:load-payloads -- --exam standard --per-student 25
 *
 * Inputs (gitignored artifacts):
 *   tests/.artifacts/loadtest-manifest.json    (exam ids/slugs)
 *   tests/.artifacts/loadtest-credentials.json (student email/passwords)
 *
 * Outputs (tests/.artifacts/load/, gitignored):
 *   payloads-<exam>.json  { login: [{email, body}], per-student answer
 *                           plans, start/state/violation/submit bodies,
 *                           fnIds, slugs, base hints }
 *
 * Session tokens are static per participant row and read from the database
 * (service role), so EVERY byte of every exam call is precomputable:
 * login, start, getExamState, saveAnswer (each question x each option letter),
 * reportViolation, submit. k6 then does zero serialization — pure throughput.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fnId, serializeFnData, SERVER_FN_FILES } from "../lib/serverfn.mjs";
import { EMAIL_DOMAIN } from "../lib/fixtures.mjs";
import { loadTestEnv, assertNotProduction } from "../lib/env.mjs";

loadTestEnv();
assertNotProduction(process.env.TURSO_DATABASE_URL);
if (!process.env.TURSO_DATABASE_URL) {
  console.error(`[gen-payloads] Missing TURSO_DATABASE_URL — fill in .env.test (see .env.test.example).`);
  process.exit(1);
}

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const ART = path.join(ROOT, "tests", ".artifacts");
const OUT = path.join(ART, "load");

function args() {
  const o = {};
  for (let i = 2; i < process.argv.length; i += 2) o[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
  return o;
}
const { exam: examKey = "standard", "per-student": perStudent = "25" } = args();
const wantQuestions = Number(perStudent);

const manifest = JSON.parse(fs.readFileSync(path.join(ART, "loadtest-manifest.json"), "utf8"));
const creds = JSON.parse(fs.readFileSync(path.join(ART, "loadtest-credentials.json"), "utf8"));
const exam = (manifest.exams ?? []).find((e) => e.key === examKey);
if (!exam) throw new Error(`exam key '${examKey}' not in manifest (run test:seed first)`);
const students = creds.students?.[examKey] ?? [];
if (!students.length) throw new Error(`no credentials for exam '${examKey}'`);

// Session tokens: resolve per student email via a direct libSQL read.
const { createClient } = await import("@libsql/client");
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});
const rows = (
  await db.execute({
    sql: "SELECT email, session_token FROM participants WHERE exam_id = ?",
    args: [exam.id],
  })
).rows;
const tokens = new Map(rows.map((r) => [String(r.email).toLowerCase(), String(r.session_token)]));

// Question ids come from the seeded deterministic sets: 1..N (see fixtures).
const meta = { examKey, slug: exam.slug, questions: wantQuestions };
const fnIds = {
  login: fnId(SERVER_FN_FILES.exam, "loginExamParticipant"),
  getExamPublic: fnId(SERVER_FN_FILES.exam, "getExamPublic"),
  getState: fnId(SERVER_FN_FILES.exam, "getExamState"),
  start: fnId(SERVER_FN_FILES.exam, "startExam"),
  save: fnId(SERVER_FN_FILES.exam, "saveAnswer"),
  violation: fnId(SERVER_FN_FILES.exam, "reportViolation"),
  submit: fnId(SERVER_FN_FILES.exam, "submitExam"),
  adminListExams: fnId(SERVER_FN_FILES.admin, "adminListExams"),
  adminOrganizerStats: fnId(SERVER_FN_FILES.admin, "adminOrganizerStats"),
  adminDashboard: fnId(SERVER_FN_FILES.admin, "adminDashboard"),
  adminListStudents: fnId(SERVER_FN_FILES.admin, "adminListStudents"),
  adminBulkSend: fnId(SERVER_FN_FILES.admin, "adminBulkSendCredentials"),
  organizerLogin: fnId(SERVER_FN_FILES.auth, "organizerLogin"),
};

/**
 * Precomputed organizer bodies (real seroval). adminDashboard/adminListExams
 * take no examId; the rest take { examId }. The bulk-send plan carries one
 * full 300-row { examId, students } payload for scenario 4.
 */
async function buildAdminSection(exam) {
  const examBodies = {
    adminListStudents: await serializeFnData({ examId: exam.id }),
    adminDashboard: await serializeFnData({}),
  };
  const bulkStudents = [];
  for (let i = 1; i <= 300; i++) {
    const n = String(i).padStart(3, "0");
    bulkStudents.push({
      name: `loadtest_ Bulk ${n}`,
      email: `loadtest_bulk${n}@${EMAIL_DOMAIN}`,
      roll_no: `LT-B-${n}`,
    });
  }
  const bulkBody = await serializeFnData({ examId: exam.id, students: bulkStudents });
  const examId = exam.id;
  return {
    examId,
    listExamsBody: await serializeFnData({}),
    organizerStatsBody: await serializeFnData({}),
    ...examBodies,
    bulkRows: 300,
    bulkBody,
  };
}

const studentPlans = [];
for (const s of students) {
  const token = tokens.get(s.email.toLowerCase());
  if (!token) throw new Error(`no session token for ${s.email} (seed incomplete?)`);
  // Deterministic answer plan: rotate A,B,C,D + every 5th unanswered, seeded per-student.
  const answers = [];
  for (let q = 1; q <= wantQuestions; q++) {
    const opt = q % 5 === 0 ? null : ["A", "B", "C", "D"][(q + s.email.length) % 4];
    answers.push({
      q,
      body: await serializeFnData({ slug: exam.slug, token, questionId: q, option: opt }),
    });
  }
  studentPlans.push({
    email: s.email,
    loginBody: await serializeFnData({ slug: exam.slug, name: s.name, email: s.email, password: s.password }),
    startBody: await serializeFnData({ slug: exam.slug, token }),
    stateBody: await serializeFnData({ slug: exam.slug, token }),
    violationBody: await serializeFnData({ slug: exam.slug, token }),
    submitBody: await serializeFnData({ slug: exam.slug, token, reason: "manual" }),
    timeoutSubmitBody: await serializeFnData({ slug: exam.slug, token, reason: "timeout" }),
    answers,
  });
}

const out = {
  createdAt: new Date().toISOString(),
  contract: { base: "BASE_URL env", serverFnBase: "/_serverFn" },
  meta: { ...meta, examId: exam.id },
  fnIds,
  publicBody: await serializeFnData({ slug: exam.slug }),
  organizer: {
    // k6 cannot serialize seroval; setup() substitutes ORG_EMAIL/ORG_PASSWORD
    // env values into this precomputed body before posting organizerLogin.
    loginTemplate: await serializeFnData({
      email: "__ORG_EMAIL__",
      password: "__ORG_PASSWORD__",
    }),
  },
  admin: await buildAdminSection(exam),
  students: studentPlans,
};
fs.mkdirSync(OUT, { recursive: true });
const outPath = path.join(OUT, `payloads-${examKey}.json`);
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`[gen-payloads] ${studentPlans.length} students x ${wantQuestions} questions -> ${outPath}`);
console.log("[gen-payloads] passwords were serialized, never printed; tokens read via service role only.");
