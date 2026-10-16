/**
 * Scenario 4 — Mixed load: 300 students run full exam loops while 2
 * organizers hammer the dashboard (stats, results, student list), and ONE
 * organizer triggers a Bulk Send of 300 rows (Resend mocked) mid-run.
 *
 * Organizer RPCs carry the organizer's HMAC session token (signed with
 * SESSION_SECRET) minted in setup() via the organizerLogin server function;
 * ALL bodies are precomputed seroval (gen-payloads.mjs).
 *
 *   k6 run tests/load/scenario-mixed.js -e BASE_URL=http://localhost:5173 \
 *     -e EXAM=standard -e HOLD_MIN=30 \
 *     -e ORG_EMAIL=loadtest_organizer@loadtest.example -e ORG_PASSWORD=...
 */
import { check } from "k6";
import { Rate } from "k6/metrics";
import exec from "k6/execution";
import http from "k6/http";
import { SharedArray } from "k6/data";
import { rpc, threw, thinkTime, CSRF_HEADERS, baseUrl } from "./lib/rpc.js";

const errors = new Rate("errors");

const EXAM = __ENV.EXAM || "standard";
const holdMin = Number(__ENV.HOLD_MIN || 30);

const PLAN = new SharedArray("plan", () => JSON.parse(open(`./payloads-${EXAM}.json`)));

export const options = {
  scenarios: {
    students: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "60s", target: Number(__ENV.USER_COUNT || 300) },
        { duration: `${holdMin}m`, target: Number(__ENV.USER_COUNT || 300) },
        { duration: "2m", target: 0 },
      ],
      exec: "students",
    },
    organizers: {
      executor: "constant-vus",
      vus: 2,
      duration: `${holdMin + 3}m`,
      startTime: "65s",
      exec: "organizers",
      gracefulStop: "30s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<800"],
    errors: ["rate<0.01"],
  },
};

/**
 * The organizer HMAC session (SESSION_SECRET) is stateless and long-lived;
 * setup() logs in once via the organizerLogin server function and reuses the
 * token for the whole run (failures surface as "organizer login failed" /
 * dashboard check failures, never silent).
 */
/** Mint an organizer session token via the app's own login server function. */
export function setup() {
  const url = `${baseUrl()}/_serverFn/${PLAN.fnIds.organizerLogin}`;
  const body = String(PLAN.organizer.loginTemplate)
    .replaceAll("__ORG_EMAIL__", __ENV.ORG_EMAIL || "")
    .replaceAll("__ORG_PASSWORD__", __ENV.ORG_PASSWORD || "");
  const origin = baseUrl();
  const res = http.post(url, body, {
    headers: Object.assign({}, CSRF_HEADERS, { origin: origin }),
  });
  if (res.status !== 200) {
    throw new Error(`organizer login failed: ${res.status} ${String(res.body).slice(0, 160)}`);
  }
  const m = String(res.body).match(/"token":"([^"]+)"/);
  if (!m) {
    throw new Error(`organizer login: no token in response: ${String(res.body).slice(0, 160)}`);
  }
  return { jwt: m[1] };
}

function orgRpc(fnId, body, jwt) {
  return rpc(fnId, body, { authorization: `Bearer ${jwt}` });
}

export function students() {
  const s = PLAN.students[__VU % PLAN.students.length];
  const a = s.answers[exec.vu.iterationInInstance % s.answers.length];
  const r = rpc(PLAN.fnIds.save, a.body);
  thinkTime(5, 15);
  const hb = rpc(PLAN.fnIds.getState, s.stateBody);
  errors.add(r.ok && !threw(r) && hb.ok && !threw(hb) ? 0 : 1);
}

export function organizers(data) {
  const jwt = data.jwt;
  const A = PLAN.admin;
  const stats = orgRpc(PLAN.fnIds.adminOrganizerStats, A.organizerStatsBody, jwt);
  const list = orgRpc(PLAN.fnIds.adminListExams, A.listExamsBody, jwt);
  const dash = orgRpc(PLAN.fnIds.adminDashboard, A.adminDashboard, jwt);
  const studentsList = orgRpc(PLAN.fnIds.adminListStudents, A.adminListStudents, jwt);
  // Bulk send once per organizer VU loop; 300 rows, Resend fully mocked.
  const bulk = orgRpc(PLAN.fnIds.adminBulkSend, A.bulkBody, jwt);
  const ok = check({ stats, list, dash, studentsList, bulk }, {
    "organizer stats ok": (o) => o.stats.ok === true,
    "exam list ok": (o) => o.list.ok === true,
    "dashboard ok": (o) => o.dash.ok === true,
    "student list ok": (o) => o.studentsList.ok === true,
    "bulk send 300 accepted": (o) => o.bulk.ok === true && o.bulk.body.indexOf("300") !== -1,
  });
  errors.add(ok ? 0 : 1);
  thinkTime(20, 40);
}
