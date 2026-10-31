"""Fetch Autobahn lorry parking and charging sites, validate, replace snapshot atomically."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from autobahn_services import BASE, build_document, check_quality, collect, fetch_json

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "client/public/data/autobahn-services-de.json"


def merge_with_previous(document, previous):
    """Return (document, changed). Unchanged content keeps the old timestamps."""
    if previous and previous.get("metadata", {}).get("sha256") == document["metadata"]["sha256"]:
        return previous, False
    return document, True


def write_atomic(path, document):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as out:
        json.dump(document, out, ensure_ascii=False, separators=(",", ":"))
        out.write("\n")
        staged = out.name
    os.chmod(staged, 0o644)
    os.replace(staged, path)


def main(output=OUTPUT):
    previous = json.loads(output.read_text(encoding="utf-8")) if output.exists() else None
    roads, parking, charging, stats = collect(fetch_json(BASE).get("roads"))
    document = build_document(roads, parking, charging)
    check_quality(document, stats, previous)
    document, changed = merge_with_previous(document, previous)
    if not changed:
        print(f"Unchanged Autobahn snapshot ({document['metadata']['parkingCount']} parking, "
              f"{document['metadata']['chargingCount']} charging; daily check succeeded)")
        return
    write_atomic(output, document)
    meta = document["metadata"]
    print(f"Imported {meta['roadCount']} roads, {meta['parkingCount']} parking sites "
          f"({meta['truckSpacesTotal']} truck spaces), {meta['chargingCount']} charging sites; "
          f"unparseable {stats['unparseable']}/{stats['items']}")


if __name__ == "__main__":
    main()
