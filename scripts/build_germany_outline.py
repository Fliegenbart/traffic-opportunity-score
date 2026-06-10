"""Konvertiert den Deutschland-Umriss (GeoJSON) in einen vorprojizierten SVG-Pfad
für die TrafficMap-Komponente.

Quelle: https://github.com/isellsoap/deutschlandGeoJSON (4_niedrig),
Geodaten © GeoBasis-DE / BKG, Lizenz dl-de/by-2-0.
Vorher laden:
  curl -sL -o data/external/deutschland.geo.json \
    https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/main/1_deutschland/4_niedrig.geo.json

Die Projektion muss exakt der in client/src/components/traffic-map.tsx entsprechen.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEOJSON = ROOT / "data" / "external" / "deutschland.geo.json"
OUT = ROOT / "client" / "src" / "components" / "germany-outline.ts"

MIN_LON = 5.4
MAX_LAT = 55.3
LON_SCALE = math.cos(math.radians(51))
SCALE = 46


def project(lon: float, lat: float) -> tuple[float, float]:
    return ((lon - MIN_LON) * LON_SCALE * SCALE, (MAX_LAT - lat) * SCALE)


def ring_to_path(ring: list[list[float]]) -> str:
    parts = []
    for index, (lon, lat) in enumerate(ring):
        x, y = project(lon, lat)
        parts.append(f"{'M' if index == 0 else 'L'}{x:.1f} {y:.1f}")
    return "".join(parts) + "Z"


def main() -> None:
    data = json.loads(GEOJSON.read_text(encoding="utf-8"))
    geometry = data["features"][0]["geometry"]
    polygons = (
        geometry["coordinates"]
        if geometry["type"] == "MultiPolygon"
        else [geometry["coordinates"]]
    )
    # Nur Außenringe; winzige Inseln (unter 4 Punkten) weglassen.
    paths = [ring_to_path(polygon[0]) for polygon in polygons if len(polygon[0]) >= 4]
    path = "".join(paths)

    OUT.write_text(
        "// Generiert von scripts/build_germany_outline.py — nicht von Hand editieren.\n"
        "// Quelle: deutschlandGeoJSON (4_niedrig), Geodaten © GeoBasis-DE / BKG (dl-de/by-2-0).\n"
        "// Koordinaten sind in der TrafficMap-Projektion vorprojiziert.\n"
        f'export const GERMANY_PATH = "{path}";\n',
        encoding="utf-8",
    )
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KB, {len(paths)} Polygone)")


if __name__ == "__main__":
    main()
