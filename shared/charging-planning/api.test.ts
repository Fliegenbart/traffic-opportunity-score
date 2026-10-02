import assert from "node:assert/strict";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { canonicalJson, runChargingPlan, summarizePlan } from "./index";
const handler = (await import("../../api/charging-plan").catch(() => null))?.default;
assert.ok(handler, "Der gemeinsame HTTP-Endpunkt muss vorhanden sein");

async function call(method: string, body: unknown, contentType = "application/json") {
  let code = 0, payload: any;
  const headers: Record<string, unknown> = {};
  const res = { setHeader(k: string, v: unknown) { headers[k] = v; return this; },
    status(n: number) { code = n; return this; }, json(p: unknown) { payload = p; return this; }, end() { return this; } };
  await handler!({ method, body, headers: { "content-type": contentType } } as VercelRequest, res as unknown as VercelResponse);
  return { code, payload, headers };
}
assert.equal((await call("GET", null)).code, 405);
assert.equal((await call("POST", "{" )).code, 400);
assert.equal((await call("POST", {})).code, 422);
assert.equal((await call("POST", "x".repeat(300000))).code, 413);
assert.equal((await call("POST", {}, "text/plain")).code, 415);
assert.equal((await call("POST", {}, "evilapplication/json")).code, 415);
const request = JSON.parse(await readFile("client/public/data/planning/example-request.json", "utf8"));
const expected = runChargingPlan(request);
const response = await call("POST", JSON.stringify(request), "application/json; charset=utf-8");
assert.equal(response.code, 200);
assert.equal(response.payload.status, "scenario_only");
assert.deepEqual(response.payload.scenarios, summarizePlan(expected).scenarios);
assert.equal(response.payload.fingerprint, createHash("sha256").update(canonicalJson({ modelVersion: expected.modelVersion, input: expected.input })).digest("hex"));
assert.equal((await call("POST", { ...request, capacity: { ...request.capacity, gridPowerKw: null }, site: { ...request.site, gridStatus: "unknown" } })).payload.status, "blocked");
const huge = { ...request, demand: { ...request.demand, anchors: [{ id: "large", hour: 0, count: 5000, energyKwh: 250, includedInPassing: true }] } };
assert.equal((await call("POST", huge)).code, 422);
console.log("Charging plan API: method, JSON, size, content type and schema gates passed.");
