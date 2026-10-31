import type { SiteTraffic } from "@shared/site-traffic";
import { siteTrafficEvidence } from "@shared/site-traffic";

const number = (value: number, digits = 0) => value.toLocaleString("de-DE", { maximumFractionDigits: digits });
export default function SiteEvidence({ context, networkSize }: { context?: SiteTraffic; networkSize?: number }) {
  const traffic = context?.traffic;
  const evidence = context && siteTrafficEvidence(context);
  return <div className="mt-4 border-t border-[#e4e4e1] pt-4" data-testid="site-evidence">
    <dl className="space-y-4 text-sm">
      <div><dt className="font-mono text-xs font-normal text-[#6b6b70]">Verkehr</dt><dd className="mt-2 text-[#55555a]" data-testid="screening-traffic">
        {traffic ? <>
          <span className="sr-only">≈ </span>
          <span className="block text-[64px] font-semibold leading-[0.9] tracking-[-0.05em] text-[#0a0a0b] tabular-nums sm:text-[80px]">{number(traffic.trucksPerDay)}</span>
          <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-medium text-[#0a0a0b]">{` ${traffic.vehicleClass === "truck" ? "Lkw" : "schwere Fahrzeuge"} pro Tag · Daten für ${traffic.referenceYear}`}
            <span className="inline-flex items-center gap-1.5 font-mono text-xs font-normal text-[#6b6b70]"><span aria-hidden="true" className={`h-2 w-2 rounded-full border-[1.5px] border-[#0a0a0b] ${evidence?.traffic === "measured" ? "bg-[#0a0a0b]" : "bg-[linear-gradient(90deg,#0a0a0b_50%,transparent_50%)]"}`} />{evidence?.traffic === "measured" ? "gemessen" : "berechnet"}</span>
          </span>
        </> : "Noch keine Datenquelle ausgewählt"}
      </dd><dd className="mt-1 text-xs text-[#6b6b70]">{evidence?.traffic === "measured" ? "Gemessen an einer Zählstelle in der Nähe, nicht direkt am Standort. Der Tageswert ist aus den verfügbaren Stundenmessungen berechnet, kein Jahresdurchschnitt." : traffic ? "Berechnete Verkehrsmengen, keine gemessenen Fahrten. Die Rechnung verteilt den Verkehr gleichmäßig über den Tag und die Woche." : networkSize === undefined ? "Verkehrsdaten werden noch geladen." : `${number(networkSize)} berechnete Straßenabschnitte verfügbar. Die Datenquelle für diesen Standort ist noch offen.`}</dd>
      {traffic?.trucksPerDay === 0 && <dd className="mt-1 text-xs text-[#8b570b]">Diese Quelle zeigt hier keine Fahrzeuge. Das heißt nicht, dass die Straße leer ist oder es keine Ladekunden aus der Umgebung gibt.</dd>}</div>
      <div><dt className="font-semibold text-[#0a0a0b]">Mögliche Ladekunden <span className="ml-2 text-xs font-medium text-[#8b570b]">Noch nicht belegt</span></dt><dd className="mt-1 text-xs text-[#6b6b70]">Vorbeifahrende Lkw sind noch keine Ladekunden. Wie viele elektrisch fahren, hier halten und laden, wird in der Rechnung angenommen. Reale Ladevorgänge und feste Kunden fehlen bisher.</dd></div>
      <div><dt className="font-semibold text-[#0a0a0b]">Vor einer Investition <span className="ml-2 text-xs font-medium text-[#8b570b]">Weitere Prüfung nötig</span></dt><dd className="mt-1 text-xs text-[#6b6b70]">Zufahrt, verfügbare Netzleistung, andere Ladeparks und tatsächliche Kunden müssen geprüft werden. Viel Verkehr allein macht einen Ladepark noch nicht rentabel.</dd></div>
    </dl>
    {traffic && <details className="mt-4 text-xs text-[#6b6b70]"><summary className="cursor-pointer font-medium text-[#55555a]">Datenquelle & Entfernung</summary>
      <a className="mt-2 block text-[#1d3bff] underline" href={traffic.source.url} target="_blank" rel="noreferrer">{traffic.source.title}</a>
      <p className="mt-1">Daten bis {traffic.source.observedThrough} · Version {traffic.source.version} · Lizenz: {traffic.source.license}</p>
      <p className="mt-1">Geschäftliche Nutzung: {traffic.source.commercialUse === "allowed" ? "laut Quellenangaben erlaubt; Lizenzbedingungen beachten" : traffic.source.commercialUse === "restricted" ? "nur eingeschränkt erlaubt" : "noch zu klären"}</p>
      <p className="mt-1">{traffic.source.kind === "measured" ? "Zählstelle" : "Berechneter Straßenabschnitt"}: {number(traffic.matchDistanceKm ?? 0, 2)} km Abstand auf der Karte. Die tatsächliche Fahrtstrecke ist nicht geprüft.</p>
      {context?.edge && <p className="mt-1">Straßenabschnitt #{context.edge.edge.edgeId}: {context.edge.edge.label}. Seine Endpunkte sind nicht als Autobahnanschlüsse bestätigt.</p>}
      <details className="mt-2"><summary>Technischer Herkunftsnachweis</summary><p className="mt-2 break-all font-mono">SHA-256 {traffic.source.sha256}</p></details>
    </details>}
  </div>;
}
