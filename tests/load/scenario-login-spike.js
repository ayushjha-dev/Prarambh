/**
 * Scenario 1 — Login spike: "everyone logs in at exam start".
 * Ramps 0 -> 300 VUs within 60s; every VU logs in with UNIQUE seeded
 * credentials (precomputed seroval bodies from gen-payloads.mjs).
 *
 *   k6 run tests/load/scenario-login-spike.js -e BASE_URL=http://localhost:5173 -e EXAM=standard
 *
 * Thresholds: login p95 < 1.5s (bcrypt cost noted), error rate < 1%.
 */
import { check } from "k6";
import { Trend, Rate } from "k6/metrics";
import { SharedArray } from "k6/data";
import { rpc, threw } from "./lib/rpc.js";

const loginDuration = new Trend("login_duration", true);
const errors = new Rate("errors");

const PLAN = new SharedArray("plan", () =>
  JSON.parse(open(`./payloads-${__ENV.EXAM || "standard"}.json`)),
);

export const options = {
  scenarios: {
    login_spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "60s", target: Number(__ENV.USER_COUNT || 300) },
        { duration: "2m", target: Number(__ENV.USER_COUNT || 300) },
        { duration: "30s", target: 0 },
      ],
      gracefulStop: "30s",
    },
  },
  thresholds: {
    login_duration: ["p(95)<1500"],
    errors: ["rate<0.01"],
  },
};

export default function () {
  const s = PLAN.students[__VU % PLAN.students.length];
  const start = Date.now();
  const r = rpc(PLAN.fnIds.login, s.loginBody);
  loginDuration.add(Date.now() - start);
  const pass = check(r, {
    "login routed (200 + serialized)": (x) => x.ok === true,
    "login accepted for seeded student": (x) => x.body.indexOf("token") !== -1,
    "no thrown error": (x) => !threw(x),
  });
  if (!pass) {
    errors.add(1);
    if (__ENV.VERBOSE) console.log(`login failed VU=${__VU} status=${r.status} body=${r.body.slice(0, 160)}`);
  } else {
    errors.add(0);
  }
}
