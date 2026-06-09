"""Validiert die synthetischen Netzkanten gegen reale BASt-Dauerzählstellen.

Quelle: BASt, Automatische Zählstellen, Jahresauswertung (Jawe).
CSV vorher herunterladen, z. B.:

  curl -s "https://www.bast.de/DE/Themen/Digitales/HF_1/Massnahmen/verkehrszaehlung/Daten/2023_1/Jawe2023.csv?view=renderTcDataExportCSV" \
    -o data/external/bast_jawe2023.csv

Vergleicht den Schwerverkehrs-DTV (DTV_SV_MobisSo_Q) der Autobahn-Zählstellen
mit dem synthetischen Lkw-Fluss 2019 der nächstgelegenen Netzkante und schreibt
das Ergebnis nach data/external/bast-validation.json. Der Build-Generator
bettet die Datei, falls vorhanden, in die App-JSON ein.
"""

from __future__ import annotations

import csv
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
ZIP_PATH = ROOT / "data" / "raw" / "mendeley_py2zkrb65h_v2" / "py2zkrb65h-2.zip"
BAST_CSV = ROOT / "data" / "external" / "bast_jawe2023.csv"
OUT_PATH = ROOT / "data" / "external" / "bast-validation.json"
ZIP_PREFIX = "Synthetic European road freight transport flow dat/"

BAST_YEAR = 2023
MAX_MATCH_KM = 3.0
KM_PER_DEG_LAT = 111.32
REF_LAT = 51.0


def to_xy(lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return (
        lon * KM_PER_DEG_LAT * math.cos(math.radians(REF_LAT)),
        lat * KM_PER_DEG_LAT,
    )


def point_segment_distance(
    px: float, py: float, ax: np.ndarray, ay: np.ndarray, bx: np.ndarray, by: np.ndarray
) -> np.ndarray:
    dx, dy = bx - ax, by - ay
    seg_len_sq = dx * dx + dy * dy
    t = np.where(
        seg_len_sq > 0,
        np.clip(((px - ax) * dx + (py - ay) * dy) / np.where(seg_len_sq > 0, seg_len_sq, 1), 0, 1),
        0,
    )
    cx, cy = ax + t * dx, ay + t * dy
    return np.hypot(px - cx, py - cy)


def parse_german_float(value: str) -> float | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return float(value.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def main() -> None:
    if not BAST_CSV.exists():
        raise SystemExit(f"Missing BASt CSV: {BAST_CSV} (siehe Docstring)")
    if not ZIP_PATH.exists():
        raise SystemExit(f"Missing source ZIP: {ZIP_PATH}")

    with ZipFile(ZIP_PATH) as archive:
        nodes = pd.read_csv(archive.open(ZIP_PREFIX + "03_network-nodes.csv"))
        edges = pd.read_csv(archive.open(ZIP_PREFIX + "04_network-edges.csv"))

    node_lon = dict(zip(nodes["Network_Node_ID"], nodes["Network_Node_X"]))
    node_lat = dict(zip(nodes["Network_Node_ID"], nodes["Network_Node_Y"]))
    node_country = dict(zip(nodes["Network_Node_ID"], nodes["Country"]))

    edges["aCountry"] = edges["Network_Node_A_ID"].map(node_country)
    edges["bCountry"] = edges["Network_Node_B_ID"].map(node_country)
    de_edges = edges.query("aCountry == 'DE' and bCountry == 'DE'").copy()
    de_edges["aLon"] = de_edges["Network_Node_A_ID"].map(node_lon)
    de_edges["aLat"] = de_edges["Network_Node_A_ID"].map(node_lat)
    de_edges["bLon"] = de_edges["Network_Node_B_ID"].map(node_lon)
    de_edges["bLat"] = de_edges["Network_Node_B_ID"].map(node_lat)
    de_edges = de_edges.dropna(subset=["aLon", "aLat", "bLon", "bLat"])

    ax, ay = to_xy(de_edges["aLon"].to_numpy(), de_edges["aLat"].to_numpy())
    bx, by = to_xy(de_edges["bLon"].to_numpy(), de_edges["bLat"].to_numpy())
    edge_flow_2019 = de_edges["Traffic_flow_trucks_2019"].to_numpy()
    edge_ids = de_edges["Network_Edge_ID"].to_numpy()

    stations = []
    with open(BAST_CSV, encoding="latin-1") as f:
        for row in csv.DictReader(f, delimiter=";"):
            if row.get("Str_Kl") != "A":
                continue
            dtv_sv = parse_german_float(row.get("DTV_SV_MobisSo_Q"))
            lon = parse_german_float(row.get("Koor_WGS84_E"))
            lat = parse_german_float(row.get("Koor_WGS84_N"))
            if dtv_sv is None or not lon or not lat or dtv_sv <= 0:
                continue
            stations.append({"name": row.get("DZ_Name", ""), "lon": lon, "lat": lat, "dtvSv": dtv_sv})

    matched: dict[int, list[float]] = {}
    for station in stations:
        px, py = to_xy(np.array([station["lon"]]), np.array([station["lat"]]))
        dist = point_segment_distance(px[0], py[0], ax, ay, bx, by)
        best = int(np.argmin(dist))
        if dist[best] <= MAX_MATCH_KM and edge_flow_2019[best] > 0:
            matched.setdefault(int(edge_ids[best]), []).append(station["dtvSv"])

    if len(matched) < 30:
        raise SystemExit(f"Zu wenige Matches ({len(matched)}) — Schwelle/Daten prüfen.")

    edge_flow_by_id = dict(zip(edge_ids.tolist(), edge_flow_2019.tolist()))
    pairs = pd.DataFrame(
        {
            "syntheticDaily2019": [edge_flow_by_id[eid] / 365.0 for eid in matched],
            "bastDtvSv": [float(np.mean(values)) for values in matched.values()],
        }
    )
    spearman = float(pairs["syntheticDaily2019"].rank().corr(pairs["bastDtvSv"].rank()))
    pearson_log = float(
        np.log10(pairs["syntheticDaily2019"]).corr(np.log10(pairs["bastDtvSv"]))
    )

    result = {
        "source": f"BASt, Automatische Zählstellen, Jahresauswertung {BAST_YEAR}",
        "sourceUrl": (
            "https://www.bast.de/DE/Themen/Digitales/HF_1/Massnahmen/"
            "verkehrszaehlung/zaehl_node.html"
        ),
        "year": BAST_YEAR,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "stationCount": len(stations),
        "matchedEdges": len(matched),
        "maxMatchDistanceKm": MAX_MATCH_KM,
        "spearman": round(spearman, 3),
        "pearsonLog10": round(pearson_log, 3),
        "methodNote": (
            "Autobahn-Dauerzählstellen (Schwerverkehrs-DTV, Querschnitt) wurden der "
            "jeweils nächstgelegenen synthetischen Netzkante (max. "
            f"{MAX_MATCH_KM:g} km) zugeordnet und als Rangkorrelation gegen den "
            "synthetischen Lkw-Fluss 2019 verglichen. Schwerverkehr umfasst auch "
            "Busse; absolute Niveaus sind daher nicht direkt vergleichbar."
        ),
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
