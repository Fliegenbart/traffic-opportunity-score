import assert from "node:assert/strict";
import {
  DEFAULT_ASSUMPTIONS,
  savingPerKmRange,
  aggregateReport,
  co2SavedKgPerKm,
  dieselCostPerKm,
  electricCostPerKm,
  evaluateRelation,
  feasibilityFor,
} from "./korridor-report";

const a = DEFAULT_ASSUMPTIONS;

// Kostenmodell: Diesel 26 l/100 km * 1,55 €/l = 0,403 €/km
assert.ok(Math.abs(dieselCostPerKm(a) - 0.403) < 0.001);
// Strom: 1,1 * (0,65*0,22 + 0,35*0,45) - 0,10 Maut - 1,1*0,08 THG = 0,1425 €/km
assert.ok(Math.abs(electricCostPerKm(a) - 0.1425) < 0.001);
const range = savingPerKmRange(a);
assert.ok(range.low < dieselCostPerKm(a) - electricCostPerKm(a));
assert.ok(range.high > dieselCostPerKm(a) - electricCostPerKm(a));
assert.ok(co2SavedKgPerKm(a) > 0.3);

// Machbarkeit
assert.equal(feasibilityFor(300, 300, a), "ready"); // in Reichweite
assert.equal(feasibilityFor(600, 200, a), "ready"); // Lücke klein
assert.equal(feasibilityFor(600, 380, a), "plannable");
assert.equal(feasibilityFor(600, 500, a), "hard");

const regions = new Map([
  ["A", { id: "A", name: "Hamburg", lon: 10.0, lat: 53.55 }],
  ["B", { id: "B", name: "Berlin", lon: 13.4, lat: 52.52 }],
]);
const relation = { name: "HH-B", originRegionId: "A", destinationRegionId: "B", tripsPerWeek: 10 };

// Ohne Korridor-Match: Luftlinie (~255 km) * 1,25 ≈ 318 km
const noHubs = evaluateRelation(relation, regions, [], [], a);
assert.ok(noHubs);
assert.equal(noHubs!.distanceSource, "luftlinie");
assert.ok(noHubs!.distanceKm > 300 && noHubs!.distanceKm < 340);
assert.equal(noHubs!.feasibility, "ready"); // unter Reichweite 350
assert.ok(noHubs!.annualSavingEur > 0);

// Mit Korridor-Match wird die Straßen-Distanz übernommen
const withCorridor = evaluateRelation(
  relation,
  regions,
  [{ originRegionId: "B", destinationRegionId: "A", totalDistanceKm: 290 }],
  [],
  a,
);
assert.equal(withCorridor!.distanceSource, "korridor");
assert.equal(withCorridor!.distanceKm, 290);
assert.equal(withCorridor!.distanceFitScore, 100);

// Unbekannte Region -> null
assert.equal(
  evaluateRelation({ ...relation, originRegionId: "X" }, regions, [], [], a),
  null,
);

const totals = aggregateReport([noHubs!, withCorridor!]);
assert.equal(totals.relationCount, 2);
assert.equal(totals.readyCount, 2);
assert.ok(totals.annualSavingEur > 0);

// Mit echter Route: km aus Route, Lücken entlang Polylinie
const polyline = Array.from({ length: 30 }, (_, i) => ({
  lon: 10.0 + (3.4 * i) / 29,
  lat: 53.55 - (1.03 * i) / 29,
}));
const routed = evaluateRelation(
  relation,
  regions,
  [],
  [{ lon: polyline[15].lon, lat: polyline[15].lat }],
  a,
  { km: 330, polyline },
);
assert.equal(routed!.distanceSource, "route");
assert.equal(routed!.distanceKm, 330);
assert.equal(routed!.hubsOnRoute, 1);
assert.ok(routed!.annualSavingLowEur < routed!.annualSavingEur);
assert.ok(routed!.annualSavingHighEur > routed!.annualSavingEur);
