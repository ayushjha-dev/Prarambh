// Keep-alive ping for the Supabase project (free tier pauses after ~7 days
// of inactivity). Runs a trivial read against the REST API so the database
// counts as "active". Only reads; no writes, no data mutated.
//
// Required env:
//   SUPABASE_URL              https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY server-only key (kept as a GitHub secret)
//
// Run manually:  node scripts/keep-db-awake.mjs

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var.");
  process.exit(1);
}

const started = Date.now();

async function ping(pathname) {
  const res = await fetch(`${url.replace(/\/$/, "")}${pathname}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  return res.status;
}

try {
  // 1) REST query (touches PostgREST + Postgres, resets the inactivity timer)
  const restStatus = await ping("/rest/v1/exams?select=id&limit=1");
  // 2) Auth service health (cheap, catches config drift too)
  const authStatus = await ping("/auth/v1/health");

  console.log(`REST status: ${restStatus}, Auth status: ${authStatus} in ${Date.now() - started}ms`);

  // Any HTTP answer from Supabase proves the project is awake. A 4xx on the
  // REST call (e.g. table renamed) still reached the API gateway — but fail
  // loudly on network errors / 5xx so the workflow shows red.
  if (restStatus >= 500 || authStatus >= 500) {
    console.error("Supabase returned a 5xx — project may be down or still paused.");
    process.exit(1);
  }
  console.log("Database is awake. ✔");
} catch (err) {
  console.error("Ping failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
