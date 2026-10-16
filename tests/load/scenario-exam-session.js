/**
 * Scenario 2 — Full exam session (the main test): 300 concurrent students do
 * login -> fetch exam -> start -> answer questions with 5-30s randomized
 * think time -> timer/state syncs -> final submit. Holds 300 VUs for the full
 * exam duration (default 30m), not a short burst.
 *
 *   k6 run tests/load/scenario-exam-session.js -e BASE_URL=... -e EXAM=standard -e HOLD=30m
 *
 * Every submit is verified post-run by DB count (results == participants),
 * proving zero lost answers/submissions.
 */
import { check } from "k6";
import { Trend, Rate } from "k6/metrics";
import { SharedArray } from "k6/data";
import { rpc, threw, thinkTime } from "./lib/rpc.js";

const answerDuration = new Trend("answer_duration", true);
const submitDuration = new Trend("submit_duration", true);
const errors = new Rate("errors");

const EXAM = __ENV.EXAM || "standard";
const PLAN = new SharedArray("plan", () =>
  JSON.parse(open(`./payloads-${EXAM}.json`)),
);
const HOLD = __ENV.HOLD || "30m";

export const options = {
  scenarios: {
    exam_session: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "60s", target: Number(__ENV.USER_COUNT || 300) },
        { duration: HOLD, target: Number(__ENV.USER_COUNT || 300) },
        { duration: "2m", target: 0 },
      ],
      gracefulStop: "2m",
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<800", "p(99)<2000"],
    errors: ["rate<0.01"],
  },
};

// One full exam per VU iteration; k6 repeats iterations until the hold ends.
export default function () {
  const s = PLAN.students[__VU % PLAN.students.length];
  const fails = [];

  const login = rpc(PLAN.fnIds.login, s.loginBody);
  if (!login.ok || threw(login)) fails.push("login");

  const start = rpc(PLAN.fnIds.start, s.startBody);
  if (!start.ok || threw(start)) fails.push("start");

  const state0 = rpc(PLAN.fnIds.getState, s.stateBody);
  if (!state0.ok || threw(state0)) fails.push("state");

  for (const a of s.answers) {
    // Realistic think time: negative marking makes students pause (5-30s).
    thinkTime(5, 30);
    const t0 = Date.now();
    const r = rpc(PLAN.fnIds.save, a.body);
    answerDuration.add(Date.now() - t0);
    const ok = check(r, { "answer accepted": (x) => x.ok === true && !threw(x) });
    if (!ok) fails.push(`save(q${a.q})`);
    // Timer heartbeat: periodic state sync like the client (every ~25s).
    if (a.q % 5 === 0) {
      const hb = rpc(PLAN.fnIds.getState, s.stateBody);
      if (!hb.ok || threw(hb)) fails.push("heartbeat");
    }
  }

  thinkTime(2, 8);
  const t1 = Date.now();
  const sub = rpc(PLAN.fnIds.submit, s.submitBody);
  submitDuration.add(Date.now() - t1);
  if (!sub.ok || threw(sub)) fails.push("submit");

  check({ fails }, { "no step failed": (o) => o.fails.length === 0 });
  errors.add(fails.length > 0 ? 1 : 0);
}
