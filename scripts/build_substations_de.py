"""Lädt Umspannwerke (>=110 kV) in Deutschland via Overpass API und schreibt
eine schlanke Punktliste als Netzanschluss-Proxy für den Standort-Check.

Quelle: OpenStreetMap (ODbL). Ausgabe: client/public/data/substations-de.json
"""

from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "client" / "public" / "data" / "substations-de.json"

QUERY = """
[out:json][timeout:300];
area["ISO3166-1"="DE"][admin_level=2]->.de;
(
  node["power"="substation"]["voltage"](area.de);
  way["power"="substation"]["voltage"](area.de);
);
out center tags;
"""

MIN_KV = 110


def max_kv(voltage: str) -> float:
    values = [float(v) for v in re.findall(r"\d+", voltage or "")]
    return max(values, default=0) / 1000


def main() -> None:
    request = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=QUERY.encode("utf-8"),
        headers={"User-Agent": "truckonomics-research/1.0 (mail@davidwegener.de)"},
    )
    with urllib.request.urlopen(request, timeout=320) as response:
        data = json.loads(response.read())

    points = []
    for element in data.get("elements", []):
        kv = max_kv(element.get("tags", {}).get("voltage", ""))
        if kv < MIN_KV:
            continue
        lat = element.get("lat") or element.get("center", {}).get("lat")
        lon = element.get("lon") or element.get("center", {}).get("lon")
        if lat is None or lon is None:
            continue
        points.append([round(lon, 4), round(lat, 4), round(kv)])

    payload = {
        "schemaVersion": 1,
        "metadata": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "source": "OpenStreetMap (power=substation, voltage >= 110 kV), ODbL",
            "note": (
                "Proxy für Netzanschluss-Nähe — Entfernung zum Umspannwerk ersetzt "
                "keine Netzanschluss-Prüfung beim Verteilnetzbetreiber."
            ),
            "minKv": MIN_KV,
        },
        "points": points,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB, {len(points)} Umspannwerke)")


if __name__ == "__main__":
    main()
