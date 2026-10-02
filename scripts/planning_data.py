"""Versioned source exports for the charging planning engine. No traffic imputation."""
from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import io
import json
import math
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
MENDELEY_URL = "https://data.mendeley.com/datasets/py2zkrb65h/2"
BAST_URL = "https://www.govdata.de/suche/daten/automatische-dauerzahlstellen-rohdaten"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source(path, *, source_id, title, url, kind, version, observed, license_name="unknown", commercial="unknown"):
    return {"id": source_id, "title": title, "url": url, "kind": kind, "version": version,
            "retrievedAt": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
            "observedThrough": observed, "sha256": sha256(path), "license": license_name, "commercialUse": commercial}


def archive_csv(archive, suffix):
    names = [n for n in archive.namelist() if n.endswith(suffix)]
    if len(names) != 1:
        raise ValueError(f"Expected exactly one {suffix}")
    return list(csv.DictReader(io.TextIOWrapper(archive.open(names[0]), encoding="utf-8-sig")))


def finite(value, minimum=0, maximum=1e12):
    result = float(value)
    if not math.isfinite(result) or not minimum <= result <= maximum:
        raise ValueError(f"Invalid numerical value: {value}")
    return result


def build_network(path):
    with ZipFile(path) as archive:
        regions = archive_csv(archive, "02_NUTS-3-Regions.csv")
        nodes = archive_csv(archive, "03_network-nodes.csv")
        edges = archive_csv(archive, "04_network-edges.csv")
    name_map = {}
    tree = ast.parse((ROOT / "scripts/build_traffic_opportunity_de.py").read_text(encoding="utf-8"))
    for statement in tree.body:
        if isinstance(statement, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "GERMAN_REGION_NAME_MAP" for t in statement.targets):
            name_map = ast.literal_eval(statement.value)
    name_map.update({a.split(",")[0]: b.split(",")[0] for a, b in list(name_map.items())})
    names = {r["ETISPlus_Zone_ID"]: name_map.get(r["Name"], r["Name"]) for r in regions}
    by_id = {int(n["Network_Node_ID"]): n for n in nodes}
    if len(by_id) != len(nodes):
        raise ValueError("Duplicate network node")
    output, seen = [], set()
    for e in edges:
        a_id, b_id = int(e["Network_Node_A_ID"]), int(e["Network_Node_B_ID"])
        if a_id not in by_id or b_id not in by_id:
            raise ValueError("Missing edge endpoint")
        a, b = by_id[a_id], by_id[b_id]
        if a["Country"] != "DE" and b["Country"] != "DE":
            continue
        edge_id = int(e["Network_Edge_ID"])
        if edge_id in seen:
            raise ValueError("Duplicate network edge")
        seen.add(edge_id)
        output.append({"edgeId": edge_id,
                       "label": f'{names.get(a["ETISplus_Zone_ID"], "Unknown")} - {names.get(b["ETISplus_Zone_ID"], "Unknown")}',
                       "aLon": finite(a["Network_Node_X"], -180, 180), "aLat": finite(a["Network_Node_Y"], -90, 90),
                       "bLon": finite(b["Network_Node_X"], -180, 180), "bLat": finite(b["Network_Node_Y"], -90, 90),
                       "lengthKm": finite(e["Distance"]), "trucks2019": finite(e["Traffic_flow_trucks_2019"]),
                       "trucks2030": finite(e["Traffic_flow_trucks_2030"])})
    if not output:
        raise ValueError("Empty German network")
    return {"schemaVersion": 1,
            "source": source(path, source_id="mendeley-py2zkrb65h-v2", title="Speth et al.: Synthetic European road freight transport flow data based on ETISplus",
                             url=MENDELEY_URL, kind="synthetic", version="2", observed="2019-12-31", license_name="CC-BY-4.0", commercial="allowed"),
            "method": "Alle Netzkanten mit mindestens einem deutschen Endpunkt. Jahresflüsse in beiden Richtungen. Geradlinige Endpunkt-Geometrie, keine verifizierte Lkw-Zufahrt. 2030 ist ein synthetisches Szenario; regionaler Verkehr fehlt teilweise.",
            "edges": sorted(output, key=lambda e: e["edgeId"])}


def read_normalized_hourly(handle):
    reader = csv.DictReader(handle)
    required = {"stationId", "date", "hour", "lkwR1", "lkwR2"}
    if not required <= set(reader.fieldnames or []):
        raise ValueError("Missing normalized hourly columns")
    for row in reader:
        day = date.fromisoformat(row["date"])
        hour = int(row["hour"])
        if not 0 <= hour <= 23 or not row["stationId"].strip():
            raise ValueError("Invalid hourly key")
        values = []
        for field in ("lkwR1", "lkwR2"):
            try:
                values.append(finite(row[field]))
            except (ValueError, TypeError):
                values.append(None)
        yield {"stationId": row["stationId"].strip(), "date": day.isoformat(), "hour": hour,
               "lkwR1": values[0], "lkwR2": values[1], "vehicleClass": "truck"}


def read_bast_fixed(handle):
    h, r, s = (handle.readline().rstrip("\r\n") for _ in range(3))
    if not h.startswith("H") or not r.startswith("R") or not s.startswith("S") or "V2.0" not in h:
        raise ValueError("Invalid BASt V2 header")
    station_id = str(int(h[5:9]))
    lane_r1, lane_r2 = int(r[1:3]), int(r[4:6])
    groups, classes = int(s[1:3]), int(s[4:6])
    labels = s[7:].rstrip(";").split()
    if len(labels) != groups + classes or lane_r1 + lane_r2 < 1:
        raise ValueError("Invalid BASt lane or classification header")
    class_labels = labels[groups:]
    if {"LoA", "LmA", "Sat"} <= set(class_labels):
        wanted, vehicle_class = {"LoA", "LmA", "Sat"}, "truck"
    elif {"LoA", "Lzg"} <= set(class_labels):
        wanted, vehicle_class = {"LoA", "Lzg"}, "truck"
    elif classes == 0 and ("Lkw" in labels[:groups] or "SV" in labels[:groups]):
        wanted, vehicle_class = {"Lkw" if "Lkw" in labels[:groups] else "SV"}, "heavy_traffic_proxy"
    else:
        raise ValueError("No separately identifiable truck class")
    lanes = lane_r1 + lane_r2
    for line in handle:
        line = line.rstrip("\r\n;")
        if not line:
            continue
        d = datetime.strptime(line[:6], "%y%m%d").date()
        ending = line[7:12]
        if ending[2:] != ":00" or not 1 <= int(ending[:2]) <= 24:
            raise ValueError("Unsupported BASt hourly timestamp")
        cells = [line[13 + 6 * i:18 + 6 * i] for i in range((groups + classes) * lanes)]
        if any(len(c) != 5 for c in cells):
            raise ValueError("Truncated BASt hourly record")
        sums = [0, 0]
        valid = [lane_r1 > 0, lane_r2 > 0]
        for lane in range(lanes):
            direction = 0 if lane < lane_r1 else 1
            for index, label in enumerate(class_labels if classes else labels[:groups]):
                if label not in wanted:
                    continue
                offset = groups * lanes + lane * classes + index if classes else lane * groups + index
                cell = cells[offset]
                try:
                    count = finite(cell[:4], 0, 9999)
                    if cell[4] != "-" or line[6] != " ":
                        valid[direction] = False
                    sums[direction] += count
                except ValueError:
                    valid[direction] = False
        yield {"stationId": station_id, "date": d.isoformat(), "hour": int(ending[:2]) - 1,
               "lkwR1": sums[0] if valid[0] else None, "lkwR2": sums[1] if valid[1] else None,
               "vehicleClass": vehicle_class}


def summarize_hourly(rows, start, end):
    start_day, end_day = date.fromisoformat(start), date.fromisoformat(end)
    if end_day < start_day:
        raise ValueError("Reversed observation period")
    by_station = defaultdict(dict)
    duplicates = defaultdict(int)
    invalid = defaultdict(int)
    vehicle_classes = {}
    for row in rows:
        if not start <= row["date"] <= end:
            raise ValueError("Hourly record outside declared observation period")
        station_id = row["stationId"]
        vehicle_class = row.get("vehicleClass", "truck")
        if station_id in vehicle_classes and vehicle_classes[station_id] != vehicle_class:
            raise ValueError("Vehicle class changed within station series")
        vehicle_classes[station_id] = vehicle_class
        key = (row["date"], row["hour"])
        values = (row["lkwR1"], row["lkwR2"])
        if key in by_station[station_id]:
            if by_station[station_id][key] != values:
                raise ValueError(f"Conflicting duplicate: {station_id} {key}")
            duplicates[station_id] += 1
            continue
        by_station[station_id][key] = values
        if None in values:
            invalid[station_id] += 1
    expected_hours = ((end_day - start_day).days + 1) * 24
    output = []
    for station_id, hours in sorted(by_station.items()):
        profile = {d: [[] for _ in range(24)] for d in ("weekday", "saturday", "sunday")}
        valid_hours, observed, r1_total, r2_total = 0, 0, 0, 0
        for (day, hour), values in hours.items():
            if None in values:
                continue
            dt = date.fromisoformat(day).weekday()
            daytype = "weekday" if dt < 5 else "saturday" if dt == 5 else "sunday"
            profile[daytype][hour].append(sum(values))
            valid_hours += 1
            observed += sum(values)
            r1_total += values[0]
            r2_total += values[1]
        means = {d: [round(sum(cell) / len(cell), 4) if cell else None for cell in cells] for d, cells in profile.items()}
        counts = {d: [len(cell) for cell in cells] for d, cells in profile.items()}
        output.append({"stationId": station_id, "vehicleClass": vehicle_classes[station_id], "validHours": valid_hours,
                       "expectedHours": expected_hours, "coverage": valid_hours / expected_hours,
                       "duplicates": duplicates[station_id], "invalidHours": invalid[station_id],
                       "observedTrucks": observed, "meanObservedTrucksPerHour": observed / valid_hours if valid_hours else None,
                       "directionShareR1": r1_total / observed if observed else None,
                       "usableAsCompleteProfile": valid_hours / expected_hours >= 0.95 and all(n >= 3 for values in counts.values() for n in values),
                       "profiles": means, "samplesByHour": counts})
    return {"period": {"start": start, "end": end}, "method": "Nur vollständige Querschnittsstunden; keine Auffüllung, Skalierung oder Interpolation. UTC-freie lokale Stundenprofile; Zeitumstellungswerte werden ausgeschlossen.", "stations": output}


def import_bast_archive(path, start, end, license_metadata=None):
    metadata = {}
    station_groups = defaultdict(list)
    rejected_files = []
    with ZipFile(path) as archive:
        metadata_names = [n for n in archive.namelist() if n.endswith("_Metadaten.csv")]
        if len(metadata_names) != 1:
            raise ValueError("Missing BASt station metadata")
        metadata_bytes = archive.read(metadata_names[0])
        try:
            metadata_text = metadata_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            metadata_text = metadata_bytes.decode("latin-1")
        with io.StringIO(metadata_text) as handle:
            for row in csv.DictReader(handle, delimiter=";"):
                station_id = str(int(row["Dauerzaehlstellennummer"]))
                metadata[station_id] = {"name": row["Dauerzaehlstellenname"], "roadClass": row["Straßenklasse"],
                                        "road": row["Straßennummer"], "direction1": row["Nahziel_Richtung_1"], "direction2": row["Nahziel_Richtung_2"],
                                        "utm32E": row["Koordinaten_UTM32_E"], "utm32N": row["Koordinaten_UTM32_N"]}
        for name in archive.namelist():
            if name.endswith("/") or name in metadata_names:
                continue
            try:
                with io.TextIOWrapper(archive.open(name), encoding="latin-1") as handle:
                    file_rows = list(read_bast_fixed(handle))
                    for row in file_rows:
                        station_groups[row["stationId"]].append(row)
            except ValueError as error:
                rejected_files.append({"file": name, "reason": str(error)})
    result = summarize_hourly((row for group in station_groups.values() for row in group), start, end)
    # Use PROJ rather than a hand-written coordinate transform.
    from pyproj import Transformer
    transform = Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True)
    rejected_stations = []
    located_stations = []
    for station in result["stations"]:
        m = metadata.get(station["stationId"])
        if not m:
            rejected_stations.append({"stationId": station["stationId"], "reason": "Station metadata missing"})
            continue
        try:
            e, n = (float(m[k].replace(",", ".")) for k in ("utm32E", "utm32N"))
            lon, lat = transform.transform(e, n)
            station["location"] = {"lon": finite(lon, 5, 16), "lat": finite(lat, 47, 56)}
        except ValueError as error:
            rejected_stations.append({"stationId": station["stationId"], "reason": str(error)})
            continue
        station["name"], station["roadClass"], station["road"] = m["name"], m["roadClass"], m["road"]
        station["direction1"], station["direction2"] = m["direction1"], m["direction2"]
        located_stations.append(station)
    result["stations"] = located_stations
    # Licence is confirmed per distribution, never inferred from the dataset title.
    license_name, commercial = "unknown", "unknown"
    if license_metadata:
        from rdflib import Graph, Namespace, URIRef
        from rdflib.namespace import DCTERMS
        from urllib.parse import unquote, urlparse
        graph = Graph().parse(license_metadata, format="turtle")
        dcat = Namespace("http://www.w3.org/ns/dcat#")
        matches = {s for s, url in graph.subject_objects(dcat.accessURL)
                   if Path(unquote(urlparse(str(url)).path)).name == path.name}
        cc_by = URIRef("http://dcat-ap.de/def/licenses/cc-by/4.0")
        if len(matches) == 1 and set(graph.objects(next(iter(matches)), DCTERMS.license)) == {cc_by}:
            license_name, commercial = "CC-BY-4.0", "allowed"
    result.update({"schemaVersion": 1, "source": source(path, source_id=f"bast-raw-{start}-{end}", title="BASt: Automatische Dauerzählstellen, ungeprüfte Rohdaten",
                                                      url=BAST_URL, kind="measured", version=f"raw-{start}-{end}", observed=end,
                                                      license_name=license_name, commercial=commercial),
                   "quality": {"rawNotProviderValidated": True, "rejectedFiles": rejected_files, "rejectedStations": rejected_stations, "stationCount": len(result["stations"]),
                               "completeProfiles": sum(s["usableAsCompleteProfile"] for s in result["stations"])}})
    if license_metadata:
        result["quality"]["licenseMetadataSha256"] = sha256(license_metadata)
    if not result["stations"]:
        raise ValueError("No usable BASt rows")
    return result


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    network = sub.add_parser("network")
    network.add_argument("--zip", type=Path, default=ROOT / "data/raw/mendeley_py2zkrb65h_v2/py2zkrb65h-2.zip")
    network.add_argument("--out", type=Path, default=ROOT / "client/public/data/planning/network-de.json")
    bast = sub.add_parser("bast")
    bast.add_argument("--zip", type=Path, required=True)
    bast.add_argument("--start", required=True)
    bast.add_argument("--end", required=True)
    bast.add_argument("--license-metadata", type=Path)
    bast.add_argument("--out", type=Path, default=ROOT / "client/public/data/planning/bast-hourly-de.json")
    args = parser.parse_args()
    data = build_network(args.zip) if args.command == "network" else import_bast_archive(args.zip, args.start, args.end, args.license_metadata)
    write_json(args.out, data)
    quality = data.get("quality")
    if quality:
        quality = {**quality, "rejectedFiles": len(quality["rejectedFiles"]), "rejectedStations": len(quality["rejectedStations"])}
    print(json.dumps({"output": str(args.out), "sha256": sha256(args.out), "edges": len(data.get("edges", [])), "stations": len(data.get("stations", [])), "quality": quality}, ensure_ascii=False))


if __name__ == "__main__":
    main()
