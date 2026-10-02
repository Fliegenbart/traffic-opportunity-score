import type { SiteTraffic } from "@shared/site-traffic";
import { siteTrafficEvidence } from "@shared/site-traffic";

const number = (value: number, digits = 0) => value.toLocaleString("de-DE", { maximumFractionDigits: digits });
export default function SiteEvidence({ context, networkSize }: { context?: SiteTraffic; networkSize?: number }) {
  const traffic = context?.traffic;
  const evidence = context && siteTrafficEvidence(context);
  return <div className="mt-4 border-t border-[#dce1e1] pt-4" data-testid="site-evidence">
    <dl className="space-y-4 text-sm">
      <div><dt className="font-semibold text-[#202426]">Verkehr</dt><dd className="mt-1 text-[#536066]" data-testid="screening-traffic">
        {traffic ? `≈ ${number(traffic.trucksPerDay)} ${traffic.vehicleClass === "truck" ? "Lkw" : "Schwerverkehr-Fahrzeuge"}/Tag · Referenz ${traffic.referenceYear}` : "Keine Verkehrsbasis gewählt"}
      </dd><dd className="mt-1 text-xs text-[#667278]">{evidence?.traffic === "measured" ? "Messung an Zählstation; Übertragung auf den Standort ungeprüft. Tageswert = Mittel der gültigen Stunden × 24, kein Jahres-DTV." : traffic ? "Synthetisches Modell; gleichmäßiges Stundenprofil angenommen. Keine aktuelle Verkehrsmessung." : networkSize === undefined ? "Gemeinsame Verkehrsdaten noch nicht verfügbar." : `${networkSize} Modellstrecken im gemeinsamen Netz; keine automatische Quellenwahl.`}</dd>
      {traffic?.trucksPerDay === 0 && <dd className="mt-1 text-xs text-[#8b570b]">Die gewählte Quelle enthält hier keinen Verkehr. Das belegt weder eine verkehrsfreie Straße noch fehlende lokale oder Depotnachfrage.</dd>}</div>
      <div><dt className="font-semibold text-[#202426]">Ladebedarf <span className="ml-2 text-xs font-medium text-[#8b570b]">Nicht validiert</span></dt><dd className="mt-1 text-xs text-[#667278]">Verkehr ist kein Ladebedarf. E-Lkw-Anteil, Anhaltequote, Energiebedarf und Ankerkunden bleiben Szenarioannahmen; Depot- und Fremdkundenbedarf sind nicht gemessen.</dd></div>
      <div><dt className="font-semibold text-[#202426]">Evidenz <span className="ml-2 text-xs font-medium text-[#8b570b]">Nicht investitionsreif</span></dt><dd className="mt-1 text-xs text-[#667278]">Streckenzuordnung, Lkw-Zufahrt, Wettbewerb, Netzangebot und reale Ladenachfrage benötigen unabhängige Nachweise. Ein hohes Verkehrssignal schließt diese Lücken nicht.</dd></div>
    </dl>
    {traffic && <details className="mt-4 text-xs text-[#667278]"><summary className="cursor-pointer font-medium text-[#536066]">Quelle & Zuordnung</summary>
      <a className="mt-2 block text-[#087782] underline" href={traffic.source.url} target="_blank" rel="noreferrer">{traffic.source.title}</a>
      <p className="mt-1">Beobachtungsstand {traffic.source.observedThrough} · Version {traffic.source.version} · Lizenz {traffic.source.license}</p>
      <p className="mt-1">Nutzungsrechte: {traffic.source.commercialUse === "allowed" ? "zulässig laut Quellenmetadaten" : traffic.source.commercialUse === "restricted" ? "eingeschränkt" : "ungeklärt"}</p>
      <p className="mt-1">{traffic.source.kind === "measured" ? "Zählstation" : "Modellsegment"}: {number(traffic.matchDistanceKm ?? 0, 2)} km geometrischer Abstand, keine Straßenprüfung.</p>
      {context?.edge && <p className="mt-1">Modellkontext #{context.edge.edge.edgeId}: {context.edge.edge.label}. Modell-Endpunkte sind keine geprüften Autobahnanschlüsse.</p>}
      <p className="mt-2 break-all font-mono">SHA-256 {traffic.source.sha256}</p>
    </details>}
  </div>;
}
