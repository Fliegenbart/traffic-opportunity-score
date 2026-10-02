"""Fetch official CSV, validate and rebuild app data without replacing it on failure."""
from __future__ import annotations

import json
import hashlib
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from bnetza_register import fetch_register

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "client/public/data/truck-charging-de.json"


def main():
    content, rows, metadata = fetch_register()
    for name, path in (("curatedSha256", "curated/truck-charging-de.json"),
                       ("networkSha256", "curated/charging-network-segments-de.json")):
        metadata[name] = hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
    if len(rows) < 50000:
        raise ValueError("Unexpectedly small national register; keeping previous app data")
    previous = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else None
    if previous:
        old = previous["metadata"]
        if metadata["bnetzaDataDate"] < old["bnetzaDataDate"]:
            raise ValueError("Provider data date regressed")
        if old.get("registerRows") and len(rows) < old["registerRows"] * 0.9:
            raise ValueError("Register lost over 10% of stations; manual review required")
        if all(old.get(key) == metadata[key] for key in
               ("registerSha256", "curatedSha256", "networkSha256")):
            print(f"Unchanged provider snapshot: {metadata['bnetzaDataDate']} (daily CSV check succeeded)")
            return
    with tempfile.TemporaryDirectory(prefix="charging-import-") as folder:
        temp = Path(folder)
        (temp / "register.csv").write_bytes(content)
        (temp / "metadata.json").write_text(json.dumps(metadata))
        subprocess.run([sys.executable, str(ROOT / "scripts/build_truck_charging_de.py"),
                        "--csv", str(temp / "register.csv"), "--import-metadata",
                        str(temp / "metadata.json"), "--output", str(temp / "charging.json")], check=True)
        candidate = json.loads((temp / "charging.json").read_text())
        if not candidate["verified"] or not candidate["proxy"]:
            raise ValueError("Empty charging layers; keeping previous app data")
        if previous:
            for layer in ("verified", "proxy"):
                if len(candidate[layer]) < len(previous[layer]) * 0.7:
                    raise ValueError(f"{layer} lost over 30%; manual review required")
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=OUTPUT.parent, delete=False) as output:
            output.write((temp / "charging.json").read_bytes())
            staged = output.name
        os.replace(staged, OUTPUT)
    print(f"Imported {len(rows)} stations; provider date {metadata['bnetzaDataDate']}")
    print("Source: public CSV, not the daily REST service. Curated operator entries are unchanged.")


if __name__ == "__main__":
    main()
