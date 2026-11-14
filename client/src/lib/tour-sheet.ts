import type { TourPlan } from "@shared/tour-plan";

// The steps of one tour in the order the driver meets them; also the content of the driver sheet.
export type SheetStep = { time: string; title: string; detail: string; kind: "start" | "stop" | "charge" | "pause" | "arrive" | "stranded"; lon?: number; lat?: number };
export type Sheet = { tour: string; date: string; truck: string; km: number; steps: SheetStep[] };

const clock = (min: number) => { const t = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
const span = (min: number) => { const m = Math.round(min); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`; };

export function sheetSteps(plan: TourPlan, departureMin: number): SheetStep[] {
  const steps: SheetStep[] = [];
  let drive = "";
  for (const e of plan.events) {
    if (e.type === "drive") { drive = `${Math.round(e.km)} km · ${span(e.minutes)} Fahrt`; continue; }
    const time = clock(departureMin + e.minute), before = drive ? `Nach ${drive}. ` : "";
    drive = "";
    if (e.type === "start") steps.push({ kind: "start", time, title: `Abfahrt ${e.label}`, detail: "Akku 100 %" });
    else if (e.type === "stop") steps.push({ kind: "stop", time, title: e.label, detail: `${before}${span(e.dwellMin)} Standzeit · Akku ${e.soc} %` });
    else if (e.type === "charge") steps.push({ kind: "charge", time, title: `Laden: ${e.charger.name}`, lon: e.charger.lon, lat: e.charger.lat,
      detail: `${before}${e.pause === "rest" ? "Ruhezeit" : "Pause"} ${span(e.minutes)} · Akku ${e.socFrom} → ${e.socTo} % · bis ${Math.round(e.kw)} kW${e.charger.operator ? ` · ${e.charger.operator}` : ""}` });
    else if (e.type === "pause") steps.push({ kind: "pause", time, title: e.pause === "rest" ? "Ruhezeit" : "Pause", detail: `${before}${span(e.minutes)} · Akku ${e.soc} %` });
    else if (e.type === "arrive") steps.push({ kind: "arrive", time, title: `Ankunft ${e.label}`, detail: `${before}Akku ${e.soc} %` });
    else steps.push({ kind: "stranded", time, title: "Akku reicht nicht weiter", detail: `${before}Kein Ladepunkt in Reichweite.` });
  }
  return steps;
}

// The sheet travels in the link itself (after the #), so nothing is stored on a server.
export function encodeSheet(sheet: Sheet) {
  const bytes = new TextEncoder().encode(JSON.stringify(sheet));
  let binary = ""; bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeSheet(hash: string): Sheet | null {
  try {
    const binary = atob(hash.replace(/^#/, "").replace(/-/g, "+").replace(/_/g, "/"));
    const sheet = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))) as Sheet;
    return Array.isArray(sheet.steps) && typeof sheet.tour === "string" ? sheet : null;
  } catch { return null; }
}
