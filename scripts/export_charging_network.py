"""Freeze ALL DE-DE model segments for the existing 3 km proximity filter.

Only these small geometry arrays are needed by the daily charging import.
Usage: python3 scripts/export_charging_network.py path/to/py2zkrb65h-2.zip
"""
import json
import sys
from pathlib import Path
from zipfile import ZipFile

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "Synthetic European road freight transport flow dat/"
with ZipFile(sys.argv[1]) as archive:
    nodes = pd.read_csv(archive.open(PREFIX + "03_network-nodes.csv"))
    edges = pd.read_csv(archive.open(PREFIX + "04_network-edges.csv"))
nodes = nodes.set_index("Network_Node_ID")
segments = []
for edge in edges.itertuples(index=False):
    a, b = nodes.loc[edge.Network_Node_A_ID], nodes.loc[edge.Network_Node_B_ID]
    if a.Country == "DE" and b.Country == "DE":
        segments.append([float(a.Network_Node_X), float(a.Network_Node_Y),
                         float(b.Network_Node_X), float(b.Network_Node_Y)])
payload = {"schemaVersion": 1, "source": "Mendeley Data 10.17632/py2zkrb65h.2",
           "methodNote": "All DE-DE edges; unchanged geometry for the charging proximity filter.",
           "segments": segments}
path = ROOT / "curated/charging-network-segments-de.json"
path.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
print(f"Exported {len(segments)} segments to {path}")
