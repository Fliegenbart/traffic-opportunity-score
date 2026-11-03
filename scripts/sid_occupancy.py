"""Toll Collect truck parking information service (SID): parse DATEX II v2 and build occupancy profiles.

Only site attributes and occupancy are kept; operator contact details in the static feed are never read.
"""
from __future__ import annotations

import csv
import hashlib
import json
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

NS = {"d": "http://datex2.eu/schema/2/2_0"}
BERLIN = ZoneInfo("Europe/Berlin")
WINDOW_DAYS = 56
NIGHT_HOURS = frozenset([20, 21, 22, 23, 0, 1, 2, 3, 4, 5])
MIN_SITES = 1000
STALE_AFTER = timedelta(hours=2)
SAMPLE_FIELDS = ("time", "id", "occupancy", "vehicles")

SOURCE = {
    "title": "Toll Collect GmbH – Lkw-Stellplatzinformationsdienst (SID) über die Mobilithek",
    "url": "https://mobilithek.info/offers/961256297668182016",
    "license": "Nutzungsbedingungen SID (Toll Collect), kommerzielle Nutzung mit Quellenangabe erlaubt",
    "attribution": "Toll Collect GmbH, Lkw-Stellplatzinformationsdienst",
    "notice": "Belegung aus Mautdaten abgeleitet bzw. modellbasiert; Werte sind Näherungen und können ungenau sein.",
}


def _float(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def parse_static(xml: bytes) -> dict[str, dict]:
    sites = {}
    for record in ET.fromstring(xml).iterfind(".//d:parkingRecord", NS):
        ident = record.get("id")
        lat = _float(record.findtext("d:parkingLocation//d:latitude", namespaces=NS))
        lon = _float(record.findtext("d:parkingLocation//d:longitude", namespaces=NS))
        if not ident or lat is None or lon is None:
            continue
        spaces = _float(record.findtext("d:parkingNumberOfSpaces", namespaces=NS))
        sites[ident] = {
            "id": ident,
            "name": (record.findtext("d:parkingName//d:value", namespaces=NS) or "").strip(),
            "lat": round(lat, 5), "lon": round(lon, 5),
            "spaces": int(spaces) if spaces is not None else None,
            "road": record.findtext(".//d:primaryRoad/d:roadIdentifier", namespaces=NS),
            "detection": record.findtext("d:parkingOccupanyDetectionType", namespaces=NS),
        }
    return sites


def parse_dynamic(xml: bytes, now: datetime) -> list[dict]:
    """Current occupancy per site; closed, unknown and stale records are dropped."""
    rows = []
    for status in ET.fromstring(xml).iterfind(".//d:parkingRecordStatus", NS):
        ref = status.find("d:parkingRecordReference", NS)
        origin = status.findtext("d:parkingStatusOriginTime", namespaces=NS)
        occupancy = _float(status.findtext("d:parkingOccupancy/d:parkingOccupancy", namespaces=NS))
        if ref is None or origin is None or occupancy is None:
            continue
        if status.findtext("d:parkingSiteOpeningStatus", namespaces=NS) not in (None, "open"):
            continue
        if now - datetime.fromisoformat(origin) > STALE_AFTER:
            continue
        vehicles = _float(status.findtext("d:parkingOccupancy/d:parkingNumberOfVehicles", namespaces=NS))
        rows.append({"id": ref.get("id"), "occupancy": round(min(max(occupancy, 0.0), 100.0)),
                     "vehicles": int(vehicles) if vehicles is not None else ""})
    return rows


def append_samples(directory: Path, rows: list[dict], now: datetime) -> Path:
    """One CSV per UTC day; time is HHMM UTC so the file stays small and diff-friendly."""
    path = directory / f"{now:%Y-%m-%d}.csv"
    directory.mkdir(parents=True, exist_ok=True)
    new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as out:
        writer = csv.DictWriter(out, fieldnames=SAMPLE_FIELDS)
        if new:
            writer.writeheader()
        for row in rows:
            writer.writerow({"time": f"{now:%H%M}", **row})
    return path


def read_samples(directory: Path, today: datetime, window_days: int = WINDOW_DAYS):
    """Yield (local datetime, id, occupancy, vehicles) for the last window_days UTC days."""
    first = (today - timedelta(days=window_days)).date()
    for path in sorted(directory.glob("*.csv")):
        try:
            day = datetime.strptime(path.stem, "%Y-%m-%d").date()
        except ValueError:
            continue
        if day < first or day > today.date():
            continue
        with path.open(newline="", encoding="utf-8") as src:
            for row in csv.DictReader(src):
                stamp = datetime(day.year, day.month, day.day, int(row["time"][:2]), int(row["time"][2:]), tzinfo=timezone.utc)
                yield stamp.astimezone(BERLIN), row["id"], int(row["occupancy"]), int(row["vehicles"]) if row["vehicles"] else None


def build_profiles(samples, sites: dict[str, dict]) -> tuple[list[dict], dict]:
    """Mean occupancy per local hour for weekdays (Mo–Fr) and weekends, plus night and overall means."""
    acc = defaultdict(lambda: {"wd": [[0, 0] for _ in range(24)], "we": [[0, 0] for _ in range(24)],
                               "night": [0, 0], "veh": [0, 0], "full": 0, "n": 0})
    days, sample_times = set(), set()
    for local, ident, occupancy, vehicles in samples:
        if ident not in sites:
            continue
        a = acc[ident]
        bucket = a["we" if local.weekday() >= 5 else "wd"][local.hour]
        bucket[0] += occupancy; bucket[1] += 1
        if local.hour in NIGHT_HOURS:
            a["night"][0] += occupancy; a["night"][1] += 1
        if vehicles is not None:
            a["veh"][0] += vehicles; a["veh"][1] += 1
        a["full"] += occupancy >= 95
        a["n"] += 1
        days.add(local.date()); sample_times.add(local.replace(second=0, microsecond=0))
    mean = lambda s: round(s[0] / s[1]) if s[1] else None  # noqa: E731
    profiles = []
    for ident in sorted(acc):
        a, site = acc[ident], sites[ident]
        profiles.append({
            "id": ident, "name": site["name"], "lat": site["lat"], "lon": site["lon"], "spaces": site["spaces"],
            "detection": site["detection"], "samples": a["n"],
            "nightOccupancy": mean(a["night"]), "meanVehicles": round(a["veh"][0] / a["veh"][1], 1) if a["veh"][1] else None,
            "fullShare": round(a["full"] / a["n"], 3),
            "weekday": [mean(b) for b in a["wd"]], "weekend": [mean(b) for b in a["we"]],
        })
    coverage = {"days": len(days), "samples": len(sample_times),
                "from": min(days).isoformat() if days else None, "to": max(days).isoformat() if days else None}
    return profiles, coverage


def cell_key(lat: float, lon: float) -> str:
    """1° tiles so the client only loads the few tiles around a site."""
    return f"{int(lat // 1)}_{int(lon // 1)}"


def build_document(profiles, coverage, sites, now: datetime) -> tuple[dict, dict[str, list]]:
    """Return (index, tiles). The index carries metadata; each tile holds the compact profiles in it."""
    payload = json.dumps(profiles, sort_keys=True, ensure_ascii=False).encode()
    tiles: dict[str, list] = defaultdict(list)
    for p in profiles:
        tiles[cell_key(p["lat"], p["lon"])].append({
            "id": p["id"], "name": p["name"], "lat": p["lat"], "lon": p["lon"], "spaces": p["spaces"],
            "night": p["nightOccupancy"], "full": round(p["fullShare"] * 100), "veh": p["meanVehicles"],
            "wd": p["weekday"], "we": p["weekend"]})
    index = {
        "schemaVersion": 2,
        "metadata": {"generatedAt": now.isoformat(timespec="seconds"), "source": SOURCE, "siteCount": len(sites),
                     "profiledSites": len(profiles), "coverage": coverage, "windowDays": WINDOW_DAYS,
                     "nightHours": "20–6 Uhr", "sha256": hashlib.sha256(payload).hexdigest()},
        "tiles": sorted(tiles),
    }
    return index, dict(tiles)


def check_quality(sites: dict, profiles: list, previous: dict | None) -> None:
    if len(sites) < MIN_SITES:
        raise SystemExit(f"Static SID feed has only {len(sites)} sites (< {MIN_SITES}); keeping previous snapshot")
    if not profiles:
        raise SystemExit("No occupancy samples in window; keeping previous snapshot")
    if previous and len(profiles) < 0.7 * previous["metadata"]["profiledSites"]:
        raise SystemExit(f"Profiled sites dropped from {previous['metadata']['profiledSites']} to {len(profiles)}")
