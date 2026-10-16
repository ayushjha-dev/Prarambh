/**
 * Deterministic test fixtures (Phase 0). EVERYTHING this module produces
 * carries the `loadtest_` marker (emails use the reserved `loadtest.example`
 * domain) so seed data can be identified and removed precisely.
 *
 * Password generation mirrors the app's generateSecurePassword() in
 * src/lib/admin.functions.ts exactly (12 chars, A–Z/a–z/2–9/symbols, no
 * ambiguous characters) so tests validate the real generator's behaviour.
 */
import crypto from "node:crypto";

export const MARKER = "loadtest_";
export const EMAIL_DOMAIN = "loadtest.example";

const SECURE_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O
const SECURE_LOWER = "abcdefghijkmnopqrstuvwxyz"; // no l
const SECURE_DIGITS = "23456789";
const SECURE_SYMBOLS = "!@#$%^&*-_+=?";

/** Same algorithm as the app's generateSecurePassword (server-side only — test tooling). */
export function generateSecurePassword(length = 12) {
  const pick = (alphabet) => alphabet[crypto.randomInt(alphabet.length)];
  const chars = [pick(SECURE_UPPER), pick(SECURE_LOWER), pick(SECURE_DIGITS), pick(SECURE_SYMBOLS)];
  const all = SECURE_UPPER + SECURE_LOWER + SECURE_DIGITS + SECURE_SYMBOLS;
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/**
 * Question-bank JSON in the exact shape adminUploadQuestionSet validates and
 * getQuestionDoc/submit_exam consume. Answers are deterministic: for question
 * i the correct letter is "ABCD"[i % 4] (and the option at that position holds
 * the right value), so tests can precompute expected scores. When i is a
 * multiple of `multiEvery`, the question is multi-correct ("A,C") to exercise
 * the multi-correct grading path (and BUG-01 coverage).
 */
export function buildQuestionSet(spec) {
  const letters = ["A", "B", "C", "D"];
  const questions = [];
  for (let i = 1; i <= spec.questions; i++) {
    const correctIdx = i % 4;
    const opts = ["", "", "", ""];
    opts[correctIdx] = String(i + 1);
    let v = i + 2;
    for (let k = 0; k < 4; k++) if (k !== correctIdx) opts[k] = String(v++);
    const multi = spec.multiEvery && i % spec.multiEvery === 0;
    questions.push({
      id: i,
      topic: `loadtest topic ${i % 7}`,
      difficulty: ["easy", "medium", "hard"][i % 3],
      qtype: "mcq",
      marks: spec.marksCorrect,
      question: multi
        ? `loadtest multi-correct q${i}: which options equal the value ${i + 1}?`
        : `loadtest q${i}: what is ${i} + 1?`,
      option_a: opts[0],
      option_b: opts[1],
      option_c: opts[2],
      option_d: opts[3],
      correct: multi ? "A,C" : letters[correctIdx],
    });
  }
  return {
    meta: {
      event: spec.title,
      organiser: "loadtest",
      total_questions: spec.questions,
      marks_correct: spec.marksCorrect,
      marks_wrong: spec.marksWrong,
      max_marks: spec.questions * spec.marksCorrect,
      duration_minutes: spec.duration,
    },
    questions,
  };
}

/**
 * The 5 seeded exams: varying question counts/durations including one 100+
 * question marathon, one live exam with multi-correct questions (smoke), and
 * one draft/future-window exam for phase/visibility tests.
 * Slugs must match exams_slug_format: ^[a-z0-9]+(-[a-z0-9]+)*$ (no underscores).
 */
export const EXAMS = [
  {
    key: "smoke",
    slug: "loadtest-smoke-10q",
    title: "loadtest_smoke 10q 15m",
    questions: 10,
    duration: 15,
    status: "live",
    window: "live",
    multiEvery: 5,
    marksCorrect: 2,
    marksWrong: -0.5,
  },
  {
    key: "standard",
    slug: "loadtest-standard-25q",
    title: "loadtest_standard 25q 30m",
    questions: 25,
    duration: 30,
    status: "live",
    window: "live",
    marksCorrect: 2,
    marksWrong: -0.5,
  },
  {
    key: "long",
    slug: "loadtest-long-50q",
    title: "loadtest_long 50q 45m",
    questions: 50,
    duration: 45,
    status: "live",
    window: "live",
    multiEvery: 10,
    marksCorrect: 2,
    marksWrong: -0.5,
  },
  {
    key: "marathon",
    slug: "loadtest-marathon-120q",
    title: "loadtest_marathon 120q 90m",
    questions: 120,
    duration: 90,
    status: "live",
    window: "live",
    marksCorrect: 4,
    marksWrong: -1,
  },
  {
    key: "draft",
    slug: "loadtest-draft-5q",
    title: "loadtest_draft 5q 10m",
    questions: 5,
    duration: 10,
    status: "draft",
    window: "future",
    marksCorrect: 2,
    marksWrong: -0.5,
  },
];

/** Deterministic student pool: loadtest_<prefix>NNN@loadtest.example, unique roll per pool. */
export function studentPool(examKey, prefix, count, startIndex = 1) {
  const students = [];
  for (let i = startIndex; i < startIndex + count; i++) {
    const n = String(i).padStart(3, "0");
    students.push({
      email: `loadtest_${prefix}${n}@${EMAIL_DOMAIN}`,
      name: `loadtest_ Student ${prefix.toUpperCase()}-${n}`,
      roll: `LT-${prefix.toUpperCase()}-${n}`,
      password: generateSecurePassword(12),
    });
  }
  return students;
}

/** One Unicode-name student (name/roll special characters coverage). */
export function unicodeStudent() {
  return {
    email: `loadtest_unicode01@${EMAIL_DOMAIN}`,
    name: 'loadtest_ Øláf-Jónsson 中文🚀 ("quote" & <angle>)',
    roll: "LT-Ü-001",
    password: generateSecurePassword(12),
  };
}
