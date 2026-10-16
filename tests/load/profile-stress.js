/**
 * Profile: stress — push beyond 300 to find the breaking point.
 * Stages: 300 (5m) -> 450 (5m) -> 600 (5m) -> ramp down.
 * Usage: k6 run tests/load/profile-stress.js -e BASE_URL=... -e EXAM=standard
 *
 * Verdict input: the user count where error rate first exceeds 1% or p95
 * exceeds 800ms is recorded as the breaking point in the final report.
 */
import { check } from "k6";
import { Rate } from "k6/metrics";
import { SharedArray } from "k6/data";
import { rpc, threw } from "./lib/rpc.js";

const errors = new Rate("errors");
const PLAN = new SharedArray("plan", () =>
  JSON.parse(open(`./payloads-${__ENV.EXAM || "standard"}.json`)),
);

export const options = {
  scenarios: {
    stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "3m", target: 300 },
        { duration: "5m", target: 300 },
        { duration: "3m", target: 450 },
        { duration: "5m", target: 450 },
        { duration: "3m", target: 600 },
        { duration: "5m", target: 600 },
        { duration: "3m", target: 0 },
      ],
      gracefulStop: "1m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<800", "p(99)<2000"],
    errors: ["rate<0.01"],
  },
};

export default function () {
  const s = PLAN.students[__VU % PLAN.students.length];
  const r = rpc(PLAN.fnIds.getState, s.stateBody);
  const ok = check(r, { "state ok": (x) => x.ok === true && !threw(x) });
  errors.add(ok ? 0 : 1);
}
