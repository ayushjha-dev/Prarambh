// Minimal .env loader for plain `node` scripts (npm scripts don't get vite's
// env handling). Real process.env values always win over the file.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadEnv() {
  const envFile = path.join(process.cwd(), ".env");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
