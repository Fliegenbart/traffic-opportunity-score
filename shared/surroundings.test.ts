import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { latestEvShare, occupancyTiles, parkingOccupancy, surroundings, type OccupancyIndex, type AutobahnServices, type EvTruckSeries } from "./surroundings";

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
const hours = (v: number | null) => Array.from({ length: 24 }, () => v);
const profile = (id: string, lat: number, spaces: number | null, night: number | null) => ({ id, name: id, lat, lon: 9.9, spaces, night, full: 0, veh: null, wd: hours(night), we: hours(null) });
const profiles = [profile("gross", 52.4, 90, 90), profile("klein", 52.41, 10, 50), profile("ohne", 52.4, 20, null), profile("fern", 53.4, 50, 10)];
const o = parkingOccupancy({ lon: 9.9, lat: 52.39 }, profiles, 9)!;
assert.equal(o.sites, 2, "Nur nahe Parkplätze mit Messwerten zählen");
assert.equal(o.nightOccupancy, 86, "Nachtbelegung nach Stellplätzen gewichtet");
assert.equal(o.weekday[3], 86, "Stundenkurve ebenso gewichtet");
assert.equal(o.weekend[3], null, "Stunden ohne Messung bleiben leer");
assert.equal(o.nearest.id, "gross");
assert.equal(parkingOccupancy({ lon: 0, lat: 0 }, profiles, 9), null);
const index: OccupancyIndex = { metadata: { generatedAt: "", coverage: { days: 9, samples: 1, from: null, to: null }, nightHours: "", source: { title: "", url: "", attribution: "", notice: "" } }, tiles: ["52_9", "51_9", "52_10"] };
assert.deepEqual(occupancyTiles({ lon: 9.99, lat: 52.02 }, index).sort(), ["51_9", "52_10", "52_9"], "Radius über Kachelgrenzen lädt Nachbarkacheln");
assert.deepEqual(occupancyTiles({ lon: 9.5, lat: 52.5 }, index), ["52_9"]);
console.log("Umfeld: Parkplätze, Belegung, Schnelllader und E-Lkw-Anteil geprüft.");
