import io
import json
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kba_trucks as kba  # noqa: E402
import refresh_kba_trucks_de as refresh  # noqa: E402


def workbook(month_label="September 2026", title_month="September 2026", ytd="Januar - September 2026",
             lkw=(24646, 3821), sattel=(2567, 107), label_header="Fahrzeugart", bev_header="Elektro (BEV)",
             as_text=False, drop_sattel=False):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "FZ 28.1"
    conv = (lambda v: str(v)) if as_text else (lambda v: v)
    ws["B6"] = f"FZ 28.1 Neuzulassungen von Kraftfahrzeugen im {title_month} nach Fahrzeugarten"
    ws["B8"], ws["C8"] = label_header, "Kraftfahrzeuge\ninsgesamt"
    ws["H12"] = bev_header
    ws["F10"] = "Elektro-Antriebe"
    rows = [(month_label, 306292, 122137), ("Krafträder", 16934, 1207),
            ("Lastkraftwagen", *lkw), ("Zugmaschinen insgesamt", 5724, 147)]
    if not drop_sattel:
        rows.append(("  darunter Sattelzugmaschinen", *sattel))
    rows += [("Sonstige Kfz", 1727, 57),
             (ytd, 2685589, 644302), ("Lastkraftwagen", 207663, 27115),
             ("darunter Sattelzugmaschinen", 23907, 1255), ("© Kraftfahrt-Bundesamt, Flensburg", None, None)]
    r = 13
    for label, total, bev in rows:
        ws.cell(r, 2, label)
        if total is not None:
            ws.cell(r, 3, conv(total))
            ws.cell(r, 8, conv(bev) if bev != 0 else "-")
        r += 1
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


class ParseTests(unittest.TestCase):
    def test_parses_month_block_not_ytd(self):
        res = kba.parse_workbook(workbook())
        self.assertEqual(res["month"], "2026-09")
        self.assertEqual(res["values"]["lkw_total"], {"all": 24646, "bev": 3821})
        self.assertEqual(res["values"]["sattelzug"], {"all": 2567, "bev": 107})

    def test_text_cells_and_dash_zero(self):
        res = kba.parse_workbook(workbook(as_text=True, sattel=(2567, 0)))
        self.assertEqual(res["values"]["sattelzug"]["bev"], 0)
        self.assertEqual(res["values"]["lkw_total"]["all"], 24646)

    def test_old_label_header_and_january_ytd(self):
        res = kba.parse_workbook(workbook("Januar 2025", "Januar 2025", "Januar-  2025",
                                          label_header="Fahrzeugklasse"))
        self.assertEqual(res["month"], "2025-01")
        self.assertEqual(res["values"]["lkw_total"]["all"], 24646)

    def test_missing_bev_header_fails(self):
        with self.assertRaises(kba.KbaError):
            kba.parse_workbook(workbook(bev_header="Elektro"))

    def test_missing_row_fails(self):
        with self.assertRaises(kba.KbaError):
            kba.parse_workbook(workbook(drop_sattel=True))

    def test_title_month_mismatch_fails(self):
        with self.assertRaises(kba.KbaError):
            kba.parse_workbook(workbook(title_month="August 2026"))

    def test_bev_above_all_fails(self):
        with self.assertRaises(kba.KbaError):
            kba.parse_workbook(workbook(lkw=(100, 200)))

    def test_missing_sheet_fails(self):
        wb = openpyxl.Workbook()
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        with self.assertRaises(kba.KbaError):
            kba.parse_workbook(buf)


class UrlTests(unittest.TestCase):
    def test_host_and_scheme_allowlist(self):
        kba.check_url(kba.month_url(2026, 9))
        for bad in ("http://www.kba.de/x.xlsx", "https://evil.example/x.xlsx", "https://kba.de/x"):
            with self.assertRaises(kba.KbaError):
                kba.check_url(bad)

    def test_discovery_walks_back(self):
        calls = []

        def fetch(url):
            calls.append(url)
            return b"PK" if "2026_09" in url else None
        y, m, url, data = kba.discover_latest(date(2026, 10, 31), fetch=fetch)
        self.assertEqual((y, m), (2026, 9))
        self.assertEqual(len(calls), 2)

    def test_discovery_year_boundary_and_failure(self):
        seen = []
        with self.assertRaises(kba.KbaError):
            kba.discover_latest(date(2026, 2, 1), max_back=2, fetch=lambda u: seen.append(u))
        self.assertIn("fz28_2025_12", seen[2])


class MergeAndRefreshTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name) / "ev.json"
        self.now = datetime(2026, 10, 31, tzinfo=timezone.utc)

    def tearDown(self):
        self.tmp.cleanup()

    def fetcher(self, files):
        def fetch(url):
            for key, buf in files.items():
                if key in url:
                    return buf.getvalue()
            return None
        return fetch

    def run_refresh(self, files, **kw):
        return refresh.run(self.out, today=date(2026, 10, 31), fetch=self.fetcher(files),
                           backfill_from="2026-08", now=self.now, log=lambda *_: None, **kw)

    def test_history_accumulates_and_unchanged_is_stable(self):
        files = {"2026_08": workbook("August 2026", "August 2026", "Januar - August 2026", lkw=(22357, 2933)),
                 "2026_09": workbook()}
        self.assertTrue(self.run_refresh(files))
        doc = json.loads(self.out.read_text())
        self.assertEqual(doc["metadata"]["dataMonth"], "2026-09")
        self.assertEqual({e["month"] for e in doc["series"]}, {"2026-08", "2026-09"})
        self.assertEqual(doc["metadata"]["source"]["commercialUse"], "unknown")
        entry = next(e for e in doc["series"] if e["month"] == "2026-09" and e["class"] == "lkw_total")
        self.assertAlmostEqual(entry["bevShare"], 3821 / 24646, places=5)
        before = self.out.read_bytes()
        self.assertFalse(self.run_refresh(files))
        self.assertEqual(before, self.out.read_bytes())

    def test_older_months_kept_when_new_month_arrives(self):
        self.run_refresh({"2026_09": workbook()})
        files = {"2026_10": workbook("Oktober 2026", "Oktober 2026", "Januar - Oktober 2026", lkw=(25000, 4000))}
        self.assertTrue(self.run_refresh(files))
        doc = json.loads(self.out.read_text())
        self.assertEqual(doc["metadata"]["dataMonth"], "2026-10")
        self.assertIn("2026-09", {e["month"] for e in doc["series"]})

    def test_regression_rejected(self):
        self.run_refresh({"2026_10": workbook("Oktober 2026", "Oktober 2026", "Januar - Oktober 2026")})
        with self.assertRaises(kba.KbaError):
            self.run_refresh({"2026_09": workbook()})

    def test_filename_month_mismatch_rejected(self):
        with self.assertRaises(kba.KbaError):
            self.run_refresh({"2026_09": workbook("August 2026", "August 2026", "Januar - August 2026")})

    def test_validate_series(self):
        with self.assertRaises(kba.KbaError):
            kba.validate_series([{"month": "2026-09", "class": "lkw_total", "bev": 5, "all": 4, "bevShare": 1}])
        with self.assertRaises(kba.KbaError):
            kba.validate_series([{"month": "2026-09", "class": "lkw_total", "bev": -1, "all": 4, "bevShare": 0}])


if __name__ == "__main__":
    unittest.main()
