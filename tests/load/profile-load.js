/**
 * Profile: load — ramp to 300 users, hold 10 minutes, ramp down.
 * Usage: k6 run tests/load/profile-load.js -e BASE_URL=... -e EXAM=standard -e HOLD_MIN=10
 */
import { check } from "k6";
import { Rate } from "k6/metrics";
import { SharedArray } from "k6/data";
import exec from "k6/execution";
import { rpc, threw, thinkTime } from "./lib/rpc.js";

const errors = new Rate("errors");
const PLAN = new SharedArray("plan", () =>
  JSON.parse(open(`./payloads-${__ENV.EXAM || "standard"}.json`)),
);
const holdMin = Number(__ENV.HOLD_MIN || 10);

export const options = {
  scenarios: {
    load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: Number(__ENV.USER_COUNT || 300) },
        { duration: `${holdMin}m`, target: Number(__ENV.USER_COUNT || 300) },
        { duration: "2m", target: 0 },
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
  const a = s.answers[exec.vu.iterationInInstance % s.answers.length];
  const r = rpc(PLAN.fnIds.save, a.body);
  thinkTime(5, 15);
  const ok = check(r, { "save ok": (x) => x.ok === true && !threw(x) });
  errors.add(ok ? 0 : 1);
}
