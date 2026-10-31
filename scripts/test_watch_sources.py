import unittest
from datetime import date

from watch_sources import run, svz_newer_than_2021


class WatchTest(unittest.TestCase):
    def test_svz_only_newer_years(self):
        self.assertIsNone(svz_newer_than_2021('href="/x/Verkehrsdaten/2021/Autobahnen-2021.xlsx"'))
        self.assertIn("2025", svz_newer_than_2021('href="/x/Verkehrsdaten/2025/Autobahnen-2025.xlsx"'))

    def test_nothing_new_today(self):
        page = b'Verkehrsdaten/2021/Autobahnen-2021.xlsx'
        fetcher = lambda url, head: (404, b"") if url.endswith(".zip") else (200, page)
        self.assertEqual(run(date(2026, 10, 31), fetcher), [])

    def test_reports_new_sources_and_tolerates_outages(self):
        fetcher = lambda url, head: (200, b"Verkehrsdaten/2025/Bundesstrassen-2025.xlsx")
        self.assertEqual({r["id"] for r in run(date(2026, 10, 31), fetcher)}, {"bast-svz-2025", "bast-hourly-2025"})
        self.assertEqual(run(date(2026, 10, 31), lambda url, head: (None, b"")), [])


if __name__ == "__main__":
    unittest.main()
