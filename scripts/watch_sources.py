"""Weekly watch for sources that do not exist yet. Prints one line per newly available source.

Only checks fixed official URLs; it never downloads data or changes app files.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

AGENT = {"User-Agent": "Truckonomics-source-watch/1.0"}


def fetch(url: str, head: bool = False):
    request = Request(url, headers=AGENT, method="HEAD" if head else "GET")
    try:
        with urlopen(request, timeout=30) as response:
            return response.status, b"" if head else response.read(3_000_000)
    except HTTPError as error:
        return error.code, b""
    except URLError:
        return None, b""


def svz_newer_than_2021(html: str):
    years = sorted({int(y) for y in re.findall(r"Verkehrsdaten/(20\d{2})/[^\"']+\.xlsx", html)})
    newer = [y for y in years if y > 2021]
    return f"SVZ {newer[-1]} als Excel auf bast.de" if newer else None


def checks(today: date):
    year = today.year - 1
    return [
        {"id": "bast-svz-2025", "title": "BASt Straßenverkehrszählung: neue Streckenwerte veröffentlicht",
         "url": "https://www.bast.de/DE/Publikationen/Statistik/Verkehrsdaten/Manuelle-Zaehlung.html",
         "test": lambda status, body: status == 200 and svz_newer_than_2021(body.decode("utf-8", "replace"))},
        {"id": f"bast-hourly-{year}", "title": f"BASt validierte Stundenwerte {year} verfügbar",
         "url": f"https://www.bast.de/videos/{year}_A_S.zip", "head": True,
         "test": lambda status, body: status == 200 and "Validierte Jahres-Stundenwerte statt ungeprüfter Rohdaten möglich"},
    ]


def run(today: date | None = None, fetcher=fetch):
    found = []
    for check in checks(today or date.today()):
        status, body = fetcher(check["url"], check.get("head", False))
        result = check["test"](status, body)
        if result:
            found.append({"id": check["id"], "title": check["title"], "url": check["url"], "detail": result})
    return found


if __name__ == "__main__":
    results = run()
    json.dump(results, sys.stdout, ensure_ascii=False)
