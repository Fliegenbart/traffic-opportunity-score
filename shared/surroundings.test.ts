import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { latestEvShare, surroundings, type AutobahnServices, type EvTruckSeries } from "./surroundings";

const services = JSON.parse(readFileSync("client/public/data/autobahn-services-de.json", "utf8")) as AutobahnServices;
const ev = JSON.parse(readFileSync("client/public/data/context/ev-trucks-de.json", "utf8")) as EvTruckSeries;
const fixture: AutobahnServices = { ...services, parking: [
  { id: "a", road: "A2", name: "Nah", lat: 52.4, lon: 9.9, truckSpaces: 40, blocked: false },
  { id: "b", road: "A2", name: "Gesperrt", lat: 52.4, lon: 9.9, truckSpaces: 99, blocked: true },
  { id: "c", road: "A7", name: "Fern", lat: 53.4, lon: 9.9, truckSpaces: 50, blocked: false },
], charging: [{ id: "x", road: "A2", name: "Lader", lat: 52.45, lon: 9.95, chargePoints: 8, maxPowerKw: 200, deutschlandnetz: true, operator: "Test" }] };
const s = surroundings({ lon: 9.9, lat: 52.39 }, fixture);
assert.equal(s.parkingSites, 1, "Gesperrte und ferne Parkplätze zählen nicht");
assert.equal(s.truckSpaces, 40);
assert.equal(s.nearestParking?.name, "Nah");
assert.equal(s.deutschlandnetzSites, 1);
assert.ok(surroundings({ lon: 9.9, lat: 52.39 }, services).parkingSites > 0, "Hannover-Ost hat echte Parkplätze im Umkreis");
const semi = latestEvShare(ev, "sattelzug")!;
assert.ok(semi.share >= 0 && semi.share <= 1 && semi.month === ev.metadata.dataMonth);
assert.equal(latestEvShare(ev, "unbekannt"), null);
console.log("Umfeld: Parkplätze, Schnelllader und E-Lkw-Anteil geprüft.");
