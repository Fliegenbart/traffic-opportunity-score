import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engine = await import("./index").catch(() => null);
assert.ok(engine, "Die freigegebene Planungsengine muss vorhanden sein");
const { generateArrivals, simulateDay, calculateCashflows, runChargingPlan, matchTrafficEdge, exportPlanCsv } = engine;

const source = {
  id: "fixture", title: "Testquelle", url: "https://example.org/data", kind: "synthetic" as const,
  version: "1", retrievedAt: "2026-10-02T00:00:00Z", observedThrough: "2023-12-31",
  sha256: "a".repeat(64), license: "CC-BY-4.0", commercialUse: "allowed" as const,
};
const capacity = { ports: 2, portPowerKw: 100, gridPowerKw: 100, lossPercent: 0,
  turnaroundMinutes: 0, maxWaitMinutes: 120, opening: [{ startMinute: 0, endMinute: 1440 }] };
const traffic = { trucksPerDay: 1000, source, vehicleClass: "truck" as const, referenceYear: 2030 };
const profile = { source: { ...source, kind: "measured" as const }, weights: Array(24).fill(1), vehicleClass: "truck" as const, matchStatus: "candidate" as const };
const demand = { reachableShare: 0.5, captureShare: 0.1, energyKwh: 100, seed: 42, anchors: [] };

const arrivals = generateArrivals(traffic.trucksPerDay, 0.1, profile.weights, demand);
assert.equal(arrivals.sessions.length, 5);
assert.deepEqual(arrivals, generateArrivals(1000, 0.1, profile.weights, demand));
assert.notDeepEqual(arrivals.sessions, generateArrivals(1000, 0.1, profile.weights, { ...demand, seed: 43 }).sessions);
assert.equal(generateArrivals(1, 0.1, profile.weights, { ...demand, reachableShare: 1, captureShare: 1 }).sessions.length, 0);
const anchored = generateArrivals(1000, 0.1, profile.weights, { ...demand, anchors: [
  { id: "a", hour: 12, count: 2, energyKwh: 100, includedInPassing: true },
] });
assert.equal(anchored.sessions.length, 5, "Ankerkunden nicht doppelt zählen");
assert.equal(anchored.anchorSessions, 2);
const additional = generateArrivals(1000, 0.1, profile.weights, { ...demand, anchors: [
  { id: "a", hour: 12, count: 2, energyKwh: 100, includedInPassing: false },
] });
assert.equal(additional.sessions.length, 7);
assert.throws(() => generateArrivals(1000, 1, Array(24).fill(0), demand));
assert.throws(() => generateArrivals(NaN, 0.1, profile.weights, demand));

const simultaneous = Array.from({ length: 2 }, (_, i) => ({ id: String(i), arrivalMinute: 0, energyKwh: 100, kind: "passing" as const }));
const day = simulateDay(simultaneous, capacity);
assert.equal(day.completedSessions, 2);
assert.equal(day.deliveredKwh, 200);
assert.ok(day.peakGridKw <= 100 + 1e-9);
assert.equal(day.sessions[0].completedMinute, 120);
assert.equal(day.sessions[1].completedMinute, 120);
assert.equal(day.gridKwh, day.deliveredKwh);
assert.equal(day.peakQueue, 0, "Sofort bediente Ankünfte sind keine Warteschlange");
const loss = simulateDay(simultaneous, { ...capacity, lossPercent: 10 });
assert.ok(Math.abs(loss.gridKwh * 0.9 - loss.deliveredKwh) < 1e-8);
const zero = simulateDay(simultaneous, { ...capacity, gridPowerKw: 0 });
assert.equal(zero.completedSessions, 0);
assert.equal(zero.deliveredKwh, 0);
assert.equal(zero.unservedSessions, 2);
const closed = simulateDay(simultaneous, { ...capacity, opening: [] });
assert.equal(closed.completedSessions, 0);
const peak = simulateDay(Array.from({ length: 10 }, (_, i) => ({ ...simultaneous[0], id: String(i) })), { ...capacity, ports: 1, maxWaitMinutes: 30 });
assert.equal(peak.completedSessions, 1);
assert.equal(peak.rejectedSessions, 9);
const partial = simulateDay([{ ...simultaneous[0], arrivalMinute: 1435 }], capacity);
assert.equal(partial.completedSessions, 0);
assert.equal(partial.unfinishedSessions, 1);
assert.ok(partial.deliveredKwh > 0 && partial.deliveredKwh < 100);
assert.ok(Math.abs(partial.requestedKwh - partial.deliveredKwh - partial.unservedKwh) < 1e-8);
assert.throws(() => simulateDay(simultaneous, { ...capacity, gridPowerKw: null }));
assert.throws(() => simulateDay(simultaneous, { ...capacity, opening: [{ startMinute: 0, endMinute: 61 }] }));
assert.throws(() => simulateDay([{ ...simultaneous[0], energyKwh: Infinity }], capacity));
for (let seed = 1; seed <= 25; seed++) {
  const generated = generateArrivals(5000 + seed * 100, 0.2, profile.weights, { ...demand, seed });
  const c = { ...capacity, ports: 1 + seed % 5, gridPowerKw: seed % 7 === 0 ? 0 : seed * 35,
    lossPercent: seed % 30, turnaroundMinutes: (seed % 5) * 5, opening: [{ startMinute: 360, endMinute: 1320 }] };
  const simulated = simulateDay(generated.sessions, c);
  assert.equal(simulated.completedSessions + simulated.rejectedSessions + simulated.unfinishedSessions, generated.sessions.length);
  assert.ok(Math.abs(simulated.requestedKwh - simulated.deliveredKwh - simulated.unservedKwh) < 1e-6);
  assert.ok(Math.abs(simulated.gridKwh * (1 - c.lossPercent / 100) - simulated.deliveredKwh) < 1e-6);
  assert.ok(simulated.peakGridKw <= c.gridPowerKw + 1e-7);
  assert.ok(simulated.portUtilization >= 0 && simulated.portUtilization <= 1);
}

const finance = { capex: 1000, fixedCostAnnual: 100, salePricePerKwh: 1, electricityPricePerKwh: 0.2,
  variableCostPerKwh: 0.1, discountRate: 0.1, priceEscalation: 0, costEscalation: 0,
  replacements: [{ year: 2028, amount: 200 }], residualValue: 50 };
const flows = calculateCashflows([{ year: 2027, deliveredKwh: 1000, gridKwh: 1000, completedSessions: 10 },
  { year: 2028, deliveredKwh: 1000, gridKwh: 1000, completedSessions: 10 }], finance);
assert.equal(flows.initialCashflow, -1000);
assert.equal(flows.years[0].operatingCashflow, 600);
assert.equal(flows.years[1].projectCashflow, 450);
assert.ok(Math.abs(flows.npv - (-1000 + 600 / 1.1 + 450 / 1.21)) < 1e-8);
assert.equal(flows.paybackYear, 2028);
assert.equal(flows.discountedPaybackYear, null);
assert.throws(() => calculateCashflows([{ year: 2027, deliveredKwh: 0, gridKwh: 0, completedSessions: 0 },
  { year: 2029, deliveredKwh: 0, gridKwh: 0, completedSessions: 0 }], finance));

const request = {
  schemaVersion: 1 as const, site: { id: "koeln", label: "Köln", lon: 6.96, lat: 50.94,
    access: { status: "assumed" as const, note: "Zufahrt noch prüfen" }, gridStatus: "assumed" as const,
    competitionStatus: "unknown" as const },
  traffic, profiles: { weekday: profile, saturday: profile, sunday: profile }, demand, capacity,
  finance: { ...finance, replacements: [] },
  scenarios: [{ id: "basis", label: "Basis", years: [{ year: 2027, evShare: 0.1, trafficMultiplier: 1 }, { year: 2028, evShare: 0.2, trafficMultiplier: 1 }] }],
};
const result = runChargingPlan(request);
assert.equal(result.modelVersion, "charging-planning-v1");
assert.equal(result.status, "scenario_only");
assert.equal(result.scenarios[0].years[0].calendarDays, 365);
assert.equal(result.scenarios[0].years[1].calendarDays, 366);
assert.deepEqual(result, runChargingPlan(request));
assert.ok(result.evidence.gaps.includes("charging_demand_not_validated"));
assert.equal(result.evidence.investmentReady, false);
assert.equal(result.scenarios[0].years[0].breakEven.requiredEnergyKwhPerYear, 100 / 0.7);
assert.ok(engine.runSensitivity);
const sensitivity = engine.runSensitivity(request, [{ id: "cost", field: "electricityPricePerKwh", value: 0.4 }]);
assert.ok(sensitivity.changes[0].npvDelta < 0);
assert.deepEqual(sensitivity, engine.runSensitivity(request, [{ id: "cost", field: "electricityPricePerKwh", value: 0.4 }]));
assert.ok(engine.compareSitePlans);
const comparison = engine.compareSitePlans([request, { ...request, site: { ...request.site, id: "second" }, finance: { ...request.finance, capex: 2000 } }]);
assert.equal(comparison.scenarios[0].ranking[0].siteId, "koeln");
const missingGrid = runChargingPlan({ ...request, capacity: { ...capacity, gridPowerKw: null }, site: { ...request.site, gridStatus: "unknown" } });
assert.equal(missingGrid.status, "blocked");
assert.equal(missingGrid.scenarios.length, 0);
const denied = runChargingPlan({ ...request, site: { ...request.site, access: { status: "inaccessible", note: "Keine Lkw-Zufahrt" } } });
assert.equal(denied.status, "blocked");
const unknownDirection = runChargingPlan({ ...request, site: { ...request.site, access: { ...request.site.access, directions: "r1" } } });
assert.equal(unknownDirection.status, "blocked");
const r1 = runChargingPlan({ ...request, traffic: { ...traffic, directionShareR1: 0.2 }, site: { ...request.site, access: { ...request.site.access, directions: "r1" } } });
assert.equal(r1.assumptions.reachableDirectionShare, 0.2);
assert.ok(r1.scenarios[0].years[0].offeredSessions < result.scenarios[0].years[0].offeredSessions);
assert.throws(() => runChargingPlan({ ...request, scenarios: [{ ...request.scenarios[0], years: [{ year: 2027, evShare: 2, trafficMultiplier: 1 }] }] }));
assert.throws(() => runChargingPlan({ ...request, surprising: true }));
assert.throws(() => runChargingPlan({ ...request, traffic: { ...traffic, source: { ...source, observedThrough: "2023-02-30" } } }));
const weekdayOnly = runChargingPlan({ ...request, traffic: { ...traffic, trucksPerDay: 0 }, demand: { ...demand,
  anchors: [{ id: "weekdays", hour: 8, count: 1, energyKwh: 100, includedInPassing: false, activeOn: ["weekday"] }] } });
assert.equal(weekdayOnly.scenarios[0].years[0].days.find((d) => d.daytype === "sunday")!.simulation.offeredSessions, 0);
assert.equal(weekdayOnly.scenarios[0].years[0].offeredSessions, engine.calendarCounts(2027).weekday);
const sparse = runChargingPlan({ ...request, traffic: { ...traffic, trucksPerDay: 20 } });
assert.ok(Math.abs(sparse.scenarios[0].years[0].offeredSessions - 36.5) < 1e-8, "0,1 erwartete Ladungen/Tag dürfen im Jahr nicht verschwinden");
assert.throws(() => engine.compareSitePlans([request, { ...request, site: { ...request.site, id: "different" }, scenarios: [{ ...request.scenarios[0], years: [{ year: 2027, evShare: 0.15, trafficMultiplier: 1 }, { year: 2028, evShare: 0.2, trafficMultiplier: 1 }] }] }]));
assert.ok(exportPlanCsv(result).includes("Köln"));
assert.equal(engine.canonicalJson({ a: 1, b: undefined }), '{"a":1}');
assert.ok(exportPlanCsv(runChargingPlan({ ...request, site: { ...request.site, label: "=evil" } })).includes("'=evil"));

const edge = { edgeId: 1, aLon: 6.9, aLat: 50.94, bLon: 7, bLat: 50.94, trucks2019: 1000, trucks2030: 2000, lengthKm: 7, label: "Köln" };
assert.equal(matchTrafficEdge({ lon: 6.96, lat: 50.94 }, [edge])?.edge.edgeId, 1);
assert.equal(matchTrafficEdge({ lon: 13.4, lat: 52.5 }, [edge]), null);
assert.equal(matchTrafficEdge({ lon: 6.96, lat: 50.94 }, []) , null);
assert.ok(engine.findStationCandidates);
const station = { stationId: "1234", vehicleClass: "truck", validHours: 744, expectedHours: 744, coverage: 1, duplicates: 0, invalidHours: 0,
  observedTrucks: 1000, meanObservedTrucksPerHour: 1000 / 744, directionShareR1: 0.5, usableAsCompleteProfile: true,
  profiles: { weekday: Array(24).fill(1), saturday: Array(24).fill(1), sunday: Array(24).fill(1) }, samplesByHour: { weekday: Array(24).fill(20), saturday: Array(24).fill(4), sunday: Array(24).fill(4) },
  location: { lon: 6.96, lat: 50.94 }, name: "Köln", roadClass: "A", road: "3", direction1: "Nord", direction2: "Süd" };
const candidates = engine.findStationCandidates({ lon: 6.96, lat: 50.94 }, [station], 3);
assert.equal(candidates.length, 1);
assert.equal(candidates[0].matchVerified, false);
assert.equal(engine.findStationCandidates({ lon: 6.96, lat: 50.94 }, [{ ...station, usableAsCompleteProfile: false }], 3).length, 0);
const data = await engine.loadPlanningData(async (url) => new Response(await readFile(`client/public${url}`, "utf8")));
assert.equal(data.network.edges.length, 2964);
assert.ok(data.bast.stations.length > 1000);
assert.equal(data.bast.source.commercialUse, "allowed");
await assert.rejects(() => engine.loadPlanningData(async () => new Response("missing", { status: 404 })));
console.log("Charging planning: sources, arrivals, overlap, grid, queues, conservation, calendars, cashflows, gates and exports passed.");
