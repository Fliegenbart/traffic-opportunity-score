import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSiteRequest, DEFAULT_SITE_INPUT, siteInputSchema, uniformSource } from "./site-input";
import { bastDataSchema, networkSchema, runChargingPlan, canonicalJson } from "./index";
import { createHash } from "node:crypto";

const data = {
  network: networkSchema.parse(JSON.parse(readFileSync("client/public/data/planning/network-de.json", "utf8"))),
  bast: bastDataSchema.parse(JSON.parse(readFileSync("client/public/data/planning/bast-hourly-de.json", "utf8"))),
};
const station = data.bast.stations.find((s) => s.stationId === "5087")!;
const site = { id: "test", label: "Köln", ...station.location };
assert.equal(buildSiteRequest(site, data, DEFAULT_SITE_INPUT, undefined).request, null, "Keine stillschweigende Profilannahme");
const measured = buildSiteRequest(site, data, DEFAULT_SITE_INPUT, { basis: "station", stationId: station.stationId });
assert.ok(measured.request);
assert.equal(measured.request.traffic.source.kind, "measured");
assert.equal(measured.request.profiles.weekday.matchStatus, "candidate");
assert.equal(measured.request.demand.captureShare, 0.02);
assert.equal(measured.request.scenarios[1].years[3].evShare, 0.08);
assert.equal(measured.request.scenarios[1].years.at(-1)!.year, 2036);
assert.equal(measured.request.capacity.gridPowerKw, 1000);
assert.equal(buildSiteRequest({ ...site, lon: 13, lat: 52 }, data, DEFAULT_SITE_INPUT, { basis: "station", stationId: station.stationId }).request, null, "Ferne Station darf nicht übertragen werden");
const uniform = buildSiteRequest(site, data, DEFAULT_SITE_INPUT, { basis: "model" });
assert.ok(uniform.request);
assert.equal(uniform.request.traffic.source.kind, "synthetic");
assert.equal(uniform.request.profiles.weekday.source.kind, "assumption");
assert.equal(uniformSource.sha256, createHash("sha256").update(canonicalJson(Array(24).fill(1))).digest("hex"));
assert.equal(runChargingPlan(buildSiteRequest(site, data, { ...DEFAULT_SITE_INPUT, gridKnown: false }, { basis: "station", stationId: station.stationId }).request!).status, "blocked");
assert.equal(runChargingPlan(buildSiteRequest(site, data, { ...DEFAULT_SITE_INPUT, access: "inaccessible" }, { basis: "station", stationId: station.stationId }).request!).status, "blocked");
assert.equal(siteInputSchema.safeParse({ ...DEFAULT_SITE_INPUT, turnaroundMinutes: 3 }).success, false);
assert.equal(siteInputSchema.safeParse({ ...DEFAULT_SITE_INPUT, anchorCount: 0.5 }).success, false);
assert.equal(siteInputSchema.safeParse({ ...DEFAULT_SITE_INPUT, startHour: 23, hoursOpen: 2 }).success, false);
const anchored = buildSiteRequest(site, data, { ...DEFAULT_SITE_INPUT, anchorCount: 3, anchorIncluded: true }, { basis: "station", stationId: station.stationId }).request!;
assert.equal(anchored.demand.anchors[0].includedInPassing, true);
assert.deepEqual(anchored.demand.anchors[0].activeOn, ["weekday"]);
console.log("Frontend-Planungsvertrag: Quellenwahl, Einheiten, Hochlauf, Sperren und Validierung geprüft.");
