import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import sid_occupancy as s

HEAD = '<d2LogicalModel xmlns="http://datex2.eu/schema/2/2_0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><payloadPublication>'
STATIC = (HEAD + '<parkingTablePublication><parkingTable><parkingRecord id="DE-BW-1" xsi:type="InterUrbanParkingSite">'
          '<parkingName><values><value lang="de">Rastanlage Test</value></values></parkingName>'
          '<parkingNumberOfSpaces>40</parkingNumberOfSpaces><parkingOccupanyDetectionType>modelBased</parkingOccupanyDetectionType>'
          '<operator><contactDetailsEMail>someone@example.org</contactDetailsEMail></operator>'
          '<parkingLocation><pointByCoordinates><pointCoordinates><latitude>48.123456</latitude><longitude>9.5</longitude>'
          '</pointCoordinates></pointByCoordinates></parkingLocation>'
          '<parkingAccess><location><primaryRoad><roadIdentifier>A8</roadIdentifier></primaryRoad></location></parkingAccess>'
          '</parkingRecord><parkingRecord id="DE-NOPOS"><parkingName><values><value>X</value></values></parkingName></parkingRecord>'
          '</parkingTable></parkingTablePublication></payloadPublication></d2LogicalModel>')


def status(ident, origin, occ, veh="3", opening="open"):
    return (f'<parkingRecordStatus><parkingRecordReference id="{ident}"/><parkingStatusOriginTime>{origin}</parkingStatusOriginTime>'
            f'<parkingOccupancy><parkingNumberOfVehicles>{veh}</parkingNumberOfVehicles><parkingOccupancy>{occ}</parkingOccupancy></parkingOccupancy>'
            f'<parkingSiteOpeningStatus>{opening}</parkingSiteOpeningStatus></parkingRecordStatus>')


NOW = datetime(2026, 11, 3, 22, 0, tzinfo=timezone.utc)


class ParseTests(unittest.TestCase):
    def test_static_keeps_site_drops_contacts_and_unlocated(self):
        sites = s.parse_static(STATIC.encode())
        self.assertEqual(list(sites), ["DE-BW-1"])
        site = sites["DE-BW-1"]
        self.assertEqual((site["name"], site["spaces"], site["lat"], site["road"]), ("Rastanlage Test", 40, 48.12346, "A8"))
        self.assertNotIn("someone@example.org", repr(sites))

    def test_dynamic_drops_stale_and_closed(self):
        xml = (HEAD + "<parkingStatusPublication>"
               + status("A", "2026-11-03T21:50:00+00:00", "45.0")
               + status("B", "2026-11-03T18:00:00+00:00", "50.0")
               + status("C", "2026-11-03T21:55:00+00:00", "70.0", opening="closed")
               + status("D", "2026-11-03T21:55:00.123+00:00", "130")
               + "</parkingStatusPublication></payloadPublication></d2LogicalModel>")
        rows = s.parse_dynamic(xml.encode(), NOW)
        self.assertEqual([(r["id"], r["occupancy"]) for r in rows], [("A", 45), ("D", 100)])


class ProfileTests(unittest.TestCase):
    def test_roundtrip_and_berlin_hours(self):
        sites = s.parse_static(STATIC.encode())
        with tempfile.TemporaryDirectory() as tmp:
            # 22:00 UTC on a Tuesday is 23:00 in Berlin (CET): a weekday night hour.
            s.append_samples(Path(tmp), [{"id": "DE-BW-1", "occupancy": 80, "vehicles": 30}], NOW)
            s.append_samples(Path(tmp), [{"id": "DE-BW-1", "occupancy": 100, "vehicles": ""}], NOW.replace(hour=12))
            s.append_samples(Path(tmp), [{"id": "UNKNOWN", "occupancy": 10, "vehicles": 1}], NOW)
            profiles, coverage = s.build_profiles(s.read_samples(Path(tmp), NOW), sites)
        self.assertEqual(len(profiles), 1)
        p = profiles[0]
        self.assertEqual((p["weekday"][23], p["weekday"][13], p["nightOccupancy"], p["meanVehicles"]), (80, 100, 80, 30.0))
        self.assertEqual((p["fullShare"], p["samples"], coverage["days"], coverage["samples"]), (0.5, 2, 1, 2))
        self.assertIsNone(p["weekend"][23])

    def test_quality_gate(self):
        with self.assertRaises(SystemExit):
            s.check_quality({"a": {}}, [{}], None)


if __name__ == "__main__":
    unittest.main()
