import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const path = new URL("../server/here-routing.ts", import.meta.url);
assert.ok(existsSync(path), "Ein serverseitiger HERE-Lkw-Adapter ist erforderlich");
const { checkHereSiteAccess, cachedHereSiteAccess } = await import(path.href);
const input = { site: { lon: 10.2, lat: 52.33 }, edge: { edgeId: 1, aLon: 10.1, aLat: 52.32, bLon: 10.3, bLat: 52.32 },
  vehicle: { heightM: 4, widthM: 2.55, lengthM: 16.5, weightKg: 40000, axleWeightKg: 11500 } };
const calls: URL[] = [];
const place = (coords: string) => { const [lat, lng] = coords.split(";")[0].split(",").map(Number); return { location: { lat, lng } }; };
const fetcher: typeof fetch = async (url) => {
  const u = new URL(String(url)); calls.push(u);
  const via = u.searchParams.get("via");
  const section = (a: string, b: string, duration: number, length: number) => ({ summary: { duration, length }, departure: { place: place(a) }, arrival: { place: place(b) } });
  return Response.json({ routes: [{ sections: via ? [section(u.searchParams.get("origin")!, via, 360, 6000), section(via, u.searchParams.get("destination")!, 360, 6000)] : [section(u.searchParams.get("origin")!, u.searchParams.get("destination")!, 600, 10000)] }] });
};
const result = await checkHereSiteAccess(input, "fixture-secret", fetcher);
assert.equal(result.status, "truck_route_proxy");
assert.equal(result.truckAccessVerified, false);
assert.equal(result.provider, "HERE Routing v8");
assert.equal(calls.length, 4);
assert.equal(result.directions[0].extraKm, 2);
assert.equal(result.directions[0].extraMinutes, 2);
assert.equal(calls[0].searchParams.get("transportMode"), "truck");
assert.equal(calls[0].searchParams.get("vehicle[height]"), "400");
assert.equal(calls[0].searchParams.get("vehicle[width]"), "255");
assert.equal(calls[0].searchParams.get("vehicle[currentWeight]"), "40000");
assert.equal(calls[0].searchParams.get("departureTime"), "any");
assert.equal(calls[2].searchParams.get("origin"), "52.32,10.3");
assert.equal(JSON.stringify(result).includes("fixture-secret"), false);
assert.deepEqual(result.vehicle, input.vehicle);
for (const failure of [Response.json({ routes: [] }), new Response("denied", { status: 403 }),
  Response.json({ routes: [{ sections: [{ summary: { duration: 100, length: 100 }, departure: { place: place("52.32,10.1") }, arrival: { place: place("52.32,10.3") }, notices: [{ code: "violatedVehicleRestriction", severity: "critical" }] }] }] })]) {
  const failed = await checkHereSiteAccess(input, "fixture-secret", async () => failure.clone());
  assert.equal(failed.status, "unavailable"); assert.equal(failed.directions.length, 0); assert.equal(failed.truckAccessVerified, false);
}
const snapped = await checkHereSiteAccess(input, "fixture-secret", async () => Response.json({ routes: [{ sections: [{ summary: { duration: 600, length: 10000 }, departure: { place: place("51,10") }, arrival: { place: place("52,11") } }] }] }));
assert.equal(snapped.status, "unavailable");
await assert.rejects(() => checkHereSiteAccess({ ...input, vehicle: { ...input.vehicle, heightM: 0 } }, "fixture-secret", fetcher));
assert.equal((await checkHereSiteAccess(input, "fixture-secret", async () => { throw new Error("secret in upstream error fixture-secret"); })).message.includes("fixture-secret"), false);
const discontinuous = await checkHereSiteAccess(input, "fixture-secret", async (url) => {
  const r = await fetcher(url); const body = await r.json();
  if (body.routes[0].sections.length === 2) body.routes[0].sections[1].departure.place.location.lng += 0.01;
  return Response.json(body);
});
assert.equal(discontinuous.status, "unavailable");
const beforeCache = calls.length;
const originalFetch = globalThis.fetch;
globalThis.fetch = fetcher;
try {
assert.ok(await cachedHereSiteAccess(input, "fixture-secret", "cache-fixture", fetcher));
assert.equal(calls.length, beforeCache + 4);
await cachedHereSiteAccess(input, "fixture-secret", "cache-fixture", fetcher);
assert.equal(calls.length, beforeCache + 4, "Wiederholung darf nicht erneut den Anbieter aufrufen");
for (let i = 0; i < 8; i++) assert.ok(await cachedHereSiteAccess({ ...input, edge: { ...input.edge, edgeId: 100 + i } }, "fixture-secret", "budget-fixture", fetcher));
assert.equal(await cachedHereSiteAccess({ ...input, edge: { ...input.edge, edgeId: 109 } }, "fixture-secret", "budget-fixture", fetcher), null);
for (let i = 9; i < 32; i++) assert.ok(await cachedHereSiteAccess({ ...input, edge: { ...input.edge, edgeId: 200 + i } }, "fixture-secret", `instance-fixture-${i}`, fetcher));
assert.equal(await cachedHereSiteAccess({ ...input, edge: { ...input.edge, edgeId: 999 } }, "fixture-secret", "other-caller", fetcher), null, "Instanzbudget gilt auch über mehrere Caller");
assert.ok(await cachedHereSiteAccess(input, "fixture-secret", "other-caller", fetcher), "Erfolgscache bleibt ohne neue Anbieterkosten erreichbar");
const beforeGuard = calls.length;
assert.equal(await cachedHereSiteAccess({ ...input, edge: { ...input.edge, edgeId: 5000 } }, "fixture-secret", "guard-fixture", fetcher, async () => false), null, "Globales Limit sperrt");
assert.equal(calls.length, beforeGuard, "Gesperrte Prüfung verursacht keine HERE-Kosten");
} finally { globalThis.fetch = originalFetch; }
console.log("HERE: Fahrzeugparameter, Richtungen, mehrteilige Routen, Sperrhinweise, Snapping und Geheimnisfreiheit geprüft.");
