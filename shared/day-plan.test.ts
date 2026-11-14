import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, planNight, smallestGridKw, tourLight, weekdayIndex } from "./day-plan";
import { planTour, TOUR_VEHICLES, type TourCharger } from "./tour-plan";

const truck = TOUR_VEHICLES[0];
const leg = (km: number) => ({ km, hours: km / 75, payloadT: 15 });
const stop = (label: string, dwellMin = 60) => ({ label, dwellMin });
const charger = (atKm: number): TourCharger => ({ id: `c${atKm}`, name: `Park ${atKm}`, atKm, maxKw: 400, lon: 10, lat: 51 });
const night = (id: string, arriveH: number, departH: number, kwh: number) => ({ id, name: id, arriveMin: arriveH * 60, departMin: departH * 60, kwh, maxChargeKw: 400, batteryKwh: 600 });

test("traffic light: depot charge is green, a stop on the road yellow, a gap red", () => {
  assert.equal(tourLight(planTour(truck, [leg(120), leg(120)], [stop("Kunde"), stop("Depot", 0)], []), 15).light, "green");
  assert.equal(tourLight(planTour(truck, [leg(400), leg(400)], [stop("Kunde"), stop("Depot", 0)], [charger(320), charger(650)]), 15).light, "yellow");
  assert.equal(tourLight(planTour(truck, [leg(900)], [stop("Ziel", 0)], []), 15).light, "red");
});

test("weekdays and dates", () => {
  assert.equal(weekdayIndex("2026-11-16"), 0);
  assert.equal(weekdayIndex("2026-11-15"), 6);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("every truck gets a charge point and leaves full when there is enough time", () => {
  const plan = planNight([night("A", 16, 30, 400), night("B", 17, 29, 300)], [{ id: "L1", kw: 50 }, { id: "L2", kw: 50 }]);
  assert.deepEqual(plan.sessions.map((s) => [s.chargerId, s.full, s.departSoc]), [["L1", true, 100], ["L2", true, 100]]);
  assert.equal(plan.sessions[0].startMin, 16 * 60);
  assert.equal(plan.sessions[0].endMin, 24 * 60);
  assert.equal(Math.round(plan.kwh), 700);
});

test("a waiting truck takes over the charge point of a full one", () => {
  const plan = planNight([night("A", 16, 30, 400), night("B", 17, 29, 300)], [{ id: "L1", kw: 150 }]);
  const b = plan.sessions[1];
  assert.deepEqual([b.chargerId, b.after, b.full], ["L1", "A", true]);
  assert.equal(b.plugMin, plan.sessions[0].endMin);
  assert.equal(plan.sessions[0].full, true);
});

test("a truck without a free charge point leaves with what it came back with", () => {
  const plan = planNight([night("A", 16, 30, 400), night("B", 17, 20, 300)], [{ id: "L1", kw: 50 }]);
  const b = plan.sessions[1];
  assert.equal(b.chargerId, null);
  assert.equal(b.full, false);
  assert.equal(b.departSoc, 50);
  assert.equal(planNight([night("A", 16, 30, 400)], []).sessions[0].departSoc, 33);
});

test("a short standing time gets the strong charger", () => {
  const plan = planNight([night("Nacht", 17, 30, 300), night("Kurz", 18, 20, 250)], [{ id: "L50", kw: 50 }, { id: "L150", kw: 150 }]);
  assert.equal(plan.sessions[0].chargerId, "L50");
  assert.equal(plan.sessions[1].chargerId, "L150");
  assert.equal(plan.sessions.every((s) => s.full), true);
});

test("the grid connection caps the power, the first truck to leave is served first", () => {
  const sessions = [night("Spät", 18, 32, 300), night("Früh", 18, 28, 300)];
  const chargers = [{ id: "L1", kw: 150 }, { id: "L2", kw: 150 }];
  const plan = planNight(sessions, chargers, 100);
  assert.ok(plan.peakKw <= 100);
  assert.equal(plan.sessions.every((s) => s.full), true);
  assert.ok(plan.sessions[1].endMin! < plan.sessions[0].endMin!);
  assert.equal(planNight(sessions, chargers, 20).sessions.some((s) => !s.full), true);
  const needed = smallestGridKw(sessions, chargers);
  assert.ok(needed >= 50 && needed <= 70, String(needed));
});
