import assert from "node:assert/strict";
import { test } from "node:test";
import { FLEET_EXAMPLE, parseTours, planDepot } from "./fleet-plan";

test("the example list parses into eight tours", () => {
  const { tours, errors } = parseTours(FLEET_EXAMPLE);
  assert.deepEqual(errors, []);
  assert.equal(tours.length, 8);
  assert.deepEqual(tours[2], { name: "Kassel-Göttingen", departureMin: 360, stops: ["Kassel", "Göttingen"], payloadT: 16, dwellMin: 45 });
});

test("pasted Excel rows, German decimals and bad lines", () => {
  const { tours, errors } = parseTours("T1\t5.30\tHamburg\t12,5\t30\nT2\tmorgens\tBremen\nT3\t07:00\t");
  assert.equal(tours.length, 1);
  assert.deepEqual(tours[0], { name: "T1", departureMin: 330, stops: ["Hamburg"], payloadT: 12.5, dwellMin: 30 });
  assert.equal(errors.length, 2);
});

test("load management lowers the depot peak for the same energy", () => {
  const trucks = [0, 1, 2, 3].map((i) => ({ name: `T${i}`, arriveMin: 16 * 60 + i * 15, departMin: 6 * 60, kwh: 400, maxChargeKw: 400 }));
  const plan = planDepot(trucks);
  assert.equal(plan.points, 4);
  assert.equal(plan.kwhPerDay, 1600);
  assert.deepEqual(plan.chargers, [{ kw: 50, count: 4 }]);
  assert.ok(plan.managedPeakKw < plan.unmanagedPeakKw);
  assert.ok(Math.abs(plan.managed.reduce((sum, kw) => sum + kw / 4, 0) - 1600) < 1);
});

test("a short standing time needs a faster charger, day and night trucks share a bay", () => {
  const plan = planDepot([
    { name: "Nacht", arriveMin: 17 * 60, departMin: 6 * 60, kwh: 300, maxChargeKw: 400 },
    { name: "Tag", arriveMin: 8 * 60, departMin: 11 * 60, kwh: 300, maxChargeKw: 400 },
  ]);
  assert.equal(plan.points, 1);
  assert.equal(plan.sessions[0].chargerKw, 50);
  assert.equal(plan.sessions[1].chargerKw, 150);
  assert.equal(plan.sessions.some((s) => s.tooShort), false);
});
