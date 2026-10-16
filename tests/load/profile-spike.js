/**
 * Profile: spike — sudden jump 0 -> 300 VUs in 10 seconds.
 * Usage: k6 run tests/load/profile-spike.js -e BASE_URL=... -e EXAM=standard
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
    spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: Number(__ENV.USER_COUNT || 300) },
        { duration: "3m", target: Number(__ENV.USER_COUNT || 300) },
        { duration: "1m", target: 0 },
      ],
      gracefulStop: "30s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<1500", "p(99)<3000"],
    errors: ["rate<0.01"],
  },
};

export default function () {
  const s = PLAN.students[__VU % PLAN.students.length];
  const r = rpc(PLAN.fnIds.login, s.loginBody);
  const ok = check(r, { "login ok": (x) => x.ok === true && !threw(x) });
  errors.add(ok ? 0 : 1);
}
