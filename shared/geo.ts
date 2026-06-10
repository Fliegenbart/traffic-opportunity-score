export interface GeoPoint {
  lon: number;
  lat: number;
}

const KM_PER_DEG_LAT = 111.32;

function toXY(point: GeoPoint, refLatRad: number): [number, number] {
  return [point.lon * KM_PER_DEG_LAT * Math.cos(refLatRad), point.lat * KM_PER_DEG_LAT];
}

// Equirektangular reicht für Deutschland-Distanzen (Fehler < 1 % bis ~500 km).
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const refLatRad = (((a.lat + b.lat) / 2) * Math.PI) / 180;
  const [ax, ay] = toXY(a, refLatRad);
  const [bx, by] = toXY(b, refLatRad);
  return Math.hypot(bx - ax, by - ay);
}

export function nearestDistanceKm(
  point: GeoPoint,
  candidates: GeoPoint[],
): { distanceKm: number; index: number } | null {
  let best: { distanceKm: number; index: number } | null = null;
  candidates.forEach((candidate, index) => {
    const d = distanceKm(point, candidate);
    if (!best || d < best.distanceKm) {
      best = { distanceKm: d, index };
    }
  });
  return best;
}

export function pointToSegmentKm(point: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const refLatRad = ((a.lat + b.lat) / 2 / 180) * Math.PI;
  const [px, py] = toXY(point, refLatRad);
  const [ax, ay] = toXY(a, refLatRad);
  const [bx, by] = toXY(b, refLatRad);
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export interface CorridorChargingStats {
  corridorKm: number;
  hubsOnRoute: number;
  maxGapKm: number;
}

// Lücken-Statistik entlang einer echten Routen-Polylinie (z. B. aus OSRM):
// Lader im Puffer werden auf ihre Position entlang der Route projiziert.
export function polylineChargingStats(
  polyline: GeoPoint[],
  hubs: GeoPoint[],
  bufferKm = 10,
): CorridorChargingStats {
  if (polyline.length < 2) return { corridorKm: 0, hubsOnRoute: 0, maxGapKm: 0 };

  const cumulative: number[] = [0];
  for (let i = 1; i < polyline.length; i++) {
    cumulative.push(cumulative[i - 1] + distanceKm(polyline[i - 1], polyline[i]));
  }
  const totalKm = cumulative[cumulative.length - 1];

  const positionsKm: number[] = [];
  for (const hub of hubs) {
    let bestDist = Infinity;
    let bestPos = 0;
    for (let i = 1; i < polyline.length; i++) {
      const a = polyline[i - 1];
      const b = polyline[i];
      const d = pointToSegmentKm(hub, a, b);
      if (d < bestDist) {
        bestDist = d;
        // Position entlang des Segments über das Distanzverhältnis nähern.
        const segLen = cumulative[i] - cumulative[i - 1];
        const da = distanceKm(hub, a);
        const db = distanceKm(hub, b);
        const t = da + db > 0 ? da / (da + db) : 0;
        bestPos = cumulative[i - 1] + Math.min(1, Math.max(0, t)) * segLen;
      }
    }
    if (bestDist <= bufferKm) positionsKm.push(bestPos);
  }

  positionsKm.sort((a, b) => a - b);
  let maxGapKm = 0;
  let previous = 0;
  for (const position of positionsKm) {
    maxGapKm = Math.max(maxGapKm, position - previous);
    previous = position;
  }
  maxGapKm = Math.max(maxGapKm, totalKm - previous);

  return {
    corridorKm: Math.round(totalKm),
    hubsOnRoute: positionsKm.length,
    maxGapKm: Math.round(maxGapKm),
  };
}

// Luftlinien-Näherung: Lader im Korridor-Puffer werden auf die Strecke
// projiziert; die größte Lücke zwischen zwei aufeinanderfolgenden
// Lademöglichkeiten (inkl. Start und Ziel) ist die kritische Kennzahl.
export function corridorChargingStats(
  origin: GeoPoint,
  destination: GeoPoint,
  hubs: GeoPoint[],
  bufferKm = 10,
): CorridorChargingStats {
  const corridorKm = distanceKm(origin, destination);
  if (corridorKm === 0) {
    return { corridorKm: 0, hubsOnRoute: 0, maxGapKm: 0 };
  }

  const refLatRad = ((origin.lat + destination.lat) / 2 / 180) * Math.PI;
  const [ax, ay] = toXY(origin, refLatRad);
  const [bx, by] = toXY(destination, refLatRad);
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  const positionsKm: number[] = [];
  for (const hub of hubs) {
    const [px, py] = toXY(hub, refLatRad);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const distToLine = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (distToLine <= bufferKm) {
      positionsKm.push(t * corridorKm);
    }
  }

  positionsKm.sort((a, b) => a - b);
  let maxGapKm = 0;
  let previous = 0;
  for (const position of positionsKm) {
    maxGapKm = Math.max(maxGapKm, position - previous);
    previous = position;
  }
  maxGapKm = Math.max(maxGapKm, corridorKm - previous);

  return {
    corridorKm: Math.round(corridorKm),
    hubsOnRoute: positionsKm.length,
    maxGapKm: Math.round(maxGapKm),
  };
}
