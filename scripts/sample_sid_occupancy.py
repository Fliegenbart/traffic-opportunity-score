"""Hourly: pull current SID occupancy and append it to the sample archive (sid-data branch)."""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

from mobilithek import SID_DYNAMIC, client_cert, pull
from sid_occupancy import append_samples, parse_dynamic

MIN_ROWS = 500


def main(directory: str) -> None:
    now = datetime.now(timezone.utc)
    with client_cert() as cert:
        rows = parse_dynamic(pull(SID_DYNAMIC, cert), now)
    if len(rows) < MIN_ROWS:
        raise SystemExit(f"Only {len(rows)} current occupancy records (< {MIN_ROWS}); not appending")
    path = append_samples(Path(directory), rows, now)
    print(f"Appended {len(rows)} occupancy records to {path.name}")


if __name__ == "__main__":
    main(sys.argv[1])
