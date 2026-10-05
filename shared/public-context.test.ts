import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { simulateDay } from "./charging-planning/simulation";
import { exportPlanCsv, runChargingPlan, runSensitivity } from "./charging-planning";
import { siteInputSchema, DEFAULT_SITE_INPUT } from "./charging-planning/site-input";

const path = new URL("./public-context.ts", import.meta.url);
assert.ok(existsSync(path), "Gemeinsame validierte Kontextdaten fehlen");
const context = await import(path.href);
assert.equal(context.referenceElectricityPrice(100, 0.15), 0.25);
assert.equal(context.referenceElectricityPrice(-20, 0.15), 0.13);
assert.throws(() => context.referenceElectricityPrice(-200, 0.1));
assert.throws(() => context.referenceElectricityPrice(100, NaN));
assert.equal(context.stressEnergyKwh(250, 20), 300);
assert.throws(() => context.stressEnergyKwh(1800, 20));
const source = JSON.parse(readFileSync(new URL("../client/public/data/context/electricity-de.json", import.meta.url), "utf8")).source;
for (const [name, schema] of [["electricity-de", context.electricityReferenceSchema], ["weather-de", context.weatherReferenceSchema], ["catalogs-de", context.catalogSchema], ["traffic-months-de", context.trafficComparisonSchema]]) {
  const raw = JSON.parse(readFileSync(new URL(`../client/public/data/context/${name}.json`, import.meta.url), "utf8"));
  assert.ok(schema.safeParse(raw).success, `Snapshot ${name} verletzt den Datenvertrag`);
}
const priceSnapshot = JSON.parse(readFileSync(new URL("../client/public/data/context/electricity-de.json", import.meta.url), "utf8"));
assert.equal(context.electricityReferenceSchema.safeParse({ ...priceSnapshot, expectedHours: 8759, validHours: 8759, coverage: 1 }).success, false, "Unmögliche Kalenderlänge abweisen");
assert.equal(context.electricityReferenceSchema.safeParse({ ...priceSnapshot, monthly: priceSnapshot.monthly.map((m: { month: number; validHours: number }) => ({ ...m, validHours: 1 })) }).success, false, "Monatsabdeckung muss zum Jahreswert passen");
const station = { stationId: "1", name: "Fixture", lon: 10, lat: 52, elevationM: 20, year: 2025, validHours: 8760, expectedHours: 8760,
  coverage: 1, rejectedHours: 0, meanC: 10, p10C: -3, hoursBelowZero: 400, monthly: [], source };
assert.equal(context.nearestWeather({ lon: 10.01, lat: 52 }, [station]).stationId, "1");
assert.equal(context.nearestWeather({ lon: 15, lat: 48 }, [station]), null);
const capacity = { ports: 1, portPowerKw: 500, vehiclePowerKw: 50, gridPowerKw: 1000, lossPercent: 0,
  maxWaitMinutes: 0, turnaroundMinutes: 0, opening: [{ startMinute: 0, endMinute: 60 }] };
const result = simulateDay([{ id: "limited", arrivalMinute: 0, energyKwh: 100, kind: "passing" }], capacity);
assert.ok(Math.abs(result.deliveredKwh - 50) < 1e-8, "Fahrzeugobergrenze muss Simulation tatsächlich begrenzen");
assert.equal(result.completedSessions, 0);
const ref = { field: "electricityPrice" as const, appliedValue: 0.25, baselineValue: 0.22, source, note: "100 EUR/MWh + 0.15 EUR/kWh Nutzeraufschlag, historisches Szenario" };
assert.ok(siteInputSchema.safeParse({ ...DEFAULT_SITE_INPUT, electricityPrice: 0.25, references: [ref] }).success);
assert.equal(siteInputSchema.safeParse({ ...DEFAULT_SITE_INPUT, references: [ref] }).success, false, "Keine veraltete Provenienz nach manueller Änderung");
const legacy = { ...DEFAULT_SITE_INPUT } as Record<string, unknown>;
delete legacy.references; delete legacy.vehiclePowerKw;
assert.equal(siteInputSchema.parse(legacy).vehiclePowerKw, 2000, "Gespeicherte V1-Annahmen bleiben lesbar");
const request = JSON.parse(readFileSync(new URL("../client/public/data/planning/example-request.json", import.meta.url), "utf8"));
request.finance.electricityPricePerKwh = ref.appliedValue; request.references = [ref];
const plan = runChargingPlan(request);
assert.ok(plan.evidence.sources.some((s) => s.id === source.id));
assert.ok(exportPlanCsv(plan).includes(source.sha256), "Übernommene Quelle muss im CSV erhalten bleiben");
assert.ok(runSensitivity(request, [{ id: "preis", field: "electricityPricePerKwh", value: 0.3 }]).changes.length);
console.log("Referenzdaten: Einheiten, negative Preise, expliziter Stress, Standortabstand und Fahrzeuggrenze geprüft.");
