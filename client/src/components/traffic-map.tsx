import { useMemo, useState } from "react";

// Equirektangulare Projektion, auf Deutschland zugeschnitten. Die Karte kommt
// ohne Tiles und Geometrien aus: 429 Regions-Zentroiden bilden die Silhouette.
const MIN_LON = 5.4;
const MAX_LON = 15.6;
const MIN_LAT = 47.0;
const MAX_LAT = 55.3;
const LON_SCALE = Math.cos((51 * Math.PI) / 180);
const SCALE = 46;

export const MAP_WIDTH = (MAX_LON - MIN_LON) * LON_SCALE * SCALE;
export const MAP_HEIGHT = (MAX_LAT - MIN_LAT) * SCALE;

export function project(lon: number, lat: number): [number, number] {
  return [
    (lon - MIN_LON) * LON_SCALE * SCALE,
    (MAX_LAT - lat) * SCALE,
  ];
}

export interface MapEdge {
  edgeId: number;
  label: string;
  aLon: number;
  aLat: number;
  bLon: number;
  bLat: number;
  trucks2030: number;
}

export interface MapRegion {
  id: string;
  name: string;
  lon: number;
  lat: number;
  trucks2030: number;
  score: number;
}

interface TooltipState {
  x: number;
  y: number;
  label: string;
}

export function scoreColor(score: number) {
  if (score >= 75) return "#0A99A4";
  if (score >= 55) return "#0DBBC8";
  if (score >= 35) return "#d99000";
  return "#9aa0a6";
}

export default function TrafficMap({
  backdrop,
  edges,
  regions,
  selectedRegionId,
  selectedEdgeId,
  onSelectRegion,
  onSelectEdge,
}: {
  backdrop: [number, number][];
  edges: MapEdge[];
  regions: MapRegion[];
  selectedRegionId: string;
  selectedEdgeId: number | null;
  onSelectRegion: (id: string) => void;
  onSelectEdge: (id: number) => void;
}) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const maxEdgeTrucks = useMemo(
    () => Math.max(1, ...edges.map((edge) => edge.trucks2030)),
    [edges],
  );
  const maxRegionTrucks = useMemo(
    () => Math.max(1, ...regions.map((region) => region.trucks2030)),
    [regions],
  );

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="Karte der Lkw-Verkehrs-Hotspots in Deutschland"
        onMouseLeave={() => setTooltip(null)}
      >
        {backdrop.map(([lon, lat], index) => {
          const [x, y] = project(lon, lat);
          return <circle key={index} cx={x} cy={y} r={1.7} fill="#e3e4e8" />;
        })}

        {regions.map((region) => {
          const [x, y] = project(region.lon, region.lat);
          const selected = region.id === selectedRegionId;
          const radius = 3 + Math.sqrt(region.trucks2030 / maxRegionTrucks) * 8.5;
          return (
            <circle
              key={region.id}
              cx={x}
              cy={y}
              r={radius}
              fill={scoreColor(region.score)}
              stroke={selected ? "#1d1d1f" : "white"}
              strokeWidth={selected ? 1.8 : 0.9}
              opacity={selected ? 0.95 : 0.78}
              className="cursor-pointer"
              onClick={() => onSelectRegion(region.id)}
              onMouseEnter={() =>
                setTooltip({
                  x,
                  y,
                  label: `${region.name} · Score ${region.score}`,
                })
              }
            />
          );
        })}

        {edges.map((edge) => {
          const [x1, y1] = project(edge.aLon, edge.aLat);
          const [x2, y2] = project(edge.bLon, edge.bLat);
          // Reale Abschnitte sind oft nur wenige Kilometer lang — für die
          // Lesbarkeit strecken wir sie auf eine visuelle Mindestlänge.
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          const length = Math.hypot(x2 - x1, y2 - y1) || 1;
          const minLength = 9;
          const stretch = Math.max(1, minLength / length);
          const sx1 = midX + (x1 - midX) * stretch;
          const sy1 = midY + (y1 - midY) * stretch;
          const sx2 = midX + (x2 - midX) * stretch;
          const sy2 = midY + (y2 - midY) * stretch;
          const selected = edge.edgeId === selectedEdgeId;
          const width = 2 + (edge.trucks2030 / maxEdgeTrucks) * 3.6;
          return (
            <g key={edge.edgeId}>
              <line
                x1={sx1}
                y1={sy1}
                x2={sx2}
                y2={sy2}
                stroke="white"
                strokeWidth={width + 2.2}
                strokeLinecap="round"
                opacity={selectedEdgeId === null || selected ? 0.9 : 0.35}
              />
              <line
                x1={sx1}
                y1={sy1}
                x2={sx2}
                y2={sy2}
                stroke={selected ? "#06737b" : "#0A99A4"}
                strokeWidth={selected ? width + 1.2 : width}
                strokeLinecap="round"
                opacity={selectedEdgeId === null || selected ? 0.95 : 0.35}
              />
              <line
                x1={sx1}
                y1={sy1}
                x2={sx2}
                y2={sy2}
                stroke="transparent"
                strokeWidth={11}
                strokeLinecap="round"
                className="cursor-pointer"
                onClick={() => onSelectEdge(edge.edgeId)}
                onMouseEnter={() =>
                  setTooltip({
                    x: midX,
                    y: midY,
                    label: `${edge.label} · ≈ ${Math.round(edge.trucks2030 / 365).toLocaleString("de-DE")} Lkw/Tag`,
                  })
                }
              />
            </g>
          );
        })}
      </svg>

      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-[#1d1d1f] px-3 py-1.5 text-xs font-medium text-white shadow-lg"
          style={{
            left: `${(tooltip.x / MAP_WIDTH) * 100}%`,
            top: `${(tooltip.y / MAP_HEIGHT) * 100}%`,
          }}
        >
          {tooltip.label}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#6e6e73]">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-1 w-6 rounded-full bg-[#0A99A4]" />
          Hotspot-Strecke (Breite = Lkw-Verkehr 2030)
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-[#0DBBC8]" />
          Region (Größe = Verkehr, Farbe = Score)
        </span>
      </div>
    </div>
  );
}
