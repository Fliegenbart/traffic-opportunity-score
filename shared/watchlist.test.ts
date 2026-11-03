import assert from "node:assert/strict";
import { chargingOffers, markSeen, readWatchlist, watchSite, watchStatus, writeWatchlist } from "./watchlist";

const before = chargingOffers({
  hubs: [{ name: "Milence Nord", status: "announced", lon: 9.9, lat: 52.45 }],
  fastChargers: [{ lon: 9.95, lat: 52.4, chargePoints: 4, maxKw: 400 }],
  autobahn: [{ id: "far", road: "A7", name: "Weit weg", lon: 9.9, lat: 53.5 }],
});
const site = watchSite({ lon: 9.9, lat: 52.39, label: "Hannover-Ost" }, before, new Date("2026-11-03T10:00:00Z"));
assert.equal(site.known.length, 2, "Nur Angebote im Umkreis von 25 km werden gemerkt");
assert.equal(watchStatus(site, before).fresh.length, 0);

const after = chargingOffers({
  hubs: [{ name: "Milence Nord", status: "live", lon: 9.9, lat: 52.45 }],
  fastChargers: [{ lon: 9.95, lat: 52.4, chargePoints: 4, maxKw: 400 }, { lon: 9.8, lat: 52.3, chargePoints: 8, maxKw: 1000 }],
  autobahn: [{ id: "far", road: "A7", name: "Weit weg", lon: 9.9, lat: 53.5 }],
});
const status = watchStatus(site, after);
assert.deepEqual(status.fresh.map((o) => o.label), ["Lkw-Ladepark Milence Nord (in Betrieb)", "Schnelllader ab 1000 kW mit 8 Ladepunkten"], "Inbetriebnahme und neuer Lader sind Neuigkeiten");
assert.equal(status.total, 3);
const seen = markSeen(site, after, new Date("2026-12-01T10:00:00Z"));
assert.equal(watchStatus(seen, after).fresh.length, 0);
assert.equal(seen.seenAt, "2026-12-01T10:00:00.000Z");

assert.deepEqual(readWatchlist(writeWatchlist([seen])), [seen], "Speichern und Lesen ergeben dasselbe");
assert.deepEqual(readWatchlist("{kaputt"), []);
assert.deepEqual(readWatchlist(JSON.stringify({ version: 2, sites: [] })), [], "Fremde Versionen werden ignoriert");
console.log("Beobachtungsliste: Umkreis, Neuigkeiten, gesehen und Speicherformat geprüft.");
