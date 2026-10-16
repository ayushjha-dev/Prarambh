/**
 * Profile: soak — 300 users for 60+ minutes. Detects memory leaks,
 * connection-pool exhaustion, and upward CPU/memory drift on the server.
 * Run with the monitor sampler (tests/monitor/) and graph its JSONL output.
 * Usage: k6 run tests/load/profile-soak.js -e BASE_URL=... -e EXAM=standard -e SOAK_MIN=60
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
const soakMin = Number(__ENV.SOAK_MIN || 60);

export const options = {
  scenarios: {
    soak: {
      executor: "constant-vus",
      vus: Number(__ENV.USER_COUNT || 300),
      duration: `${soakMin}m`,
      gracefulStop: "2m",
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
  thinkTime(8, 20);
  const hb = rpc(PLAN.fnIds.getState, s.stateBody);
  const ok = check({ r, hb }, {
    "save ok": (o) => o.r.ok === true && !threw(o.r),
    "heartbeat ok": (o) => o.hb.ok === true && !threw(o.hb),
  });
  errors.add(ok ? 0 : 1);
}
