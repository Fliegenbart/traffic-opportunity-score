import unittest
from datetime import datetime, timezone

import autobahn_services as a
import refresh_autobahn_services_de as r


def park(ident="DE-1", lat=50.9, lon=6.8, lines=("PKW Stellplätze: 100", "LKW Stellplätze: 82"), **kw):
    item = {"identifier": ident, "title": "A1 | X", "subtitle": "BP Truckstop",
            "coordinate": {"lat": lat, "long": lon}, "isBlocked": "false",
            "description": list(lines),
            "lorryParkingFeatureIcons": [{"description": "Toilette vorhanden"}, {"description": "Dusche vorhanden"}]}
    item.update(kw)
    return item


COMPACT = {"identifier": "30248", "title": "A1 | Saarbrücken | Grüner Winkel (West)",
           "coordinate": {"lat": 50.608454, "long": 6.710019},
           "description": ["A1 | x", "", "4 Ladepunkte ", "DC Kupplung Combo (CCS)", "200+kW", "",
                           "Ladesäulenbetreiber: Autostrom plus GmbH", "",
                           "Dieser Standort ist Teil des Deutschlandnetzes."]}
PERPOINT = {"identifier": "abc=", "title": "A1 | Wuppertal | Remscheid Ost",
            "coordinate": {"lat": "51.157855", "long": "7.22812"},
            "description": ["Wuppertal | Remscheid Ost", "42859 Wermelskirchen", "",
                            "Ladepunkt 1:", "AC Kupplung Typ 2", "43 kW", "",
                            "Ladepunkt 2:", "DC Kupplung Combo, DC CHAdeMO", "50 kW"]}


class ParseTests(unittest.TestCase):
    def test_parking(self):
        p = a.parse_parking(park(lat="50.9143456", lon="6.835181"), "A1")
        self.assertEqual((p["truckSpaces"], p["carSpaces"], p["lat"], p["blocked"]), (82, 100, 50.91435, False))
        self.assertEqual(p["features"], ["Dusche vorhanden", "Toilette vorhanden"])
        self.assertEqual(p["name"], "BP Truckstop")

    def test_parking_missing_counts_and_blocked(self):
        p = a.parse_parking(park(lines=(), isBlocked="true"), "A1")
        self.assertIsNone(p["truckSpaces"])
        self.assertTrue(p["blocked"])

    def test_compact_charging(self):
        c = a.parse_charging(COMPACT, "A1")
        self.assertEqual((c["chargePoints"], c["maxPowerKw"], c["powerIsMinimum"]), (4, 200, True))
        self.assertEqual(c["connectors"], ["DC Kupplung Combo (CCS)"])
        self.assertEqual(c["operator"], "Autostrom plus GmbH")
        self.assertTrue(c["deutschlandnetz"])
        self.assertEqual(c["name"], "Grüner Winkel (West)")

    def test_per_point_charging(self):
        c = a.parse_charging(PERPOINT, "A1")
        self.assertEqual((c["chargePoints"], c["maxPowerKw"]), (2, 50))
        self.assertNotIn("powerIsMinimum", c)
        self.assertEqual(c["connectors"], ["AC Kupplung Typ 2", "DC CHAdeMO", "DC Kupplung Combo"])
        self.assertIsNone(c["operator"])
        self.assertFalse(c["deutschlandnetz"])

    def test_bbox_and_garbage(self):
        with self.assertRaises(ValueError):
            a.parse_parking(park(lat=40.0), "A1")
        with self.assertRaises(ValueError):
            a.parse_parking(park(lat="abc"), "A1")
        with self.assertRaises(KeyError):
            a.parse_parking({"coordinate": {"lat": 50, "long": 8}}, "A1")

    def test_clean_roads(self):
        self.assertEqual(a.clean_roads(["A2", "A1 ", "A99a", "A1", "../x", "", "A10"]), ["A1", "A2", "A10", "A99a"])

    def test_host_allowlist(self):
        for url in ("http://verkehr.autobahn.de/x", "https://evil.example/x"):
            with self.assertRaises(ValueError):
                a.fetch_json(url)


class CollectTests(unittest.TestCase):
    def fake(self, responses, fail=()):
        def fetch(url):
            if any(f in url for f in fail):
                raise OSError("boom")
            return responses[url.split("/autobahn/")[1]]
        return fetch

    def test_dedupe_across_roads_and_unparseable(self):
        resp = {"A1/services/parking_lorry": {"parking_lorry": [park("DE-1"), park("DE-2", lat=1)]},
                "A2/services/parking_lorry": {"parking_lorry": [park("DE-1")]},
                "A1/services/electric_charging_station": {"electric_charging_station": [COMPACT]},
                "A2/services/electric_charging_station": {"electric_charging_station": [COMPACT, PERPOINT]}}
        roads, parking, charging, stats = a.collect(["A2", "A1 "], self.fake(resp), sleep=lambda s: None)
        self.assertEqual(roads, ["A1", "A2"])
        self.assertEqual([p["id"] for p in parking], ["DE-1"])
        self.assertEqual(parking[0]["road"], "A1")
        self.assertEqual(len(charging), 2)
        self.assertEqual((stats["unparseable"], stats["items"]), (1, 6))

    def test_failed_request_counted(self):
        resp = {"A1/services/parking_lorry": {"parking_lorry": []}}
        _, _, _, stats = a.collect(["A1"], self.fake(resp, fail=("electric",)), sleep=lambda s: None)
        self.assertEqual(stats["failedRequests"], 1)


def doc(roads=60, n_park=600, n_charge=100, ts=None):
    parking = [{"id": f"p{i}", "road": "A1", "name": "n", "lat": 50.0, "lon": 8.0, "truckSpaces": 5,
                "carSpaces": 1, "features": [], "blocked": False} for i in range(n_park)]
    charging = [{"id": f"c{i}", "road": "A1", "name": "n", "lat": 50.0, "lon": 8.0, "chargePoints": 2,
                 "maxPowerKw": 50, "connectors": [], "operator": None, "deutschlandnetz": False}
                for i in range(n_charge)]
    return a.build_document(list(range(roads)), parking, charging,
                            ts or datetime(2026, 1, 1, tzinfo=timezone.utc))


OK = {"items": 100, "unparseable": 0, "requests": 100, "failedRequests": 0}


class GateTests(unittest.TestCase):
    def test_ok(self):
        d = doc()
        a.check_quality(d, OK, doc())
        self.assertEqual(d["metadata"]["truckSpacesTotal"], 3000)

    def test_gates(self):
        with self.assertRaises(ValueError):
            a.check_quality(doc(roads=49), OK)
        with self.assertRaises(ValueError):
            a.check_quality(doc(n_park=499), OK)
        with self.assertRaises(ValueError):
            a.check_quality(doc(n_park=700), dict(OK, unparseable=6))
        with self.assertRaises(ValueError):
            a.check_quality(doc(n_park=700), dict(OK, failedRequests=6))
        with self.assertRaises(ValueError):
            a.check_quality(doc(n_park=700), OK, doc(n_park=1000))
        with self.assertRaises(ValueError):
            a.check_quality(doc(n_charge=70), OK, doc(n_charge=100))
        a.check_quality(doc(n_park=800), OK, doc(n_park=1000))  # exactly -20% is fine


class UnchangedTests(unittest.TestCase):
    def test_unchanged_keeps_timestamps(self):
        old = doc(ts=datetime(2026, 1, 1, tzinfo=timezone.utc))
        new = doc(ts=datetime(2026, 6, 1, tzinfo=timezone.utc))
        merged, changed = r.merge_with_previous(new, old)
        self.assertFalse(changed)
        self.assertEqual(merged["metadata"]["generatedAt"], old["metadata"]["generatedAt"])

    def test_changed_content(self):
        merged, changed = r.merge_with_previous(doc(n_park=601), doc())
        self.assertTrue(changed)

    def test_atomic_write(self):
        import json, tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "sub" / "o.json"
            r.write_atomic(p, {"a": "ä"})
            self.assertEqual(json.loads(p.read_text(encoding="utf-8")), {"a": "ä"})
            self.assertEqual([x.name for x in p.parent.iterdir()], ["o.json"])


if __name__ == "__main__":
    unittest.main()
