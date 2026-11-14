import { useEffect, useMemo, useState } from "react";
import { decodeSheet } from "@/lib/tour-sheet";

const DOT: Record<string, string> = { start: "bg-[#0a0a0b]", stop: "bg-white border-2 border-[#0a0a0b]", charge: "bg-[#1d3bff]", pause: "bg-[#8e8e93]", arrive: "bg-[#0a0a0b]", stranded: "bg-[#e3261b]" };

// Driver sheet for one tour. Everything it shows comes from the link; the page stores and sends nothing.
export default function Fahrt() {
  const sheet = useMemo(() => decodeSheet(window.location.hash), []);
  const [copied, setCopied] = useState(false);
  useEffect(() => { document.title = sheet ? `${sheet.tour} · Fahrer-Zettel` : "Fahrer-Zettel"; }, [sheet]);
  if (!sheet) return <main className="mx-auto max-w-md px-4 py-10 text-sm text-[#55555a]">Dieser Link enthält keinen Fahrer-Zettel. Bitte im Tagesplan neu erzeugen.</main>;
  const date = new Date(`${sheet.date}T12:00:00`).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  return <main className="mx-auto max-w-md bg-white px-4 py-6 text-[#0a0a0b]">
    <p className="text-xs text-[#6b6b70]">{date} · {sheet.truck}</p>
    <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em]">{sheet.tour}</h1>
    <p className="mt-1 text-sm text-[#55555a]">{Math.round(sheet.km).toLocaleString("de-DE")} km · {sheet.steps[0]?.time} bis {sheet.steps[sheet.steps.length - 1]?.time} Uhr</p>
    <ol className="mt-6">
      {sheet.steps.map((s, i) => <li key={i} className="relative grid grid-cols-[3.2rem_1rem_1fr] gap-x-2 pb-5">
        <span className="text-sm font-semibold tabular-nums">{s.time}</span>
        <span className="relative flex justify-center">{i < sheet.steps.length - 1 && <span className="absolute top-3 h-full w-px bg-[#d4d4d0]" />}<span className={`relative mt-1 h-3 w-3 ${DOT[s.kind] ?? DOT.stop}`} /></span>
        <span>
          <span className={`block text-[15px] font-semibold leading-snug ${s.kind === "charge" ? "text-[#1d3bff]" : s.kind === "stranded" ? "text-[#b3180f]" : ""}`}>{s.title}</span>
          <span className="block text-[13px] leading-snug text-[#55555a]">{s.detail}</span>
          {s.lat != null && s.lon != null && <a href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[13px] font-semibold text-[#1d3bff] print:hidden">Navigation öffnen</a>}
        </span>
      </li>)}
    </ol>
    <p className="border-t border-[#e4e4e1] pt-3 text-[11px] leading-relaxed text-[#6b6b70]">Planwerte. Akkustände sind berechnet, nicht gemessen. Ob am Ladepunkt ein Platz frei ist, wurde nicht geprüft. Bei weniger als 20 % Akku früher laden und die Disposition anrufen.</p>
    <div className="mt-4 flex gap-4 text-sm font-semibold text-[#1d3bff] print:hidden">
      <button type="button" onClick={() => window.print()}>Drucken</button>
      <button type="button" onClick={() => void navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true))}>{copied ? "Link kopiert" : "Link kopieren"}</button>
    </div>
  </main>;
}
