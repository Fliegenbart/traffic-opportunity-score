from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
ZIP_PATH = ROOT / "data" / "raw" / "mendeley_py2zkrb65h_v2" / "py2zkrb65h-2.zip"
OUT_PATH = ROOT / "client" / "public" / "data" / "traffic-opportunity-de.json"
ZIP_PREFIX = "Synthetic European road freight transport flow dat/"

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

    de_regions = {
        region_id: {
            "id": region_id,
            "name": normalize_region_name(region_name[region_id]),
            "country": "DE",
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

    country_pairs = defaultdict(lambda: {"trucks2019": 0.0, "trucks2030": 0.0})
    distance_buckets = defaultdict(float)
    top_corridor_parts = []
    flow_rows = 0
    de_touch_trucks_2030 = 0.0
    de_touch_tons_2030 = 0.0

    usecols = [
        "ID_origin_region",
        "Name_origin_region",
        "ID_destination_region",
        "Name_destination_region",
        "Total_distance",
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
                if not de_rows.empty:
                    de_touch_trucks_2030 += float(de_rows["Traffic_flow_trucks_2030"].sum())
                    de_touch_tons_2030 += float(de_rows["Traffic_flow_tons_2030"].sum())

                    top_corridor_parts.append(
                        de_rows.nlargest(30, "Traffic_flow_trucks_2030")[
                            [
                                "ID_origin_region",
                                "Name_origin_region",
                                "originCountry",
                                "ID_destination_region",
                                "Name_destination_region",
                                "destinationCountry",
                                "Total_distance",
                                "Traffic_flow_trucks_2019",
                                "Traffic_flow_trucks_2030",
                                "Traffic_flow_tons_2030",
                            ]
                        ]
                    )
                    if len(top_corridor_parts) > 6:
                        top_corridor_parts = [
                            pd.concat(top_corridor_parts).nlargest(
                                120, "Traffic_flow_trucks_2030"
                            )
                        ]

                    for bucket, value in de_rows.assign(
                        bucket=de_rows["Total_distance"].map(distance_bucket)
                    ).groupby("bucket")["Traffic_flow_trucks_2030"].sum().items():
                        distance_buckets[bucket] += float(value)

                    for row in de_rows.itertuples(index=False):
                        flow_2019 = float(row.Traffic_flow_trucks_2019)
                        flow_2030 = float(row.Traffic_flow_trucks_2030)
                        tons_2030 = float(row.Traffic_flow_tons_2030)
                        fit = distance_fit_score(float(row.Total_distance))

                        if row.originCountry == "DE":
                            region = de_regions[row.ID_origin_region]
                            region["trucks2019"] += flow_2019
                            region["trucks2030"] += flow_2030
                            region["tons2030"] += tons_2030
                            region["originTrucks2030"] += flow_2030
                            region["distanceFitWeighted"] += flow_2030 * fit
                            region["distanceFitWeight"] += flow_2030
                            if row.destinationCountry != "DE":
                                region["crossBorderTrucks2030"] += flow_2030

                        if row.destinationCountry == "DE":
                            region = de_regions[row.ID_destination_region]
                            region["trucks2019"] += flow_2019
                            region["trucks2030"] += flow_2030
                            region["tons2030"] += tons_2030
                            region["destinationTrucks2030"] += flow_2030
                            region["distanceFitWeighted"] += flow_2030 * fit
                            region["distanceFitWeight"] += flow_2030
                            if row.originCountry != "DE":
                                region["crossBorderTrucks2030"] += flow_2030

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
        region_records.append(
            {
                "id": region["id"],
                "name": region["name"],
                "country": region["country"],
                "trucks2019": round(region["trucks2019"]),
                "trucks2030": round(region["trucks2030"]),
                "tons2030": round(region["tons2030"]),
                "crossBorderTrucks2030": round(region["crossBorderTrucks2030"]),
                "crossBorderShare": round(cross_share, 4),
                "distanceFitScore": round(distance_fit),
                "corridorRelevanceScore": corridor_relevance,
                "originTrucks2030": round(region["originTrucks2030"]),
                "destinationTrucks2030": round(region["destinationTrucks2030"]),
            }
        )

    top_corridors = pd.concat(top_corridor_parts).nlargest(
        90, "Traffic_flow_trucks_2030"
    )
    max_corridor_trucks = float(top_corridors["Traffic_flow_trucks_2030"].max())
    corridor_records = []
    for row in top_corridors.itertuples(index=False):
        cross_border = row.originCountry != row.destinationCountry
        corridor_records.append(
            {
                "originRegionId": str(row.ID_origin_region),
                "originRegion": normalize_region_name(row.Name_origin_region),
                "originCountry": row.originCountry,
                "destinationRegionId": str(row.ID_destination_region),
                "destinationRegion": normalize_region_name(row.Name_destination_region),
                "destinationCountry": row.destinationCountry,
                "totalDistanceKm": round(float(row.Total_distance), 1),
                "trucks2019": round(float(row.Traffic_flow_trucks_2019)),
                "trucks2030": round(float(row.Traffic_flow_trucks_2030)),
                "tons2030": round(float(row.Traffic_flow_tons_2030)),
                "distanceFitScore": distance_fit_score(float(row.Total_distance)),
                "corridorRelevanceScore": 100 if cross_border else 70,
                "crossBorder": cross_border,
            }
        )

    node_a = nodes[
        ["Network_Node_ID", "Network_Node_X", "Network_Node_Y", "Country"]
    ].rename(
        columns={
            "Network_Node_ID": "Network_Node_A_ID",
            "Network_Node_X": "aLon",
            "Network_Node_Y": "aLat",
            "Country": "aCountry",
        }
    )
    node_b = nodes[
        ["Network_Node_ID", "Network_Node_X", "Network_Node_Y", "Country"]
    ].rename(
        columns={
            "Network_Node_ID": "Network_Node_B_ID",
            "Network_Node_X": "bLon",
            "Network_Node_Y": "bLat",
            "Country": "bCountry",
        }
    )
    edge_rows = (
        edges.merge(node_a, on="Network_Node_A_ID", how="left")
        .merge(node_b, on="Network_Node_B_ID", how="left")
        .query("aCountry == 'DE' or bCountry == 'DE'")
        .sort_values("Traffic_flow_trucks_2030", ascending=False)
        .head(60)
    )
    edge_records = []
    for row in edge_rows.itertuples(index=False):
        edge_records.append(
            {
                "edgeId": int(row.Network_Edge_ID),
                "distanceKm": round(float(row.Distance), 3),
                "aCountry": row.aCountry,
                "bCountry": row.bCountry,
                "aLon": round(float(row.aLon), 6),
                "aLat": round(float(row.aLat), 6),
                "bLon": round(float(row.bLon), 6),
                "bLat": round(float(row.bLat), 6),
                "trucks2019": int(row.Traffic_flow_trucks_2019),
                "trucks2030": int(row.Traffic_flow_trucks_2030),
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

    payload = {
        "metadata": {
            "title": "Traffic Opportunity Score Deutschland",
            "source": "Mendeley Data 10.17632/py2zkrb65h.2",
            "sourceUrl": "https://data.mendeley.com/datasets/py2zkrb65h/2",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "methodNote": (
                "Scores are based on synthetic ETISplus-derived truck-flow data. "
                "They indicate traffic opportunity, not final charger profitability."
            ),
            "knownCaveat": (
                "The source notes that some edge paths in 01_Trucktrafficflow may be "
                "listed in the incorrect direction."
            ),
        },
        "summary": {
            "flowRows": flow_rows,
            "deRegionCount": len(region_records),
            "deTouchTrucks2030": round(de_touch_trucks_2030),
            "deTouchTons2030": round(de_touch_tons_2030),
            "distanceBuckets2030": {
                key: round(distance_buckets.get(key, 0))
                for key in ["<150 km", "150-300 km", "300-600 km", "600-1000 km", "1000+ km"]
            },
        },
        "maxima": {
            "regionTrucks2030": round(max_region_trucks),
            "corridorTrucks2030": round(max_corridor_trucks),
            "edgeTrucks2030": int(edge_rows["Traffic_flow_trucks_2030"].max()),
        },
        "regions": sorted(
            region_records, key=lambda item: item["trucks2030"], reverse=True
        )[:120],
        "corridors": corridor_records,
        "countryPairs": country_pair_records,
        "edgeHotspots": edge_records,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT_PATH}")
    print(f"Regions: {len(payload['regions'])}")
    print(f"Corridors: {len(payload['corridors'])}")
    print(f"Edge hotspots: {len(payload['edgeHotspots'])}")


if __name__ == "__main__":
    main()
