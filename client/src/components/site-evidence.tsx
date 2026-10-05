import type { SiteTraffic } from "@shared/site-traffic";
import { siteTrafficEvidence } from "@shared/site-traffic";

const number = (value: number, digits = 0) => value.toLocaleString("de-DE", { maximumFractionDigits: digits });
export default function SiteEvidence({ context, networkSize }: { context?: SiteTraffic; networkSize?: number }) {
  const traffic = context?.traffic;
  const evidence = context && siteTrafficEvidence(context);
  return <div className="mt-4 border-t border-[#e3e6e1] pt-4" data-testid="site-evidence">
    <dl className="space-y-4 text-sm">
      <div><dt className="font-semibold text-[#0d1417]">Verkehr</dt><dd className="mt-1 text-[#536066]" data-testid="screening-traffic">
        {traffic ? `≈ ${number(traffic.trucksPerDay)} ${traffic.vehicleClass === "truck" ? "Lkw" : "schwere Fahrzeuge"} pro Tag · Daten für ${traffic.referenceYear}` : "Noch keine Datenquelle ausgewählt"}
      </dd><dd className="mt-1 text-xs text-[#667278]">{evidence?.traffic === "measured" ? "Gemessen an einer Zählstelle in der Nähe, nicht direkt am Standort. Der Tageswert ist aus den verfügbaren Stundenmessungen berechnet, kein Jahresdurchschnitt." : traffic ? "Berechnete Verkehrsmengen, keine gemessenen Fahrten. Die Rechnung verteilt den Verkehr gleichmäßig über den Tag und die Woche." : networkSize === undefined ? "Verkehrsdaten werden noch geladen." : `${number(networkSize)} berechnete Straßenabschnitte verfügbar. Die Datenquelle für diesen Standort ist noch offen.`}</dd>
      {traffic?.trucksPerDay === 0 && <dd className="mt-1 text-xs text-[#8b570b]">Diese Quelle zeigt hier keine Fahrzeuge. Das heißt nicht, dass die Straße leer ist oder es keine Ladekunden aus der Umgebung gibt.</dd>}</div>
      <div><dt className="font-semibold text-[#0d1417]">Mögliche Ladekunden <span className="ml-2 text-xs font-medium text-[#8b570b]">Noch nicht belegt</span></dt><dd className="mt-1 text-xs text-[#667278]">Vorbeifahrende Lkw sind noch keine Ladekunden. Wie viele elektrisch fahren, hier halten und laden, wird in der Rechnung angenommen. Reale Ladevorgänge und feste Kunden fehlen bisher.</dd></div>
      <div><dt className="font-semibold text-[#0d1417]">Vor einer Investition <span className="ml-2 text-xs font-medium text-[#8b570b]">Weitere Prüfung nötig</span></dt><dd className="mt-1 text-xs text-[#667278]">Zufahrt, verfügbare Netzleistung, andere Ladeparks und tatsächliche Kunden müssen geprüft werden. Viel Verkehr allein macht einen Ladepark noch nicht rentabel.</dd></div>
    </dl>
    {traffic && <details className="mt-4 text-xs text-[#667278]"><summary className="cursor-pointer font-medium text-[#536066]">Datenquelle & Entfernung</summary>
      <a className="mt-2 block text-[#0a7c63] underline" href={traffic.source.url} target="_blank" rel="noreferrer">{traffic.source.title}</a>
      <p className="mt-1">Daten bis {traffic.source.observedThrough} · Version {traffic.source.version} · Lizenz: {traffic.source.license}</p>
      <p className="mt-1">Geschäftliche Nutzung: {traffic.source.commercialUse === "allowed" ? "laut Quellenangaben erlaubt; Lizenzbedingungen beachten" : traffic.source.commercialUse === "restricted" ? "nur eingeschränkt erlaubt" : "noch zu klären"}</p>
      <p className="mt-1">{traffic.source.kind === "measured" ? "Zählstelle" : "Berechneter Straßenabschnitt"}: {number(traffic.matchDistanceKm ?? 0, 2)} km Abstand auf der Karte. Die tatsächliche Fahrtstrecke ist nicht geprüft.</p>
      {context?.edge && <p className="mt-1">Straßenabschnitt #{context.edge.edge.edgeId}: {context.edge.edge.label}. Seine Endpunkte sind nicht als Autobahnanschlüsse bestätigt.</p>}
      <details className="mt-2"><summary>Technischer Herkunftsnachweis</summary><p className="mt-2 break-all font-mono">SHA-256 {traffic.source.sha256}</p></details>
    </details>}
  </div>;
}
