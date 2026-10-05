"""Reproducible public reference snapshots; no partner data or provider credentials."""
from __future__ import annotations

import argparse
import calendar
import csv
import hashlib
import io
import json
import math
import re
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from statistics import mean
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
DWD = "https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/hourly/air_temperature/historical/"
SMARD = "https://www.smard.de/app/chart_data/4169/DE/"
ALLOWED = {"opendata.dwd.de", "www.smard.de", "www.renault-trucks.de", "group.dhl.com"}
DHL_NAMES = [
    "Hagen", "Börnicke", "Rüdersdorf", "Neumark", "Bruchsal", "Greven-Reckenfeld", "Kitzingen", "Regensburg",
    "Neumünster", "Nohra", "Osterweddingen", "Ottendorf-Okrilla", "Neustrelitz", "Neuwied", "Staufenberg", "Hamburg",
    "Bremen Hemelingen", "Lahr", "Radefeld", "Augsburg", "Dorsten", "Saulheim", "Köln", "Feucht", "Speyer", "Günzburg",
    "Köngen", "Eutingen", "Krefeld", "Hannover", "Rodgau", "Aschheim", "Bielefeld", "Obertshausen", "Bremen GVZ",
    "Bochum", "Ludwigsfelde", "Aschheim II",
]


def fetch(url, path):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED:
        raise ValueError("Unapproved public source")
    if path.exists():
        return path.read_bytes()
    with urlopen(Request(url, headers={"User-Agent": "TrafficOpportunity-reference-import/1.0"}), timeout=45) as response:
        if urlparse(response.url).hostname not in ALLOWED:
            raise ValueError("Unexpected source redirect")
        raw = response.read(32000001)
    if not raw or len(raw) > 32000000:
        raise ValueError("Source file empty or exceeds limit")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(raw)
    temporary.replace(path)
    return raw


def ref(title, url, source_id, observed, raw, captured=None):
    return {"id": source_id, "title": title, "url": url, "kind": "measured", "version": observed,
            "retrievedAt": (captured or datetime.now(timezone.utc)).isoformat(), "observedThrough": observed,
            "sha256": hashlib.sha256(raw).hexdigest(), "license": "CC-BY-4.0", "commercialUse": "allowed"}


def quantile(values, p):
    ordered = sorted(values)
    index = (len(ordered) - 1) * p
    a = math.floor(index)
    return ordered[a] + (ordered[min(a + 1, len(ordered) - 1)] - ordered[a]) * (index - a)


def summarize_prices(rows, year, minimum_coverage=0.99):
    values = {}
    for stamp, value in rows:
        if not isinstance(stamp, (int, float)) or not math.isfinite(stamp):
            raise ValueError("Invalid price timestamp")
        dt = datetime.fromtimestamp(stamp / 1000, timezone.utc)
        if dt.year != year:
            continue
        if dt.minute or dt.second or dt.microsecond:
            raise ValueError("Expected hourly prices")
        if value is None:
            continue
        if not isinstance(value, (int, float)) or not math.isfinite(value) or not -5000 <= value <= 5000:
            raise ValueError("Invalid market price")
        if stamp in values and values[stamp] != value:
            raise ValueError("Conflicting price duplicate")
        values[stamp] = value
    expected = (366 if calendar.isleap(year) else 365) * 24
    if not values or len(values) / expected < minimum_coverage:
        raise ValueError("Incomplete market reference year")
    prices = list(values.values())
    monthly = [{"month": m, "validHours": sum(datetime.fromtimestamp(t / 1000, timezone.utc).month == m for t in values),
                "meanEurMwh": mean([v for t, v in values.items() if datetime.fromtimestamp(t / 1000, timezone.utc).month == m])}
               for m in range(1, 13) if any(datetime.fromtimestamp(t / 1000, timezone.utc).month == m for t in values)]
    return {"year": year, "validHours": len(values), "expectedHours": expected, "coverage": len(values) / expected,
            "meanEurMwh": mean(prices), "p10EurMwh": quantile(prices, 0.1), "p90EurMwh": quantile(prices, 0.9),
            "negativeHours": sum(v < 0 for v in prices), "monthly": monthly}


def summarize_weather(handle, station_id, year, minimum_coverage=0.95):
    reader = csv.DictReader(handle, delimiter=";", skipinitialspace=True)
    if not {"STATIONS_ID", "MESS_DATUM", "QN_9", "TT_TU"} <= set(reader.fieldnames or []):
        raise ValueError("Missing DWD temperature fields")
    values, rejected = {}, 0
    for row in reader:
        try:
            if int(row["STATIONS_ID"]) != int(station_id):
                raise ValueError("Station mismatch")
            stamp = row["MESS_DATUM"].strip()
            dt = datetime.strptime(stamp, "%Y%m%d%H")
            if dt.year != year:
                continue
            temp, quality = float(row["TT_TU"]), int(row["QN_9"])
            if not math.isfinite(temp) or not -80 <= temp <= 60 or quality not in {3, 5, 7, 8, 9, 10}:
                rejected += 1
                continue
        except (ValueError, TypeError):
            rejected += 1
            continue
        if stamp in values and values[stamp] != temp:
            raise ValueError("Conflicting weather duplicate")
        values[stamp] = temp
    expected = (366 if calendar.isleap(year) else 365) * 24
    if not values or len(values) / expected < minimum_coverage:
        raise ValueError("Incomplete DWD reference year")
    temps = list(values.values())
    months = [{"month": m, "meanC": mean([v for t, v in values.items() if int(t[4:6]) == m]),
               "validHours": sum(int(t[4:6]) == m for t in values)}
              for m in range(1, 13) if any(int(t[4:6]) == m for t in values)]
    return {"year": year, "validHours": len(values), "expectedHours": expected, "coverage": len(values) / expected,
            "rejectedHours": rejected, "meanC": mean(temps), "p10C": quantile(temps, 0.1),
            "hoursBelowZero": sum(v < 0 for v in temps), "monthly": months}


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.hrefs.extend(value for key, value in attrs if key == "href" and value)


class FactTables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables, self.table, self.row, self.cell = [], None, None, None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            if self.table is not None:
                raise ValueError("Nested manufacturer tables require review")
            self.table = []
        elif tag == "tr" and self.table is not None:
            self.row = []
        elif tag in {"td", "th"} and self.row is not None:
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in {"td", "th"} and self.cell is not None:
            self.row.append(" ".join(" ".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def verify_vehicle_facts(html):
    parser = FactTables(); parser.feed(html); parser.close()
    headers = ["", *[f"Renault Trucks E-Tech T {variant}" for variant in [540, 585, 780]]]
    matches = [table for table in parser.tables if headers in table]
    if len(matches) != 1 or ["Achskonfiguration", "Sattelzugmaschine 4x2", "Sattelzugmaschine 6x2", "Sattelzugmaschine 6x2"] not in matches[0] \
            or ["Ladekapazität", "Bis zu 350 kW", "Bis zu 720 kW", "Bis zu 720 kW"] not in matches[0]:
        raise ValueError("Manufacturer facts changed or ambiguous; editorial review required")


def compare_months(first, second):
    later = {s["stationId"]: s for s in second}
    matches = []
    for a in first:
        b = later.get(a["stationId"])
        if not b or not a["usableAsCompleteProfile"] or not b["usableAsCompleteProfile"]:
            continue
        if any(a[key] != b[key] for key in ["vehicleClass", "roadClass", "road"]):
            continue
        km = math.hypot((a["location"]["lon"] - b["location"]["lon"]) * 111.32 * math.cos(math.radians(a["location"]["lat"])),
                        (a["location"]["lat"] - b["location"]["lat"]) * 111.32)
        if km > 0.1:
            continue
        matches.append({"stationId": a["stationId"], "vehicleClass": a["vehicleClass"],
                        "roadClass": a["roadClass"], "road": a["road"],
                        "first": {d: sum(v) for d, v in a["profiles"].items()},
                        "second": {d: sum(v) for d, v in b["profiles"].items()}})
    return matches


def build_bast_comparison():
    from planning_data import import_bast_archive
    folder = ROOT / "data/raw/bast"
    periods = []
    for month in [1, 7]:
        path = folder / f"DZ_2026_{month:02d}_Rohdaten.zip"
        result = import_bast_archive(path, f"2026-{month:02d}-01", f"2026-{month:02d}-31", folder / "license.ttl")
        result["source"]["retrievedAt"] = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
        periods.append(result)
        print(f"BASt {month}: {len(result['stations'])} stations", flush=True)
    return {"schemaVersion": 1, "firstPeriod": periods[0]["period"], "secondPeriod": periods[1]["period"],
            "sources": [p["source"] for p in periods], "stations": compare_months(periods[0]["stations"], periods[1]["stations"]),
            "method": "Januar/Juli 2026, dieselbe Stations-ID, Fahrzeugklasse und Straße; Koordinatenabweichung höchstens 100 m. Beide Profile vollständig nach BASt-Importregeln. Vergleich mittlerer Tagesprofile je Wochentagstyp, keine Jahressaisonalität, Feiertagsbereinigung oder automatische Änderung der Planung. Ungeprüfte Anbieter-Rohdaten."}


def build_catalogs():
    folder = ROOT / "data/raw/public-context/catalogs"
    vehicle_url = "https://www.renault-trucks.de/product/renault-trucks-e-tech-t-540-t-585-t-780"
    dhl_url = "https://group.dhl.com/de/presse/pressemitteilungen/2024/30-jahre-paketzentren.html"
    sources = []
    for name, url, title, observed in [("renault", vehicle_url, "Renault Trucks: E-Tech T, veröffentlichte Ladeleistungsobergrenzen", "2026-10-02"),
                                        ("dhl", dhl_url, "DHL: historische Paketzentrum-Referenzen aus der Mitteilung vom 24.05.2024", "2024-05-24")]:
        path = folder / f"{name}.html"
        if name == "renault":
            raw = fetch(url, path)
            verify_vehicle_facts(raw.decode("utf-8"))
            captured = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
        else:
            # Editorial facts were checked against the public page, not imported as an open dataset.
            raw = json.dumps(DHL_NAMES, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            captured = datetime(2026, 10, 2, tzinfo=timezone.utc)
        item = ref(title, url, f"{name}-public-facts-v1", observed, raw, captured)
        item.update({"kind": "assumption", "license": "Einzelne veröffentlichte Fakten; keine offene Datenlizenz", "commercialUse": "unknown"})
        sources.append(item)
    return {"schemaVersion": 1, "vehicles": [
        {"id": "renault-t540", "name": "Renault E-Tech T 540 · 4×2", "maxChargingKw": 350, "source": sources[0]},
        {"id": "renault-t585", "name": "Renault E-Tech T 585 · 6×2", "maxChargingKw": 720, "source": sources[0]},
        {"id": "renault-t780", "name": "Renault E-Tech T 780 · 6×2", "maxChargingKw": 720, "source": sources[0]},
    ], "dhl": {"source": sources[1], "names": DHL_NAMES}, "method": "Redaktionell übertragene Einzelangaben, keine vollständigen Herstellerdaten. Renault-Hash: abgerufene HTML-Seite. DHL-Hash: redaktionelle Namensliste (UTF-8 JSON), am 02.10.2026 gegen öffentliche Mitteilung geprüft; kein Rohseitenimport. Spitzenladeleistung ist keine Ladekurve oder garantierte Dauerleistung; Batterieinhalt, Anschlussstandard und konkrete Konfiguration nicht abgeleitet. Historische Standortnamen ohne bestätigte Adresse, Koordinaten, heutigen Betrieb, Flotten- oder Ladenachfrage. Kommerzielle Rechte vor produktiver Weiterverwendung prüfen."}


def build_prices(year):
    folder = ROOT / "data/raw/public-context/smard"
    index = json.loads(fetch(SMARD + "index_hour.json", folder / "index_hour.json"))
    stamps = sorted(set(index["timestamps"]))
    start, end = (int(datetime(y, 1, 1, tzinfo=timezone.utc).timestamp() * 1000) for y in [year, year + 1])
    selected = [t for i, t in enumerate(stamps) if t < end and (stamps[i + 1] if i + 1 < len(stamps) else t + 7 * 86400000) > start]
    rows, manifest = [], []
    for t in selected:
        name = f"4169_DE_hour_{t}.json"
        raw = fetch(SMARD + name, folder / name)
        payload = json.loads(raw)
        rows.extend(payload["series"])
        manifest.append({"url": SMARD + name, "sha256": hashlib.sha256(raw).hexdigest()})
    result = summarize_prices(rows, year)
    captured = datetime.fromtimestamp(max((folder / Path(item["url"]).name).stat().st_mtime for item in manifest), timezone.utc)
    result["source"] = ref("Bundesnetzagentur | SMARD: Großhandelspreise Deutschland/Luxemburg", "https://www.smard.de/en/downloadcenter/download-market-data", f"smard-de-lu-{year}", f"{year}-12-31", json.dumps(manifest, sort_keys=True).encode(), captured)
    result["method"] = "Ungewichtete Stundenmittel im UTC-Referenzjahr, EUR/MWh. Negative Preise bleiben erhalten. Kein ladelastgewichteter Bezugspreis, Standortvertrag oder Preisforecast. Snapshot nutzt die öffentliche Chart-Datenschnittstelle, keine zugesicherte API."
    result["manifest"] = manifest
    return result


def build_weather(year):
    folder = ROOT / "data/raw/public-context/dwd"
    listing = fetch(DWD, folder / "index.html")
    links = Links(); links.feed(listing.decode("utf-8"))
    archives = {}
    for name in links.hrefs:
        match = re.fullmatch(r"stundenwerte_TU_(\d{5})_(\d{8})_(\d{8})_hist\.zip", name)
        if match:
            station_id, start, end = match.groups()
            datetime.strptime(start, "%Y%m%d"); datetime.strptime(end, "%Y%m%d")
            if start <= f"{year}0101" and end >= f"{year}1231":
                archives.setdefault(station_id, []).append(name)
    stations_raw = fetch(DWD + "TU_Stundenwerte_Beschreibung_Stationen.txt", folder / "stations.txt")
    candidates = []
    for line in stations_raw.decode("latin-1").splitlines()[2:]:
        p = line.split(maxsplit=6)
        if len(p) != 7 or p[0] not in archives or len(archives[p[0]]) != 1:
            continue
        lat, lon, elevation = float(p[4]), float(p[5]), float(p[3])
        if not 5 <= lon <= 16 or not 47 <= lat <= 56 or not -100 <= elevation <= 600:
            continue
        candidates.append({"stationId": p[0], "name": p[6][:41].strip(), "lat": lat, "lon": lon, "elevationM": elevation})
    # One low-altitude station per degree cell, biased towards the cell centre rather than extrema.
    cells = {}
    for s in candidates:
        cell = (int(s["lat"]), int(s["lon"]))
        metric = (s["lat"] - cell[0] - 0.5) ** 2 + (s["lon"] - cell[1] - 0.5) ** 2
        if cell not in cells or metric < cells[cell][0]:
            cells[cell] = (metric, s)
    results, rejected = [], []
    for _, station in sorted(cells.values(), key=lambda x: x[1]["stationId"]):
        name = archives[station["stationId"]][0]
        raw = fetch(DWD + name, folder / name)
        try:
            with ZipFile(io.BytesIO(raw)) as archive:
                products = [n for n in archive.namelist() if Path(n).name.startswith("produkt_tu_stunde_") and n.endswith(".txt")]
                if len(products) != 1 or archive.getinfo(products[0]).file_size > 150000000:
                    raise ValueError("Ambiguous or excessive DWD product")
                with io.TextIOWrapper(archive.open(products[0]), encoding="latin-1") as handle:
                    summary = summarize_weather(handle, station["stationId"], year)
            captured = datetime.fromtimestamp((folder / name).stat().st_mtime, timezone.utc)
            results.append({**station, **summary, "source": ref(f"DWD: {station['name']} – stündliche Temperatur", DWD + name, f"dwd-{station['stationId']}-{year}", f"{year}-12-31", raw, captured)})
        except ValueError as error:
            rejected.append({"stationId": station["stationId"], "reason": str(error)})
        print(f"DWD {station['stationId']}: {len(results)} stations", flush=True)
    if not results:
        raise ValueError("No complete DWD stations")
    return {"year": year, "stations": results, "rejected": rejected,
            "method": "Historische, qualitätsgeprüfte Stundenwerte; QN 3/5/7/8/9/10, Sentinelwerte ausgeschlossen, mindestens 95 % Abdeckung. Räumliche Auswahl je 1°-Zelle unter 600 m. Standortübertragung höchstens 100 km; lokale Höhenunterschiede ungeprüft. Keine Verbrauchskalibrierung oder Wetterprognose."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=2025)
    parser.add_argument("--source", choices=["prices", "weather", "catalogs", "bast", "all"], default="all")
    args = parser.parse_args()
    if not 2020 <= args.year < datetime.now(timezone.utc).year:
        raise ValueError("A complete historical reference year is required")
    out = ROOT / "client/public/data/context"
    from planning_data import write_json
    if args.source in {"prices", "all"}:
        result = build_prices(args.year)
        write_json(out / "electricity-de.json", {"schemaVersion": 1, **result})
        print(f"SMARD: {result['validHours']} valid hours", flush=True)
    if args.source in {"weather", "all"}:
        result = build_weather(args.year)
        write_json(out / "weather-de.json", {"schemaVersion": 1, **result})
        print(f"DWD: {len(result['stations'])} stations, {len(result['rejected'])} rejected", flush=True)
    if args.source in {"catalogs", "all"}:
        write_json(out / "catalogs-de.json", build_catalogs())
    if args.source in {"bast", "all"}:
        result = build_bast_comparison()
        write_json(out / "traffic-months-de.json", result)
        print(f"BASt: {len(result['stations'])} comparable stations", flush=True)


if __name__ == "__main__":
    main()
