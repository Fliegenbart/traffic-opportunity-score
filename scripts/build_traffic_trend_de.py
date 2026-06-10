"""Verschmilzt die Chronos-Ergebnisse vom Server mit dem Stations-Mapping zur
Frontend-Datei client/public/data/traffic-trend-de.json.

Vorher vom Server holen:
  scp root@5.9.106.75:/opt/truckonomics-trend/out/trend_results.json data/external/
  scp root@5.9.106.75:/opt/truckonomics-trend/out/profiles.json data/external/
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXTERNAL = ROOT / "data" / "external"
OUT_PATH = ROOT / "client" / "public" / "data" / "traffic-trend-de.json"


def main() -> None:
    mapping = json.loads((EXTERNAL / "hotspot-bast-stations.json").read_text(encoding="utf-8"))
    trends = json.loads((EXTERNAL / "trend_results.json").read_text(encoding="utf-8"))
    profiles = json.loads((EXTERNAL / "profiles.json").read_text(encoding="utf-8"))
    directions_path = EXTERNAL / "directions.json"
    directions = (
        json.loads(directions_path.read_text(encoding="utf-8"))
        if directions_path.exists()
        else {}
    )

    edges: dict[str, dict] = {}
    for entry in mapping["mapping"]:
        station = entry.get("station")
        if not station:
            continue
        zst = str(int(station["zst"]))
        station_result = trends["stations"].get(zst, {})
        profile = profiles.get(zst)
        if not station_result and not profile:
            continue
        edges[str(entry["edgeId"])] = {
            "station": {
                "zst": zst,
                "name": station["name"],
                "strasse": station["strasse"],
                "distanceKm": entry["distanceKm"],
                "directionShareR1": directions.get(zst, {}).get("r1Share"),
            },
            "profile": profile,
            "trend": station_result.get("trend"),
            "backtest": station_result.get("backtest"),
        }

    payload = {
        "schemaVersion": 1,
        "metadata": {
            **trends["summary"],
            "source": "BASt-Dauerzählstellen, Stundenwerte (Lkw beide Richtungen), 2016–2023",
            "sourceUrl": "https://www.bast.de/DE/Themen/Digitales/HF_1/Massnahmen/verkehrszaehlung/Stundenwerte.html",
            "methodNote": (
                "Wochenreihen je Zählstelle (auf 168 h normalisiert), Forecast mit "
                "Amazon Chronos-2 (zero-shot, 52 Wochen, Quantile p10/p50/p90). "
                "Backtest: letztes Jahr zurückgehalten, Vergleich gegen "
                "Saisonal-Naiv (Vorjahreswoche). Trendband aus Quantilpfaden "
                "(Näherung). Tagesgang: Stundenmittel 2022–2023."
            ),
        },
        "edges": edges,
    }

    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    size_kb = OUT_PATH.stat().st_size / 1024
    with_trend = sum(1 for e in edges.values() if e.get("trend"))
    with_backtest = sum(1 for e in edges.values() if e.get("backtest"))
    print(f"Wrote {OUT_PATH} ({size_kb:.0f} KB)")
    print(f"Kanten mit Profil: {len(edges)}, mit Trend: {with_trend}, mit Backtest: {with_backtest}")


if __name__ == "__main__":
    main()
