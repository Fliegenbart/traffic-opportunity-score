from __future__ import annotations

import heapq
import json
from collections import defaultdict
from datetime import datetime, timezone
from itertools import count
from pathlib import Path
from zipfile import ZipFile

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
ZIP_PATH = ROOT / "data" / "raw" / "mendeley_py2zkrb65h_v2" / "py2zkrb65h-2.zip"
OUT_PATH = ROOT / "client" / "public" / "data" / "traffic-opportunity-de.json"
VALIDATION_PATH = ROOT / "data" / "external" / "bast-validation.json"
ZIP_PREFIX = "Synthetic European road freight transport flow dat/"

TOP_EDGE_COUNT = 60
TOP_CORRIDOR_COUNT = 90
TOP_REGION_COUNT = 120
REGION_TOP_CORRIDORS = 5
EDGE_TOP_FLOWS = 3

GERMAN_REGION_NAME_MAP = {
    "Bitburg-Prum": "Bitburg-Prüm",
    "Boblingen": "Böblingen",
    "Borde": "Börde",
    "Duren": "Düren",
    "Dusseldorf, Kreisfreie Stadt": "Düsseldorf, Kreisfreie Stadt",
    "Eichstatt": "Eichstätt",
    "Furth, Kreisfreie Stadt": "Fürth, Kreisfreie Stadt",
    "Furth, Landkreis": "Fürth, Landkreis",
    "Giessen, Landkreis": "Gießen, Landkreis",
    "Gorlitz, Kreisfreie Stadt": "Görlitz, Kreisfreie Stadt",
    "Gottingen": "Göttingen",
    "Gross-Gerau": "Groß-Gerau",
    "Gustrow": "Güstrow",
    "Gutersloh": "Gütersloh",
    "Hoxter": "Höxter",
    "Koln, Kreisfreie Stadt": "Köln, Kreisfreie Stadt",
    "Lubeck, Kreisfreie Stadt": "Lübeck, Kreisfreie Stadt",
    "Markisch-Oderland": "Märkisch-Oderland",
    "Markischer Kreis": "Märkischer Kreis",
    "Minden-Lubbecke": "Minden-Lübbecke",
    "Munchen, Kreisfreie Stadt": "München, Kreisfreie Stadt",
    "Munchen, Landkreis": "München, Landkreis",
    "Munster, Kreisfreie Stadt": "Münster, Kreisfreie Stadt",
    "Nurnberg, Kreisfreie Stadt": "Nürnberg, Kreisfreie Stadt",
    "Nurnberger Land": "Nürnberger Land",
    "Osnabruck, Kreisfreie Stadt": "Osnabrück, Kreisfreie Stadt",
    "Osnabruck, Landkreis": "Osnabrück, Landkreis",
    "Rendsburg-Eckernforde": "Rendsburg-Eckernförde",
    "Riesa-Grossenhain": "Riesa-Großenhain",
    "Rugen": "Rügen",
    "Saarbrucken": "Saarbrücken",
    "Schwabisch Hall": "Schwäbisch Hall",
    "Stadtverband Saarbrucken": "Stadtverband Saarbrücken",
    "Teltow-Flaming": "Teltow-Fläming",
    "Tubingen, Landkreis": "Tübingen, Landkreis",
    "Wurzburg, Kreisfreie Stadt": "Würzburg, Kreisfreie Stadt",
    "Wurzburg, Landkreis": "Würzburg, Landkreis",
}


def normalize_region_name(name: str) -> str:
    return GERMAN_REGION_NAME_MAP.get(str(name), str(name))


def short_region_name(name: str) -> str:
    return normalize_region_name(name).split(",")[0].strip()


def distance_fit_score(distance_km: float) -> int:
    if distance_km <= 0:
        return 0
    if distance_km < 150:
        return 65
    if distance_km < 300:
        return 100
    if distance_km < 600:
        return 90
    if distance_km < 1000:
        return 45
    return 25


def normalize(value: float, max_value: float) -> int:
    if max_value <= 0:
        return 0
    return round(max(0, min(100, value / max_value * 100)))


def distance_bucket(distance_km: float) -> str:
    if distance_km < 150:
        return "<150 km"
    if distance_km < 300:
        return "150-300 km"
    if distance_km < 600:
        return "300-600 km"
    if distance_km < 1000:
        return "600-1000 km"
    return "1000+ km"


def parse_edge_path(raw: object) -> list[str]:
    if not isinstance(raw, str) or len(raw) < 3:
        return []
    return raw[1:-1].split(", ")


def load_validation() -> dict | None:
    if not VALIDATION_PATH.exists():
        return None
    try:
        return json.loads(VALIDATION_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def main() -> None:
    if not ZIP_PATH.exists():
        raise SystemExit(f"Missing source ZIP: {ZIP_PATH}")

    with ZipFile(ZIP_PATH) as archive:
        regions = pd.read_csv(archive.open(ZIP_PREFIX + "02_NUTS-3-Regions.csv"))
        nodes = pd.read_csv(archive.open(ZIP_PREFIX + "03_network-nodes.csv"))
        edges = pd.read_csv(archive.open(ZIP_PREFIX + "04_network-edges.csv"))

    regions["ETISPlus_Zone_ID"] = regions["ETISPlus_Zone_ID"].astype(str)
    region_country = dict(zip(regions["ETISPlus_Zone_ID"], regions["Country"]))
    region_name = dict(zip(regions["ETISPlus_Zone_ID"], regions["Name"]))
    region_lon = dict(zip(regions["ETISPlus_Zone_ID"], regions["Geometric_center_X"]))
    region_lat = dict(zip(regions["ETISPlus_Zone_ID"], regions["Geometric_center_Y"]))

    node_zone = dict(zip(nodes["Network_Node_ID"], nodes["ETISplus_Zone_ID"].astype(str)))
    node_lon = dict(zip(nodes["Network_Node_ID"], nodes["Network_Node_X"]))
    node_lat = dict(zip(nodes["Network_Node_ID"], nodes["Network_Node_Y"]))
    node_country = dict(zip(nodes["Network_Node_ID"], nodes["Country"]))

    def node_label(node_id: int) -> str:
        zone = node_zone.get(node_id)
        if zone and zone in region_name:
            return short_region_name(region_name[zone])
        return "unbekannt"

    # Hotspot edges first, so the flow loop can attribute corridors to them.
    # Eine Kante kommt nur in die Auswahl, wenn mindestens eine ihrer beiden
    # Endzonen neu ist: Die Top-60 nach Verkehr wären sonst fast nur
    # Parallelsegmente derselben Autobahnen um Hamburg, Hannover und das
    # Ruhrgebiet.
    edges["aCountry"] = edges["Network_Node_A_ID"].map(node_country)
    edges["bCountry"] = edges["Network_Node_B_ID"].map(node_country)
    candidates = edges.query("aCountry == 'DE' or bCountry == 'DE'").sort_values(
        "Traffic_flow_trucks_2030", ascending=False
    )
    seen_labels: set[str] = set()
    kept_rows = []
    kept_info: list[tuple[set[str], float]] = []
    for row in candidates.itertuples(index=False):
        labels = {
            node_label(row.Network_Node_A_ID),
            node_label(row.Network_Node_B_ID),
        }
        if labels <= seen_labels:
            continue
        flow = float(row.Traffic_flow_trucks_2030)
        # Nachbarsegmente desselben Nadelöhrs haben fast identische Flüsse —
        # die bringen keinen neuen Suchraum.
        if any(
            labels & kept_labels and abs(flow - kept_flow) / kept_flow < 0.02
            for kept_labels, kept_flow in kept_info
        ):
            continue
        seen_labels.update(labels)
        kept_rows.append(row)
        kept_info.append((labels, flow))
        if len(kept_rows) == TOP_EDGE_COUNT:
            break
    hotspot_edges = pd.DataFrame(kept_rows)
    hotspot_ids = set(hotspot_edges["Network_Edge_ID"].astype(str))
    edge_via: dict[str, dict] = {
        edge_id: {"via2030": 0.0, "via2019": 0.0, "top": []} for edge_id in hotspot_ids
    }

    de_regions = {
        region_id: {
            "id": region_id,
            "name": normalize_region_name(region_name[region_id]),
            "country": "DE",
            "trucks2010": 0.0,
            "trucks2019": 0.0,
            "trucks2030": 0.0,
            "tons2030": 0.0,
            "crossBorderTrucks2030": 0.0,
            "distanceFitWeighted": 0.0,
            "distanceFitWeight": 0.0,
            "originTrucks2030": 0.0,
            "destinationTrucks2030": 0.0,
        }
        for region_id, country in region_country.items()
        if country == "DE"
    }
    region_top_corridors: dict[str, list] = defaultdict(list)
    tiebreak = count()

    country_pairs = defaultdict(lambda: {"trucks2019": 0.0, "trucks2030": 0.0})
    distance_buckets = defaultdict(float)
    top_corridor_parts = []
    flow_rows = 0
    de_trucks_2030 = 0.0
    de_tons_2030 = 0.0

    usecols = [
        "ID_origin_region",
        "Name_origin_region",
        "ID_destination_region",
        "Name_destination_region",
        "Edge_path_E_road",
        "Total_distance",
        "Traffic_flow_trucks_2010",
        "Traffic_flow_trucks_2019",
        "Traffic_flow_trucks_2030",
        "Traffic_flow_tons_2030",
    ]
    corridor_cols = [
        "ID_origin_region",
        "Name_origin_region",
        "originCountry",
        "ID_destination_region",
        "Name_destination_region",
        "destinationCountry",
        "Total_distance",
        "Traffic_flow_trucks_2010",
        "Traffic_flow_trucks_2019",
        "Traffic_flow_trucks_2030",
        "Traffic_flow_tons_2030",
    ]

    with ZipFile(ZIP_PATH) as archive:
        with archive.open(ZIP_PREFIX + "01_Trucktrafficflow.csv") as flow_file:
            for chunk in pd.read_csv(flow_file, usecols=usecols, chunksize=50_000):
                chunk["ID_origin_region"] = chunk["ID_origin_region"].astype(str)
                chunk["ID_destination_region"] = chunk["ID_destination_region"].astype(str)
                chunk["originCountry"] = chunk["ID_origin_region"].map(region_country).fillna("??")
                chunk["destinationCountry"] = (
                    chunk["ID_destination_region"].map(region_country).fillna("??")
                )
                chunk["touchesDE"] = (chunk["originCountry"] == "DE") | (
                    chunk["destinationCountry"] == "DE"
                )
                flow_rows += len(chunk)

                for key, values in chunk.groupby(["originCountry", "destinationCountry"]):
                    pair = country_pairs[f"{key[0]}->{key[1]}"]
                    pair["trucks2019"] += float(values["Traffic_flow_trucks_2019"].sum())
                    pair["trucks2030"] += float(values["Traffic_flow_trucks_2030"].sum())

                de_rows = chunk[chunk["touchesDE"]]
                if de_rows.empty:
                    continue

                de_trucks_2030 += float(de_rows["Traffic_flow_trucks_2030"].sum())
                de_tons_2030 += float(de_rows["Traffic_flow_tons_2030"].sum())

                top_corridor_parts.append(
                    de_rows.nlargest(30, "Traffic_flow_trucks_2030")[corridor_cols]
                )
                if len(top_corridor_parts) > 6:
                    top_corridor_parts = [
                        pd.concat(top_corridor_parts).nlargest(
                            TOP_CORRIDOR_COUNT + 30, "Traffic_flow_trucks_2030"
                        )
                    ]

                for bucket, value in de_rows.assign(
                    bucket=de_rows["Total_distance"].map(distance_bucket)
                ).groupby("bucket")["Traffic_flow_trucks_2030"].sum().items():
                    distance_buckets[bucket] += float(value)

                for row in de_rows.itertuples(index=False):
                    flow_2010 = float(row.Traffic_flow_trucks_2010)
                    flow_2019 = float(row.Traffic_flow_trucks_2019)
                    flow_2030 = float(row.Traffic_flow_trucks_2030)
                    tons_2030 = float(row.Traffic_flow_tons_2030)
                    distance_km = float(row.Total_distance)
                    fit = distance_fit_score(distance_km)
                    origin_is_de = row.originCountry == "DE"
                    destination_is_de = row.destinationCountry == "DE"

                    if origin_is_de:
                        region = de_regions[row.ID_origin_region]
                        region["trucks2010"] += flow_2010
                        region["trucks2019"] += flow_2019
                        region["trucks2030"] += flow_2030
                        region["tons2030"] += tons_2030
                        region["originTrucks2030"] += flow_2030
                        region["distanceFitWeighted"] += flow_2030 * fit
                        region["distanceFitWeight"] += flow_2030
                        if not destination_is_de:
                            region["crossBorderTrucks2030"] += flow_2030
                        heap = region_top_corridors[row.ID_origin_region]
                        heapq.heappush(
                            heap,
                            (
                                flow_2030,
                                next(tiebreak),
                                {
                                    "direction": "outbound",
                                    "partnerName": short_region_name(row.Name_destination_region),
                                    "partnerCountry": row.destinationCountry,
                                    "trucks2030": round(flow_2030),
                                    "distanceKm": round(distance_km),
                                },
                            ),
                        )
                        if len(heap) > REGION_TOP_CORRIDORS:
                            heapq.heappop(heap)

                    if destination_is_de:
                        region = de_regions[row.ID_destination_region]
                        region["trucks2010"] += flow_2010
                        region["trucks2019"] += flow_2019
                        region["trucks2030"] += flow_2030
                        region["tons2030"] += tons_2030
                        region["destinationTrucks2030"] += flow_2030
                        region["distanceFitWeighted"] += flow_2030 * fit
                        region["distanceFitWeight"] += flow_2030
                        if not origin_is_de:
                            region["crossBorderTrucks2030"] += flow_2030
                        heap = region_top_corridors[row.ID_destination_region]
                        heapq.heappush(
                            heap,
                            (
                                flow_2030,
                                next(tiebreak),
                                {
                                    "direction": "inbound",
                                    "partnerName": short_region_name(row.Name_origin_region),
                                    "partnerCountry": row.originCountry,
                                    "trucks2030": round(flow_2030),
                                    "distanceKm": round(distance_km),
                                },
                            ),
                        )
                        if len(heap) > REGION_TOP_CORRIDORS:
                            heapq.heappop(heap)

                    # Attribute this corridor to the hotspot edges it traverses.
                    for edge_id in parse_edge_path(row.Edge_path_E_road):
                        stats = edge_via.get(edge_id)
                        if stats is None:
                            continue
                        stats["via2030"] += flow_2030
                        stats["via2019"] += flow_2019
                        heapq.heappush(
                            stats["top"],
                            (
                                flow_2030,
                                next(tiebreak),
                                {
                                    "origin": short_region_name(row.Name_origin_region),
                                    "originCountry": row.originCountry,
                                    "destination": short_region_name(row.Name_destination_region),
                                    "destinationCountry": row.destinationCountry,
                                    "trucks2030": round(flow_2030),
                                },
                            ),
                        )
                        if len(stats["top"]) > EDGE_TOP_FLOWS:
                            heapq.heappop(stats["top"])

    max_region_trucks = max(region["trucks2030"] for region in de_regions.values())
    max_cross_border_trucks = max(
        region["crossBorderTrucks2030"] for region in de_regions.values()
    )

    region_records = []
    for region in de_regions.values():
        if region["trucks2030"] <= 0:
            continue
        cross_share = region["crossBorderTrucks2030"] / region["trucks2030"]
        distance_fit = (
            region["distanceFitWeighted"] / region["distanceFitWeight"]
            if region["distanceFitWeight"] > 0
            else 0
        )
        corridor_relevance = round(
            normalize(region["crossBorderTrucks2030"], max_cross_border_trucks) * 0.65
            + min(100, cross_share * 220) * 0.35
        )
        top_corridors = [
            payload
            for _, _, payload in sorted(
                region_top_corridors.get(region["id"], []), reverse=True
            )
        ]
        region_records.append(
            {
                "id": region["id"],
                "name": region["name"],
                "country": region["country"],
                "lon": round(float(region_lon[region["id"]]), 4),
                "lat": round(float(region_lat[region["id"]]), 4),
                "trucks2010": round(region["trucks2010"]),
                "trucks2019": round(region["trucks2019"]),
                "trucks2030": round(region["trucks2030"]),
                "tons2030": round(region["tons2030"]),
                "crossBorderTrucks2030": round(region["crossBorderTrucks2030"]),
                "crossBorderShare": round(cross_share, 4),
                "distanceFitScore": round(distance_fit),
                "corridorRelevanceScore": corridor_relevance,
                "originTrucks2030": round(region["originTrucks2030"]),
                "destinationTrucks2030": round(region["destinationTrucks2030"]),
                "topCorridors": top_corridors,
            }
        )

    top_corridors_df = pd.concat(top_corridor_parts).nlargest(
        TOP_CORRIDOR_COUNT, "Traffic_flow_trucks_2030"
    )
    max_corridor_trucks = float(top_corridors_df["Traffic_flow_trucks_2030"].max())
    corridor_records = []
    for row in top_corridors_df.itertuples(index=False):
        cross_border = row.originCountry != row.destinationCountry
        origin_id = str(row.ID_origin_region)
        destination_id = str(row.ID_destination_region)
        corridor_records.append(
            {
                "originRegionId": origin_id,
                "originRegion": normalize_region_name(row.Name_origin_region),
                "originCountry": row.originCountry,
                "originLon": round(float(region_lon.get(origin_id, 0)), 4),
                "originLat": round(float(region_lat.get(origin_id, 0)), 4),
                "destinationRegionId": destination_id,
                "destinationRegion": normalize_region_name(row.Name_destination_region),
                "destinationCountry": row.destinationCountry,
                "destinationLon": round(float(region_lon.get(destination_id, 0)), 4),
                "destinationLat": round(float(region_lat.get(destination_id, 0)), 4),
                "totalDistanceKm": round(float(row.Total_distance), 1),
                "trucks2010": round(float(row.Traffic_flow_trucks_2010)),
                "trucks2019": round(float(row.Traffic_flow_trucks_2019)),
                "trucks2030": round(float(row.Traffic_flow_trucks_2030)),
                "tons2030": round(float(row.Traffic_flow_tons_2030)),
                "distanceFitScore": distance_fit_score(float(row.Total_distance)),
                "corridorRelevanceScore": 100 if cross_border else 70,
                "crossBorder": cross_border,
            }
        )

    edge_records = []
    for row in hotspot_edges.itertuples(index=False):
        edge_id = str(row.Network_Edge_ID)
        stats = edge_via[edge_id]
        top_flows = [
            payload for _, _, payload in sorted(stats["top"], reverse=True)
        ]
        edge_records.append(
            {
                "edgeId": int(row.Network_Edge_ID),
                "distanceKm": round(float(row.Distance), 3),
                "aLabel": node_label(row.Network_Node_A_ID),
                "bLabel": node_label(row.Network_Node_B_ID),
                "aCountry": row.aCountry,
                "bCountry": row.bCountry,
                "aLon": round(float(node_lon[row.Network_Node_A_ID]), 6),
                "aLat": round(float(node_lat[row.Network_Node_A_ID]), 6),
                "bLon": round(float(node_lon[row.Network_Node_B_ID]), 6),
                "bLat": round(float(node_lat[row.Network_Node_B_ID]), 6),
                "trucks2019": int(row.Traffic_flow_trucks_2019),
                "trucks2030": int(row.Traffic_flow_trucks_2030),
                "viaTrucks2030": round(stats["via2030"]),
                "topFlows": top_flows,
            }
        )

    country_pair_records = []
    for pair_key, values in sorted(
        country_pairs.items(), key=lambda item: item[1]["trucks2030"], reverse=True
    ):
        origin_country, destination_country = pair_key.split("->")
        if origin_country == "DE" or destination_country == "DE":
            country_pair_records.append(
                {
                    "originCountry": origin_country,
                    "destinationCountry": destination_country,
                    "trucks2019": round(values["trucks2019"]),
                    "trucks2030": round(values["trucks2030"]),
                }
            )
        if len(country_pair_records) >= 30:
            break

    backdrop = [
        [round(float(region_lon[region_id]), 3), round(float(region_lat[region_id]), 3)]
        for region_id, country in region_country.items()
        if country == "DE"
    ]

    payload = {
        "schemaVersion": 2,
        "metadata": {
            "title": "Traffic Opportunity Score Deutschland",
            "source": "Mendeley Data 10.17632/py2zkrb65h.2",
            "sourceUrl": "https://data.mendeley.com/datasets/py2zkrb65h/2",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "rawDatasetBytes": ZIP_PATH.stat().st_size,
            "datasetBytes": 0,
            "methodNote": (
                "Scores basieren auf synthetischen, ETISplus-basierten Lkw-Flussdaten "
                "(Modelljahre 2010, 2019, 2030). Sie zeigen Verkehrspotenzial, keine "
                "Ladepunkt-Wirtschaftlichkeit. Der E-Lkw-Hochlauf ist nicht modelliert."
            ),
            "knownCaveat": (
                "Laut Datensatzbeschreibung können einzelne Kantenpfade in "
                "01_Trucktrafficflow in falscher Richtung gelistet sein."
            ),
            "validation": load_validation(),
        },
        "summary": {
            "flowRows": flow_rows,
            "deRegionCount": len(region_records),
            "deTrucks2030": round(de_trucks_2030),
            "deTons2030": round(de_tons_2030),
            "distanceBuckets2030": {
                key: round(distance_buckets.get(key, 0))
                for key in ["<150 km", "150-300 km", "300-600 km", "600-1000 km", "1000+ km"]
            },
        },
        "maxima": {
            "regionTrucks2030": round(max_region_trucks),
            "corridorTrucks2030": round(max_corridor_trucks),
            "edgeTrucks2030": int(hotspot_edges["Traffic_flow_trucks_2030"].max()),
        },
        "regions": sorted(
            region_records, key=lambda item: item["trucks2030"], reverse=True
        )[:TOP_REGION_COUNT],
        "corridors": corridor_records,
        "countryPairs": country_pair_records,
        "edgeHotspots": edge_records,
        "backdrop": backdrop,
    }

    serialized = json.dumps(payload, indent=2, ensure_ascii=False)
    payload["metadata"]["datasetBytes"] = len(serialized.encode("utf-8"))
    serialized = json.dumps(payload, indent=2, ensure_ascii=False)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(serialized, encoding="utf-8")
    print(f"Wrote {OUT_PATH} ({len(serialized.encode('utf-8')) / 1024:.0f} KB)")
    print(f"Regions: {len(payload['regions'])}")
    print(f"Corridors: {len(payload['corridors'])}")
    print(f"Edge hotspots: {len(payload['edgeHotspots'])}")
    print(f"Backdrop points: {len(backdrop)}")
    print(f"Validation: {'yes' if payload['metadata']['validation'] else 'no'}")


if __name__ == "__main__":
    main()
