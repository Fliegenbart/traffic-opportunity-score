"""Läuft auf dem Chronos-Server: extrahiert Lkw-Stundenwerte der Hotspot-Stationen
aus den BASt-Jahres-Zips und baut Wochenreihen + Tagesgang-Profile.

Input:  /opt/truckonomics-trend/data/hotspot-bast-stations.json
        /opt/truckonomics-trend/data/<jahr>_A_S.zip  (werden bei Bedarf geladen)
Output: /opt/truckonomics-trend/out/weekly_series.csv   (zst, week, lkwWeek, validHours)
        /opt/truckonomics-trend/out/profiles.json       (Tagesgang je Station)
"""

from __future__ import annotations

import io
import json
import subprocess
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from zipfile import ZipFile

BASE = Path("/opt/truckonomics-trend")
DATA = BASE / "data"
OUT = BASE / "out"
YEARS = list(range(2016, 2024))
PROFILE_YEARS = {2022, 2023}
MIN_VALID_HOURS_PER_WEEK = 120

OUT.mkdir(parents=True, exist_ok=True)

stations = json.loads((DATA / "hotspot-bast-stations.json").read_text(encoding="utf-8"))
zst_set = {
    str(int(m["station"]["zst"]))
    for m in stations["mapping"]
    if m.get("station")
}
print(f"Stationen: {len(zst_set)}")

# Wochenreihen: (zst, montag-der-woche) -> [summe, gültige stunden]
weekly = defaultdict(lambda: [0.0, 0])
# Tagesgang: (zst, daytype, stunde) -> [summe, anzahl]  daytype: werktag/samstag/sonntag
profile = defaultdict(lambda: [0.0, 0])
# Richtungssplit (Profil-Jahre): zst -> [summe_r1, summe_r2]
direction = defaultdict(lambda: [0.0, 0.0])


def daytype(wotag: int) -> str:
    if wotag <= 5:
        return "werktag"
    if wotag == 6:
        return "samstag"
    return "sonntag"


for year in YEARS:
    zip_path = DATA / f"{year}_A_S.zip"
    if not zip_path.exists():
        print(f"Lade {year} ...", flush=True)
        subprocess.run(
            ["curl", "-s", "--max-time", "900", "-o", str(zip_path),
             f"https://www.bast.de/videos/{year}_A_S.zip"],
            check=True,
        )
    with ZipFile(zip_path) as archive:
        name = archive.namelist()[0]
        with archive.open(name) as raw:
            reader = io.TextIOWrapper(raw, encoding="latin-1")
            header = reader.readline().strip().split(";")
            idx = {col: i for i, col in enumerate(header)}
            i_zst, i_dat, i_wot, i_std = idx["Zst"], idx["Datum"], idx["Wotag"], idx["Stunde"]
            i_l1, i_l2 = idx["Lkw_R1"], idx["Lkw_R2"]
            kept = 0
            for line in reader:
                parts = line.split(";")
                zst = parts[i_zst].strip()
                if zst not in zst_set:
                    continue
                try:
                    l1 = int(parts[i_l1])
                    l2 = int(parts[i_l2])
                except ValueError:
                    continue
                if l1 < 0 or l2 < 0:
                    continue
                total = l1 + l2
                d = parts[i_dat].strip()
                day = date(2000 + int(d[0:2]), int(d[2:4]), int(d[4:6]))
                monday = day - timedelta(days=day.weekday())
                cell = weekly[(zst, monday.isoformat())]
                cell[0] += total
                cell[1] += 1
                if year in PROFILE_YEARS:
                    hour = int(parts[i_std])  # 1..24, Stunde 1 = 00-01 Uhr
                    p = profile[(zst, daytype(int(parts[i_wot])), hour)]
                    p[0] += total
                    p[1] += 1
                    direction[zst][0] += l1
                    direction[zst][1] += l2
                kept += 1
    print(f"{year}: {kept} Stundenwerte übernommen", flush=True)

with open(OUT / "weekly_series.csv", "w", encoding="utf-8") as f:
    f.write("zst,week,lkwWeek,validHours\n")
    for (zst, week), (total, hours) in sorted(weekly.items()):
        # Auf 168 Stunden hochskalieren, damit Ausfall-Lücken die Woche nicht drücken.
        scaled = total / hours * 168 if hours >= MIN_VALID_HOURS_PER_WEEK else ""
        f.write(f"{zst},{week},{scaled if scaled == '' else round(scaled)},{hours}\n")

profiles_out: dict[str, dict[str, list[float]]] = {}
for (zst, dt, hour), (total, count) in profile.items():
    profiles_out.setdefault(zst, {}).setdefault(dt, [0.0] * 24)
    if count > 0:
        profiles_out[zst][dt][hour - 1] = round(total / count, 1)

(OUT / "profiles.json").write_text(json.dumps(profiles_out, indent=1), encoding="utf-8")

directions_out = {
    zst: {"r1Share": round(r1 / (r1 + r2), 3)}
    for zst, (r1, r2) in direction.items()
    if r1 + r2 > 0
}
(OUT / "directions.json").write_text(json.dumps(directions_out, indent=1), encoding="utf-8")
print(f"Wochen-Zeilen: {len(weekly)}, Stationen mit Profil: {len(profiles_out)}")
print("FERTIG")
