import csv
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from bnetza_register import DownloadLinks, parse_csv
import refresh_truck_charging_de as refresh


def fixture(encoding="utf-8-sig", date="01.09.2026", **changes):
    row = {"Ladeeinrichtungs-ID": "1000001", "Betreiber": "München Test",
           "Status": "In Betrieb", "Ort": "München", "Breitengrad": "48,1",
           "Längengrad": "11,5", "Nennleistung Ladeeinrichtung [kW]": "1.000,5",
           "Anzahl Ladepunkte": "2", "Standortbezeichnung": "Lkw; Hof",
           "Informationen zum Parkraum": "Lkw"}
    row.update(changes)
    text = io.StringIO()
    text.write(f"Register\nLetzte Aktualisierung vom: {date}\n\n")
    writer = csv.DictWriter(text, fieldnames=list(row), delimiter=";")
    writer.writeheader()
    writer.writerow(row)
    return text.getvalue().encode(encoding)


class RegisterTest(unittest.TestCase):
    def test_current_and_legacy_encoding_and_quoted_fields(self):
        for encoding in ("utf-8-sig", "latin-1"):
            rows, metadata = parse_csv(fixture(encoding))
            self.assertEqual(rows[0]["operator"], "München Test")
            self.assertEqual(rows[0]["kw"], 1000.5)
            self.assertEqual(rows[0]["siteLabel"], "Lkw; Hof")
            self.assertEqual(metadata["bnetzaDataDate"], "2026-09-01")

    def test_no_silent_html_or_missing_date(self):
        for content in (b"<html>Error</html>", fixture().replace(b"Letzte Aktualisierung vom:", b"No data date:")):
            with self.assertRaises(ValueError):
                parse_csv(content)

    def test_future_date_and_invalid_coordinates_fail(self):
        for content in (fixture(date="01.01.2099"), fixture(Breitengrad="nan")):
            with self.assertRaises(ValueError):
                parse_csv(content)

    def test_duplicate_station_ids_rejected(self):
        content = fixture()
        with self.assertRaises(ValueError):
            parse_csv(content + content.splitlines()[-1] + b"\n")

    def test_only_official_https_download(self):
        links = DownloadLinks()
        links.feed('<a href="https://evil.example/Ladesaeulenregister.csv">bad</a>'
                   '<a href="https://data.bundesnetzagentur.de/Ladesaeulenregister.csv">ok</a>')
        self.assertEqual(links.links, ["https://data.bundesnetzagentur.de/Ladesaeulenregister.csv"])

    def test_failed_download_keeps_last_good_app_file(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "charging.json"
            original = '{"lastGood": true}'
            output.write_text(original)
            with patch.object(refresh, "OUTPUT", output), patch.object(refresh, "fetch_register", side_effect=ValueError("HTML response")):
                with self.assertRaises(ValueError):
                    refresh.main()
            self.assertEqual(output.read_text(), original)


if __name__ == "__main__":
    unittest.main()
