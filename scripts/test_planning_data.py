import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile


class PlanningDataTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name("planning_data.py")
        self.assertTrue(path.exists(), "Die versionierte Datenpipeline muss vorhanden sein")
        spec = importlib.util.spec_from_file_location("planning_data", path)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_network_uses_all_german_edges_not_just_hotspots(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / "source.zip"
            with ZipFile(archive, "w") as z:
                z.writestr("data/02_NUTS-3-Regions.csv", "ETISPlus_Zone_ID,Name,Country\n1,Koln,DE\n2,Lyon,FR\n")
                z.writestr("data/03_network-nodes.csv", "Network_Node_ID,Network_Node_X,Network_Node_Y,ETISplus_Zone_ID,Country\n10,7,51,1,DE\n11,8,51,1,DE\n12,9,51,2,FR\n13,10,51,2,FR\n")
                z.writestr("data/04_network-edges.csv", "Network_Edge_ID,Network_Node_A_ID,Network_Node_B_ID,Distance,Traffic_flow_trucks_2019,Traffic_flow_trucks_2030\n1,10,11,70,1000,2000\n2,11,12,70,10,20\n3,12,13,70,10,20\n")
            d = self.module.build_network(archive)
            self.assertEqual(len(d["edges"]), 2)
            self.assertEqual(d["source"]["kind"], "synthetic")
            self.assertEqual(len(d["source"]["sha256"]), 64)
            self.assertEqual(d["source"]["commercialUse"], "allowed")
            self.assertIn("Köln", d["edges"][0]["label"])

    def test_missing_nodes_and_negative_traffic_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / "source.zip"
            with ZipFile(archive, "w") as z:
                z.writestr("02_NUTS-3-Regions.csv", "ETISPlus_Zone_ID,Name,Country\n1,Koeln,DE\n")
                z.writestr("03_network-nodes.csv", "Network_Node_ID,Network_Node_X,Network_Node_Y,ETISplus_Zone_ID,Country\n10,7,51,1,DE\n")
                z.writestr("04_network-edges.csv", "Network_Edge_ID,Network_Node_A_ID,Network_Node_B_ID,Distance,Traffic_flow_trucks_2019,Traffic_flow_trucks_2030\n1,10,11,70,-1,20\n")
            with self.assertRaises(ValueError):
                self.module.build_network(archive)

    def test_hourly_import_preserves_missing_hours_and_reports_duplicates(self):
        rows = list(self.module.read_normalized_hourly(io.StringIO("stationId,date,hour,lkwR1,lkwR2\na,2026-01-01,0,4,6\na,2026-01-01,0,4,6\na,2026-01-01,1,-1,2\na,2026-01-01,2,3,7\n")))
        d = self.module.summarize_hourly(rows, "2026-01-01", "2026-01-01")
        station = d["stations"][0]
        self.assertEqual(station["validHours"], 2)
        self.assertEqual(station["expectedHours"], 24)
        self.assertEqual(station["duplicates"], 1)
        self.assertEqual(station["invalidHours"], 1)
        self.assertIsNone(station["profiles"]["weekday"][1])
        self.assertEqual(station["observedTrucks"], 20)
        self.assertFalse(station["usableAsCompleteProfile"])

    def test_conflicting_duplicates_fail(self):
        rows = list(self.module.read_normalized_hourly(io.StringIO("stationId,date,hour,lkwR1,lkwR2\na,2026-01-01,0,4,6\na,2026-01-01,0,8,6\n")))
        with self.assertRaises(ValueError):
            self.module.summarize_hourly(rows, "2026-01-01", "2026-01-01")

    def test_invalid_timestamp_not_interpolated(self):
        with self.assertRaises(ValueError):
            list(self.module.read_normalized_hourly(io.StringIO("stationId,date,hour,lkwR1,lkwR2\na,2026-01-99,24,4,6\n")))

    def test_bast_fixed_width_excludes_buses_and_uses_interval_end(self):
        headers = ["H36413592 12 A 2     Netzen                   V2.0;", "R01 01 Berlin              O Magdeburg           W;", "S02 09 KFZ SV  Mot Pkw Lfw PmA Bus LoA LmA Sat Son;"]
        values = [100, 20, 200, 30] + [0, 70, 2, 1, 3, 4, 5, 6, 0] + [0, 150, 2, 1, 7, 8, 9, 10, 0]
        line = "260101 01:00" + "".join(f" {n:4d}-" for n in values)
        parsed = list(self.module.read_bast_fixed(io.StringIO("\n".join(headers + [line]))))
        self.assertEqual(parsed[0]["hour"], 0)
        self.assertEqual(parsed[0]["lkwR1"], 15)
        self.assertEqual(parsed[0]["lkwR2"], 27)
        self.assertEqual(parsed[0]["vehicleClass"], "truck")

    def test_bast_estimated_or_missing_lane_rejects_whole_hour(self):
        headers = ["H36413592 12 A 2     Netzen                   V2.0;", "R01 01 Berlin              O Magdeburg           W;", "S02 00 KFZ Lkw;"]
        line = "260101 01:00" + "  100-   20a  200-   30-"
        parsed = list(self.module.read_bast_fixed(io.StringIO("\n".join(headers + [line]))))
        self.assertIsNone(parsed[0]["lkwR1"])
        self.assertEqual(parsed[0]["vehicleClass"], "heavy_traffic_proxy")

    def test_sv_only_classification_is_explicit_proxy(self):
        headers = ["H36413592 12 A 2     Netzen                   V2.0;", "R01 01 Berlin              O Magdeburg           W;", "S02 00 KFZ SV;"]
        line = "260101 01:00" + "  100-   20-  200-   30-"
        rows = list(self.module.read_bast_fixed(io.StringIO("\n".join(headers + [line]))))
        self.assertEqual(rows[0]["vehicleClass"], "heavy_traffic_proxy")
        self.assertEqual(rows[0]["lkwR1"], 20)
        self.assertEqual(rows[0]["lkwR2"], 30)

    def test_archive_metadata_umlauts_and_license_roundtrip(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / "DZ_2026_01_Rohdaten.zip"
            license_path = Path(temp) / "license.ttl"
            license_path.write_text('@prefix dcat: <http://www.w3.org/ns/dcat#> . @prefix dct: <http://purl.org/dc/terms/> . <https://example.org/dist> dcat:accessURL <https://files.bast.de/DZ_2026_01_Rohdaten.zip> ; dct:license <http://dcat-ap.de/def/licenses/cc-by/4.0> .', encoding="utf-8")
            header = "Dauerzaehlstellennummer;Dauerzaehlstellenname;Straßenklasse;Straßennummer;Nahziel_Richtung_1;Nahziel_Richtung_2;Koordinaten_UTM32_E;Koordinaten_UTM32_N\n"
            with ZipFile(archive, "w") as z:
                z.writestr("_DZ_2026_01_Metadaten.csv", header + "3592;München;A;9;Nord;Süd;500000,0;5500000,0\n")
                z.writestr("station.261", "H36413592 12 A 2     Netzen                   V2.0;\nR01 01 Berlin              O Magdeburg           W;\nS02 00 KFZ Lkw;\n260101 01:00  100-   20-  200-   30-\n")
            d = self.module.import_bast_archive(archive, "2026-01-01", "2026-01-31", license_path)
            self.assertEqual(d["stations"][0]["name"], "München")
            self.assertEqual(d["source"]["commercialUse"], "allowed")
            self.assertEqual(d["stations"][0]["validHours"], 1)

    def test_refresh_only_selects_licensed_months_from_official_hosts(self):
        from refresh_planning_data import checked_url, select_bast_month
        rdf = '@prefix dcat: <http://www.w3.org/ns/dcat#> . @prefix dct: <http://purl.org/dc/terms/> . <https://example.org/dist> dcat:accessURL <https://files.bast.de/DZ_2026_01_Rohdaten.zip> ; dct:license <http://dcat-ap.de/def/licenses/cc-by/4.0> .'
        self.assertEqual(select_bast_month(rdf)["month"], "2026-01")
        for url in ["http://files.bast.de/data.zip", "https://files.bast.de.evil.test/data.zip", "https://user@files.bast.de/data.zip", "https://files.bast.de:8080/data.zip"]:
            with self.assertRaises(ValueError):
                checked_url(url)
        with self.assertRaises(ValueError):
            select_bast_month(rdf.replace("cc-by/4.0", "cc-by-nc/4.0"))


if __name__ == "__main__":
    unittest.main()
