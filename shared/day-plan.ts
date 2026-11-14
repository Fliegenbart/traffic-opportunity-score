import type { TourPlan } from "./tour-plan";

// Tagesplan: the fixed lines of one day, a traffic light per tour and the charging plan for the night at the depot.

export type Light = "green" | "yellow" | "red";

// Green only when the depot charge is enough: a charging stop on the road works on paper, but nobody guarantees a free bay.
export function tourLight(plan: TourPlan, reservePercent: number): { light: Light; reason: string } {
  if (!plan.feasible) return { light: "red", reason: "Der Akku reicht nicht und auf der Strecke liegt kein erreichbarer Ladepunkt." };
  if (plan.minutes >= 1440) return { light: "yellow", reason: "Die Tour dauert mit Ruhezeit länger als einen Tag." };
  if (plan.extraChargeMin > 5) return { light: "yellow", reason: `Das Laden unterwegs dauert ${Math.round(plan.extraChargeMin)} Minuten länger als die Pause.` };
  if (plan.chargeStops > 0) return { light: "yellow", reason: `${plan.chargeStops === 1 ? "Ein Ladestopp" : `${plan.chargeStops} Ladestopps`} unterwegs in der Pause. Ob ein Ladeplatz frei ist, ist nicht geprüft.` };
  if (plan.arrivalSoc < reservePercent + 5) return { light: "yellow", reason: `Es geht knapp: Rückkehr mit ${plan.arrivalSoc} % Akku.` };
  return { light: "green", reason: "Die Depotladung reicht für die ganze Tour." };
}

// Monday = 0 … Sunday = 6 for an ISO date (YYYY-MM-DD).
export function weekdayIndex(date: string) { return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7; }
export function addDays(date: string, days: number) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

export type DepotCharger = { id: string; kw: number };
// Minutes count from midnight of the planned day; a truck leaving the next morning has departMin above 1440.
export type NightSession = { id: string; name: string; arriveMin: number; departMin: number; kwh: number; maxChargeKw: number; batteryKwh: number };
export type NightResult = NightSession & { chargerId: string | null; chargerKw: number; plugMin: number | null; after: string | null; startMin: number | null; endMin: number | null; chargedKwh: number; departSoc: number; full: boolean };
export type NightPlan = { sessions: NightResult[]; fromMin: number; curve: number[]; peakKw: number; kwh: number; missingKwh: number };

const SLOT = 15;
// Not the whole standing time is usable (parking, plugging in, departure check).
const USABLE_WINDOW = 0.9;

// A truck keeps its charge point until it leaves. Only when another truck is waiting, a full truck gives its point away (someone has to replug).
// Power is handed out in 15-minute steps, the truck that leaves first is served first, never above the grid connection.
export function planNight(input: NightSession[], chargers: DepotCharger[], gridKw: number | null = null): NightPlan {
  const fromMin = input.length ? Math.floor(Math.min(...input.map((s) => s.arriveMin)) / SLOT) * SLOT : 0;
  const toMin = input.length && chargers.length ? Math.max(...input.map((s) => s.departMin)) : fromMin;
  const state = new Map(input.map((s) => [s.id, { left: s.kwh, start: null as number | null, end: null as number | null, charger: null as DepotCharger | null, plugMin: null as number | null, after: null as string | null }]));
  const occupied = new Map<string, NightSession>();
  const order = [...input].sort((x, y) => x.departMin - y.departMin);
  const curve: number[] = [];
  for (let t = fromMin; t < toMin; t += SLOT) {
    for (const [id, s] of Array.from(occupied)) if (s.departMin <= t) occupied.delete(id);
    for (const s of order) {
      const st = state.get(s.id)!;
      if (st.charger || st.left < 0.5 || s.arriveMin > t || t + SLOT > s.departMin) continue;
      let free = chargers.filter((c) => !occupied.has(c.id));
      if (!free.length) free = chargers.filter((c) => state.get(occupied.get(c.id)!.id)!.left < 0.5);
      if (!free.length) continue;
      const need = st.left / ((s.departMin - t) / 60 * USABLE_WINDOW);
      free.sort((x, y) => x.kw - y.kw);
      const pick = free.find((c) => c.kw >= need) ?? free[free.length - 1];
      st.after = occupied.get(pick.id)?.name ?? null; st.charger = pick; st.plugMin = t;
      occupied.set(pick.id, s);
    }
    let grid = gridKw ?? Infinity, sum = 0;
    for (const s of order) {
      const st = state.get(s.id)!;
      if (!st.charger || occupied.get(st.charger.id) !== s || st.left < 1e-6) continue;
      const kw = Math.min(st.charger.kw, s.maxChargeKw, st.left / (SLOT / 60), grid);
      if (kw <= 1e-6) continue;
      st.left -= kw * SLOT / 60; grid -= kw; sum += kw;
      st.start ??= t; st.end = t + SLOT;
    }
    curve.push(sum);
  }
  const sessions = input.map((s) => {
    const st = state.get(s.id)!;
    return { ...s, chargerId: st.charger?.id ?? null, chargerKw: st.charger?.kw ?? 0, plugMin: st.plugMin, after: st.after, startMin: st.start, endMin: st.end, chargedKwh: s.kwh - st.left,
      departSoc: Math.round(100 - st.left / s.batteryKwh * 100), full: st.left < 0.5 };
  });
  return { sessions, fromMin, curve, peakKw: Math.max(0, ...curve), kwh: sessions.reduce((sum, s) => sum + s.chargedKwh, 0), missingKwh: sessions.reduce((sum, s) => sum + s.kwh - s.chargedKwh, 0) };
}

// Smallest grid connection (in 10 kW steps) with which the trucks leave as full as without any limit.
export function smallestGridKw(input: NightSession[], chargers: DepotCharger[]) {
  const open = planNight(input, chargers);
  let low = 0, high = Math.ceil(open.peakKw / 10);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (planNight(input, chargers, mid * 10).missingKwh <= open.missingKwh + 0.5) high = mid; else low = mid + 1;
  }
  return low * 10;
}
