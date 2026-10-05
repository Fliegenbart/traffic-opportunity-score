import assert from "node:assert/strict";
import { test } from "node:test";
import { availableTutorialStep, readTutorialState, SITE_STEP, TUTORIAL_STEPS } from "./traffic-tutorial";

test("first visit starts the tutorial; embeds may opt out", () => {
  assert.deepEqual(readTutorialState(null), { enabled: true, step: 0 });
  assert.deepEqual(readTutorialState(null, false), { enabled: false, step: 0 });
});

test("switch and progress survive reload without changing disabled state", () => {
  for (const enabled of [true, false]) for (let step = 0; step < TUTORIAL_STEPS.length; step++) {
    assert.deepEqual(readTutorialState(JSON.stringify({ enabled, step })), { enabled, step });
  }
});

test("malformed or out-of-range stored progress cannot crash the tutorial", () => {
  for (const raw of ["oops", "null", "[]", "{}", '{"enabled":"false","step":1}', '{"enabled":true,"step":-1}', '{"enabled":true,"step":1.5}', JSON.stringify({ enabled: true, step: TUTORIAL_STEPS.length })]) {
    assert.deepEqual(readTutorialState(raw), { enabled: true, step: 0 });
  }
});

test("site-dependent steps return to site selection when no site exists", () => {
  TUTORIAL_STEPS.forEach((step, index) => {
    assert.equal(availableTutorialStep(index, true), index);
    assert.equal(availableTutorialStep(index, false), step.needsSite ? SITE_STEP : index);
  });
});

test("step identifiers are stable, unique and match a site-selection gate", () => {
  assert.equal(new Set(TUTORIAL_STEPS.map((step) => step.id)).size, TUTORIAL_STEPS.length);
  assert.ok(SITE_STEP >= 0);
  assert.equal(TUTORIAL_STEPS[SITE_STEP].tab, "standort");
  assert.ok(TUTORIAL_STEPS.every((step) => step.title && step.text && step.target));
});
