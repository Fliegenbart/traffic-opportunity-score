import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { latestEvShare, parkingOccupancy, surroundings, type OccupancyProfiles, type AutobahnServices, type EvTruckSeries } from "./surroundings";

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
const profile = (id: string, lat: number, spaces: number | null, night: number | null) => ({ id, name: id, lat, lon: 9.9, spaces, detection: null, samples: 10, nightOccupancy: night, meanVehicles: null, fullShare: 0, weekday: [], weekend: [] });
const occupancy: OccupancyProfiles = { metadata: { generatedAt: "", coverage: { days: 9, samples: 200, from: null, to: null }, nightHours: "20–6 Uhr", source: { title: "", url: "", attribution: "", notice: "" } },
  sites: [profile("gross", 52.4, 90, 90), profile("klein", 52.41, 10, 50), profile("ohne", 52.4, 20, null), profile("fern", 53.4, 50, 10)] };
const o = parkingOccupancy({ lon: 9.9, lat: 52.39 }, occupancy)!;
assert.equal(o.sites, 2, "Nur nahe Parkplätze mit Messwerten zählen");
assert.equal(o.nightOccupancy, 86, "Nachtbelegung nach Stellplätzen gewichtet");
assert.equal(o.nearest.id, "gross");
assert.equal(o.days, 9);
assert.equal(parkingOccupancy({ lon: 0, lat: 0 }, occupancy), null);
console.log("Umfeld: Parkplätze, Belegung, Schnelllader und E-Lkw-Anteil geprüft.");
