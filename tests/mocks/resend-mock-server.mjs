/**
 * Local stand-in for https://api.resend.com.
 *
 * The Resend SDK (>= v6) reads RESEND_BASE_URL from the environment
 * (node_modules/resend/dist/index.mjs -> getDefaultBaseUrl()), so the app is
 * pointed here purely via .env.test — ZERO application-logic changes.
 *
 * Safety: no request ever reaches Resend, so no real student is ever emailed.
 * Every payload (recipient, name, roll no, password, exam name, exam link)
 * is recorded in RESEND_MOCK_CAPTURE as JSONL for assertions.
 *
 * Run standalone: npm run test:resend-mock
 * Options (env): RESEND_MOCK_PORT, RESEND_MOCK_CAPTURE, RESEND_MOCK_FAIL_EMAILS,
 *                RESEND_MOCK_FAIL_RATE
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { RESEND_CAPTURE_PATH } from "../lib/env.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createResendMockServer(opts = {}) {
  const state = {
    captured: [],
    seq: 0,
    failEmails: new Set(
      String(opts.failEmails ?? process.env.RESEND_MOCK_FAIL_EMAILS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
    failRate: Number(opts.failRate ?? process.env.RESEND_MOCK_FAIL_RATE ?? 0),
  };
  const capturePath =
    opts.capturePath !== undefined
      ? opts.capturePath === null
        ? null
        : path.resolve(ROOT, opts.capturePath)
      : process.env.RESEND_MOCK_CAPTURE
        ? path.resolve(ROOT, process.env.RESEND_MOCK_CAPTURE)
        : RESEND_CAPTURE_PATH;

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url, "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/_health") {
      return json(res, 200, { ok: true, captured: state.captured.length });
    }
    if (req.method === "GET" && url.pathname === "/_capture") {
      return json(res, 200, state.captured);
    }
    if (req.method === "DELETE" && url.pathname === "/_capture") {
      state.captured = [];
      return json(res, 200, { cleared: true });
    }
    if (req.method !== "POST") {
      return json(res, 405, { error: { name: "method_not_allowed", message: "POST only" } });
    }

    let payload;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = { _unparsable: raw.slice(0, 500) };
    }
    const record = { ts: new Date().toISOString(), path: url.pathname, payload };
    state.captured.push(record);
    if (capturePath) {
      fs.mkdirSync(path.dirname(capturePath), { recursive: true });
      fs.appendFileSync(capturePath, JSON.stringify(record) + "\n");
    }

    const to = String(payload?.to ?? "").toLowerCase();
    const shouldFail =
      state.failEmails.has(to) || (state.failRate > 0 && Math.random() < state.failRate);
    if (shouldFail) {
      return json(res, 422, {
        error: {
          name: "validation_error",
          message: "Mock induced failure (RESEND_MOCK_FAIL_EMAILS / RESEND_MOCK_FAIL_RATE)",
        },
      });
    }
    state.seq += 1;
    return json(res, 200, { id: `mock-${String(state.seq).padStart(6, "0")}` });
  });

  return {
    server,
    state,
    capturePath,
    listen(port = Number(process.env.RESEND_MOCK_PORT ?? 4599), host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve(server.address().port));
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    setFailEmails(list) {
      state.failEmails = new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean));
    },
  };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const mock = createResendMockServer();
  const port = await mock.listen();
  console.log(`[resend-mock] listening on http://127.0.0.1:${port}`);
  console.log(`[resend-mock] capturing payloads to ${mock.capturePath ?? "(memory only)"}`);
  console.log("[resend-mock] no request ever reaches api.resend.com — zero real emails");
}
