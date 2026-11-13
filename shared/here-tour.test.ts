import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cachedHereTourRoute, decodeFlexPolyline, hereTourRoute } from "../server/here-tour";
import handler from "../api/tour-route";

// Example from the HERE flexible polyline specification.
const POLYLINE = "BFoz5xJ67i1B1B7PzIhaxL7Y";
const places = [{ lon: 9.73, lat: 52.37 }, { lon: 10.52, lat: 52.26 }, { lon: 9.73, lat: 52.37 }];
const calls: URL[] = [];
const fetcher: typeof fetch = async (url) => {
  const u = new URL(String(url)); calls.push(u);
  return Response.json({ routes: [{ sections: [1, 2].slice(0, u.searchParams.getAll("via").length + 1).map(() => ({ polyline: POLYLINE, summary: { duration: 3600, length: 70000 } })) }] });
};

test("the flexible polyline decodes to lon/lat pairs", () => {
  assert.deepEqual(decodeFlexPolyline(POLYLINE), [[8.69821, 50.10228], [8.69567, 50.10201], [8.6915, 50.10063], [8.68752, 50.09878]]);
  assert.throws(() => decodeFlexPolyline("B!"));
});

test("one truck request per tour with stops as via points", async () => {
  const route = await hereTourRoute({ places, vehicle: "rigid" }, "fixture-secret", fetcher);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("transportMode"), "truck");
  assert.equal(calls[0].searchParams.get("origin"), "52.37,9.73");
  assert.deepEqual(calls[0].searchParams.getAll("via"), ["52.26,10.52"]);
  assert.equal(calls[0].searchParams.get("vehicle[grossWeight]"), "26000");
  assert.deepEqual(route.legs, [{ km: 70, hours: 1 }, { km: 70, hours: 1 }]);
  assert.equal(route.line.length, 7);
  assert.equal(JSON.stringify(route).includes("fixture-secret"), false);
});

test("a violated restriction or a failing provider gives no route and leaks no key", async () => {
  const violated = async () => Response.json({ routes: [{ sections: [{ polyline: POLYLINE, summary: { duration: 1, length: 1 }, notices: [{ code: "violatedVehicleRestriction", severity: "critical" }] }] }] });
  await assert.rejects(() => hereTourRoute({ places: places.slice(0, 2) }, "fixture-secret", violated));
  await assert.rejects(() => hereTourRoute({ places: places.slice(0, 2) }, "fixture-secret", async () => { throw new Error("https://x?apiKey=fixture-secret"); }), (e: Error) => !e.message.includes("fixture-secret"));
  await assert.rejects(() => hereTourRoute({ places: [{ lon: 2, lat: 48 }, places[0]] }, "fixture-secret", fetcher));
});

test("a repeated tour is served from the cache, a closed budget costs nothing", async () => {
  const before = calls.length, input = { places: places.slice(0, 2) };
  assert.ok(await cachedHereTourRoute(input, "fixture-secret", async () => true, fetcher));
  assert.ok(await cachedHereTourRoute(input, "fixture-secret", async () => false, fetcher));
  assert.equal(calls.length, before + 1);
  assert.equal(await cachedHereTourRoute({ places: [places[1], places[0]] }, "fixture-secret", async () => false, fetcher), null);
  assert.equal(calls.length, before + 1);
});

test("the endpoint stays off without its own switch", async () => {
  let status = 0, upstream = 0;
  const res = { setHeader() { return this; }, status(code: number) { status = code; return this; }, json() { return this; }, end() { return this; } } as unknown as VercelResponse;
  const call = async (body: unknown) => { await handler({ method: "POST", body, headers: { "content-type": "application/json" } } as VercelRequest, res); return status; };
  const saved = { ...process.env }, originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { upstream++; return Response.json({}); };
  try {
    Object.assign(process.env, { HERE_API_KEY: "fixture-secret", HERE_ROUTING_ENABLED: "1", UPSTASH_REDIS_REST_URL: "https://store.invalid", UPSTASH_REDIS_REST_TOKEN: "t" });
    delete process.env.HERE_TOUR_ROUTING_ENABLED;
    assert.equal(await call({ places }), 503);
    assert.equal(await call({ places: [places[0]] }), 422);
    assert.equal(upstream, 0);
  } finally { process.env = saved; globalThis.fetch = originalFetch; }
});
