import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
mkdirSync(join(root, "output"), { recursive: true });
const directory = mkdtempSync(join(root, "output", "planning-runtime-"));
try {
  const compile = spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"),
    "--outDir", directory, "--rootDir", root, "--module", "ESNext", "--moduleResolution", "Bundler",
    "--target", "ES2022", "--types", "node", "--strict", "--skipLibCheck", "api/charging-plan.ts"],
  { cwd: root, encoding: "utf8" });
  assert.equal(compile.status, 0, compile.stdout + compile.stderr);
  // Native ESM, deliberately without tsx or bundler module-resolution shortcuts.
  const { default: handler } = await import(pathToFileURL(join(directory, "api/charging-plan.js")).href);
  const request = JSON.parse(readFileSync(join(root, "client/public/data/planning/example-request.json"), "utf8"));
  let status, payload;
  const response = { setHeader() { return this; }, status(code) { status = code; return this; },
    json(body) { payload = body; return this; }, end() { return this; } };
  await handler({ method: "POST", body: JSON.stringify(request), headers: { "content-type": "application/json" } }, response);
  assert.equal(status, 200);
  assert.equal(payload.status, "scenario_only");
  assert.equal(payload.scenarios.length, 3);
  assert.equal(payload.scenarios[0].years.length, 10);
  assert.match(payload.fingerprint, /^[a-f0-9]{64}$/);
  await handler({ method: "GET", headers: {} }, response);
  assert.equal(status, 405);
  console.log("Compiled native ESM runtime: API imports, 10-year calculation and HTTP gates passed.");
} finally { rmSync(directory, { recursive: true, force: true }); }
