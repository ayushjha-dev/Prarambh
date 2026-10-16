/**
 * Self-test for the Resend mock — proves capture, failure injection and the
 * health/capture endpoints work before any real test relies on them.
 * Run: npm run test:resend-selftest
 */
import assert from "node:assert/strict";
import { createResendMockServer } from "./resend-mock-server.mjs";

const mock = createResendMockServer({ capturePath: null, failEmails: [], failRate: 0 });
const port = await mock.listen(0);
const base = `http://127.0.0.1:${port}`;

// 1. Successful send is captured with the full payload.
let res = await fetch(`${base}/emails`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    from: "ExamPortal Tests <no-reply@loadtest.example>",
    to: "loadtest_s001@loadtest.example",
    subject: "Your exam login: loadtest_standard 25q 30m",
    text: "Hi loadtest_ Student S-001,\nName: loadtest_ Student S-001\nRoll No: LT-S-001\nPassword: Ab3!xyzQw7@\nExam link: http://localhost:5173/exam/loadtest-standard-25q",
  }),
});
assert.equal(res.status, 200, "mock must answer 200 like Resend");
assert.ok((await res.json()).id, "mock must return a Resend-shaped {id}");

// 2. Failure injection (partial-failure tests).
mock.setFailEmails(["fail@loadtest.example"]);
res = await fetch(`${base}/emails`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ to: "fail@loadtest.example", subject: "x", text: "y" }),
});
assert.equal(res.status, 422, "configured recipients must fail");
assert.ok((await res.json()).error?.message, "failure must be Resend-shaped {error}");

// 3. Capture endpoint exposes payloads for assertions.
res = await fetch(`${base}/_capture`);
const captured = await res.json();
assert.equal(captured.length, 2, "both requests must be captured");
assert.equal(captured[0].payload.to, "loadtest_s001@loadtest.example");
assert.match(captured[0].payload.text, /Roll No: LT-S-001/, "roll no must be in payload");
assert.match(captured[0].payload.text, /Password: /, "password must be in payload");
assert.match(
  captured[0].payload.text,
  /\/exam\/loadtest-standard-25q/,
  "exam link must be in payload",
);

// 4. Health endpoint.
res = await fetch(`${base}/_health`);
assert.equal((await res.json()).ok, true, "health must report ok");

await mock.close();
console.log("resend-mock selftest: PASS (4/4)");
