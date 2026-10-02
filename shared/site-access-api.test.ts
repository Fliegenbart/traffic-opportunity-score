import assert from "node:assert/strict";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "../api/site-access";
import { siteAccessResultSchema } from "./site-access";
import { createServer } from "node:http";

let status = 0;
let payload: unknown;
const headers: Record<string, string | number | readonly string[]> = {};
const response = { setHeader(key: string, value: string | number | readonly string[]) { headers[key] = value; return this; },
  status(code: number) { status = code; return this; }, json(body: unknown) { payload = body; return this; }, end() { return this; } } as unknown as VercelResponse;
const call = async (method: string, body?: unknown, contentType = "application/json") => {
  await handler({ method, body, headers: { "content-type": contentType } } as VercelRequest, response);
  return status;
};
assert.equal(await call("GET"), 405);
assert.equal(await call("OPTIONS"), 204);
assert.equal(await call("POST", {}, "text/plain"), 415);
assert.equal(await call("POST", "{"), 400);
assert.equal(await call("POST", { site: { lon: 1, lat: 2 } }), 422);
assert.equal(await call("POST", "x".repeat(4097)), 413);
const saved = process.env.SITE_ROUTING_BASE_URL;
try {
  delete process.env.SITE_ROUTING_BASE_URL;
  assert.equal(await call("POST", { site: { lon: 10.2, lat: 52.33 }, edge: { edgeId: 1, aLon: 10.1, aLat: 52.32, bLon: 10.3, bLat: 52.32 } }), 200);
  assert.equal(siteAccessResultSchema.parse(payload).status, "not_configured");
  assert.equal(headers["Cache-Control"], "no-store");
  process.env.SITE_ROUTING_BASE_URL = "https://router.project-osrm.org";
  assert.equal(await call("POST", { site: { lon: 10.2, lat: 52.33 }, edge: { edgeId: 1, aLon: 10.1, aLat: 52.32, bLon: 10.3, bLat: 52.32 } }), 503);
} finally { if (saved === undefined) delete process.env.SITE_ROUTING_BASE_URL; else process.env.SITE_ROUTING_BASE_URL = saved; }
let routeCalls = 0;
const fixtureServer = createServer((req, res) => {
  routeCalls++;
  const via = req.url!.includes("10.2,52.33");
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ code: "Ok", routes: [{ duration: via ? 720 : 600, distance: via ? 12000 : 10000 }],
    waypoints: Array.from({ length: via ? 3 : 2 }, () => ({ distance: 5 })) }));
});
const savedProfile = process.env.SITE_ROUTING_PROFILE;
try {
  await new Promise<void>((resolve, reject) => { fixtureServer.once("error", reject); fixtureServer.listen(0, "127.0.0.1", resolve); });
  process.env.SITE_ROUTING_BASE_URL = `http://127.0.0.1:${(fixtureServer.address() as { port: number }).port}`;
  process.env.SITE_ROUTING_PROFILE = "driving";
  assert.equal(await call("POST", { site: { lon: 10.2, lat: 52.33 }, edge: { edgeId: 1, aLon: 10.1, aLat: 52.32, bLon: 10.3, bLat: 52.32 } }), 200);
  const result = siteAccessResultSchema.parse(payload);
  assert.equal(result.status, "road_proxy");
  assert.equal(routeCalls, 4);
  assert.equal(result.directions[0].extraKm, 2);
  assert.equal(result.truckAccessVerified, false);
} finally {
  if (saved === undefined) delete process.env.SITE_ROUTING_BASE_URL; else process.env.SITE_ROUTING_BASE_URL = saved;
  if (savedProfile === undefined) delete process.env.SITE_ROUTING_PROFILE; else process.env.SITE_ROUTING_PROFILE = savedProfile;
  fixtureServer.closeAllConnections();
  await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
}
console.log("Straßenprüfungs-API: HTTP-Grenzen, Konfiguration, Demo-Ausschluss und realer HTTP-Transport mit lokaler Testfixture geprüft; keine reale Standortvalidierung.");
