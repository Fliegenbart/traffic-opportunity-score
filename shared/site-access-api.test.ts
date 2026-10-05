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
const savedHere = process.env.HERE_API_KEY;
const savedHereEnabled = process.env.HERE_ROUTING_ENABLED;
delete process.env.HERE_ROUTING_ENABLED;
try {
  process.env.HERE_API_KEY = "fixture-not-enabled";
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
const originalFetch = globalThis.fetch;
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
  let hereCalls = 0, storeCalls = 0;
  const counters = new Map<string, number>();
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(process.env.SITE_ROUTING_BASE_URL!)) return originalFetch(url, init);
    if (String(url).endsWith("/pipeline")) {
      storeCalls++;
      const [[, key]] = JSON.parse(String(init!.body)) as [string, string][];
      counters.set(key, (counters.get(key) || 0) + 1);
      return Response.json([{ result: counters.get(key) }, { result: 1 }]);
    }
    hereCalls++;
    const params = new URL(String(url)).searchParams;
    const points = [params.get("origin")!, ...(params.has("via") ? [params.get("via")!] : []), params.get("destination")!];
    const place = (coords: string) => { const [lat, lng] = coords.split(",").map(Number); return { location: { lat, lng } }; };
    return Response.json({ routes: [{ sections: points.slice(1).map((p, i) => ({ summary: { duration: 300, length: 5000 },
      departure: { place: place(points[i]) }, arrival: { place: place(p) } })) }] });
  };
  process.env.HERE_ROUTING_ENABLED = "1";
  // Without a shared counter there is no global cost cap, so HERE must not be called.
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.KV_REST_API_URL;
  assert.equal(await call("POST", { site: { lon: 10.2, lat: 52.33 }, edge: { edgeId: 1, aLon: 10.1, aLat: 52.32, bLon: 10.3, bLat: 52.32 } }), 200);
  assert.equal(siteAccessResultSchema.parse(payload).status, "road_proxy");
  assert.equal(hereCalls, 0, "HERE ohne globalen Zähler gesperrt");
  process.env.UPSTASH_REDIS_REST_URL = "https://store.fixture"; process.env.UPSTASH_REDIS_REST_TOKEN = "fixture-token";
  assert.equal(await call("POST", { site: { lon: 10.2, lat: 52.33 }, edge: { edgeId: 1, aLon: 10.1, aLat: 52.32, bLon: 10.3, bLat: 52.32 } }), 200);
  assert.equal(siteAccessResultSchema.parse(payload).status, "truck_route_proxy");
  assert.equal(hereCalls, 4);
  assert.equal(storeCalls, 2, "IP- und Tageszähler werden geprüft");
  // Global daily cap reached (e.g. by other instances): no further paid calls.
  counters.set(`tos:here:day:${new Date().toISOString().slice(0, 10)}`, 10000);
  assert.equal(await call("POST", { site: { lon: 10.21, lat: 52.33 }, edge: { edgeId: 2, aLon: 10.1, aLat: 52.32, bLon: 10.3, bLat: 52.32 } }), 429);
  assert.equal(hereCalls, 4, "Globales Tageslimit verhindert weitere HERE-Aufrufe");
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
  assert.equal(JSON.stringify(payload).includes("fixture-not-enabled"), false);
} finally {
  globalThis.fetch = originalFetch;
  if (saved === undefined) delete process.env.SITE_ROUTING_BASE_URL; else process.env.SITE_ROUTING_BASE_URL = saved;
  if (savedProfile === undefined) delete process.env.SITE_ROUTING_PROFILE; else process.env.SITE_ROUTING_PROFILE = savedProfile;
  fixtureServer.closeAllConnections();
  await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
  if (savedHere === undefined) delete process.env.HERE_API_KEY; else process.env.HERE_API_KEY = savedHere;
  if (savedHereEnabled === undefined) delete process.env.HERE_ROUTING_ENABLED; else process.env.HERE_ROUTING_ENABLED = savedHereEnabled;
}
console.log("Straßenprüfungs-API: HTTP-Grenzen, Konfiguration, Demo-Ausschluss und realer HTTP-Transport mit lokaler Testfixture geprüft; keine reale Standortvalidierung.");
