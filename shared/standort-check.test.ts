import assert from "node:assert/strict";
import { assessSite } from "./standort-check";

// A2 bei Peine: Kante quer, Punkt direkt daneben.
const edges = [
  {
    edgeId: 1,
    label: "bei Peine",
    aLon: 10.1,
    aLat: 52.32,
    bLon: 10.3,
    bLat: 52.32,
    trucks2030: 12_000_000, // ≈ 32.9k/Tag
    whiteSpot: true,
  },
];
const regions = [
  { id: "r1", name: "Peine", lon: 10.23, lat: 52.32, score: 70, rank: 9 },
];
const farHub = [{ name: "Milence Kassel", lon: 9.5, lat: 51.3 }];
const nearHub = [{ name: "Aral pulse Hannover", lon: 10.21, lat: 52.35 }];

// Hoher Verkehr + freier Suchraum -> stark
const stark = assessSite({ lon: 10.2, lat: 52.33 }, edges, farHub, regions);
assert.equal(stark.signal, "stark");
assert.ok(stark.edge && stark.edge.km < 5);
assert.ok(stark.edge!.trucksPerDay > 30000);
assert.equal(stark.reasons.length, 3);

// Hoher Verkehr + Park in 3-4 km -> dichter Wettbewerb -> pruefen
const dicht = assessSite({ lon: 10.2, lat: 52.33 }, edges, nearHub, regions);
assert.equal(dicht.signal, "pruefen");

// Weit weg von jeder Hotspot-Kante -> niedriges Verkehrssignal
const ab = assessSite({ lon: 13.8, lat: 54.0 }, edges, farHub, regions);
assert.ok(ab.signal === "pruefen" || ab.signal === "schwach");
assert.ok(ab.edge!.km > 25);

// Ohne Hubs: Wettbewerb gilt als frei, kein Hub-Eintrag
const ohneHubs = assessSite({ lon: 10.2, lat: 52.33 }, edges, [], regions);
assert.equal(ohneHubs.signal, "stark");
assert.equal(ohneHubs.hub, null);
