import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSiteRequest, DEFAULT_SITE_INPUT, siteInputSchema, uniformSource } from "./site-input";
import { bastDataSchema, networkSchema, runChargingPlan, canonicalJson } from "./index";
import { compareSitePlans } from "./sensitivity";
import { stationRoadWarning } from "../site-traffic";
import { createHash } from "node:crypto";

const data = {
  network: networkSchema.parse(JSON.parse(readFileSync("client/public/data/planning/network-de.json", "utf8"))),
  bast: bastDataSchema.parse(JSON.parse(readFileSync("client/public/data/planning/bast-hourly-de.json", "utf8"))),
};
const station = data.bast.stations.find((s) => s.stationId === "5087")!;
const site = { id: "test", label: "Köln", ...station.location };
assert.equal(buildSiteRequest(site, data, DEFAULT_SITE_INPUT, undefined).request, null, "Keine stillschweigende Profilannahme");
const measured = buildSiteRequest(site, data, DEFAULT_SITE_INPUT, { basis: "station", stationId: station.stationId, direction: "both" });
assert.ok(measured.request);
assert.equal(measured.request.traffic.source.kind, "measured");
assert.equal(measured.request.profiles.weekday.matchStatus, "candidate");
assert.equal(measured.request.demand.captureShare, 0.02);
assert.equal(measured.request.scenarios[1].years[3].evShare, 0.08);
assert.equal(measured.request.scenarios[1].years.at(-1)!.year, 2036);
assert.equal(measured.request.capacity.gridPowerKw, 1000);
assert.equal(buildSiteRequest({ ...site, lon: 13, lat: 52 }, data, DEFAULT_SITE_INPUT, { basis: "station", stationId: station.stationId, direction: "both" }).request, null, "Ferne Station darf nicht übertragen werden");
const uniform = buildSiteRequest(site, data, DEFAULT_SITE_INPUT, { basis: "model", direction: "both" });
assert.ok(uniform.request);
assert.equal(uniform.request.traffic.source.kind, "synthetic");
// Model traffic uses the mean BASt truck profile (peaks, weekend drop) instead of a flat profile.
const w = uniform.request.profiles.weekday.weights, sun = uniform.request.profiles.sunday.weights;
assert.equal(uniform.request.profiles.weekday.matchStatus, "assumed");
assert.ok(Math.max(...w) > 1.5 * Math.min(...w), "Mittleres Profil muss Tagesspitzen zeigen");
assert.ok(sun.reduce((a, b) => a + b, 0) < w.reduce((a, b) => a + b, 0), "Sonntag muss schwächer sein als Werktag");
// Model years 2027–2029 are interpolated between 2019 and 2030, from 2030 constant.
const edge = data.network.edges.find((e) => e.trucks2019 > 0 && e.trucks2030 > e.trucks2019 * 1.1)!;
const onEdge = buildSiteRequest({ id: "edge", label: "Abschnitt", lon: (edge.aLon + edge.bLon) / 2, lat: (edge.aLat + edge.bLat) / 2 }, data, DEFAULT_SITE_INPUT, { basis: "model", direction: "both" });
assert.equal(onEdge.edge!.edge.edgeId, edge.edgeId);
const multipliers = onEdge.request!.scenarios[0].years.map((y) => y.trafficMultiplier);
assert.ok(Math.abs(multipliers[0] - (edge.trucks2019 + (edge.trucks2030 - edge.trucks2019) * 8 / 11) / edge.trucks2030) < 1e-12);
assert.deepEqual(multipliers.slice(3), Array(7).fill(1));
assert.equal(measured.request.scenarios[0].years[0].trafficMultiplier, 1, "Gemessener Verkehr bleibt unverändert");
// Direction has no default: without it there is no request.
const noDirection = buildSiteRequest(site, data, DEFAULT_SITE_INPUT, { basis: "station", stationId: station.stationId });
assert.equal(noDirection.request, null, "Ohne Fahrtrichtung keine Rechnung");
assert.match(noDirection.reason!, /Fahrtrichtung/);
const edgeSite = { id: "edge", label: "Abschnitt", lon: (edge.aLon + edge.bLon) / 2, lat: (edge.aLat + edge.bLat) / 2 };
const half = buildSiteRequest(edgeSite, data, DEFAULT_SITE_INPUT, { basis: "model", direction: "one_unknown" }).request!;
const halfPlan = runChargingPlan(half), bothPlan = runChargingPlan(onEdge.request!);
assert.ok(bothPlan.scenarios[1].years[5].offeredSessions > 10, "Testabschnitt braucht nennenswerte Nachfrage");
assert.ok(halfPlan.evidence.gaps.includes("direction_share_assumed_half"));
assert.ok(halfPlan.scenarios[1].years[5].offeredSessions < 0.6 * bothPlan.scenarios[1].years[5].offeredSessions, "Eine Richtung halbiert etwa die Nachfrage");
assert.equal(siteInputSchema.safeParse({ ...DEFAULT_SITE_INPUT, directions: "both" }).success, true, "Alte gespeicherte Annahmen bleiben lesbar");
assert.equal(uniformSource.sha256, createHash("sha256").update(canonicalJson(Array(24).fill(1))).digest("hex"));
assert.equal(runChargingPlan(buildSiteRequest(site, data, { ...DEFAULT_SITE_INPUT, gridKnown: false }, { basis: "station", stationId: station.stationId, direction: "both" }).request!).status, "blocked");
assert.equal(runChargingPlan(buildSiteRequest(site, data, { ...DEFAULT_SITE_INPUT, access: "inaccessible" }, { basis: "station", stationId: station.stationId, direction: "both" }).request!).status, "blocked");
assert.equal(siteInputSchema.safeParse({ ...DEFAULT_SITE_INPUT, turnaroundMinutes: 3 }).success, false);
assert.equal(siteInputSchema.safeParse({ ...DEFAULT_SITE_INPUT, anchorCount: 0.5 }).success, false);
assert.equal(siteInputSchema.safeParse({ ...DEFAULT_SITE_INPUT, startHour: 23, hoursOpen: 2 }).success, false);
const anchored = buildSiteRequest(site, data, { ...DEFAULT_SITE_INPUT, anchorCount: 3, anchorIncluded: true }, { basis: "station", stationId: station.stationId, direction: "both" }).request!;
assert.equal(anchored.demand.anchors[0].includedInPassing, true);
assert.deepEqual(anchored.demand.anchors[0].activeOn, ["weekday"]);
// Empty model edges (no trucks in 2019/2030) must never be matched.
const empty = data.network.edges.find((e) => e.trucks2030 <= 0)!;
const atEmpty = buildSiteRequest({ id: "empty", label: "Leer", lon: (empty.aLon + empty.bLon) / 2, lat: (empty.aLat + empty.bLat) / 2 }, data, DEFAULT_SITE_INPUT, { basis: "model", direction: "both" });
assert.ok(!atEmpty.edge || atEmpty.edge.edge.trucks2030 > 0, "Leerer Modellabschnitt darf nicht zugeordnet werden");
assert.ok(!atEmpty.request || atEmpty.request.traffic.trucksPerDay > 0);
assert.ok(uniform.edge!.edge.trucks2030 > 0, "Köln bekommt einen Abschnitt mit Verkehr statt eines leeren");
// Mixed traffic sources must not be ranked against each other.
assert.throws(() => compareSitePlans([measured.request, { ...uniform.request, site: { ...uniform.request.site, id: "other" } }]), /dieselbe Art von Verkehrsdaten/);
// Road plausibility: a station on another motorway than the one named in the site label is flagged.
const ctx = { candidates: [{ station: { ...station, roadClass: "A", road: "2" }, distanceKm: 2, matchVerified: false as const }] };
assert.match(stationRoadWarning("Kreuz Hannover-Ost, A 7", ctx, station.stationId)!, /A2/);
assert.equal(stationRoadWarning("Raststätte, A 2", ctx, station.stationId), null);
console.log("Frontend-Planungsvertrag: Quellenwahl, Einheiten, Hochlauf, Sperren und Validierung geprüft.");
