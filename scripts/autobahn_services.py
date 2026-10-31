"""Open Autobahn GmbH API (verkehr.autobahn.de): lorry parking and charging sites.

No authentication. The provider states no licence, so the output is marked
commercialUse "unknown". Parsers are strict about structure but tolerant about
missing optional values; unparseable items are counted, never guessed.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

BASE = "https://verkehr.autobahn.de/o/autobahn/"
ALLOWED_HOSTS = {"verkehr.autobahn.de"}
MAX_BYTES = 8 * 1024 * 1024
TIMEOUT = 30
DELAY = 0.2
RETRIES = 2
BBOX = (47.0, 56.0, 5.0, 16.0)  # lat min/max, lon min/max
SOURCE = {
    "title": "Autobahn GmbH des Bundes – Verkehrsinformationen (verkehr.autobahn.de)",
    "url": "https://verkehr.autobahn.de/",
    "license": "unklar – keine Lizenzangabe des Anbieters",
    "commercialUse": "unknown",
    "attribution": "Autobahn GmbH des Bundes",
}
ROAD_RE = re.compile(r"^A\d{1,3}[a-z]?$")


def fetch_json(url, sleep=time.sleep):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        raise ValueError(f"Host not allowed: {url}")
    request = Request(url, headers={"User-Agent": "Truckonomics-autobahn-import/1.0",
                                    "Accept": "application/json"})
    last = None
    for attempt in range(RETRIES + 1):
        try:
            with urlopen(request, timeout=TIMEOUT) as response:
                content = response.read(MAX_BYTES + 1)
            if len(content) > MAX_BYTES:
                raise ValueError("Autobahn response exceeds size limit")
            return json.loads(content.decode("utf-8"))
        except (OSError, ValueError) as error:  # URLError/HTTPError are OSError
            last = error
            if attempt < RETRIES:
                sleep(1.0 + attempt)
    raise last


def clean_roads(raw):
    """Strip entries, drop anything that is not an Autobahn designator, dedupe."""
    roads = set()
    for item in raw or []:
        text = str(item).strip()
        if ROAD_RE.match(text):
            roads.add(text)
    return sorted(roads, key=lambda r: (int(re.match(r"A(\d+)", r)[1]), r))


def _float(value):
    result = float(str(value).strip().replace(",", "."))
    if result != result or result in (float("inf"), float("-inf")):
        raise ValueError("Non-finite number")
    return result


def parse_coordinate(item):
    coord = item.get("coordinate") or {}
    lat, lon = _float(coord["lat"]), _float(coord["long"])
    if not (BBOX[0] <= lat <= BBOX[1] and BBOX[2] <= lon <= BBOX[3]):
        raise ValueError("Coordinate outside Germany")
    return round(lat, 5), round(lon, 5)


def _lines(item):
    return [str(line).strip() for line in (item.get("description") or [])]


def _int_after(lines, prefix):
    for line in lines:
        if line.startswith(prefix):
            match = re.search(r"\d+", line[len(prefix):])
            return int(match[0]) if match else None
    return None


def _flag(value):
    return str(value).strip().lower() == "true"


def parse_parking(item, road):
    ident = str(item["identifier"]).strip()
    if not ident:
        raise ValueError("Missing identifier")
    lat, lon = parse_coordinate(item)
    lines = _lines(item)
    features = []
    for icon in item.get("lorryParkingFeatureIcons") or []:
        text = str((icon or {}).get("description", "")).strip()
        if text and text not in features:
            features.append(text)
    return {"id": ident, "road": road,
            "name": str(item.get("subtitle") or "").strip() or str(item.get("title") or "").strip(),
            "lat": lat, "lon": lon,
            "truckSpaces": _int_after(lines, "LKW Stellplätze:"),
            "carSpaces": _int_after(lines, "PKW Stellplätze:"),
            "features": sorted(features), "blocked": _flag(item.get("isBlocked"))}


POWER_RE = re.compile(r"^(\d+(?:[.,]\d+)?)\s*(\+)?\s*kW$", re.I)
POINTS_RE = re.compile(r"^(\d+)\s+Ladepunkte?$")
POINT_HEAD_RE = re.compile(r"^Ladepunkt\s+\d+:$")
CONNECTOR_RE = re.compile(r"^(AC|DC)\s+(Kupplung|Steckdose)\b")


def parse_charging(item, road):
    ident = str(item["identifier"]).strip()
    if not ident:
        raise ValueError("Missing identifier")
    lat, lon = parse_coordinate(item)
    lines = _lines(item)
    points = sum(1 for line in lines if POINT_HEAD_RE.match(line))
    summary = next((POINTS_RE.match(line) for line in lines if POINTS_RE.match(line)), None)
    if summary:  # compact format: "4 Ladepunkte"
        points = int(summary[1])
    powers, minimum, connectors, operator = [], False, set(), None
    for line in lines:
        match = POWER_RE.match(line.replace(" ", " "))
        if match:
            powers.append(_float(match[1]))
            minimum = minimum or bool(match[2])
        elif CONNECTOR_RE.match(line):
            connectors.update(part.strip() for part in line.split(",") if part.strip())
        elif line.startswith("Ladesäulenbetreiber:"):
            operator = line.split(":", 1)[1].strip() or None
    title = str(item.get("title") or "").strip()
    name = title.split("|")[-1].strip() if "|" in title else title
    max_power = max(powers) if powers else None
    if max_power is not None and max_power == int(max_power):
        max_power = int(max_power)
    record = {"id": ident, "road": road, "name": name, "lat": lat, "lon": lon,
              "chargePoints": points or None, "maxPowerKw": max_power,
              "connectors": sorted(connectors), "operator": operator,
              "deutschlandnetz": any("Deutschlandnetz" in line for line in lines)}
    if minimum:
        record["powerIsMinimum"] = True
    return record


def collect(roads_raw, fetch=fetch_json, sleep=time.sleep):
    """Fetch every road; return (roads, parking, charging, stats). Dedupes by id."""
    roads = clean_roads(roads_raw)
    parking, charging = {}, {}
    stats = {"items": 0, "unparseable": 0, "requests": 0, "failedRequests": 0}
    for road in roads:
        for kind, parser, target in (("parking_lorry", parse_parking, parking),
                                     ("electric_charging_station", parse_charging, charging)):
            stats["requests"] += 1
            try:
                data = fetch(f"{BASE}{quote(road, safe='')}/services/{kind}")
                items = data.get(kind) or []
            except Exception:  # keep going; the quality gate judges the failure rate
                stats["failedRequests"] += 1
                items = []
            sleep(DELAY)
            for item in items:
                stats["items"] += 1
                try:
                    record = parser(item, road)
                except (KeyError, ValueError, TypeError, AttributeError):
                    stats["unparseable"] += 1
                    continue
                target.setdefault(record["id"], record)  # roads are sorted: first road wins
    key = lambda r: (r["road"], r["name"], r["id"])
    return (roads, sorted(parking.values(), key=key), sorted(charging.values(), key=key), stats)


def canonical_sha256(road_count, parking, charging):
    payload = json.dumps({"roadCount": road_count, "parking": parking, "charging": charging},
                         sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_document(roads, parking, charging, now=None):
    stamp = (now or datetime.now(timezone.utc)).replace(microsecond=0).isoformat()
    return {"schemaVersion": 1,
            "metadata": {"generatedAt": stamp, "retrievedAt": stamp, "source": dict(SOURCE),
                         "roadCount": len(roads), "parkingCount": len(parking),
                         "truckSpacesTotal": sum(p["truckSpaces"] or 0 for p in parking),
                         "chargingCount": len(charging),
                         "sha256": canonical_sha256(len(roads), parking, charging)},
            "parking": parking, "charging": charging}


def check_quality(document, stats, previous=None):
    meta = document["metadata"]
    if meta["roadCount"] < 50:
        raise ValueError(f"Only {meta['roadCount']} roads; keeping previous file")
    if meta["parkingCount"] < 500:
        raise ValueError(f"Only {meta['parkingCount']} parking sites; keeping previous file")
    total = stats["items"] + 0
    if total and stats["unparseable"] / total > 0.05:
        raise ValueError(f"{stats['unparseable']}/{total} items unparseable; keeping previous file")
    if stats["requests"] and stats["failedRequests"] / stats["requests"] > 0.05:
        raise ValueError(f"{stats['failedRequests']}/{stats['requests']} requests failed")
    if previous:
        old = previous.get("metadata", {})
        for key in ("parkingCount", "chargingCount"):
            if old.get(key) and meta[key] < old[key] * 0.8:
                raise ValueError(f"{key} dropped from {old[key]} to {meta[key]} (>20%)")
