/**
 * Load profiles (Phase 5): smoke, stress, spike, soak.
 * All share the exam-session VU function via different executors/durations.
 *
 *   k6 run tests/load/profile-smoke.js            # 5 users, 1 minute
 *   k6 run tests/load/profile-load.js             # ramp to 300, hold, ramp down
 *   k6 run tests/load/profile-stress.js           # 450 then 600 — breaking point
 *   k6 run tests/load/profile-spike.js            # 0 -> 300 in 10 seconds
 *   k6 run tests/load/profile-soak.js             # 300 users, 60+ minutes
 *
 * BASE_URL / EXAM env same as scenario-exam-session.js.
 */