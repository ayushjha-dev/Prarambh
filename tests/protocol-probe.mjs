/**
 * Protocol probe — validates the server-fn wire protocol against a running
 * dev server WITHOUT needing a database:
 *   1. getExamPublic with a bogus slug  -> Error "EXAM_NOT_FOUND"
 *   2. adminListExams without a token   -> Unauthorized (middleware)
 * Run: node tests/protocol-probe.mjs   (dev server must be up: npm run dev:test)
 */
import { callServerFn, SERVER_FN_FILES, fnId } from "./lib/serverfn.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
let base = "http://localhost:5173";
try {
  base = JSON.parse(
    fs.readFileSync(path.join(ROOT, "tests", ".artifacts", "dev-server.json"), "utf8"),
  ).baseUrl;
} catch {
  /* fall back to default */
}

let failed = 0;
function check(label, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed += 1;
}

console.log(`probe base: ${base}`);
console.log(`fnId(getExamPublic) = ${fnId(SERVER_FN_FILES.exam, "getExamPublic")}`);

const r1 = await callServerFn(base, { fn: "getExamPublic", data: { slug: "does-not-exist-xyz" } });
check(
  "getExamPublic bogus slug -> EXAM_NOT_FOUND error",
  r1.error instanceof Error && /EXAM_NOT_FOUND/.test(r1.error.message),
  `status=${r1.status} error=${r1.error?.message}`,
);

const r2 = await callServerFn(base, { fn: "adminListExams", file: SERVER_FN_FILES.admin, data: {} });
check(
  "adminListExams without token -> Unauthorized",
  r2.error instanceof Error && /Unauthorized/i.test(r2.error.message),
  `status=${r2.status} error=${r2.error?.message}`,
);

const r3 = await callServerFn(base, {
  fn: "saveAnswer",
  data: { slug: "x", token: "not-a-uuid", questionId: 1, option: "A" },
});
check(
  "saveAnswer invalid input -> Zod validation error",
  r3.error instanceof Error && /uuid|invalid|expected/i.test(r3.error.message),
  `status=${r3.status} error=${String(r3.error?.message).slice(0, 120)}`,
);

console.log(failed === 0 ? "\nprotocol probe: PASS (3/3)" : `\nprotocol probe: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
