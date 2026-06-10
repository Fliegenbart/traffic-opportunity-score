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
  whiteSpot?: boolean;
}

export interface MapRegion {
  id: string;
  name: string;
  lon: number;
  lat: number;
  trucks2030: number;
  score: number;
}

export interface MapCharger {
  id: string;
  name: string;
  lon: number;
  lat: number;
  status: "live" | "announced";
  type: "mcs" | "hpc";
}

export interface MapRoute {
  label: string;
  aLabel?: string;
  bLabel?: string;
  aLon: number;
  aLat: number;
  bLon: number;
  bLat: number;
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
  chargers = [],
  proxyChargers = [],
  routes = [],
  variant = "light",
  selectedRegionId,
  selectedEdgeId,
  onSelectRegion,
  onSelectEdge,
}: {
  backdrop: [number, number][];
  edges: MapEdge[];
  regions: MapRegion[];
  chargers?: MapCharger[];
  proxyChargers?: [number, number][];
  routes?: MapRoute[];
  variant?: "light" | "dark";
  selectedRegionId: string;
  selectedEdgeId: number | null;
  onSelectRegion: (id: string) => void;
  onSelectEdge: (id: number) => void;
}) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const dark = variant === "dark";
  const palette = dark
    ? {
        backdropDot: "#34383f",
        edgeCasing: "rgba(13,187,200,0.16)",
        edge: "#19c8d4",
        edgeSelected: "#7ef0f7",
        whiteSpotEdge: "#e8a13a",
        regionStroke: "#17181c",
        chargerFill: "#a78bfa",
        chargerStroke: "#17181c",
        legendText: "text-white/55",
      }
    : {
        backdropDot: "#e3e4e8",
        edgeCasing: "white",
        edge: "#0A99A4",
        edgeSelected: "#06737b",
        whiteSpotEdge: "#d99000",
        regionStroke: "white",
        chargerFill: "#7c3aed",
        chargerStroke: "white",
        legendText: "text-[#6e6e73]",
      };

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
          return <circle key={index} cx={x} cy={y} r={1.7} fill={palette.backdropDot} />;
        })}

        {proxyChargers.map(([lon, lat], index) => {
          const [x, y] = project(lon, lat);
          return <circle key={`p-${index}`} cx={x} cy={y} r={1.1} fill="#7c3aed" opacity={0.22} />;
        })}

        {regions.map((region) => {
          const [x, y] = project(region.lon, region.lat);
          const selected = region.id === selectedRegionId;
          const radius = dark
            ? 2.5 + Math.sqrt(region.trucks2030 / maxRegionTrucks) * 6.5
            : 3 + Math.sqrt(region.trucks2030 / maxRegionTrucks) * 8.5;
          return (
            <circle
              key={region.id}
              cx={x}
              cy={y}
              r={radius}
              // Im Dark-Hero gehört Amber den Lade-Lücken — Regionen bleiben
              // dort einfarbig und treten zurück.
              fill={dark ? "#3d8b95" : scoreColor(region.score)}
              stroke={selected ? (dark ? "white" : "#1d1d1f") : palette.regionStroke}
              strokeWidth={selected ? 1.8 : 0.9}
              opacity={selected ? 0.95 : dark ? 0.5 : 0.78}
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
          const baseColor = edge.whiteSpot ? palette.whiteSpotEdge : palette.edge;
          return (
            <g key={edge.edgeId}>
              {dark && (
                <line
                  x1={sx1}
                  y1={sy1}
                  x2={sx2}
                  y2={sy2}
                  stroke={baseColor}
                  strokeWidth={width + 6}
                  strokeLinecap="round"
                  opacity={selectedEdgeId === null || selected ? 0.18 : 0.06}
                />
              )}
              <line
                x1={sx1}
                y1={sy1}
                x2={sx2}
                y2={sy2}
                stroke={palette.edgeCasing}
                strokeWidth={width + 2.2}
                strokeLinecap="round"
                opacity={selectedEdgeId === null || selected ? 0.9 : 0.3}
              />
              <line
                x1={sx1}
                y1={sy1}
                x2={sx2}
                y2={sy2}
                stroke={selected ? palette.edgeSelected : baseColor}
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

        {routes.map((route, index) => {
          const [x1, y1] = project(route.aLon, route.aLat);
          const [x2, y2] = project(route.bLon, route.bLat);
          return (
            <g key={`route-${index}`}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#1d1d1f"
                strokeWidth={1.6}
                strokeDasharray="5 4"
                opacity={0.85}
              />
              <circle cx={x1} cy={y1} r={3} fill="#1d1d1f" />
              <circle cx={x2} cy={y2} r={3} fill="#1d1d1f" />
            </g>
          );
        })}

        {(() => {
          // Endpunkt-Labels: gleiche Orte (z. B. Hamburg in drei Relationen)
          // nur einmal beschriften.
          const seen = new Set<string>();
          const labels: { x: number; y: number; text: string }[] = [];
          for (const route of routes) {
            for (const [lon, lat, text] of [
              [route.aLon, route.aLat, route.aLabel],
              [route.bLon, route.bLat, route.bLabel],
            ] as const) {
              if (!text) continue;
              const key = `${lon.toFixed(2)},${lat.toFixed(2)}`;
              if (seen.has(key)) continue;
              seen.add(key);
              const [x, y] = project(lon, lat);
              labels.push({ x, y, text });
            }
          }
          return labels.map((label) => (
            <text
              key={label.text}
              x={label.x + 5}
              y={label.y - 4}
              fontSize={8.5}
              fontWeight={600}
              fill="#1d1d1f"
              stroke="white"
              strokeWidth={2.5}
              paintOrder="stroke"
            >
              {label.text}
            </text>
          ));
        })()}

        {chargers.map((charger) => {
          const [x, y] = project(charger.lon, charger.lat);
          const r = charger.type === "mcs" ? 5 : 3.8;
          const live = charger.status === "live";
          return (
            <path
              key={charger.id}
              d={`M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`}
              fill={live ? palette.chargerFill : palette.chargerStroke}
              stroke={live ? palette.chargerStroke : palette.chargerFill}
              strokeWidth={1.1}
              opacity={0.95}
              className="cursor-pointer"
              onMouseEnter={() =>
                setTooltip({
                  x,
                  y,
                  label: `${charger.name}${live ? "" : " (angekündigt)"}`,
                })
              }
            />
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

      <div
        className={`mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs ${palette.legendText}`}
      >
        {edges.length > 0 && (
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-block h-1 w-6 rounded-full"
              style={{ background: palette.edge }}
            />
            Hotspot-Strecke (Breite = Lkw-Verkehr 2030)
          </span>
        )}
        {edges.some((edge) => edge.whiteSpot) && (
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-block h-1 w-6 rounded-full"
              style={{ background: palette.whiteSpotEdge }}
            />
            Lade-Lücke (kein Lkw-Ladepark ≤ 25 km)
          </span>
        )}
        {regions.length > 0 && (
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-[#0DBBC8]" />
            {dark ? "Region (Größe = Verkehr)" : "Region (Größe = Verkehr, Farbe = Score)"}
          </span>
        )}
        {routes.length > 0 && (
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-block h-0 w-6 border-t-2 border-dashed border-[#1d1d1f]"
              aria-hidden
            />
            Ihre Relation (Luftlinie)
          </span>
        )}
        {chargers.length > 0 && (
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rotate-45"
              style={{ background: palette.chargerFill }}
            />
            Lkw-Ladepark (verifiziert; Umriss = angekündigt)
          </span>
        )}
      </div>
    </div>
  );
}
