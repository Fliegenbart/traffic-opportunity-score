"""Daily: fetch SID site list, aggregate the sample archive into occupancy profiles, replace snapshot atomically."""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from mobilithek import SID_STATIC, client_cert, pull
from refresh_autobahn_services_de import write_atomic
from sid_occupancy import build_document, build_profiles, check_quality, parse_static, read_samples

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "client/public/data/truck-parking-occupancy"


def write_tiles(output: Path, index: dict, tiles: dict) -> None:
    """Build the whole directory next to the old one, then swap, so readers never see a half-written set."""
    staged = Path(tempfile.mkdtemp(dir=output.parent, prefix=".occupancy-"))
    for key, rows in tiles.items():
        write_atomic(staged / f"{key}.json", rows)
    write_atomic(staged / "index.json", index)
    for path in staged.rglob("*"):
        path.chmod(0o644)
    staged.chmod(0o755)
    if output.exists():
        retired = output.with_name(output.name + ".old")
        output.rename(retired)
        staged.rename(output)
        shutil.rmtree(retired)
    else:
        staged.rename(output)


def main(samples_dir: str, output: Path = OUTPUT) -> None:
    now = datetime.now(timezone.utc)
    index_path = output / "index.json"
    previous = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else None
    with client_cert() as cert:
        sites = parse_static(pull(SID_STATIC, cert))
    profiles, coverage = build_profiles(read_samples(Path(samples_dir), now), sites)
    check_quality(sites, profiles, previous)
    index, tiles = build_document(profiles, coverage, sites, now)
    if previous and previous["metadata"]["sha256"] == index["metadata"]["sha256"]:
        print("Unchanged occupancy profiles")
        return
    write_tiles(output, index, tiles)
    print(f"Profiled {len(profiles)} of {len(sites)} SID sites over {coverage['days']} days "
          f"({coverage['samples']} sampling rounds) in {len(tiles)} tiles")


if __name__ == "__main__":
    main(sys.argv[1])
