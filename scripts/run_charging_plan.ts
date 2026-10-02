import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  bastDataSchema, networkSchema, matchTrafficEdge, stationProfiles,
  planningRequestSchema, runChargingPlan, canonicalJson, exportPlanCsv, summarizePlan, runSensitivity,
  type PlanningRequest,
} from "../shared/charging-planning/index";
import { distanceKm } from "../shared/geo";

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
const args = process.argv.slice(2);
if (args.includes("--help") || !args.length) {
  console.log("Usage: tsx scripts/run_charging_plan.ts --example [--out output/planning-demo]\n       tsx scripts/run_charging_plan.ts --input request.json [--out output/plan]\n       Add --full to export individual arrivals and five-minute slots.");
  process.exit(args.includes("--help") ? 0 : 1);
}
const value = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Wert fehlt: ${name}`);
  return args[i + 1];
};
let request: PlanningRequest;
if (args.includes("--example")) {
  const network = networkSchema.parse(await readJson("client/public/data/planning/network-de.json"));
  const bast = bastDataSchema.parse(await readJson("client/public/data/planning/bast-hourly-de.json"));
  const target = { lon: 6.96, lat: 50.94 };
  const candidates = bast.stations.filter((s) => s.usableAsCompleteProfile && s.vehicleClass === "truck" && s.roadClass === "A")
    .sort((a, b) => distanceKm(target, a.location) - distanceKm(target, b.location));
  const station = candidates.find((s) => matchTrafficEdge(s.location, network.edges));
  if (!station) throw new Error("Keine vollständige Zählstation am Modellnetz für das Beispiel");
  const edge = matchTrafficEdge(station.location, network.edges)!;
  request = planningRequestSchema.parse({
    schemaVersion: 1,
    site: { id: `demo-${station.stationId}`, label: `Demostandort bei ${station.name}`, ...station.location,
      access: { status: "assumed", note: "Illustrativer Punkt an einer Zählstation, kein geprüftes Grundstück oder Zufahrtsrecht." },
      gridStatus: "assumed", competitionStatus: "unknown" },
    traffic: { trucksPerDay: station.meanObservedTrucksPerHour! * 24,
      source: { ...bast.source, id: `${bast.source.id}-station-${station.stationId}`, title: `${bast.source.title}: ${station.name}` },
      contextSource: network.source,
      referenceYear: Number(bast.period.end.slice(0, 4)), directionShareR1: station.directionShareR1,
      edgeId: edge.edge.edgeId, matchDistanceKm: edge.distanceKm, vehicleClass: "truck" },
    profiles: stationProfiles(station, bast.source),
    demand: { reachableShare: 0.5, captureShare: 0.02, energyKwh: 250, seed: 42,
      anchors: [{ id: "illustrative-anchor", hour: 8, count: 4, energyKwh: 200, includedInPassing: false, activeOn: ["weekday"] }] },
    capacity: { ports: 4, portPowerKw: 250, gridPowerKw: 1000, lossPercent: 8, turnaroundMinutes: 15,
      maxWaitMinutes: 30, opening: [{ startMinute: 0, endMinute: 1440 }] },
    finance: { capex: 1500000, fixedCostAnnual: 90000, salePricePerKwh: 0.49, electricityPricePerKwh: 0.22,
      variableCostPerKwh: 0.03, discountRate: 0.08, priceEscalation: 0, costEscalation: 0.02,
      replacements: [{ year: 2033, amount: 200000 }], residualValue: 150000 },
    scenarios: [{ id: "low", label: "Niedrig", targetShare: 0.04 }, { id: "base", label: "Basis", targetShare: 0.08 }, { id: "high", label: "Hoch", targetShare: 0.15 }]
      .map(({ id, label, targetShare }) => ({ id, label, years: Array.from({ length: 10 }, (_, i) => ({
        year: 2027 + i, evShare: targetShare * Math.min(1, (i + 1) / 4), trafficMultiplier: 1 })) })),
  });
} else {
  const path = value("--input");
  if (!path) throw new Error("--input oder --example erforderlich");
  request = planningRequestSchema.parse(await readJson(path));
}
const result = runChargingPlan(request);
const fingerprint = createHash("sha256").update(canonicalJson({ modelVersion: result.modelVersion, input: request })).digest("hex");
const output = resolve(value("--out") || "output/planning-demo");
await mkdir(output, { recursive: true });
const files = {
  "request.json": JSON.stringify(request, null, 2),
  "plan.json": JSON.stringify({ fingerprint, ...(args.includes("--full") ? result : summarizePlan(result)) }, null, 2),
  "plan.csv": exportPlanCsv(result),
  "sensitivity.json": JSON.stringify(runSensitivity(request, [
    { id: "capture-low", field: "captureShare", value: request.demand.captureShare * 0.5 },
    { id: "capture-high", field: "captureShare", value: Math.min(1, request.demand.captureShare * 1.5) },
    { id: "electricity-high", field: "electricityPricePerKwh", value: Math.min(5, request.finance.electricityPricePerKwh * 1.2) },
    { id: "grid-low", field: "gridPowerKw", value: (request.capacity.gridPowerKw || 0) * 0.5 },
  ]), null, 2),
};
for (const [name, content] of Object.entries(files)) {
  await writeFile(resolve(output, `${name}.tmp`), content, "utf8");
  await rename(resolve(output, `${name}.tmp`), resolve(output, name));
}
console.log(JSON.stringify({ output, fingerprint, status: result.status,
  scenarios: result.scenarios.map((s) => ({ id: s.id, npv: Math.round(s.finance.npv), paybackYear: s.finance.paybackYear,
    deliveredMwhLastYear: Math.round(s.years.at(-1)!.deliveredKwh / 1000) })), note: "Alle Nachfrage-, Netz- und Preisannahmen im Beispiel sind illustrativ, nicht validiert." }, null, 2));
