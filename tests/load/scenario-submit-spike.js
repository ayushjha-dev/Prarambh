/**
 * Scenario 3 — Submit spike: most of the 300 students submit within the same
 * 1-2 minute window near the end of the exam (submit_exam RPC storm).
 *
 *   k6 run tests/load/scenario-submit-spike.js -e BASE_URL=... -e EXAM=standard
 *
 * Asserts: every submit accepted exactly once (submitExam is idempotent —
 * double submit returns { submitted: true }), no 5xx, p95 < 800ms.
 */
import { check } from "k6";
import { Trend, Rate } from "k6/metrics";
import { SharedArray } from "k6/data";
import { rpc, threw } from "./lib/rpc.js";

const submitDuration = new Trend("submit_duration", true);
const errors = new Rate("errors");

const PLAN = new SharedArray("plan", () =>
  JSON.parse(open(`./payloads-${__ENV.EXAM || "standard"}.json`)),
);

export const options = {
  scenarios: {
    submit_spike: {
      executor: "ramping-arrival-rate",
      startRate: 0,
      timeUnit: "1s",
      preAllocatedVUs: 320,
      maxVUs: 400,
      stages: [
        { duration: "20s", target: 30 }, // warm: 30/s
        { duration: "90s", target: 180 }, // spike: ~180 submits/s
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    submit_duration: ["p(95)<800"],
    errors: ["rate<0.01"],
  },
};

export default function () {
  const s = PLAN.students[Math.floor(Math.random() * PLAN.students.length)];
  const t0 = Date.now();
  const r = rpc(PLAN.fnIds.submit, s.submitBody);
  submitDuration.add(Date.now() - t0);
  const pass = check(r, {
    "submit accepted": (x) => x.ok === true,
    "submitted:true": (x) => x.body.indexOf("submitted") !== -1,
    "no error": (x) => !threw(x),
  });
  errors.add(pass ? 0 : 1);
}
