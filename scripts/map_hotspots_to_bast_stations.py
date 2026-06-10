"""Ordnet jeder Hotspot-Kante die nächstgelegene BASt-Autobahn-Dauerzählstelle zu.

Output: data/external/hotspot-bast-stations.json — Input für die
Chronos-Trend-Pipeline (Stundenwerte je Station von bast.de/videos/<jahr>_A_S.zip).
"""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRAFFIC_JSON = ROOT / "client" / "public" / "data" / "traffic-opportunity-de.json"
BAST_CSV = ROOT / "data" / "external" / "bast_jawe2023.csv"
OUT_PATH = ROOT / "data" / "external" / "hotspot-bast-stations.json"

MAX_KM = 5.0
KM_PER_DEG_LAT = 111.32


def dist_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    dx = (lon2 - lon1) * KM_PER_DEG_LAT * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat2 - lat1) * KM_PER_DEG_LAT
    return math.hypot(dx, dy)


def parse_german_float(value: str | None) -> float | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return float(value.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def main() -> None:
    traffic = json.loads(TRAFFIC_JSON.read_text(encoding="utf-8"))

    stations = []
    with open(BAST_CSV, encoding="latin-1") as f:
        for row in csv.DictReader(f, delimiter=";"):
            if row.get("Str_Kl") != "A":
                continue
            lon = parse_german_float(row.get("Koor_WGS84_E"))
            lat = parse_german_float(row.get("Koor_WGS84_N"))
            dtv_sv = parse_german_float(row.get("DTV_SV_MobisSo_Q"))
            if not lon or not lat or not dtv_sv:
                continue
            stations.append(
                {
                    "tknr": row["TK_Nr"].strip(),
                    "zst": row["DZ_Nr"].strip(),
                    "name": row["DZ_Name"].strip(),
                    "strasse": f"A {row.get('Str_Nr', '').strip()}",
                    "lon": lon,
                    "lat": lat,
                    "dtvSv2023": round(dtv_sv),
                }
            )

    mapping = []
    used_stations: dict[str, list[int]] = {}
    for edge in traffic["edgeHotspots"]:
        mid_lon = (edge["aLon"] + edge["bLon"]) / 2
        mid_lat = (edge["aLat"] + edge["bLat"]) / 2
        best, best_km = None, MAX_KM
        for station in stations:
            d = dist_km(mid_lon, mid_lat, station["lon"], station["lat"])
            if d < best_km:
                best, best_km = station, d
        if best is None:
            mapping.append({"edgeId": edge["edgeId"], "station": None})
            continue
        mapping.append(
            {
                "edgeId": edge["edgeId"],
                "edgeLabel": f"{edge['aLabel']} – {edge['bLabel']}",
                "distanceKm": round(best_km, 2),
                "station": best,
            }
        )
        used_stations.setdefault(best["zst"], []).append(edge["edgeId"])

    matched = [m for m in mapping if m["station"]]
    OUT_PATH.write_text(
        json.dumps(
            {"maxMatchKm": MAX_KM, "mapping": mapping},
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"Kanten gesamt: {len(mapping)}, gematcht: {len(matched)}")
    print(f"Eindeutige Stationen: {len(used_stations)}")
    for m in matched[:6]:
        s = m["station"]
        print(f"  {m['edgeLabel']}: Zst {s['zst']} ({s['name']}, {s['strasse']}), {m['distanceKm']} km")


if __name__ == "__main__":
    main()
