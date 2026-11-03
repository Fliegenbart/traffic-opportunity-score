"""Daily: fetch SID site list, aggregate the sample archive into occupancy profiles, replace snapshot atomically."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from mobilithek import SID_STATIC, client_cert, pull
from refresh_autobahn_services_de import write_atomic
from sid_occupancy import build_document, build_profiles, check_quality, parse_static, read_samples

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "client/public/data/truck-parking-occupancy-de.json"


def main(samples_dir: str, output: Path = OUTPUT) -> None:
    now = datetime.now(timezone.utc)
    previous = json.loads(output.read_text(encoding="utf-8")) if output.exists() else None
    with client_cert() as cert:
        sites = parse_static(pull(SID_STATIC, cert))
    profiles, coverage = build_profiles(read_samples(Path(samples_dir), now), sites)
    check_quality(sites, profiles, previous)
    document = build_document(profiles, coverage, sites, now)
    if previous and previous["metadata"]["sha256"] == document["metadata"]["sha256"]:
        print("Unchanged occupancy profiles")
        return
    write_atomic(output, document)
    print(f"Profiled {len(profiles)} of {len(sites)} SID sites over {coverage['days']} days "
          f"({coverage['samples']} sampling rounds)")


if __name__ == "__main__":
    main(sys.argv[1])
