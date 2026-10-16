/**
 * k6 shared library: RPC calls + seroval-aware assertions (Phase 5).
 * NOTE: bodies are precomputed by tests/load/gen-payloads.mjs — k6 never
 * builds seroval itself. It reads responses with light string checks:
 *   200 + x-tss-serialized  => routed & returned a value
 *   403 + "Forbidden"       => CSRF block (missing same-origin signal)
 *   500 + vite error page   => unknown fn id / routing failure
 * Thrown server errors (Zod / EXAM_NOT_FOUND / Unauthorized) arrive as
 * serialized Error payloads: detect via the embedded message string.
 */
import http from "k6/http";
import { sleep } from "k6";

export const CSRF_HEADERS = {
  "x-tsr-serverFn": "true",
  "content-type": "application/json",
  accept: "application/json",
  "sec-fetch-site": "same-origin",
};

export function baseUrl() {
  return __ENV.BASE_URL || "http://localhost:5173";
}

export function originOf(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

/** POST one server function; returns { status, body, serialized, ok }. */
export function rpc(fnId, body, extraHeaders) {
  const url = `${baseUrl()}/_serverFn/${fnId}`;
  const headers = Object.assign({}, CSRF_HEADERS, { origin: originOf(url) }, extraHeaders || {});
  const res = http.post(url, body, { headers, tags: { fn: fnId.slice(0, 12) } });
  return {
    status: res.status,
    body: res.body || "",
    serialized: res.headers["X-Tss-Serialized"] === "true",
    ok: res.status === 200 && res.headers["X-Tss-Serialized"] === "true",
  };
}

/** True when the response is a thrown server Error containing `message`. */
export function threw(r, message) {
  return r.status === 200 && r.serialized && (message ? r.body.indexOf(message) !== -1 : true);
}

/** True when the response is a returned value (not a thrown Error). */
export function returned(r) {
  return r.ok && r.body.indexOf('"@name":"Error"') === -1 && r.body.indexOf("\\u0000Error") === -1;
}

/** Random sleep between min and max seconds (exam think time). */
export function thinkTime(minSec, maxSec) {
  sleep(minSec + Math.random() * (maxSec - minSec));
}
