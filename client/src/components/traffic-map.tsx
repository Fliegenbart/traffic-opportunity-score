import { useMemo, useState } from "react";
import { GERMANY_PATH } from "./germany-outline";

// Motion-Spezifikation aus dem Design-Prototyp (design/briefing-animated-map.md):
// Eingangs-Choreografie ≤ 2 s, danach unaufdringlicher Ruhe-Loop. Animationen
// laufen nur in der Dark-Variante — die helle Variante bleibt druckstabil.
const MAP_KEYFRAMES = `
@keyframes tmDraw { to { stroke-dashoffset: 0; } }
@keyframes tmFade { from { opacity: 0; } }
@keyframes tmFadeOut { to { opacity: 0; } }
@keyframes tmPop { from { opacity: 0; transform: scale(0.35); } }
@keyframes tmEmber { 0%, 100% { opacity: 0.5; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.1); } }
@keyframes tmRing { 0% { opacity: 0; transform: scale(0.25); } 10% { opacity: 0.8; } 32% { opacity: 0; transform: scale(1.9); } 100% { opacity: 0; transform: scale(1.9); } }
@keyframes tmFlow { to { stroke-dashoffset: -10.5; } }
@keyframes tmDash { to { stroke-dashoffset: -10; } }
@media (prefers-reduced-motion: reduce) {
  .tm-anim [data-anim] { animation: none !important; }
}
`;

// Deterministisches Pseudo-Random je Objekt — Math.random() würde bei jedem
// React-Render neu streuen.
function hash01(seed: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 2654435761);
  h = Math.imul(h ^ (h >>> 13), 1597334677);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Dezente Orientierungsstädte — bewusst wenige, damit die Datenebenen führen.
const ANCHOR_CITIES: { name: string; lon: number; lat: number }[] = [
  { name: "Hamburg", lon: 9.99, lat: 53.55 },
  { name: "Berlin", lon: 13.4, lat: 52.52 },
  { name: "Köln", lon: 6.96, lat: 50.94 },
  { name: "Frankfurt", lon: 8.68, lat: 50.11 },
  { name: "München", lon: 11.58, lat: 48.14 },
  { name: "Leipzig", lon: 12.37, lat: 51.34 },
];

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

export function unproject(x: number, y: number): [number, number] {
  return [x / (LON_SCALE * SCALE) + MIN_LON, MAX_LAT - y / SCALE];
}

export interface MapPin {
  id: string;
  lon: number;
  lat: number;
  index: number;
  active?: boolean;
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
  /** Echte Routen-Geometrie (z. B. OSRM); ohne sie wird die Luftlinie gezeichnet. */
  path?: [number, number][];
  /** Dezente Darstellung (Korridor-Übersicht ohne Auswahl). */
  subtle?: boolean;
}

export interface NetworkLayer {
  id: string;
  width: number;
  opacity: number;
  d: string;
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
  pins = [],
  network = [],
  variant = "light",
  pinMode = false,
  showCities = false,
  textureEmphasis = false,
  edgeDim = 1,
  chargerDim = 1,
  onMapClick,
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
  pins?: MapPin[];
  /** Verkehrsnetz als gebündelte Adern-Pfade (Bühne hinter den Hotspots). */
  network?: NetworkLayer[];
  variant?: "light" | "dark";
  /** Im Pin-Modus setzt jeder Karten-Klick einen Standort statt zu selektieren. */
  pinMode?: boolean;
  showCities?: boolean;
  /** Hebt die Regions-Punkttextur hervor (Tab „Regionen"). */
  textureEmphasis?: boolean;
  /** Tab-abhängige Grundsichtbarkeit der Ebenen (Prototyp: segDim/parkDim). */
  edgeDim?: number;
  chargerDim?: number;
  onMapClick?: (lon: number, lat: number) => void;
  selectedRegionId: string;
  selectedEdgeId: number | null;
  onSelectRegion: (id: string) => void;
  onSelectEdge: (id: number) => void;
}) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  // Remount des SVG spielt die Eingangs-Choreografie erneut ab („↺ Intro").
  const [epoch, setEpoch] = useState(0);
  const dark = variant === "dark";
  const palette = dark
    ? {
        landFill: "#1b1e24",
        landStroke: "rgba(255,255,255,0.14)",
        landGlow: "rgba(13,187,200,0.05)",
        cityText: "rgba(255,255,255,0.32)",
        backdropDot: "#2b2f36",
        network: "#19c8d4",
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
        landFill: "#f1f2f5",
        landStroke: "#d8dae0",
        landGlow: "rgba(10,153,164,0.04)",
        cityText: "#a3a4aa",
        backdropDot: "#e0e2e7",
        network: "#0A99A4",
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
  const minEdgeTrucks = useMemo(
    () => Math.min(maxEdgeTrucks, ...edges.map((edge) => edge.trucks2030)),
    [edges, maxEdgeTrucks],
  );
  const maxRegionTrucks = useMemo(
    () => Math.max(1, ...regions.map((region) => region.trucks2030)),
    [regions],
  );

  return (
    <div className={`relative ${dark ? "tm-anim" : ""}`}>
      {dark && <style>{MAP_KEYFRAMES}</style>}
      <svg
        key={epoch}
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        className={`h-auto w-full ${pinMode ? "cursor-crosshair" : ""}`}
        role="img"
        aria-label="Karte der Lkw-Verkehrs-Hotspots in Deutschland"
        onMouseLeave={() => setTooltip(null)}
        onClick={(event) => {
          if (!pinMode || !onMapClick) return;
          const svg = event.currentTarget;
          const rect = svg.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * MAP_WIDTH;
          const y = ((event.clientY - rect.top) / rect.height) * MAP_HEIGHT;
          const [lon, lat] = unproject(x, y);
          onMapClick(Math.round(lon * 10000) / 10000, Math.round(lat * 10000) / 10000);
        }}
      >
        <defs>
          <radialGradient id="tmGlowCyan">
            <stop offset="0%" stopColor="#19c8d4" stopOpacity={0.55} />
            <stop offset="45%" stopColor="#19c8d4" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#19c8d4" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="tmGlowAmber">
            <stop offset="0%" stopColor="#ffc46b" stopOpacity={0.9} />
            <stop offset="38%" stopColor="#e8a13a" stopOpacity={0.32} />
            <stop offset="100%" stopColor="#e8a13a" stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* Landmasse: echter Umriss. */}
        {!dark && <path d={GERMANY_PATH} fill="none" stroke={palette.landGlow} strokeWidth={7} />}
        <path
          d={GERMANY_PATH}
          fill={palette.landFill}
          data-anim
          style={dark ? { animation: "tmFade 0.7s ease 0.45s both" } : undefined}
        />
        <path
          d={GERMANY_PATH}
          fill="none"
          stroke={palette.landStroke}
          strokeWidth={dark ? 0.55 : 0.8}
          strokeLinejoin="round"
          pathLength={1}
          data-anim
          style={
            dark
              ? {
                  strokeDasharray: 1,
                  strokeDashoffset: 1,
                  animation: "tmDraw 1s cubic-bezier(0.45,0,0.25,1) 0.05s both",
                }
              : undefined
          }
        />

        <g data-anim style={dark ? { animation: "tmFade 0.8s ease 0.5s both" } : undefined}>
          {backdrop.map(([lon, lat], index) => {
            const [x, y] = project(lon, lat);
            return (
              <circle
                key={index}
                cx={x}
                cy={y}
                r={dark ? (textureEmphasis ? 0.75 : 0.45) : 1.0}
                fill={textureEmphasis ? "#3c424c" : palette.backdropDot}
              />
            );
          })}
        </g>

        {/* Verkehrsnetz als gebündelte Adern: dünn/dunkel → dick/hell ∝ Verkehr.
            Das zusammenhängende Netz ist die Bühne; die Hotspots sitzen darauf. */}
        {network.map((layer, i) => (
          <path
            key={layer.id}
            d={layer.d}
            fill="none"
            stroke={palette.network}
            strokeWidth={layer.width}
            strokeOpacity={layer.opacity}
            strokeLinecap="round"
            data-anim
            style={
              dark
                ? { animation: `tmFade 0.9s ease ${(0.55 + i * 0.12).toFixed(2)}s both` }
                : undefined
            }
          />
        ))}

        {showCities &&
          ANCHOR_CITIES.map((city) => {
            const [x, y] = project(city.lon, city.lat);
            return (
              <g
                key={city.name}
                pointerEvents="none"
                data-anim
                style={dark ? { animation: "tmFade 0.6s ease 1.1s both" } : undefined}
              >
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  fontSize={4.3}
                  letterSpacing={0.7}
                  fontWeight={600}
                  fill={palette.cityText}
                  style={{ textTransform: "uppercase" }}
                >
                  {city.name.toUpperCase()}
                </text>
              </g>
            );
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
              className={pinMode ? undefined : "cursor-pointer"}
              onClick={() => {
                if (!pinMode) onSelectRegion(region.id);
              }}
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

        {/* Hotspot-Strecken als Energie-Knoten: Glow + ehrliche dünne Geometrie
            + gerichteter Verkehrsfluss (Dash-Drift) bzw. Glut für Lade-Lücken.
            Design: design/briefing-animated-map.md + Prototyp. */}
        {edges.map((edge) => {
          const [x1, y1] = project(edge.aLon, edge.aLat);
          const [x2, y2] = project(edge.bLon, edge.bLat);
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          const norm = Math.max(
            0,
            Math.min(
              1,
              (edge.trucks2030 - minEdgeTrucks) / Math.max(1, maxEdgeTrucks - minEdgeTrucks),
            ),
          );
          const rnd = hash01(edge.edgeId);
          const inN = midY / MAP_HEIGHT; // Nord→Süd-Staffelung des Eintritts
          const selected = edge.edgeId === selectedEdgeId;
          const dimmed = selectedEdgeId !== null && !selected;
          const color = edge.whiteSpot ? palette.whiteSpotEdge : palette.edge;
          const hasNetwork = network.length > 0;
          // Auf dem Netz treten versorgte Hotspots zurück (das Netz zeigt den
          // Verkehr schon); die amber Lade-Lücken führen die Aufmerksamkeit.
          const glowR = edge.whiteSpot
            ? 2.9 + norm * 4.8
            : hasNetwork
              ? 1.5 + norm * 2.2
              : 2.6 + norm * 4.6;
          const glowOpacity = edge.whiteSpot ? 0.92 : hasNetwork ? 0.42 : 0.62;
          const coreR = 0.9 + norm * 0.7;
          const lineW = 0.8 + norm * 1.3;
          const inDelay = edge.whiteSpot ? 1.5 + rnd * 0.5 : 1.0 + inN * 0.35 + rnd * 0.1;
          // Richtungsstrich: ehrliche Richtung, aber visuelle Mindestlänge —
          // dünn und ohne runde Kappen, damit Strecken als Strecken lesbar sind.
          const segLen = Math.hypot(x2 - x1, y2 - y1) || 1;
          const stretch = Math.max(1, (7 + norm * 4) / segLen);
          const sx1 = midX + (x1 - midX) * stretch;
          const sy1 = midY + (y1 - midY) * stretch;
          const sx2 = midX + (x2 - midX) * stretch;
          const sy2 = midY + (y2 - midY) * stretch;
          const flowDur = 10.5 / (1.2 + norm * 2.2);
          const anim = dark
            ? {
                glow: edge.whiteSpot
                  ? `tmFade 0.5s ease ${inDelay.toFixed(2)}s both, tmEmber ${(2.8 + rnd * 1.4).toFixed(2)}s ease-in-out ${(inDelay + 0.5).toFixed(2)}s infinite`
                  : `tmPop 0.55s cubic-bezier(0.2,0.9,0.3,1) ${inDelay.toFixed(2)}s both`,
                tick: `tmFade 0.4s ease ${inDelay.toFixed(2)}s both`,
                flow: `tmFade 0.5s ease ${inDelay.toFixed(2)}s both, tmFlow ${flowDur.toFixed(2)}s linear -${(rnd * flowDur).toFixed(1)}s infinite`,
              }
            : undefined;
          return (
            <g
              key={edge.edgeId}
              style={{ opacity: dimmed ? 0.15 : edgeDim, transition: "opacity 0.35s ease" }}
            >
              <circle
                cx={midX}
                cy={midY}
                r={glowR}
                fill={edge.whiteSpot ? "url(#tmGlowAmber)" : "url(#tmGlowCyan)"}
                opacity={glowOpacity}
                data-anim
                style={{
                  transformBox: "fill-box",
                  transformOrigin: "center",
                  ...(anim ? { animation: anim.glow } : {}),
                }}
              />
              <line
                x1={sx1}
                y1={sy1}
                x2={sx2}
                y2={sy2}
                stroke={color}
                strokeWidth={lineW}
                opacity={edge.whiteSpot ? 0.95 : 0.55}
                data-anim
                style={anim ? { animation: anim.tick } : undefined}
              />
              {!edge.whiteSpot && (
                <line
                  x1={sx1}
                  y1={sy1}
                  x2={sx2}
                  y2={sy2}
                  stroke="#7deef5"
                  strokeWidth={0.7 + norm * 1.0}
                  strokeDasharray="1.4 2.1"
                  opacity={0.6}
                  data-anim
                  style={anim ? { animation: anim.flow } : undefined}
                />
              )}
              <circle
                cx={midX}
                cy={midY}
                r={coreR}
                fill={color}
                opacity={0.9}
                data-anim
                style={anim ? { animation: anim.tick } : undefined}
              />
              <circle
                cx={midX}
                cy={midY}
                r={glowR * 0.8}
                fill="none"
                stroke="rgba(255,255,255,0.75)"
                strokeWidth={0.5}
                opacity={selected ? 0.9 : 0}
                style={{ transition: "opacity 0.3s ease" }}
              />
              <circle
                cx={midX}
                cy={midY}
                r={6.5}
                fill="transparent"
                className={pinMode ? undefined : "cursor-pointer"}
                onClick={() => {
                  if (!pinMode) onSelectEdge(edge.edgeId);
                }}
                onMouseEnter={() =>
                  setTooltip({
                    x: midX,
                    y: midY,
                    label: `${edge.label} · ≈ ${Math.round(edge.trucks2030 / 365).toLocaleString("de-DE")} Lkw/Tag${edge.whiteSpot ? " · Lade-Lücke" : ""}`,
                  })
                }
              />
            </g>
          );
        })}

        {routes.map((route, index) => {
          const [x1, y1] = project(route.aLon, route.aLat);
          const [x2, y2] = project(route.bLon, route.bLat);
          const lineColor = dark ? "rgba(255,255,255,0.85)" : "#1d1d1f";
          return (
            <g key={`route-${index}`}>
              {route.path && route.path.length > 1 ? (
                (() => {
                  const d = route.path
                    .map(([lon, lat], i) => {
                      const [x, y] = project(lon, lat);
                      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
                    })
                    .join("");
                  return (
                    <>
                      <path
                        d={d}
                        fill="none"
                        stroke={lineColor}
                        strokeWidth={1.6}
                        strokeDasharray="5 4"
                        strokeLinejoin="round"
                        opacity={0.85}
                        data-anim
                        style={
                          dark
                            ? {
                                animation: `tmFade 0.5s ease ${(1.3 + index * 0.35).toFixed(2)}s both, tmDash 1.4s linear infinite`,
                              }
                            : undefined
                        }
                      />
                      {dark && (
                        <path
                          d={d}
                          fill="none"
                          stroke="rgba(255,255,255,0.9)"
                          strokeWidth={1.8}
                          strokeLinejoin="round"
                          pathLength={1}
                          data-anim
                          style={{
                            strokeDasharray: 1,
                            strokeDashoffset: 1,
                            animation: `tmDraw 1.3s cubic-bezier(0.45,0,0.2,1) ${(0.15 + index * 0.35).toFixed(2)}s both, tmFadeOut 0.7s ease ${(1.5 + index * 0.35).toFixed(2)}s both`,
                          }}
                        />
                      )}
                    </>
                  );
                })()
              ) : (
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={lineColor}
                  strokeWidth={route.subtle ? 0.7 : 1.6}
                  strokeDasharray={route.subtle ? "2 2.6" : "5 4"}
                  opacity={route.subtle ? 0.35 : 0.85}
                  data-anim
                  style={
                    dark && !route.subtle ? { animation: "tmDash 1.4s linear infinite" } : undefined
                  }
                />
              )}
              {!route.subtle && (
                <>
                  <circle cx={x1} cy={y1} r={route.path ? 1.8 : 3} fill={lineColor} />
                  <circle cx={x2} cy={y2} r={route.path ? 1.8 : 3} fill={lineColor} />
                </>
              )}
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

        {chargers.map((charger, index) => {
          const [x, y] = project(charger.lon, charger.lat);
          const r = charger.type === "mcs" ? 3.1 : 2.3;
          const live = charger.status === "live";
          const rnd = hash01(index + 7919);
          const chargerOpacity = selectedEdgeId !== null ? 0.2 : chargerDim;
          return (
            <g key={charger.id} style={{ opacity: chargerOpacity, transition: "opacity 0.35s ease" }}>
              {dark && live && (
                <circle
                  cx={x}
                  cy={y}
                  r={3.4}
                  fill="none"
                  stroke={palette.chargerFill}
                  strokeWidth={0.5}
                  opacity={0}
                  data-anim
                  style={{
                    transformBox: "fill-box",
                    transformOrigin: "center",
                    animation: `tmRing ${(8 + rnd * 6).toFixed(1)}s linear ${(2.2 + rnd * 9).toFixed(1)}s infinite`,
                  }}
                />
              )}
              <path
                d={`M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`}
                fill={live ? palette.chargerFill : (dark ? "#141519" : "white")}
                stroke={live ? (dark ? "#141519" : "white") : palette.chargerFill}
                strokeWidth={0.7}
                opacity={0.95}
                className="cursor-pointer"
                data-anim
                style={
                  dark
                    ? {
                        transformBox: "fill-box",
                        transformOrigin: "center",
                        animation: `tmPop 0.5s cubic-bezier(0.2,0.9,0.3,1) ${(1.25 + rnd * 0.4).toFixed(2)}s both`,
                      }
                    : undefined
                }
                onMouseEnter={() =>
                  setTooltip({
                    x,
                    y,
                    label: `${charger.name}${live ? "" : " (angekündigt)"}`,
                  })
                }
              />
            </g>
          );
        })}

        {pins.map((pin) => {
          const [x, y] = project(pin.lon, pin.lat);
          return (
            <g
              key={pin.id}
              data-anim
              style={
                dark
                  ? {
                      transformBox: "fill-box",
                      transformOrigin: "center",
                      animation: "tmPop 0.35s cubic-bezier(0.2,0.9,0.3,1) both",
                    }
                  : undefined
              }
            >
              <circle
                cx={x}
                cy={y}
                r={4.4}
                fill={pin.active ? "#e8a13a" : "white"}
                stroke="rgba(20,21,25,0.9)"
                strokeWidth={0.7}
              />
              <text
                x={x}
                y={y + 1.6}
                textAnchor="middle"
                fontSize={4.6}
                fontWeight={700}
                fill="#141519"
              >
                {pin.index}
              </text>
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

      <div
        className={`mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs ${palette.legendText}`}
      >
        {edges.length > 0 && (
          <span className="inline-flex items-center gap-2">
            <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden>
              <circle cx="13" cy="6" r="5" fill={palette.edge} opacity={0.18} />
              <line x1="7" y1="6" x2="19" y2="6" stroke={palette.edge} strokeWidth="1.8" opacity={0.55} />
              <line x1="7" y1="6" x2="19" y2="6" stroke="#7deef5" strokeWidth="1.3" strokeDasharray="2.2 3" />
            </svg>
            Hotspot versorgt — Verkehr fließt
          </span>
        )}
        {edges.some((edge) => edge.whiteSpot) && (
          <span className="inline-flex items-center gap-2">
            <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden>
              <circle cx="13" cy="6" r="5.4" fill={palette.whiteSpotEdge} opacity={0.25} />
              <line x1="9" y1="6" x2="17" y2="6" stroke={palette.whiteSpotEdge} strokeWidth="1.8" />
              <circle cx="13" cy="6" r="1.4" fill="#ffc46b" />
            </svg>
            Lade-Lücke (kein Lkw-Ladepark ≤ 25 km) — glüht
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
            {routes.some((route) => route.path)
              ? "Ihre Relation (Straßenroute)"
              : "Ihre Relation (Luftlinie)"}
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
        {dark && (
          <button
            type="button"
            onClick={() => setEpoch((value) => value + 1)}
            className="ml-auto rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/60 transition hover:border-white/30 hover:text-white"
            title="Eingangs-Choreografie erneut abspielen"
          >
            ↺ Intro
          </button>
        )}
      </div>
    </div>
  );
}
