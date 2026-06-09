import assert from "node:assert/strict";
import {
  calculateTrafficOpportunityScore,
  classifyTrafficOpportunity,
  getDistanceFitScore,
  normalizeAgainstMax,
  normalizeVolumeSqrt,
} from "./traffic-opportunity";

assert.equal(normalizeAgainstMax(50, 100), 50);
assert.equal(normalizeAgainstMax(125, 100), 100);
assert.equal(normalizeAgainstMax(10, 0), 0);

assert.equal(normalizeVolumeSqrt(25, 100), 50);
assert.equal(normalizeVolumeSqrt(100, 100), 100);
assert.equal(normalizeVolumeSqrt(125, 100), 100);
assert.equal(normalizeVolumeSqrt(10, 0), 0);

assert.equal(getDistanceFitScore(220), 100);
assert.equal(getDistanceFitScore(480), 90);
assert.equal(getDistanceFitScore(75), 65);
assert.equal(getDistanceFitScore(1200), 25);

const high = calculateTrafficOpportunityScore({
  trucks2019: 900_000,
  trucks2030: 1_350_000,
  maxTrucks2030: 1_500_000,
  distanceFitScore: 95,
  corridorRelevanceScore: 90,
});

// volume = sqrt(0.9) * 100 = 95, growth = 50 % / 60 % = 83
assert.equal(high.components.volume, 95);
assert.equal(high.components.growth, 83);
assert.equal(high.score, 92);
assert.equal(classifyTrafficOpportunity(high.score).level, "High Opportunity");

const low = calculateTrafficOpportunityScore({
  trucks2019: 0,
  trucks2030: 12_000,
  maxTrucks2030: 1_500_000,
  distanceFitScore: 25,
  corridorRelevanceScore: 5,
});

assert.equal(low.components.growth, 0);
assert.equal(low.components.volume, 9);
assert.equal(low.score, 13);
assert.equal(classifyTrafficOpportunity(low.score).level, "Low Opportunity");
