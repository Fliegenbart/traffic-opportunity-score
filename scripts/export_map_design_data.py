"""Exportiert alle Karten-Ebenen mit echten, vorprojizierten Koordinaten als
ein JSON für Design-Tools (Begleiter zu design/briefing-animated-map.md).

Projektion identisch zu client/src/components/traffic-map.tsx.
"""

from __future__ import annotations

import json
import math
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "client" / "public" / "data"
OUT = ROOT / "design" / "map-data.json"

MIN_LON, MAX_LON = 5.4, 15.6
MIN_LAT, MAX_LAT = 47.0, 55.3
LON_SCALE = math.cos(math.radians(51))
SCALE = 46
WIDTH = round((MAX_LON - MIN_LON) * LON_SCALE * SCALE, 1)
HEIGHT = round((MAX_LAT - MIN_LAT) * SCALE, 1)
WHITE_SPOT_KM = 25
KM_PER_DEG_LAT = 111.32

ANCHOR_CITIES = [
    ("HAMBURG", 9.99, 53.55),
    ("BERLIN", 13.4, 52.52),
    ("KÖLN", 6.96, 50.94),
    ("FRANKFURT", 8.68, 50.11),
    ("MÜNCHEN", 11.58, 48.14),
    ("LEIPZIG", 12.37, 51.34),
]


def project(lon: float, lat: float) -> list[float]:
    return [
        round((lon - MIN_LON) * LON_SCALE * SCALE, 1),
        round((MAX_LAT - lat) * SCALE, 1),
    ]


def dist_km(lon1, lat1, lon2, lat2) -> float:
    dx = (lon2 - lon1) * KM_PER_DEG_LAT * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat2 - lat1) * KM_PER_DEG_LAT
    return math.hypot(dx, dy)


def main() -> None:
    traffic = json.loads((DATA / "traffic-opportunity-de.json").read_text(encoding="utf-8"))
    charging = json.loads((DATA / "truck-charging-de.json").read_text(encoding="utf-8"))
    outline_ts = (ROOT / "client" / "src" / "components" / "germany-outline.ts").read_text(
        encoding="utf-8"
    )
    germany_path = re.search(r'GERMANY_PATH = "([^"]+)"', outline_ts).group(1)

    live_hubs = [h for h in charging["verified"] if h["status"] == "live"]

    edges = []
    for edge in traffic["edgeHotspots"]:
        mid_lon = (edge["aLon"] + edge["bLon"]) / 2
        mid_lat = (edge["aLat"] + edge["bLat"]) / 2
        nearest = min(dist_km(mid_lon, mid_lat, h["lon"], h["lat"]) for h in live_hubs)
        label = (
            f"bei {edge['aLabel']}"
            if edge["aLabel"] == edge["bLabel"]
            else f"{edge['aLabel']} – {edge['bLabel']}"
        )
        edges.append(
            {
                "label": label,
                "a": project(edge["aLon"], edge["aLat"]),
                "b": project(edge["bLon"], edge["bLat"]),
                "trucksPerDay": round(edge["trucks2030"] / 365),
                "whiteSpot": nearest > WHITE_SPOT_KM,
            }
        )

    chargers = [
        {
            "name": h["name"],
            "xy": project(h["lon"], h["lat"]),
            "type": h["type"],
            "status": h["status"],
        }
        for h in charging["verified"]
    ]

    backdrop = [project(lon, lat) for lon, lat in traffic["backdrop"]]

    # Echte Beispielroute (Hamburg -> Köln) via OSRM für die Zeichnen-Animation.
    regions = {r["id"]: r for r in traffic["regions"]}
    hh, k = regions["107060000"], regions["107100203"]
    sample_route = None
    try:
        url = (
            "https://router.project-osrm.org/route/v1/driving/"
            f"{hh['lon']},{hh['lat']};{k['lon']},{k['lat']}"
            "?overview=simplified&geometries=geojson"
        )
        with urllib.request.urlopen(url, timeout=30) as response:
            osrm = json.loads(response.read())
        route = osrm["routes"][0]
        sample_route = {
            "label": "Hamburg – Köln (OSRM)",
            "km": round(route["distance"] / 1000),
            "path": [project(lon, lat) for lon, lat in route["geometry"]["coordinates"]],
        }
    except Exception as error:  # noqa: BLE001 - Export funktioniert auch ohne Route
        print(f"OSRM nicht erreichbar, Beispielroute übersprungen: {error}")

    payload = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "viewBox": f"0 0 {WIDTH} {HEIGHT}",
            "note": (
                "Alle Koordinaten vorprojiziert (equirektangular, lon 5.4–15.6, "
                "lat 47–55.3). Begleitdokument: briefing-animated-map.md"
            ),
            "colors": {
                "background": "#141519",
                "land": "#1b1e24",
                "landBorder": "rgba(255,255,255,0.14)",
                "texture": "#2b2f36",
                "traffic": "#19c8d4",
                "opportunity": "#e8a13a",
                "charger": "#a78bfa",
                "cityLabel": "rgba(255,255,255,0.32)",
            },
        },
        "germanyPath": germany_path,
        "backdrop": backdrop,
        "edges": edges,
        "chargers": chargers,
        "cities": [{"name": n, "xy": project(lon, lat)} for n, lon, lat in ANCHOR_CITIES],
        "sampleRoute": sample_route,
    }

    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    white = sum(1 for e in edges if e["whiteSpot"])
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
    print(
        f"Ebenen: {len(edges)} Strecken ({white} amber), {len(chargers)} Ladeparks, "
        f"{len(backdrop)} Textur-Punkte, Route: {'ja' if sample_route else 'nein'}"
    )


if __name__ == "__main__":
    main()
