import assert from "node:assert/strict";
import * as accessModule from "./site-access";

assert.equal(typeof accessModule.checkSiteAccess, "function", "Eine richtungsbezogene Straßenprüfung ist erforderlich");
const input = { site: { lon: 10.2, lat: 52.33 }, edge: { edgeId: 1, aLon: 10.1, aLat: 52.32, bLon: 10.3, bLat: 52.32 } };
let calls: string[] = [];
const fixture = (duration: number, distance: number, count = 2, snapDistance = 5) => ({ code: "Ok", routes: [{ duration, distance }], waypoints: Array.from({ length: count }, () => ({ distance: snapDistance })) });
const fetcher: typeof fetch = async (url) => {
  calls.push(String(url));
  const via = String(url).includes("10.2,52.33");
  const reverse = String(url).includes("10.3,52.32;10.2") || String(url).includes("10.3,52.32;10.1");
  return new Response(JSON.stringify(fixture(via ? reverse ? 840 : 720 : 600, via ? 12000 : 10000, via ? 3 : 2)), { headers: { "Content-Type": "application/json" } });
};
const unavailable = await accessModule.checkSiteAccess(input, undefined, fetcher);
assert.equal(unavailable.status, "not_configured");
assert.equal(calls.length, 0, "Kein stillschweigender Demoserver");
const config = { baseUrl: "https://routing.example.org", profile: "driving" };
const result = await accessModule.checkSiteAccess(input, config, fetcher);
assert.equal(result.status, "road_proxy");
assert.equal(result.truckAccessVerified, false);
assert.equal(result.directions.length, 2);
assert.equal(result.directions[0].extraMinutes, 2);
assert.equal(result.directions[1].extraMinutes, 4);
assert.equal(result.directions[0].extraKm, 2);
assert.equal(calls.length, 4);
assert.ok(calls.every((url) => url.startsWith(config.baseUrl + "/route/v1/driving/")));
for (const invalid of [fixture(-1, 1000), fixture(1, 1000, 2, 800), { code: "NoRoute" }, fixture(1, 1000, 1)]) {
  const failed = await accessModule.checkSiteAccess(input, config, async () => new Response(JSON.stringify(invalid)));
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.directions.length, 0, "Keine Teilprüfung als Erfolg anzeigen");
  assert.equal(failed.truckAccessVerified, false);
}
assert.equal((await accessModule.checkSiteAccess(input, config, async () => { throw new Error("offline"); })).status, "unavailable");
await assert.rejects(() => accessModule.checkSiteAccess({ ...input, site: { lon: NaN, lat: 52 } }, config, fetcher));
await assert.rejects(() => accessModule.checkSiteAccess(input, { ...config, baseUrl: "https://router.project-osrm.org" }, fetcher), /Demo/);
await assert.rejects(() => accessModule.checkSiteAccess(input, { ...config, baseUrl: "https://routing.openstreetmap.de/routed-car" }, fetcher), /Demo/);
console.log("Erreichbarkeit: beide Richtungen, Umweg, Fehler und fehlende Lkw-Verifikation geprüft.");
