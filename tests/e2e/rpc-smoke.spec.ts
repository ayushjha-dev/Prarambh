/**
 * RPC smoke test (Phase 1): proves the browser's own server-function calls
 * complete over HTTP. Uses a bogus exam slug — needs NO database:
 *   1. Load /exam/<bogus> (SSR page that imports exam server functions).
 *   2. Call getExamPublic({ slug }) from inside the page via the app's own
 *      wire protocol (headers verified by tests/lib/serverfn.mjs).
 *   3. Assert a *deserializable* response carrying Error "EXAM_NOT_FOUND"
 *      (proves ID registration + CSRF + seroval all work end to end).
 */
import { test, expect } from "@playwright/test";
import {
  callServerFn,
  serializeFnData,
  fnId,
  SERVER_FN_FILES,
} from "../lib/serverfn.mjs";

test("browser server-fn RPC round-trip returns EXAM_NOT_FOUND for bogus slug", async ({ page }) => {
  const slug = "does-not-exist-probe";
  await page.goto(`/exam/${slug}`);
  await expect(page.locator("body")).toBeVisible();

  const id = fnId(SERVER_FN_FILES.exam, "getExamPublic");
  const body = await serializeFnData({ slug });
  const outcome = await page.evaluate(
    async ({ id, body }) => {
      const res = await fetch(`/_serverFn/${id}`, {
        method: "POST",
        headers: {
          "x-tsr-serverFn": "true",
          "content-type": "application/json",
          accept: "application/json",
        },
        body,
      });
      return {
        status: res.status,
        contentType: res.headers.get("content-type"),
        serialized: res.headers.get("x-tss-serialized"),
        text: await res.text(),
      };
    },
    { id, body },
  );

  expect(outcome.status, `RPC status (body: ${outcome.text.slice(0, 200)})`).toBe(200);
  expect(outcome.serialized).toBe("true");
  expect(outcome.text).toContain("EXAM_NOT_FOUND");
});

test("raw (non-browser) server-fn call matches the protocol probe", async ({ request, baseURL }) => {
  const r = await callServerFn(baseURL!, { fn: "getExamPublic", data: { slug: "does-not-exist-probe" } });
  expect(r.error?.message ?? "").toContain("EXAM_NOT_FOUND");
});
