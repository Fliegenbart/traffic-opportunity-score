import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bastDataSchema } from "./charging-planning/data";
import { networkSchema } from "./charging-planning/traffic";
import { buildSiteRequest, DEFAULT_SITE_INPUT } from "./charging-planning/site-input";
import * as trafficModule from "./site-traffic";

assert.equal(typeof trafficModule.resolveSiteTraffic, "function", "Eine gemeinsame Standort-Verkehrsauflösung ist erforderlich");
const data = {
  network: networkSchema.parse(JSON.parse(readFileSync("client/public/data/planning/network-de.json", "utf8"))),
  bast: bastDataSchema.parse(JSON.parse(readFileSync("client/public/data/planning/bast-hourly-de.json", "utf8"))),
};
const hotspots = JSON.parse(readFileSync("client/public/data/traffic-opportunity-de.json", "utf8")).edgeHotspots as { edgeId: number }[];
const nonHotspot = data.network.edges.find((e) => !hotspots.some((h) => h.edgeId === e.edgeId))!;
const site = { id: "site", label: "Standort", lon: nonHotspot.aLon, lat: nonHotspot.aLat };
const noChoice = trafficModule.resolveSiteTraffic(site, data);
assert.equal(noChoice.traffic, null, "Keine stillschweigende Verkehrsannahme");
assert.ok(noChoice.edge, "Auch Strecken außerhalb der 60 Hotspots berücksichtigen");
const model = trafficModule.resolveSiteTraffic(site, data, { basis: "model" });
const request = buildSiteRequest(site, data, DEFAULT_SITE_INPUT, { basis: "model" }).request!;
assert.ok(model.traffic);
assert.deepEqual(model.traffic, request.traffic, "Screening und Simulation müssen exakt dieselbe Menge und Quelle verwenden");
assert.equal(model.traffic.source.sha256, data.network.source.sha256);
assert.equal(model.traffic.trucksPerDay, model.edge!.edge.trucks2030 / 365);
assert.equal(model.traffic.referenceYear, 2030);
const station = data.bast.stations.find((s) => s.stationId === "5087")!;
const stationSite = { ...site, ...station.location };
const measured = trafficModule.resolveSiteTraffic(stationSite, data, { basis: "station", stationId: station.stationId });
assert.deepEqual(measured.traffic, buildSiteRequest(stationSite, data, DEFAULT_SITE_INPUT, { basis: "station", stationId: station.stationId }).request!.traffic);
assert.equal(measured.traffic!.referenceYear, 2026);
assert.equal(measured.profiles!.weekday.matchStatus, "candidate");
assert.equal(trafficModule.resolveSiteTraffic(site, data, { basis: "station", stationId: "missing" }).traffic, null);
const far = trafficModule.resolveSiteTraffic({ ...site, lon: 15.9, lat: 55.9 }, data, { basis: "model" });
assert.equal(far.traffic, null, "Außerhalb von 10 km kein erfundener Modellverkehr");
const evidence = trafficModule.siteTrafficEvidence(measured);
assert.equal(evidence.demand, "not_validated");
assert.equal(evidence.siteMatch, "unreviewed");
assert.equal(evidence.investmentReady, false);
assert.equal(evidence.traffic, "measured");
assert.equal(trafficModule.siteTrafficEvidence(noChoice).traffic, "unknown");
assert.equal(typeof trafficModule.validateHotspotConsistency, "function");
trafficModule.validateHotspotConsistency(JSON.parse(readFileSync("client/public/data/traffic-opportunity-de.json", "utf8")).edgeHotspots, data.network);
assert.throws(() => trafficModule.validateHotspotConsistency([{ ...data.network.edges[0], trucks2030: data.network.edges[0].trucks2030 + 1 }], data.network), /widerspricht/);
console.log("Standort-Verkehr: vollständiges Netz, gemeinsame Quelle und unabhängige Evidenz geprüft.");
