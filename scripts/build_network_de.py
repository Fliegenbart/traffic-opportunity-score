"""Exportiert das deutsche Fernstraßen-Netz (verbundene Kanten) als vorprojizierte,
nach Verkehrsstärke gebucketete Adern für die Karte.

Quelle: Mendeley/ETISplus 04_network-edges + 03_network-nodes (lokale ZIP).
Ausgabe: client/public/data/network-de.json — Bühne für die Hotspot-Hotspots.
Projektion identisch zu client/src/components/traffic-map.tsx.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from zipfile import ZipFile

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
ZIP_PATH = ROOT / "data" / "raw" / "mendeley_py2zkrb65h_v2" / "py2zkrb65h-2.zip"
OUT = ROOT / "client" / "public" / "data" / "network-de.json"
PREFIX = "Synthetic European road freight transport flow dat/"

MIN_LON, MAX_LON = 5.4, 15.6
MIN_LAT, MAX_LAT = 47.0, 55.3
LON_SCALE = math.cos(math.radians(51))
SCALE = 46

# Untergrenze: schwache Stichstraßen weglassen, Autobahn-/Bundesstraßennetz behalten.
MIN_TRUCKS = 800_000
# Verkehrs-Buckets (Anteil am Maximum) → je Bucket ein Sammelpfad mit eigener
# Strichbreite/Helligkeit. Reihenfolge dünn→dick = Zeichenreihenfolge.
BUCKETS = [
    {"id": "faint", "min": 0.00, "width": 0.35, "opacity": 0.16},
    {"id": "low", "min": 0.08, "width": 0.55, "opacity": 0.28},
    {"id": "mid", "min": 0.20, "width": 0.85, "opacity": 0.45},
    {"id": "high", "min": 0.42, "width": 1.3, "opacity": 0.7},
    {"id": "trunk", "min": 0.68, "width": 1.9, "opacity": 0.95},
]


def project(lon: float, lat: float) -> tuple[float, float]:
    return (
        round((lon - MIN_LON) * LON_SCALE * SCALE, 1),
        round((MAX_LAT - lat) * SCALE, 1),
    )


def main() -> None:
    with ZipFile(ZIP_PATH) as z:
        nodes = pd.read_csv(z.open(PREFIX + "03_network-nodes.csv"))
        edges = pd.read_csv(z.open(PREFIX + "04_network-edges.csv"))

    country = dict(zip(nodes["Network_Node_ID"], nodes["Country"]))
    nx = dict(zip(nodes["Network_Node_ID"], nodes["Network_Node_X"]))
    ny = dict(zip(nodes["Network_Node_ID"], nodes["Network_Node_Y"]))

    edges["aC"] = edges["Network_Node_A_ID"].map(country)
    edges["bC"] = edges["Network_Node_B_ID"].map(country)
    de = edges[(edges["aC"] == "DE") & (edges["bC"] == "DE")].copy()
    de = de[de["Traffic_flow_trucks_2030"] >= MIN_TRUCKS]

    max_t = float(de["Traffic_flow_trucks_2030"].max())
    bucket_segments: dict[str, list[str]] = {b["id"]: [] for b in BUCKETS}

    for row in de.itertuples(index=False):
        a, b = row.Network_Node_A_ID, row.Network_Node_B_ID
        if a not in nx or b not in nx:
            continue
        ax, ay = project(nx[a], ny[a])
        bx, by = project(nx[b], ny[b])
        ratio = float(row.Traffic_flow_trucks_2030) / max_t
        bucket = BUCKETS[0]["id"]
        for b_def in BUCKETS:
            if ratio >= b_def["min"]:
                bucket = b_def["id"]
        bucket_segments[bucket].append(f"M{ax} {ay}L{bx} {by}")

    layers = [
        {
            "id": b["id"],
            "width": b["width"],
            "opacity": b["opacity"],
            "d": "".join(bucket_segments[b["id"]]),
            "count": len(bucket_segments[b["id"]]),
        }
        for b in BUCKETS
    ]

    payload = {
        "schemaVersion": 1,
        "source": "Mendeley/ETISplus 04_network-edges (DE-DE, >= 0,8 Mio. Lkw 2030)",
        "viewBox": f"0 0 {round((MAX_LON-MIN_LON)*LON_SCALE*SCALE,1)} {round((MAX_LAT-MIN_LAT)*SCALE,1)}",
        "edgeCount": int(len(de)),
        "layers": layers,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
    for layer in layers:
        print(f"  {layer['id']}: {layer['count']} Kanten")


if __name__ == "__main__":
    main()
