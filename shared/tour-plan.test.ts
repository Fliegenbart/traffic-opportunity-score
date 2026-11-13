import assert from "node:assert/strict";
import { test } from "node:test";
import { alongRoute, consumptionKwhPerKm, DEFAULT_TOUR_ASSUMPTIONS, planTour, TOUR_VEHICLES, type TourCharger } from "./tour-plan";

const truck = TOUR_VEHICLES[0];
const leg = (km: number, payloadT = 15) => ({ km, hours: km / 75, payloadT });
const charger = (atKm: number, maxKw = 400): TourCharger => ({ id: `c${atKm}`, name: `Park ${atKm}`, atKm, maxKw, lon: 10, lat: 51 });
const stop = (label: string, dwellMin = 60) => ({ label, dwellMin });

test("consumption rises with payload and cold", () => {
  const base = consumptionKwhPerKm(truck, 15, 15);
  assert.ok(base > 0.9 && base < 1.1);
  assert.ok(consumptionKwhPerKm(truck, 24, 15) > base);
  assert.ok(consumptionKwhPerKm(truck, 15, -5) > base * 1.1);
});

test("a short round trip needs only the depot charge", () => {
  const plan = planTour(truck, [leg(150), leg(150)], [stop("Kunde"), stop("Depot", 0)], []);
  assert.equal(plan.feasible, true);
  assert.equal(plan.chargeStops, 0);
  assert.ok(plan.arrivalSoc >= DEFAULT_TOUR_ASSUMPTIONS.reservePercent);
  assert.equal(plan.cost.electric.energy.toFixed(2), (plan.kwh * 0.30).toFixed(2));
});

test("a long tour charges during the break and arrives above the reserve", () => {
  const plan = planTour(truck, [leg(400), leg(400)], [stop("Kunde"), stop("Depot", 0)], [charger(100), charger(320), charger(650)]);
  assert.equal(plan.feasible, true);
  assert.ok(plan.chargeStops >= 1);
  const charges = plan.events.filter((e) => e.type === "charge");
  assert.ok(charges.every((e) => e.type === "charge" && e.minutes >= 45 && e.socTo <= 100));
  assert.ok(plan.arrivalSoc >= DEFAULT_TOUR_ASSUMPTIONS.reservePercent - 1);
  assert.ok(plan.publicKwh > 0 && plan.cost.electric.energy > plan.publicKwh * 0.30);
});

test("without a charger in range the plan names the gap", () => {
  const plan = planTour(truck, [leg(900)], [stop("Ziel", 0)], [charger(850)]);
  assert.equal(plan.feasible, false);
  assert.ok(plan.gap && plan.gap.fromKm === 0 && plan.gap.toKm > 400 && plan.gap.toKm < 600);
  assert.equal(plan.events.at(-1)?.type, "stranded");
});

test("more than nine hours of driving includes the daily rest", () => {
  const plan = planTour(truck, [leg(800)], [stop("Ziel", 0)], [charger(300), charger(600)]);
  assert.equal(plan.feasible, true);
  assert.ok(plan.events.some((e) => (e.type === "charge" || e.type === "pause") && e.pause === "rest"));
  assert.ok(plan.minutes > 800 / 75 * 60 + 11 * 60);
});

test("chargers are placed along the route line", () => {
  const line: [number, number][] = Array.from({ length: 101 }, (_, i) => [10, 50 + i * 0.01]);
  const { hits, lengthKm } = alongRoute(line, [{ lon: 10.01, lat: 50.5 }, { lon: 11, lat: 50.5 }], 3);
  assert.ok(Math.abs(lengthKm - 111.3) < 1);
  assert.equal(hits.length, 1);
  assert.ok(Math.abs(hits[0].atKm - 55.7) < 1);
});
