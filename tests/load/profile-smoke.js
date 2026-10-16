/**
 * Profile: smoke — 5 users, 1 minute. Sanity check before any heavy run.
 * Usage: k6 run tests/load/profile-smoke.js -e BASE_URL=... -e EXAM=standard
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
  vus: 5,
  duration: "1m",
  thresholds: { errors: ["rate<0.01"] },
};

export default function () {
  const s = PLAN.students[__VU % PLAN.students.length];
  const r = rpc(PLAN.fnIds.login, s.loginBody);
  const ok = check(r, { "login ok": (x) => x.ok === true && !threw(x) });
  errors.add(ok ? 0 : 1);
}
