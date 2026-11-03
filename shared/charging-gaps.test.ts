import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeGaps, eTruckShare, largestGaps, trucksPerDay, GAP_FIRST_YEAR, GAP_LAST_YEAR, type GapEdge, type GapHub } from "./charging-gaps";

const edge = (id: number, lon: number, trucks2019 = 3650000, trucks2030 = 7300000): GapEdge =>
  ({ edgeId: id, label: `Ort ${id} - Ort ${id}`, aLon: lon, aLat: 51, bLon: lon + 0.1, bLat: 51, lengthKm: 7, trucks2019, trucks2030 });

assert.equal(trucksPerDay(edge(1, 10), 2019), 10000);
assert.equal(trucksPerDay(edge(1, 10), 2030), 20000);
assert.ok(eTruckShare(GAP_FIRST_YEAR) < eTruckShare(2030) && eTruckShare(2030) < eTruckShare(GAP_LAST_YEAR), "E-Lkw-Anteil wächst über den ganzen Zeitraum");

const edges = [edge(1, 10), edge(2, 10.1), edge(3, 13)];
const hub: GapHub = { lon: 10.05, lat: 51, status: "live", chargePoints: 1000 };
const covered = computeGaps(edges, [hub], 2030);
assert.equal(covered.sections[0].missing, 0, "Großer Ladepark in der Nähe deckt den Bedarf");
assert.ok(covered.sections[2].missing > 0, "Ohne Ladepark in Reichweite fehlt alles");
assert.equal(covered.sections[2].missing, covered.sections[2].demand);
const small = computeGaps(edges, [{ ...hub, chargePoints: 1 }], 2030);
assert.ok(small.sections[0].missing > 0 && small.sections[0].missing < small.sections[0].demand, "Kleiner Ladepark deckt nur einen Teil");
assert.ok(computeGaps(edges, [], 2035).missingPoints > computeGaps(edges, [], 2026).missingPoints, "Die Lücke wächst mit den Jahren");
assert.equal(computeGaps(edges, [{ ...hub, status: "announced" }], 2026).sections[0].hubKm, null, "Angekündigte Parks zählen erst ab 2027");

const spots = largestGaps(computeGaps(edges, [], 2030), [{ id: "p", road: "A7", name: "Rastplatz Test", lon: 13.05, lat: 51.01, truckSpaces: 20, blocked: false }], 5);
assert.equal(spots.length, 2, "Lücken liegen mindestens 80 km auseinander");
assert.ok(spots.some((s) => s.parkingName === "Rastplatz Test" && s.road === "A7"));

// Real data: few gaps today, a large shortfall by 2035.
const network = JSON.parse(readFileSync("client/public/data/planning/network-de.json", "utf8")).edges as GapEdge[];
const hubs = JSON.parse(readFileSync("client/public/data/truck-charging-de.json", "utf8")).verified as GapHub[];
const now = computeGaps(network, hubs, 2026), later = computeGaps(network, hubs, 2035);
assert.ok(now.missingPoints < later.missingPoints / 10);
assert.equal(largestGaps(later, []).length, 5);
assert.ok(largestGaps(later, [], [{ lon: 10, lat: 51 }])[0].hubKm! > 0, "Entfernung zum nächsten Ladepark in Betrieb");
console.log(`Lückenmodell geprüft: ${now.missingPoints} fehlende Ladepunkte ${now.year}, ${later.missingPoints} ${later.year}.`);
