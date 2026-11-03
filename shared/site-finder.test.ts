import assert from "node:assert/strict";
import { finderRoads, rankRoadSites } from "./site-finder";

const lot = (id: string, lat: number, truckSpaces: number | null, road = "A7", blocked = false) => ({ id, road, name: id, lat, lon: 9.9, truckSpaces, blocked });
const parking = [lot("voll", 52.0, 60), lot("leer", 52.5, 60), lot("gesperrt", 52.2, 200, "A7", true), lot("andere", 51, 80, "A2"), lot("klein", 53.0, 5), lot("x", 50, 5, "B3")];
const hours = Array.from({ length: 24 }, () => null);
const profiles = [{ id: "voll", name: "voll", lat: 52, lon: 9.9, spaces: 60, night: 100, full: 80, veh: 55, wd: hours, we: hours }];
const edges = [{ aLon: 9.9, aLat: 51.5, bLon: 9.9, bLat: 53.5, trucks2030: 365 * 10000 }];
const hubs = [{ name: "Lader Süd", lon: 9.9, lat: 52.5 }];
const subs: [number, number, number][] = [[9.9, 52.01, 380]];

assert.deepEqual(finderRoads(parking).map((r) => r.road), ["A2", "A7"], "Nur Autobahnen, gesperrte Plätze zählen nicht");
const ranked = rankRoadSites("A7", parking, profiles, edges, hubs, subs);
assert.deepEqual(ranked.map((c) => c.id), ["voll", "klein", "leer"], "Gemessene Standzeit, freie Lage und Netznähe zuerst; Ladepark direkt daneben zuletzt");
assert.equal(ranked[0].trucksPerNight, 60);
assert.equal(ranked[0].trucksPerDay, 10000);
assert.equal(ranked[2].hub?.km, 0);
assert.equal(ranked[1].trucksPerNight, null, "Ohne Messung keine Lkw-Zahl, nur Stellplätze");
assert.ok(ranked.every((c) => c.score >= 0 && c.score <= 100));
assert.equal(rankRoadSites("A7", parking, profiles, edges, hubs, subs, 1).length, 1);
console.log("Standortsuche: Straßen, Rangfolge und Messwerte geprüft.");
