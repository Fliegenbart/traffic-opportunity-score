"""Erzeugt die Lkw-Ladepark-Datei für die App aus zwei Quellen:

1. BNetzA-Ladesäulenregister (data/external/bnetza_ladesaeulen.csv, vorher laden:
   automatisch laden: python3 scripts/refresh_truck_charging_de.py).
   Daraus werden als "verifiziert" übernommen:
   - alle Einrichtungen von Milence Germany GmbH,
   - Daimler Truck AG ab 150 kW (TruckCharge),
   - E.ON Drive Infrastructure mit "MAN"-Standortbezeichnung ab 300 kW,
   - Einrichtungen mit expliziter Lkw-Erwähnung in Parkraum/Standortbezeichnung ab 150 kW.
   Außerdem als "Proxy"-Ebene: alle Einrichtungen ab 300 kW in Autobahnnähe
   (≤ 3 km zur synthetischen Netzkante) — Lkw-Tauglichkeit dort unbestätigt.

2. Handkuratierte Liste curated/truck-charging-de.json (Aral-pulse-MCS-Parks,
   angekündigte Standorte) mit Quelle und Prüfdatum je Eintrag.

Ausgabe: client/public/data/truck-charging-de.json
"""

from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import argparse
import os
import tempfile

from bnetza_register import parse_csv

ROOT = Path(__file__).resolve().parents[1]
BNETZA_CSV = ROOT / "data" / "external" / "bnetza_ladesaeulen.csv"
CURATED_JSON = ROOT / "curated" / "truck-charging-de.json"
OUT_PATH = ROOT / "client" / "public" / "data" / "truck-charging-de.json"

NETWORK_PATH = ROOT / "curated" / "charging-network-segments-de.json"
PROXY_MIN_KW = 300
VERIFIED_MIN_KW = 150
AUTOBAHN_MAX_KM = 3.0
HUB_MERGE_KM = 0.5
CURATED_DEDUP_KM = 2.0
KM_PER_DEG_LAT = 111.32
REF_LAT = 51.0

LKW_PATTERN = re.compile(r"lkw|truck|sattelzug", re.IGNORECASE)


def to_xy(lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return (
        lon * KM_PER_DEG_LAT * math.cos(math.radians(REF_LAT)),
        lat * KM_PER_DEG_LAT,
    )


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    dx = (lon2 - lon1) * KM_PER_DEG_LAT * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat2 - lat1) * KM_PER_DEG_LAT
    return math.hypot(dx, dy)


def classify_verified(row: dict) -> str | None:
    """Liefert das Operator-Label, wenn die Einrichtung als Lkw-tauglich gilt."""
    operator = row["operator"]
    if operator == "Milence Germany GmbH":
        return "Milence"
    if operator == "Daimler Truck AG" and row["kw"] >= VERIFIED_MIN_KW:
        return "Daimler TruckCharge"
    if (
        operator == "E.ON Drive Infrastructure GmbH"
        and "MAN" in row["siteLabel"]
        and row["kw"] >= 300
    ):
        return "E.ON Drive / MAN"
    if row["kw"] >= VERIFIED_MIN_KW and (
        LKW_PATTERN.search(row["parking"]) or LKW_PATTERN.search(row["siteLabel"])
    ):
        return operator or "unbekannt"
    return None


def cluster_hubs(rows: list[dict]) -> list[dict]:
    """Fasst Einzeleinrichtungen am selben Standort zu einem Hub zusammen."""
    hubs: list[dict] = []
    for row in rows:
        merged = False
        for hub in hubs:
            if (
                hub["operatorLabel"] == row["operatorLabel"]
                and haversine_km(hub["lon"], hub["lat"], row["lon"], row["lat"]) <= HUB_MERGE_KM
            ):
                hub["chargePoints"] += row["points"]
                hub["maxKw"] = max(hub["maxKw"], row["kw"])
                merged = True
                break
        if not merged:
            hubs.append(
                {
                    "operatorLabel": row["operatorLabel"],
                    "ort": row["ort"],
                    "lon": row["lon"],
                    "lat": row["lat"],
                    "chargePoints": row["points"],
                    "maxKw": row["kw"],
                }
            )
    return hubs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", type=Path, default=BNETZA_CSV)
    parser.add_argument("--output", type=Path, default=OUT_PATH)
    parser.add_argument("--import-metadata", type=Path)
    args = parser.parse_args()
    if not args.csv.exists():
        raise SystemExit(f"Missing BNetzA CSV: {args.csv} (siehe Docstring)")
    if not CURATED_JSON.exists():
        raise SystemExit(f"Missing curated list: {CURATED_JSON}")

    register, register_metadata = parse_csv(args.csv.read_bytes())
    if args.import_metadata:
        imported = json.loads(args.import_metadata.read_text())
        if imported["registerSha256"] != register_metadata["registerSha256"]:
            raise ValueError("Register hash differs from import metadata")
        register_metadata.update(imported)
    active = [r for r in register if r["status"].lower() == "in betrieb"]
    print(f"Register: {len(register)} Einrichtungen, davon in Betrieb: {len(active)}")

    verified_rows = []
    for row in active:
        label = classify_verified(row)
        if label:
            verified_rows.append({**row, "operatorLabel": label})
    register_hubs = cluster_hubs(verified_rows)
    print(f"Verifizierte Register-Hubs: {len(register_hubs)}")

    verified = [
        {
            "id": f"reg-{index}",
            "name": f"{hub['operatorLabel']} {hub['ort']}".strip(),
            "operator": hub["operatorLabel"],
            "type": "mcs" if hub["maxKw"] >= 1000 else "hpc",
            "status": "live",
            "lon": round(hub["lon"], 6),
            "lat": round(hub["lat"], 6),
            "chargePoints": hub["chargePoints"],
            "maxKw": round(hub["maxKw"]),
            "source": "BNetzA-Ladesäulenregister",
            "coordsApprox": False,
        }
        for index, hub in enumerate(register_hubs)
    ]

    curated = json.loads(CURATED_JSON.read_text(encoding="utf-8"))["entries"]
    added, skipped = 0, 0
    for index, entry in enumerate(curated):
        duplicate = any(
            haversine_km(entry["lon"], entry["lat"], hub["lon"], hub["lat"])
            <= CURATED_DEDUP_KM
            for hub in verified
        )
        if entry["status"] == "live" and duplicate:
            skipped += 1
            continue
        verified.append(
            {
                "id": f"cur-{index}",
                "name": entry["name"],
                "operator": entry["operator"],
                "type": entry["type"],
                "status": entry["status"],
                "lon": entry["lon"],
                "lat": entry["lat"],
                "chargePoints": entry.get("chargePoints", 0),
                "maxKw": entry.get("maxKw", 0),
                "source": entry["source"],
                "coordsApprox": bool(entry.get("coordsApprox")),
                "checkedAt": entry["checkedAt"],
            }
        )
        added += 1
    print(f"Kuratiert übernommen: {added}, als Dublette übersprungen: {skipped}")

    # Proxy-Ebene: Hochleistungslader in Autobahnnähe (Lkw-Tauglichkeit unbestätigt).
    network = json.loads(NETWORK_PATH.read_text())
    segments = np.asarray(network["segments"], dtype=float)
    if segments.ndim != 2 or segments.shape[1] != 4 or not np.isfinite(segments).all():
        raise ValueError("Invalid frozen model network")
    ax, ay = to_xy(segments[:, 0], segments[:, 1])
    bx, by = to_xy(segments[:, 2], segments[:, 3])
    dx, dy = bx - ax, by - ay
    seg_len_sq = np.where(dx * dx + dy * dy > 0, dx * dx + dy * dy, 1)

    def near_autobahn(lon: float, lat: float) -> bool:
        px, py = to_xy(np.array([lon]), np.array([lat]))
        t = np.clip(((px[0] - ax) * dx + (py[0] - ay) * dy) / seg_len_sq, 0, 1)
        dist = np.hypot(px[0] - (ax + t * dx), py[0] - (ay + t * dy))
        return bool(dist.min() <= AUTOBAHN_MAX_KM)

    proxy_candidates = [
        r
        for r in active
        if r["kw"] >= PROXY_MIN_KW
        and not any(
            haversine_km(r["lon"], r["lat"], hub["lon"], hub["lat"]) <= 1.5
            for hub in verified
        )
    ]
    proxy_near = [r for r in proxy_candidates if near_autobahn(r["lon"], r["lat"])]
    print(f"Proxy-Kandidaten >= {PROXY_MIN_KW} kW: {len(proxy_candidates)}, in Autobahnnähe: {len(proxy_near)}")

    grid: dict[tuple[float, float], dict] = defaultdict(
        lambda: {"count": 0, "maxKw": 0.0, "lonSum": 0.0, "latSum": 0.0}
    )
    for r in proxy_near:
        key = (round(r["lon"], 2), round(r["lat"], 2))
        cell = grid[key]
        cell["count"] += r["points"]
        cell["maxKw"] = max(cell["maxKw"], r["kw"])
        cell["lonSum"] += r["lon"]
        cell["latSum"] += r["lat"]
        cell.setdefault("sites", 0)
        cell["sites"] += 1
    proxy = [
        {
            "lon": round(cell["lonSum"] / cell["sites"], 4),
            "lat": round(cell["latSum"] / cell["sites"], 4),
            "chargePoints": cell["count"],
            "maxKw": round(cell["maxKw"]),
        }
        for cell in grid.values()
    ]

    payload = {
        "schemaVersion": 1,
        "metadata": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            **register_metadata,
            "curatedCheckedAt": sorted(set(e["checkedAt"] for e in curated)),
            "sources": [
                "BNetzA-Ladesäulenregister (Stand " + register_metadata["bnetzaDataDate"] + ")",
                "Betreiber-Pressemitteilungen (Milence, Aral pulse, E.ON/MAN) — siehe curated/truck-charging-de.json",
            ],
            "methodNote": (
                "Verifiziert = Betreiber mit dediziertem Lkw-Ladenetz oder explizite "
                "Lkw-Kennzeichnung im Register bzw. belegte Pressemitteilung. "
                "Proxy = Schnelllader ab 300 kW in Autobahnnähe; ob ein Sattelzug "
                "dort rangieren kann, ist nicht bestätigt."
            ),
        },
        "verified": sorted(verified, key=lambda hub: (-int(hub["status"] == "live"), -hub["maxKw"])),
        "proxy": proxy,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.output.parent,
                                     delete=False) as tmp:
        json.dump(payload, tmp, indent=2, ensure_ascii=False)
        tmp_path = tmp.name
    os.replace(tmp_path, args.output)
    live = sum(1 for hub in verified if hub["status"] == "live")
    announced = len(verified) - live
    print(f"Wrote {args.output}")
    print(f"Verifizierte Hubs: {live} in Betrieb, {announced} angekündigt")
    print(f"Proxy-Cluster: {len(proxy)}")


if __name__ == "__main__":
    main()
