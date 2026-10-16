#!/usr/bin/env node
/**
 * Dev-server bootstrap used by tests/start-dev.mjs.
 *
 * Loads the PROJECT's vite.config.ts through vite's own config loader, then
 * re-points `envDir` at tests/env/ so the browser bundle only ever sees the
 * staging VITE_* values that start-dev.mjs generates there — the root .env
 * (production) is never read for client env.
 *
 * The mode stays "development": the TanStack Start / lovable stack only
 * serves SSR routes in that mode (verified: `vite dev --mode test` returns
 * 404 for every route while static files still serve).
 *
 * Usage: node tests/vite-dev-wrapper.mjs --port 5173 --strictPort
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, loadConfigFromFile, mergeConfig } from "vite";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const CONFIG_FILE = path.join(ROOT, "vite.config.ts");
const ENV_DIR = path.join(ROOT, "tests", "env");

const argv = process.argv.slice(2);
const portIdx = argv.indexOf("--port");
const serverOverride = {};
if (portIdx >= 0 && argv[portIdx + 1]) serverOverride.port = Number(argv[portIdx + 1]);
if (argv.includes("--strictPort")) serverOverride.strictPort = true;

const loaded = await loadConfigFromFile(
  { command: "serve", mode: "development" },
  CONFIG_FILE,
  ROOT,
);
if (!loaded?.config) {
  console.error("[vite-wrapper] could not load vite.config.ts");
  process.exit(1);
}
let base = loaded.config;
if (typeof base === "function") base = await base({ command: "serve", mode: "development" });

const config = mergeConfig(base, {
  root: ROOT,
  envDir: ENV_DIR,
  // Dev-only workaround: the TSS start-compiler cannot analyze vite's
  // prebundled deps (fails with "could not load module info for
  // .vite/deps/zod.js?..."), which blocks server-fn registration so every
  // RPC 500s with "Invalid server function ID". Serving zod raw lets the
  // compiler resolve the real file. The app's own vite.config.ts is untouched.
  optimizeDeps: { exclude: ["zod"] },
  ...(Object.keys(serverOverride).length ? { server: serverOverride } : {}),
});

const server = await createServer(config);
await server.listen();
server.printUrls();

async function shutdown() {
  try {
    await server.close();
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
