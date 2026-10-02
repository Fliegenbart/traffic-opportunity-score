import assert from "node:assert/strict";
import { calculateSiteEconomics as calc, DEFAULT_ECONOMICS as base, economicsCsv, hasTrafficBasis, readSavedEconomics } from "./site-economics";
import { matchesRegionSearch } from "./region-search";
import { assessSite } from "./standort-check";

const r = calc(30000, 0.08, base);
assert.equal(r.demand, 24);
assert.equal(r.sessions, 24);
assert.equal(r.annualEnergy, 2190000);
assert.ok(Math.abs(r.operatingSurplus - (2190000 * (0.49 - 0.22 / 0.92 - 0.03) - 90000)) < 1e-6);
assert.equal(r.paybackYears, base.investment / r.operatingSurplus);
assert.ok(r.breakEvenReachable);
const saturated = calc(1000000, 0.15, base);
assert.equal(saturated.sessions, saturated.portCapacity);
assert.equal(saturated.utilization, 1);
assert.ok(saturated.unservedSessions > 0);
const grid = calc(1000000, 0.15, { ...base, gridPowerKw: 100 });
assert.equal(grid.sessions, grid.gridCapacity);
assert.equal(grid.bottleneck, "Netzanschluss");
for (const change of [{ gridPowerKw: 0 }, { hoursPerDay: 0 }, { availabilityPercent: 0 }]) {
  const zero = calc(30000, 0.08, { ...base, ...change });
  assert.equal(zero.sessions, 0);
  assert.equal(zero.utilization, 0);
  assert.equal(zero.operatingSurplus, -base.fixedCost);
  assert.equal(zero.paybackYears, null);
  assert.equal(zero.breakEvenReachable, false);
}
assert.equal(calc(0, 0, base).operatingSurplus, -base.fixedCost);
assert.equal(calc(0, 0, { ...base, contractedSessions: 12 }).sessions, 12);
assert.equal(calc(1000, 0.08, { ...base, reachablePercent: 0 }).sessions, 0);
const loss = calc(30000, 0.08, { ...base, salePrice: 0.1 });
assert.equal(loss.breakEvenSessions, null);
assert.equal(loss.paybackYears, null);
assert.ok(loss.operatingSurplus < 0);
assert.equal(calc(30000, 0.08, { ...base, investment: 0 }).paybackYears, null);
assert.throws(() => calc(NaN, 0.08, base));
assert.throws(() => calc(-1, 0.08, base));
assert.throws(() => calc(1000, 1.1, base));
for (const change of [{ ports: 1.5 }, { energyPerSession: 0 }, { lossPercent: 100 }, { investment: Infinity }]) {
  assert.throws(() => calc(1000, 0.08, { ...base, ...change }));
}
assert.deepEqual(readSavedEconomics(JSON.stringify({ version: 1, assumptions: base })), base);
for (const raw of [null, "broken", "null", '{"version":2}', JSON.stringify({ version: 1, assumptions: { ...base, ports: -1 } })]) {
  assert.equal(readSavedEconomics(raw), null);
}
const site = { id: "a", label: '=HYPERLINK("bad")', lon: 10.2, lat: 52.33, assessment: assessSite({ lon: 10.2, lat: 52.33 }, [{ edgeId: 1, label: "Peine", aLon: 10.1, aLat: 52.32, bLon: 10.3, bLat: 52.32, trucks2030: 12000000 }], [], []) };
assert.ok(hasTrafficBasis(site));
const csv = economicsCsv([site], base, "2026-04-22");
assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
assert.ok(csv.includes("2026-04-22"));
assert.ok(csv.includes("Konservativ") && csv.includes("Ambitioniert"));
assert.ok(!hasTrafficBasis({ ...site, assessment: undefined }));
assert.ok(economicsCsv([{ ...site, assessment: undefined }], base, null).includes("nicht berechnet"));
for (const query of ["", "  ", "Köln", "Koeln", "Koln", "KÖLN", "köln DEA"]) assert.ok(matchesRegionSearch("Köln DEA23", query), query);
assert.ok(matchesRegionSearch("München", "Muenchen"));
assert.ok(matchesRegionSearch("Straße", "strasse"));
assert.ok(!matchesRegionSearch("Köln", "Berlin"));
console.log("Site economics: calculation, capacity, validation, persistence, CSV and umlaut search passed.");
