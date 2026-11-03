"""One-off probe: show the structure of both SID payloads (tag counts + first record), not the raw data."""
from __future__ import annotations

import collections
import xml.etree.ElementTree as ET

from mobilithek import SID_DYNAMIC, SID_STATIC, client_cert, pull


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def describe(name: str, body: bytes, record_tags: tuple[str, ...]) -> None:
    print(f"== {name}: {len(body)} bytes")
    root = ET.fromstring(body)
    counts = collections.Counter(local(el.tag) for el in root.iter())
    print("root:", local(root.tag), "| namespaces:", sorted({el.tag.split('}')[0][1:] for el in root.iter() if '}' in el.tag}))
    for tag, n in counts.most_common(60):
        print(f"  {tag}: {n}")
    for el in root.iter():
        if local(el.tag) in record_tags:
            print("-- first", local(el.tag))
            print(ET.tostring(el, encoding="unicode")[:4000])
            break


def main() -> None:
    with client_cert() as cert:
        describe("static", pull(SID_STATIC, cert), ("parkingRecord", "parkingSite"))
        describe("dynamic", pull(SID_DYNAMIC, cert), ("parkingRecordStatus", "parkingSiteStatus"))


if __name__ == "__main__":
    main()
