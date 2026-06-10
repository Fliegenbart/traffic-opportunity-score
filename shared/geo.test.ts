import assert from "node:assert/strict";
import { corridorChargingStats, distanceKm, nearestDistanceKm, pointToSegmentKm } from "./geo";

const hamburg = { lon: 10.0, lat: 53.55 };
const berlin = { lon: 13.4, lat: 52.52 };
const hannover = { lon: 9.74, lat: 52.37 };

// Hamburg–Berlin Luftlinie: ~255 km
const hhBer = distanceKm(hamburg, berlin);
assert.ok(hhBer > 245 && hhBer < 265, `Hamburg-Berlin: ${hhBer}`);

assert.equal(distanceKm(hamburg, hamburg), 0);

const nearest = nearestDistanceKm(hamburg, [berlin, hannover]);
assert.equal(nearest?.index, 1);

// Punkt auf der Strecke hat Abstand ~0
const mid = { lon: (hamburg.lon + berlin.lon) / 2, lat: (hamburg.lat + berlin.lat) / 2 };
assert.ok(pointToSegmentKm(mid, hamburg, berlin) < 2);

// Punkt abseits: Hannover liegt ~120+ km von der Linie Hamburg-Berlin
assert.ok(pointToSegmentKm(hannover, hamburg, berlin) > 80);

// Korridor ohne Lader: maximale Lücke = ganze Strecke
const empty = corridorChargingStats(hamburg, berlin, []);
assert.equal(empty.hubsOnRoute, 0);
assert.equal(empty.maxGapKm, empty.corridorKm);

// Ein Lader in der Mitte halbiert die maximale Lücke
const withMid = corridorChargingStats(hamburg, berlin, [mid]);
assert.equal(withMid.hubsOnRoute, 1);
assert.ok(Math.abs(withMid.maxGapKm - Math.round(withMid.corridorKm / 2)) <= 2);

// Lader weit abseits des Puffers zählt nicht
const offRoute = corridorChargingStats(hamburg, berlin, [hannover]);
assert.equal(offRoute.hubsOnRoute, 0);
