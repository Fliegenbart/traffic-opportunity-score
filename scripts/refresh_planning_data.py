"""Manual source refresh. No schedule, guessed URLs, or automatic deployment."""
from __future__ import annotations

import argparse
import calendar
import http.cookiejar
import re
import time
from datetime import date
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, Request, build_opener
from zipfile import ZipFile

from planning_data import ROOT, build_network, import_bast_archive, write_json

METADATA_URL = "https://www.govdata.de/ckan/dataset/automatische-dauerzahlstellen-rohdaten.ttl"
MENDELEY_DOWNLOAD = "https://data.mendeley.com/public-api/zip/py2zkrb65h/download/2"
HOSTS = {"www.govdata.de", "files.bast.de", "data.mendeley.com", "prod-dcd-datasets-cache-zipfiles.s3.eu-west-1.amazonaws.com"}


def checked_url(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in HOSTS or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Source URL outside official allowlist")
    return url


class CheckedRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        checked_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url, path, limit, timeout=900):
    opener = build_opener(CheckedRedirect(), HTTPCookieProcessor(http.cookiejar.CookieJar()))
    deadline = time.monotonic() + timeout
    temporary = path.with_suffix(path.suffix + ".download")
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with opener.open(Request(checked_url(url), headers={"User-Agent": "Truckonomics-source-import/1.0"}), timeout=30) as response:
            length = int(response.headers.get("Content-Length") or 0)
            if length > limit:
                raise ValueError("Source exceeds download byte limit")
            total = 0
            with temporary.open("wb") as handle:
                while True:
                    if time.monotonic() > deadline:
                        raise TimeoutError("Source download deadline exceeded")
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > limit:
                        raise ValueError("Source exceeds download byte limit")
                    handle.write(chunk)
            if not total or (length and total != length):
                raise ValueError("Incomplete source response")
        if path.suffix == ".zip":
            with ZipFile(temporary) as archive:
                if not archive.namelist():
                    raise ValueError("Empty source archive")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def select_bast_month(metadata, month=None):
    from rdflib import Graph, Namespace, URIRef
    from rdflib.namespace import DCTERMS
    graph = Graph().parse(data=metadata, format="turtle")
    dcat = Namespace("http://www.w3.org/ns/dcat#")
    candidates = []
    for subject, access in graph.subject_objects(dcat.accessURL):
        url = str(access)
        name = Path(unquote(urlparse(url).path)).name
        match = re.fullmatch(r"DZ_(\d{4})_(\d{2})_Rohdaten\.zip", name)
        if not match:
            continue
        checked_url(url)
        year, number = map(int, match.groups())
        first = date(year, number, 1)
        last = date(year, number, calendar.monthrange(year, number)[1])
        if last >= date.today():
            continue
        licenses = set(graph.objects(subject, DCTERMS.license))
        if licenses != {URIRef("http://dcat-ap.de/def/licenses/cc-by/4.0")}:
            continue
        candidates.append({"month": first.strftime("%Y-%m"), "start": first.isoformat(), "end": last.isoformat(), "url": url, "filename": name})
    if month:
        candidates = [c for c in candidates if c["month"] == month]
    if not candidates:
        raise ValueError("No completed monthly BASt distribution with confirmed CC-BY-4.0 license")
    latest = max(c["month"] for c in candidates)
    matches = [c for c in candidates if c["month"] == latest]
    if len(matches) != 1:
        raise ValueError("Ambiguous BASt monthly distribution")
    return matches[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--month", help="YYYY-MM; default: latest licensed complete provider month")
    parser.add_argument("--force-mendeley", action="store_true", help="Re-download the large Mendeley v2 archive")
    args = parser.parse_args()
    metadata = ROOT / "data/raw/bast/license.ttl"
    download(METADATA_URL, metadata, 2000000, timeout=60)
    selected = select_bast_month(metadata.read_text(encoding="utf-8"), args.month)
    archive = ROOT / "data/raw/bast" / selected["filename"]
    download(selected["url"], archive, 300000000)
    bast = import_bast_archive(archive, selected["start"], selected["end"], metadata)
    bast["quality"]["downloadUrl"] = selected["url"]
    mendeley = ROOT / "data/raw/mendeley_py2zkrb65h_v2/py2zkrb65h-2.zip"
    if not mendeley.exists() or args.force_mendeley:
        download(MENDELEY_DOWNLOAD, mendeley, 400000000)
    network = build_network(mendeley)
    output = ROOT / "client/public/data/planning"
    write_json(output / "network-de.json", network)
    write_json(output / "bast-hourly-de.json", bast)
    print(f"Built {len(network['edges'])} edges and {len(bast['stations'])} BASt stations for {selected['month']}. No deployment triggered.")


if __name__ == "__main__":
    main()
