/**
 * Load-test contract for the ExamPortal k6 suite (Phase 5).
 *
 * Server functions are NOT plain JSON over HTTP: request bodies are seroval
 * cross-JSON of `{ data }` (see tests/lib/serverfn.mjs), function IDs are
 * deterministic base64url, and callers must send
 * `sec-fetch-site: same-origin` (+ Origin) or TSS's CSRF middleware 403s.
 * k6 cannot compute seroval trees itself, so tests/load/gen-payloads.mjs
 * (node + real seroval) precomputes every exact body string k6 needs from the
 * credentials/manifest artifacts. k6 asserts on HTTP status + how responses
 * DECODE as seroval (see tests/load/lib/decode.js + rpc.js).
 *
 * Status contract (from live calls):
 *   - accepted & routed: 200 (+ x-tss-serialized response)
 *   - missing same-origin signal: 403 "Forbidden" (CSRF middleware)
 *   - unknown function id: 500 (vite error page; body contains the id)
 *   - server-fn *threw* (Zod, EXAM_NOT_FOUND, Unauthorized): verifier pending
 *     (dev RPC registration issue under investigation — see Phase 1 notes)
 *
 * Thresholds (per the test plan):
 *   p95 < 800ms and p99 < 2s for normal API calls; login p95 < 1.5s;
 *   error rate < 1%; zero lost answers/submissions (DB-count verified).
 */
export const CONTRACT = {
  serverFnBase: "/_serverFn",
  csrfHeader: "sec-fetch-site",
  csrfValue: "same-origin",
  status: { ok: 200, csrfBlocked: 403, unknownFn: 500 },
};

export const THRESHOLDS = {
  http_req_duration: ["p(95)<800", "p(99)<2000"],
  login_duration: ["p(95)<1500"],
  errors: ["rate<0.01"],
};
