"""Refresh KBA FZ 28 e-truck registrations (Lkw, Sattelzugmaschinen) into the app context file.

Finds the newest published fz28_YYYY_MM.xlsx, parses table FZ 28.1, merges the month into the
accumulated history (older months are kept) and writes the JSON only if the series changed.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kba_trucks as kba  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "client/public/data/context/ev-trucks-de.json"
DEFAULT_BACKFILL_FROM = "2023-01"


def months_between(start, end):
    y, m = start
    while (y, m) <= end:
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def run(output=OUTPUT, today=None, fetch=kba.fetch_xlsx, backfill_from=DEFAULT_BACKFILL_FROM,
        now=None, log=print):
    today = today or date.today()
    previous = json.loads(output.read_text()) if output.exists() else None
    series = list(previous["series"]) if previous else []

    y, m, url, data = kba.discover_latest(today, fetch=fetch)
    parsed = kba.parse_workbook(kba.open_bytes(data))
    if parsed["month"] != f"{y:04d}-{m:02d}":
        raise kba.KbaError(f"File {y}-{m:02d} contains data for {parsed['month']}")
    data_month = parsed["month"]

    if previous and data_month < previous["metadata"]["dataMonth"]:
        raise kba.KbaError(f"Data month regressed: {data_month} < {previous['metadata']['dataMonth']}")

    series = kba.merge_series(series, data_month, parsed["values"], overwrite=True)

    # Fill gaps in the history from older monthly files (never overwrites existing months).
    have = {e["month"] for e in series}
    by, bm = (int(x) for x in backfill_from.split("-"))
    for gy, gm in months_between((by, bm), kba.previous_month(y, m)):
        key = f"{gy:04d}-{gm:02d}"
        if key in have:
            continue
        try:
            raw = fetch(kba.month_url(gy, gm))
            if raw is None:
                log(f"Backfill {key}: file not published, skipped")
                continue
            old = kba.parse_workbook(kba.open_bytes(raw))
            if old["month"] != key:
                raise kba.KbaError(f"contains {old['month']}")
            series = kba.merge_series(series, key, old["values"], overwrite=False)
        except kba.KbaError as err:
            log(f"Backfill {key}: skipped ({err})")

    kba.validate_series(series)
    latest = max(e["month"] for e in series)
    if previous:
        old_month = previous["metadata"]["dataMonth"]
        if latest < old_month:
            raise kba.KbaError("Data month would regress")
        if previous["series"] == series:
            log(f"Unchanged: data month {previous['metadata']['dataMonth']}")
            return False

    now = now or datetime.now(timezone.utc)
    doc = kba.build_document(series, data_month, url, kba.sha256_hex(data),
                             now.strftime("%Y-%m-%dT%H:%M:%SZ"))
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=output.parent, delete=False, encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
        staged = fh.name
    os.replace(staged, output)
    log(f"Wrote {output}: data month {data_month}, {len(series)} entries")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--backfill-from", default=DEFAULT_BACKFILL_FROM, help="YYYY-MM")
    args = ap.parse_args()
    try:
        run(backfill_from=args.backfill_from)
    except kba.KbaError as err:
        print(f"ERROR: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
