"""KBA FZ 28 (Neuzulassungen mit alternativem Antrieb): parser, discovery, merge.

Sheet "FZ 28.1" holds ONE month per file (plus a Jan-to-month year-to-date
block) by Fahrzeugart: Lastkraftwagen, Zugmaschinen insgesamt and
"darunter Sattelzugmaschinen". No weight classes (N2/N3) are published there,
so only the classes lkw_total and sattelzug exist; lkw_n3 is NOT available.
Note: KBA counts Sattelzugmaschinen under Zugmaschinen, not under Lkw.
Cells are located by header / label text, never by fixed position.
"""
from __future__ import annotations

import hashlib
import io
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

ALLOWED_HOSTS = {"www.kba.de"}
MAX_BYTES = 20 * 1024 * 1024
TIMEOUT = 30
URL_TEMPLATE = ("https://www.kba.de/SharedDocs/Downloads/DE/Statistik/Fahrzeuge/FZ28/"
                "fz28_{y:04d}_{m:02d}.xlsx?__blob=publicationFile")
SHEET = "FZ 28.1"
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MONTHS = {"januar": 1, "februar": 2, "märz": 3, "maerz": 3, "april": 4, "mai": 5,
          "juni": 6, "juli": 7, "august": 8, "september": 9, "oktober": 10,
          "november": 11, "dezember": 12}
YTD_LABEL = re.compile(r"^[a-zäöü]+\s*-\s*([a-zäöü]+\s*)?\d{4}$")
CLASSES = ("lkw_total", "sattelzug")
SOURCE_TITLE = ("Kraftfahrt-Bundesamt, FZ 28 Neuzulassungen von Kraftfahrzeugen mit "
                "alternativem Antrieb (Tabelle FZ 28.1)")
LICENSE = "unklar – Quellenangabe Kraftfahrt-Bundesamt"


class KbaError(Exception):
    pass


def _norm(value):
    return re.sub(r"\s+", " ", str(value)).strip() if value is not None else ""


def _number(cell, where):
    if isinstance(cell, bool):
        raise KbaError(f"{where}: unexpected boolean")
    if isinstance(cell, (int, float)):
        if cell < 0 or cell != int(cell):
            raise KbaError(f"{where}: invalid count {cell!r}")
        return int(cell)
    text = _norm(cell)
    if text == "-":  # KBA: nothing present
        return 0
    if re.fullmatch(r"\d+", text):
        return int(text)
    raise KbaError(f"{where}: non-numeric value {text!r}")


def _month_label(text):
    """'September 2026' -> (2026, 9); YTD labels ('Januar - September 2026') -> None."""
    m = re.fullmatch(r"([A-Za-zäöüÄÖÜ]+) (\d{4})", text)
    if m and m.group(1).lower() in MONTHS:
        return int(m.group(2)), MONTHS[m.group(1).lower()]
    return None


def parse_workbook(source):
    """Return {'month': 'YYYY-MM', 'values': {class: {'bev': int, 'all': int}}}.

    `source` is a path or file-like object. Raises KbaError on any structural
    deviation (missing sheet, header, rows, unreadable numbers).
    """
    import openpyxl
    wb = openpyxl.load_workbook(source, read_only=True, data_only=True)
    try:
        if SHEET not in wb.sheetnames:
            raise KbaError(f"Sheet {SHEET!r} missing; found {wb.sheetnames}")
        rows = [list(r) for r in wb[SHEET].iter_rows(values_only=True)]
    finally:
        wb.close()

    total_col = bev_col = header_row = None
    for i, row in enumerate(rows):
        for j, cell in enumerate(row):
            text = _norm(cell).lower()
            if text == "kraftfahrzeuge insgesamt" and total_col is None:
                total_col, header_row = j, i
            if text == "elektro (bev)" and bev_col is None:
                bev_col = j
    if total_col is None or bev_col is None:
        raise KbaError("Header 'Kraftfahrzeuge insgesamt' / 'Elektro (BEV)' not found")
    label_col = None
    for j in range(len(rows[header_row])):
        if _norm(rows[header_row][j]).lower() in ("fahrzeugart", "fahrzeugarten", "fahrzeugklasse"):
            label_col = j
    if label_col is None:
        raise KbaError("Label header 'Fahrzeugart' / 'Fahrzeugklasse' not found")

    title = next((_norm(c) for r in rows for c in r if _norm(c).startswith("FZ 28.1")), "")
    tm = re.search(r"im ([A-Za-zäöüÄÖÜ]+) (\d{4})", title)
    title_month = None
    if tm and tm.group(1).lower() in MONTHS:
        title_month = (int(tm.group(2)), MONTHS[tm.group(1).lower()])

    # Month block: first marker row below the header whose label is "<Monat> <Jahr>".
    start = None
    for i in range(header_row + 1, len(rows)):
        ym = _month_label(_norm(rows[i][label_col]))
        if ym and rows[i][total_col] is not None:
            start, month_ym = i, ym
            break
    if start is None:
        raise KbaError("Monthly marker row ('<Monat> <Jahr>') not found")
    if title_month and title_month != month_ym:
        raise KbaError(f"Title month {title_month} differs from block month {month_ym}")

    values = {}
    for i in range(start, len(rows)):
        label = _norm(rows[i][label_col]).lower()
        if i > start and YTD_LABEL.match(label):
            break  # next block = year-to-date
        if label.startswith("©"):
            break
        key = None
        if label == "lastkraftwagen":
            key = "lkw_total"
        elif label.endswith("sattelzugmaschinen"):
            key = "sattelzug"
        if key:
            where = f"{SHEET} row {i + 1} {key}"
            values[key] = {"all": _number(rows[i][total_col], where + " total"),
                           "bev": _number(rows[i][bev_col], where + " BEV")}
    missing = [c for c in CLASSES if c not in values]
    if missing:
        raise KbaError(f"Rows not found in monthly block: {missing}")
    for key, v in values.items():
        if v["bev"] > v["all"]:
            raise KbaError(f"{key}: BEV {v['bev']} exceeds all {v['all']}")
    return {"month": f"{month_ym[0]:04d}-{month_ym[1]:02d}", "values": values}


# ---------------------------------------------------------------- download

class _HostCheckingRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def check_url(url):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in ALLOWED_HOSTS:
        raise KbaError(f"URL not allowed (https + {sorted(ALLOWED_HOSTS)} only): {url}")


def fetch_xlsx(url, opener=None):
    """Return bytes of an xlsx, or None if the file does not exist (404/HTML page)."""
    check_url(url)
    opener = opener or urllib.request.build_opener(_HostCheckingRedirect)
    req = urllib.request.Request(url, headers={"User-Agent": "truckonomics-kba-refresh/1.0"})
    try:
        with opener.open(req, timeout=TIMEOUT) as resp:
            ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            data = resp.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as err:
        if err.code in (404, 410):
            return None
        raise KbaError(f"HTTP {err.code} for {url}") from err
    if len(data) > MAX_BYTES:
        raise KbaError(f"Download exceeds {MAX_BYTES} bytes: {url}")
    if ctype != XLSX_TYPE or data[:4] != b"PK\x03\x04":
        return None  # KBA serves HTML pages for missing files
    return data


def month_url(year, month):
    return URL_TEMPLATE.format(y=year, m=month)


def previous_month(year, month):
    return (year - 1, 12) if month == 1 else (year, month - 1)


def discover_latest(today=None, max_back=8, fetch=fetch_xlsx):
    """Walk months backwards from `today`; return (year, month, url, bytes)."""
    today = today or date.today()
    y, m = today.year, today.month
    for _ in range(max_back + 1):
        url = month_url(y, m)
        data = fetch(url)
        if data is not None:
            return y, m, url, data
        y, m = previous_month(y, m)
    raise KbaError(f"No FZ 28 file found in the last {max_back} months")


# ------------------------------------------------------------------- merge

def share(bev, all_):
    return round(bev / all_, 6) if all_ else 0.0


def entries(month, values):
    return [{"month": month, "class": c, "bev": values[c]["bev"], "all": values[c]["all"],
             "bevShare": share(values[c]["bev"], values[c]["all"])} for c in CLASSES]


def merge_series(existing, month, values, overwrite=True):
    """Merge one parsed month into the series. overwrite=False keeps existing months."""
    keep = [e for e in existing if e["month"] != month or not overwrite]
    if not overwrite and any(e["month"] == month for e in existing):
        return sorted(existing, key=_sort_key)
    merged = keep + entries(month, values)
    return sorted(merged, key=_sort_key)


def _sort_key(e):
    return (e["month"], CLASSES.index(e["class"]))


def validate_series(series):
    seen = set()
    for e in series:
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", e["month"]) or e["class"] not in CLASSES:
            raise KbaError(f"Invalid series entry {e}")
        if (e["month"], e["class"]) in seen:
            raise KbaError(f"Duplicate series entry {e}")
        seen.add((e["month"], e["class"]))
        if e["bev"] < 0 or e["all"] < 0 or e["bev"] > e["all"]:
            raise KbaError(f"Implausible counts {e}")


def build_document(series, data_month, url, sha256, generated_at):
    return {
        "schemaVersion": 1,
        "metadata": {
            "generatedAt": generated_at,
            "dataMonth": data_month,
            "source": {"title": SOURCE_TITLE, "url": url, "license": LICENSE,
                       "commercialUse": "unknown", "attribution": "Kraftfahrt-Bundesamt"},
            "sha256": sha256,
        },
        "series": series,
    }


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def open_bytes(data):
    return io.BytesIO(data)
