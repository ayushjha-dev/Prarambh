/**
 * Minimal HTTP client for TanStack Start server functions (Phase 1).
 *
 * Protocol, reverse-engineered from @tanstack/start-client-core:
 *   POST {base}/_serverFn/{fnId}
 *   headers: x-tsr-serverFn: true, content-type: application/json,
 *            accept: application/json   (JSON instead of framed, for parsing)
 *   body:    seroval cross-JSON of { data }   (NOT plain JSON)
 *   response: x-tss-serialized: true + seroval cross-JSON of the return
 *             value; thrown server errors come back as serialized Error
 *             instances (HTTP 200 or 500 depending on the error path).
 *
 * fnId is deterministic:
 *   base64url(JSON.stringify({ file, export: `${name}_createServerFn_handler` }))
 *
 * Note for k6: bodies are seroval-encoded — precompute payload strings with
 * tests/load/gen-payloads.mjs instead of hand-building JSON in k6.
 */
import { toJSONAsync, fromCrossJSON } from "seroval";

export const SERVER_FN_FILES = {
  exam: "/src/lib/exam.functions.ts?tss-serverfn-split",
  admin: "/src/lib/admin.functions.ts?tss-serverfn-split",
  auth: "/src/lib/auth.functions.ts?tss-serverfn-split",
};

export function fnId(file, exportName) {
  return Buffer.from(
    JSON.stringify({ file, export: `${exportName}_createServerFn_handler` }),
    "utf8",
  ).toString("base64url");
}

/** Serialize a `data` payload exactly like the TSS client does (for k6 precompute too). */
export async function serializeFnData(data) {
  return JSON.stringify(await toJSONAsync({ data }, { plugins: [] }));
}

/**
 * Call a server function over HTTP.
 * Resolves to { status, ok, result, error, text } — `error` is a real Error
 * instance when the server function threw; `result` is the returned value.
 */
export async function callServerFn(base, options) {
  const {
    fn,
    data,
    file = SERVER_FN_FILES.exam,
    method = "POST",
    headers = {},
    signal,
    token,
  } = options;
  const url = `${String(base).replace(/\/+$/, "")}/_serverFn/${fnId(file, fn)}`;
  const origin = new URL(url).origin;
  const h = {
    "x-tsr-serverFn": "true",
    "content-type": "application/json",
    accept: "application/json",
    // TSS default CSRF middleware rejects requests without a same-origin
    // signal (Sec-Fetch-Site / Origin / Referer) with 403 "Forbidden".
    "sec-fetch-site": "same-origin",
    origin,
    ...headers,
  };
  if (token) h.authorization = `Bearer ${token}`;
  const body = data === undefined ? undefined : await serializeFnData(data);
  const res = await fetch(url, { method, headers: h, body, signal });
  const text = await res.text();
  const ct = res.headers.get("content-type") ?? "";
  let result = null;
  let error = null;
  if (res.headers.get("x-tss-serialized") && ct.includes("application/json")) {
    let de;
    try {
      de = fromCrossJSON(JSON.parse(text), { plugins: [] });
    } catch (e) {
      error = e;
      de = undefined;
    }
    if (de instanceof Error) error = de;
    else if (de && typeof de === "object" && "result" in de && Object.keys(de).length <= 2) result = de.result;
    else result = de;
  } else if (ct.includes("application/json")) {
    try {
      const j = JSON.parse(text);
      if (j && typeof j === "object" && j.error) error = new Error(String(j.error));
      else result = j;
    } catch {
      result = text;
    }
  } else {
    result = text;
  }
  return { status: res.status, ok: res.ok, result, error, text, headers: res.headers };
}
