"""Validated import of the official public CSV; not the daily REST service.

The REST contract must be obtained from BNetzA before implementing that adapter.
Never substitute retrieval time for the provider's data date.
"""
from __future__ import annotations

import csv
import hashlib
import io
import math
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urlparse
from urllib.request import Request, urlopen

SOURCE_PAGE = "https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/start.html"
REQUIRED = {"Betreiber", "Status", "Ort", "Breitengrad", "Längengrad",
            "Nennleistung Ladeeinrichtung [kW]", "Anzahl Ladepunkte",
            "Standortbezeichnung", "Informationen zum Parkraum"}
MAX_BYTES = 100 * 1024 * 1024


class DownloadLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        href = dict(attrs).get("href", "")
        parsed = urlparse(href)
        if (tag == "a" and parsed.scheme == "https"
                and parsed.hostname == "data.bundesnetzagentur.de"
                and "Ladesaeulenregister" in parsed.path and parsed.path.endswith(".csv")):
            self.links.append(href)


def download(url):
    request = Request(url, headers={"User-Agent": "Truckonomics-register-import/1.0"})
    with urlopen(request, timeout=60) as response:
        content = response.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ValueError("BNetzA response exceeds size limit")
    return content


def number(value):
    text = str(value or "").strip()
    # Both the legacy Latin-1 and current UTF-8 exports use German decimals.
    result = float(text.replace(".", "").replace(",", "."))
    if not math.isfinite(result):
        raise ValueError("Non-finite numeric value")
    return result


def parse_csv(content: bytes):
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    records = list(csv.reader(io.StringIO(text), delimiter=";"))
    header_index = next((i for i, row in enumerate(records[:40])
                         if REQUIRED.issubset(set(row))), None)
    if header_index is None:
        raise ValueError("Missing required register columns (or HTML instead of CSV)")
    match = re.search(r"Letzte Aktualisierung vom:\s*(\d{2}\.\d{2}\.\d{4})", text[:8000])
    if not match:
        raise ValueError("Missing provider data date")
    data_date = datetime.strptime(match[1], "%d.%m.%Y").date()
    if data_date > datetime.now(timezone.utc).date():
        raise ValueError("Provider date lies in the future")
    header = records[header_index]
    rows = []
    skipped = 0
    ids = set()
    for record in records[header_index + 1:]:
        if not any(record):
            continue
        if len(record) != len(header):
            raise ValueError("Register row has an unexpected column count")
        row = dict(zip(header, record))
        station_id = row.get("Ladeeinrichtungs-ID", "").strip()
        if station_id:
            if station_id in ids:
                raise ValueError("Duplicate station ID")
            ids.add(station_id)
        try:
            lat = float(row["Breitengrad"].replace(",", "."))
            lon = float(row["Längengrad"].replace(",", "."))
            kw, points = number(row["Nennleistung Ladeeinrichtung [kW]"]), number(row["Anzahl Ladepunkte"])
            if not (47 <= lat <= 56 and 5 <= lon <= 16 and 0 < kw <= 100000
                    and points >= 1 and points.is_integer()):
                raise ValueError("Invalid station coordinates, power or count")
        except ValueError:
            skipped += 1
            continue
        rows.append({"operator": row["Betreiber"].strip(), "status": row["Status"].strip(),
                     "ort": row["Ort"].strip(), "kw": kw, "points": int(points),
                     "lat": lat, "lon": lon, "siteLabel": row["Standortbezeichnung"].strip(),
                     "parking": row["Informationen zum Parkraum"].strip()})
    if not rows or skipped / (len(rows) + skipped) > 0.01:
        raise ValueError("Register is empty or has too many invalid stations")
    return rows, {"bnetzaDataDate": data_date.isoformat(), "registerRows": len(rows),
                  "invalidRows": skipped, "registerSha256": hashlib.sha256(content).hexdigest()}


def fetch_register():
    links = DownloadLinks()
    links.feed(download(SOURCE_PAGE).decode("utf-8"))
    urls = sorted(set(links.links))
    if len(urls) != 1:
        raise ValueError("Expected exactly one official BNetzA CSV download")
    content = download(urls[0])
    rows, metadata = parse_csv(content)
    metadata.update({"retrievedAt": datetime.now(timezone.utc).isoformat(),
                     "registerSourceUrl": urls[0], "registerSourceMode": "public_csv"})
    return content, rows, metadata
