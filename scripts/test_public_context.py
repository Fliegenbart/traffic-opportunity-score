import importlib.util
import io
import unittest
from datetime import datetime, timezone
from pathlib import Path


class PublicContextTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).with_name("public_context.py")
        cls.module = None
        if path.exists():
            spec = importlib.util.spec_from_file_location("public_context", path)
            cls.module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.module)

    def test_smard_units_negatives_nulls_and_duplicates(self):
        self.assertIsNotNone(self.module, "Validierte öffentliche Importer fehlen")
        ts = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
        result = self.module.summarize_prices([[ts, -20], [ts + 3600000, 100], [ts + 7200000, None]], 2025, minimum_coverage=0)
        self.assertEqual(result["meanEurMwh"], 40)
        self.assertEqual(result["negativeHours"], 1)
        self.assertEqual(result["validHours"], 2)
        with self.assertRaises(ValueError):
            self.module.summarize_prices([[ts, 1], [ts, 2]], 2025, minimum_coverage=0)

    def test_smard_missing_year_is_not_zero(self):
        self.assertIsNotNone(self.module, "Validierte öffentliche Importer fehlen")
        with self.assertRaises(ValueError):
            self.module.summarize_prices([], 2025)

    def test_dwd_quality_sentinel_and_conflicting_duplicates(self):
        self.assertIsNotNone(self.module, "Validierte öffentliche Importer fehlen")
        header = "STATIONS_ID;MESS_DATUM;QN_9;TT_TU;RF_TU;eor\n"
        rows = "1;2025010100;10;-5;50;eor\n1;2025010101;10;5;50;eor\n1;2025010102;10;-999;50;eor\n1;2025010103;1;-10;50;eor\n"
        result = self.module.summarize_weather(io.StringIO(header + rows), "00001", 2025, minimum_coverage=0)
        self.assertEqual(result["meanC"], 0)
        self.assertEqual(result["validHours"], 2)
        self.assertEqual(result["hoursBelowZero"], 1)
        with self.assertRaises(ValueError):
            self.module.summarize_weather(io.StringIO(header + rows + "1;2025010100;10;8;50;eor\n"), "00001", 2025, minimum_coverage=0)

    def test_month_comparison_requires_same_station_class_road_and_location(self):
        station = {"stationId": "1", "vehicleClass": "truck", "roadClass": "A", "road": "1",
                   "location": {"lon": 10, "lat": 52}, "usableAsCompleteProfile": True,
                   "profiles": {"weekday": [10] * 24, "saturday": [5] * 24, "sunday": [2] * 24}}
        self.assertEqual(len(self.module.compare_months([station], [station])), 1)
        for field, value in [("vehicleClass", "heavy_traffic_proxy"), ("road", "2"),
                             ("location", {"lon": 11, "lat": 52}), ("usableAsCompleteProfile", False)]:
            self.assertEqual(self.module.compare_months([station], [{**station, field: value}]), [])

    def test_utc_hours_survive_dst_and_leap_year_has_8784_hours(self):
        ts = int(datetime(2024, 10, 27, tzinfo=timezone.utc).timestamp() * 1000)
        result = self.module.summarize_prices([[ts, 10], [ts + 3600000, 20]], 2024, minimum_coverage=0)
        self.assertEqual(result["validHours"], 2)
        self.assertEqual(result["expectedHours"], 8784)

    def test_manufacturer_facts_require_matching_variant_table(self):
        html = "<table><tr><td></td><th>Renault Trucks E-Tech T 540</th><th>Renault Trucks E-Tech T 585</th><th>Renault Trucks E-Tech T 780</th></tr><tr><th>Achskonfiguration</th><td>Sattelzugmaschine 4x2</td><td>Sattelzugmaschine 6x2</td><td>Sattelzugmaschine 6x2</td></tr><tr><th>Ladekapazität</th><td>Bis zu 350 kW</td><td>Bis zu 720 kW</td><td>Bis zu 720 kW</td></tr></table>"
        self.module.verify_vehicle_facts(html)
        with self.assertRaises(ValueError):
            self.module.verify_vehicle_facts(html.replace("350", "300"))
        with self.assertRaises(ValueError):
            self.module.verify_vehicle_facts(html.replace("4x2", "6x2"))


if __name__ == "__main__":
    unittest.main()
