// Flotten-Check: a list of daily tours from one depot, and what the depot needs to recharge the trucks overnight.

export type FleetTour = { name: string; departureMin: number; stops: string[]; payloadT: number; dwellMin: number };

export const FLEET_EXAMPLE = `Tour;Abfahrt;Stopps;Ladung t;Standzeit min
Braunschweig;06:00;Braunschweig;18;60
Hamburg;05:30;Hamburg;20;60
Kassel-Göttingen;06:00;Kassel > Göttingen;16;45
Frankfurt;04:30;Frankfurt am Main;18;60
Bremen;07:00;Bremen;14;60
Magdeburg-Wolfsburg;06:30;Magdeburg > Wolfsburg;12;45
Dortmund;05:00;Dortmund;20;60
Bielefeld;14:00;Bielefeld;10;60`;

export const MAX_FLEET_TOURS = 30;

// One tour per line: name, departure, stops (separated by ">"), payload in tons, dwell per stop in minutes.
// Accepts ";" "," or tabs (pasted from Excel) and German decimals; a header line is skipped.
export function parseTours(text: string): { tours: FleetTour[]; errors: string[] } {
  const tours: FleetTour[] = [], errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const sep = lines[0]?.includes("\t") ? "\t" : lines[0]?.includes(";") ? ";" : ",";
  lines.forEach((line, index) => {
    const cells = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    const time = /^(\d{1,2})[:.](\d{2})$/.exec(cells[1] || "");
    if (!time) { if (index > 0) errors.push(`Zeile ${index + 1}: Abfahrt fehlt oder ist keine Uhrzeit (z. B. 06:00).`); return; }
    const stops = (cells[2] || "").split(/>|→/).map((s) => s.trim()).filter(Boolean);
    if (!stops.length) { errors.push(`Zeile ${index + 1}: Kein Stopp angegeben.`); return; }
    const num = (v: string | undefined, fallback: number) => { const n = Number((v || "").replace(",", ".")); return v && Number.isFinite(n) && n >= 0 ? n : fallback; };
    tours.push({ name: cells[0] || `Tour ${tours.length + 1}`, departureMin: Math.min(23, Number(time[1])) * 60 + Math.min(59, Number(time[2])), stops, payloadT: num(cells[3], 15), dwellMin: num(cells[4], 60) });
  });
  if (tours.length > MAX_FLEET_TOURS) { errors.push(`Der Prototyp prüft höchstens ${MAX_FLEET_TOURS} Touren, der Rest wurde weggelassen.`); tours.length = MAX_FLEET_TOURS; }
  return { tours, errors };
}

// Charger classes that can be installed at a depot bay.
export const DEPOT_CHARGER_KW = [50, 150, 400];
const SLOT_MIN = 15, SLOTS = 1440 / SLOT_MIN;
// Not the whole standing time is usable (parking, plugging in, departure check).
const USABLE_WINDOW = 0.9;

export type DepotSession = { name: string; arriveMin: number; departMin: number; kwh: number; maxChargeKw: number };
export type DepotPlan = {
  sessions: (DepotSession & { windowH: number; chargerKw: number; tooShort: boolean })[];
  points: number; chargers: { kw: number; count: number }[];
  managed: number[]; unmanaged: number[]; managedPeakKw: number; unmanagedPeakKw: number; kwhPerDay: number;
};

// Every truck returns, charges at the depot and leaves at the same time the next day.
// "unmanaged" = each truck charges at full power on arrival; "managed" = the same energy spread over the standing time.
export function planDepot(input: DepotSession[]): DepotPlan {
  const managed = new Array<number>(SLOTS).fill(0), unmanaged = new Array<number>(SLOTS).fill(0), present = new Array<number>(SLOTS).fill(0);
  const sessions = input.map((s) => {
    const arrive = ((s.arriveMin % 1440) + 1440) % 1440;
    const windowMin = (((s.departMin - arrive) % 1440) + 1440) % 1440 || 1440;
    const windowH = windowMin / 60, needKw = s.kwh / (windowH * USABLE_WINDOW);
    const chargerKw = DEPOT_CHARGER_KW.find((kw) => kw >= needKw && kw <= Math.max(s.maxChargeKw, DEPOT_CHARGER_KW[0])) ?? Math.min(s.maxChargeKw, DEPOT_CHARGER_KW[DEPOT_CHARGER_KW.length - 1]);
    const first = Math.floor(arrive / SLOT_MIN), count = Math.max(1, Math.round(windowMin / SLOT_MIN));
    const fastSlots = Math.min(count, Math.ceil(s.kwh / chargerKw * 60 / SLOT_MIN));
    for (let i = 0; i < count; i++) {
      const slot = (first + i) % SLOTS;
      present[slot]++; managed[slot] += Math.min(chargerKw, s.kwh / (count * SLOT_MIN / 60));
      if (i < fastSlots) unmanaged[slot] += chargerKw;
    }
    return { ...s, arriveMin: arrive, windowH, chargerKw, tooShort: needKw > chargerKw };
  });
  return {
    sessions, points: Math.max(0, ...present),
    chargers: DEPOT_CHARGER_KW.map((kw) => ({ kw, count: sessions.filter((s) => s.chargerKw === kw).length })).filter((c) => c.count),
    managed, unmanaged, managedPeakKw: Math.max(0, ...managed), unmanagedPeakKw: Math.max(0, ...unmanaged), kwhPerDay: input.reduce((sum, s) => sum + s.kwh, 0),
  };
}
