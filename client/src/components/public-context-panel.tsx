import { useEffect, useState } from "react";
import { Check, ExternalLink, RotateCcw } from "lucide-react";
import { catalogSchema, electricityReferenceSchema, nearestWeather, referenceElectricityPrice, stressEnergyKwh, trafficComparisonSchema, weatherReferenceSchema,
  type ElectricityReference, type PublicCatalog, type TrafficComparison, type WeatherReference } from "@shared/public-context";
import type { ParameterReference, SourceRef } from "@shared/charging-planning/contracts";
import type { PlanningSite, SiteInput } from "@shared/charging-planning/site-input";
import "./public-context-panel.css";

const n = (value: number, digits = 1) => value.toLocaleString("de-DE", { maximumFractionDigits: digits });
const date = (value: string) => new Date(value).toLocaleDateString("de-DE", { timeZone: "UTC" });
function Source({ source }: { source: SourceRef }) {
  return <details className="context-source"><summary>Datenquelle · Stand {date(source.observedThrough)}</summary><a href={source.url} target="_blank" rel="noreferrer">{source.title} <ExternalLink size={12} /></a><p>Lizenz: {source.license}<br />Geschäftliche Nutzung: {source.commercialUse === "allowed" ? "laut Quellenangaben erlaubt; Lizenzbedingungen beachten" : source.commercialUse === "restricted" ? "nur eingeschränkt erlaubt" : "noch zu klären"}<br />Abgerufen am {date(source.retrievedAt)}</p><details><summary>Technischer Herkunftsnachweis</summary><code>SHA-256: {source.sha256}</code></details></details>;
}

export default function PublicContextPanel({ site, input, stationId, onApply, onUndo }: {
  site?: PlanningSite; input: SiteInput | null; stationId?: string;
  onApply: (ref: ParameterReference) => void; onUndo: (field: ParameterReference["field"]) => void;
}) {
  const [prices, setPrices] = useState<ElectricityReference>();
  const [weather, setWeather] = useState<WeatherReference>();
  const [catalog, setCatalog] = useState<PublicCatalog>();
  const [traffic, setTraffic] = useState<TrafficComparison>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [retry, setRetry] = useState(0);
  const [priceMode, setPriceMode] = useState<"meanEurMwh" | "p10EurMwh" | "p90EurMwh">("meanEurMwh");
  const [surcharge, setSurcharge] = useState("0.13");
  const [stress, setStress] = useState("20");
  const [vehicleId, setVehicleId] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setErrors({});
    setPrices(undefined); setWeather(undefined); setCatalog(undefined); setTraffic(undefined);
    const load = async (name: string, parse: (raw: unknown) => void) => {
      try {
        const response = await fetch(`/data/context/${name}.json`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        parse(await response.json());
      } catch { if (!controller.signal.aborted) setErrors((e) => ({ ...e, [name]: "Diese Daten konnten nicht geladen oder geprüft werden." })); }
    };
    void load("electricity-de", (raw) => setPrices(electricityReferenceSchema.parse(raw)));
    void load("weather-de", (raw) => setWeather(weatherReferenceSchema.parse(raw)));
    void load("catalogs-de", (raw) => setCatalog(catalogSchema.parse(raw)));
    void load("traffic-months-de", (raw) => setTraffic(trafficComparisonSchema.parse(raw)));
    return () => controller.abort();
  }, [retry]);
  const nearest = site && weather ? nearestWeather(site, weather.stations) : null;
  const comparison = traffic?.stations.find((s) => s.stationId === stationId);
  const energyRef = input?.references.find((r) => r.field === "energyKwh");
  const baseEnergy = energyRef?.baselineValue ?? input?.energyKwh;
  let selectedPrice: number | undefined, stressedEnergy: number | undefined;
  try { if (prices && surcharge.trim()) selectedPrice = referenceElectricityPrice(prices[priceMode], Number(surcharge)); } catch { /* Invalid draft stays unapplied. */ }
  try { if (baseEnergy !== undefined && stress.trim()) stressedEnergy = stressEnergyKwh(baseEnergy, Number(stress)); } catch { /* Invalid draft stays unapplied. */ }
  const vehicle = catalog?.vehicles.find((v) => v.id === vehicleId);
  const applied = (field: ParameterReference["field"]) => input?.references.find((ref) => ref.field === field);
  const undo = (field: ParameterReference["field"]) => applied(field) && <button type="button" className="context-icon" title="Vorherigen Wert wiederherstellen" aria-label={`${field === "energyKwh" ? "Mehrverbrauch" : field === "electricityPrice" ? "Strompreis" : "Fahrzeug-Ladeleistung"} zurücknehmen`} onClick={() => onUndo(field)}><RotateCcw size={15} /></button>;
  return <details className="public-context">
    <summary>Zusätzliche Daten & Annahmen</summary>
    <p className="context-note">Daten zur Umgebung von {site?.label || "diesem Standort"}. Übernommene Werte gelten für alle verglichenen Standorte.</p>
    <section className="context-section" aria-labelledby="context-price-heading">
      <h4 id="context-price-heading">Strompreise im Jahr {prices?.year || "…"}</h4>
      {prices && <>
        <div className="context-stats"><span><strong>{n(prices.meanEurMwh / 10, 2)}</strong> ct/kWh Börsenmittel</span><span><strong>{n(prices.negativeHours, 0)}</strong> Stunden mit Preisen unter null</span><span><strong>{n(prices.coverage * 100)}</strong> % der Jahresstunden erfasst</span></div>
        <label htmlFor="context-price-reference">Börsenpreis für die Rechnung<select id="context-price-reference" value={priceMode} onChange={(e) => setPriceMode(e.target.value as typeof priceMode)}><option value="meanEurMwh">Durchschnitt des Jahres</option><option value="p10EurMwh">Niedriger Preis · 10 % der Stunden waren günstiger</option><option value="p90EurMwh">Hoher Preis · 10 % der Stunden waren teurer</option></select></label>
        <label htmlFor="context-surcharge">Zusätzliche Bezugskosten · angenommen (€/kWh)<input id="context-surcharge" type="number" min="0" max="5" step="0.01" value={surcharge} onChange={(e) => setSurcharge(e.target.value)} /></label>
        <div className="context-actions"><button type="button" className="economics-export" disabled={!input || selectedPrice === undefined} onClick={() => onApply({ field: "electricityPrice", appliedValue: selectedPrice!, baselineValue: applied("electricityPrice")?.baselineValue ?? input!.electricityPrice, source: prices.source,
          note: `Börsenpreise ${prices.year}: ${priceMode === "meanEurMwh" ? "Jahresdurchschnitt" : priceMode === "p10EurMwh" ? "niedriger Stundenpreis (10. Perzentil)" : "hoher Stundenpreis (90. Perzentil)"} ${n(prices[priceMode] / 1000, 4)} €/kWh plus ${n(Number(surcharge), 4)} €/kWh angenommene Bezugskosten. Gleichgewichtete Stunden in UTC; kein Stromvertrag und keine Preisprognose.` })}><Check size={15} /> {selectedPrice === undefined ? "Preis bitte prüfen" : `${n(selectedPrice, 4)} €/kWh übernehmen`}</button>{undo("electricityPrice")}</div>
        <p className="context-note">Der Börsenpreis ist nur ein Teil der Stromrechnung. Netzgebühren, Abgaben und Lieferkosten kommen hinzu. Jede Stunde zählt hier gleich viel, unabhängig davon, wann der Ladepark Strom bezieht. Die Werte stammen aus der Vergangenheit, nicht aus einer Preisprognose.</p>
        <Source source={prices.source} />
      </>}
      {errors["electricity-de"] && <p role="alert">{errors["electricity-de"]}</p>}
    </section>
    <section className="context-section" aria-labelledby="context-weather-heading">
      <h4 id="context-weather-heading">Wetter & möglicher Mehrverbrauch</h4>
      {weather && <p className="context-note">Wetterdaten aus einer Auswahl von {weather.stations.length} Stationen des Deutschen Wetterdienstes (DWD).</p>}
      {weather && !nearest && <p className="context-note">Im Umkreis von 100 km ist keine Station mit ausreichend vollständigen Daten verfügbar. Deshalb werden hier keine Wetterwerte angezeigt.</p>}
      {nearest && <>
        <p>{nearest.name} · {n(nearest.distanceKm)} km Luftlinie · {n(nearest.elevationM, 0)} m Höhe · {nearest.year}</p>
        <div className="context-stats"><span><strong>{n(nearest.meanC)}</strong> °C Jahresmittel</span><span><strong>{n(nearest.p10C)}</strong> °C · 10 % der Stunden waren kälter</span><span><strong>{n(nearest.hoursBelowZero, 0)}</strong> Stunden unter 0 °C</span></div>
        <p className="context-note">{n(nearest.coverage * 100, 2)} % der Jahresstunden erfasst. Am Standort können andere Temperaturen herrschen, etwa durch eine andere Höhenlage. Daraus lässt sich noch kein Lkw-Verbrauch ableiten.</p>
        <label htmlFor="context-stress">Zusätzliche Energie je Ladung · angenommen (%)<input id="context-stress" type="number" min="0" max="100" step="5" value={stress} onChange={(e) => setStress(e.target.value)} /></label>
        <div className="context-actions"><button type="button" className="economics-export" disabled={!input || stressedEnergy === undefined} onClick={() => onApply({ field: "energyKwh", appliedValue: stressedEnergy!, baselineValue: baseEnergy!, source: nearest.source,
          note: `${n(Number(stress))} % zusätzliche Energie auf ursprünglich ${n(baseEnergy!)} kWh je Ladung, für das gesamte Planjahr. Frei gewählte Annahme, nicht aus Wetter oder Fahrdaten berechnet. DWD-Station ${nearest.stationId} dient nur als Wetterreferenz.` })}><Check size={15} /> {stressedEnergy === undefined ? "Energiebedarf bitte prüfen" : `${n(stressedEnergy)} kWh je Ladung übernehmen`}</button>{undo("energyKwh")}</div>
        <p className="context-note">Der Mehrverbrauch ist frei angenommen, nicht aus dem Wetter berechnet. Er gilt für jede Ladung im ganzen Jahr, nicht nur für kalte Tage.</p><Source source={nearest.source} />
      </>}
      {errors["weather-de"] && <p role="alert">{errors["weather-de"]}</p>}
    </section>
    <section className="context-section" aria-labelledby="context-vehicle-heading">
      <h4 id="context-vehicle-heading">Wie schnell kann der Lkw laden?</h4>
      {catalog && <><label htmlFor="context-vehicle">Lkw-Modell · Herstellerangaben<select id="context-vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}><option value="">Modell auswählen</option>{catalog.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name} · bis {v.maxChargingKw} kW</option>)}</select></label>
        <div className="context-actions"><button type="button" className="economics-export" disabled={!input || !vehicle} onClick={() => onApply({ field: "vehiclePowerKw", appliedValue: vehicle!.maxChargingKw, baselineValue: applied("vehiclePowerKw")?.baselineValue ?? input!.vehiclePowerKw, source: vehicle!.source,
          note: `${vehicle!.name}: maximal ${n(vehicle!.maxChargingKw)} kW laut Hersteller. Die Rechnung nutzt diesen Wert als feste Obergrenze; in der Praxis kann die Ladeleistung während des Ladens sinken. Genaue Fahrzeugausstattung und passenden Ladeanschluss separat prüfen.` })}><Check size={15} /> Ladeleistung übernehmen</button>{undo("vehiclePowerKw")}</div>
        <p className="context-note">Fahrzeug, Ladeplatz und Netzanschluss begrenzen gemeinsam die Ladeleistung. Die Herstellerangabe ist ein Höchstwert, keine dauerhaft garantierte Leistung. Batteriegröße und passender Ladeanschluss sind damit nicht bestätigt.</p>{vehicle && <Source source={vehicle.source} />}</>}
      {errors["catalogs-de"] && <p role="alert">{errors["catalogs-de"]}</p>}
    </section>
    <section className="context-section" aria-labelledby="context-traffic-heading">
      <h4 id="context-traffic-heading">Verkehr im Januar und Juli 2026</h4>
      {traffic && (comparison ? <><p>Zählstelle {comparison.stationId} · {comparison.roadClass} {comparison.road} · {comparison.vehicleClass === "truck" ? "Lkw" : "schwere Fahrzeuge inkl. Busse"}</p><div className="economics-table-wrap"><table className="economics-table"><caption>Durchschnittliche Fahrzeuge pro Tag an derselben Zählstelle</caption><thead><tr><th>Tag</th><th>Januar</th><th>Juli</th></tr></thead><tbody>{(["weekday", "saturday", "sunday"] as const).map((d, i) => <tr key={d}><th>{["Mo–Fr", "Samstag", "Sonntag"][i]}</th><td>{n(comparison.first[d], 0)}</td><td>{n(comparison.second[d], 0)}</td></tr>)}</tbody></table></div>{traffic.sources.map((s) => <Source key={s.id} source={s} />)}</> : <p className="context-note">{stationId ? "Für diese Zählstelle fehlen vollständige Daten zum Monatsvergleich." : "Noch keine Zählstelle für den Monatsvergleich gewählt."} Für {traffic.stations.length} Zählstellen ist ein Vergleich verfügbar.</p>)}
      <p className="context-note">Der Vergleich zeigt zwei Monate, nicht den Verlauf eines ganzen Jahres. Ferien und Feiertage können die Unterschiede beeinflussen. Die Messwerte sind noch nicht abschließend von der BASt geprüft und ändern die Rechnung nicht automatisch.</p>
      {errors["traffic-months-de"] && <p role="alert">{errors["traffic-months-de"]}</p>}
    </section>
    {input?.references.length ? <section className="context-section"><h4>Übernommene Werte</h4>{input.references.map((ref) => <details key={ref.field} className="context-source"><summary>{ref.field === "electricityPrice" ? "Strompreis" : ref.field === "energyKwh" ? "Energie je Ladung" : "Maximale Lkw-Ladeleistung"}: {n(ref.appliedValue, ref.field === "electricityPrice" ? 4 : 1)} {ref.field === "electricityPrice" ? "€/kWh" : ref.field === "energyKwh" ? "kWh" : "kW"}</summary><p className="context-note">{ref.note}</p></details>)}</section> : null}
    <details className="context-section"><summary>DHL-Paketzentren · veröffentlichte Liste von 2024</summary>{catalog && <><p className="context-note">DHL nannte am 24.05.2024 diese 38 Paketzentren. Ob sie heute unverändert bestehen, ist nicht bestätigt. Adressen, Touren und Ladebedarf liegen nicht vor. Die Liste dient zur Orientierung und fließt nicht in die Rechnung ein.</p><label htmlFor="context-dhl-search">Standortname<input id="context-dhl-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></label><ul className="context-directory">{catalog.dhl.names.filter((name) => name.toLocaleLowerCase("de").includes(search.toLocaleLowerCase("de"))).map((name) => <li key={name}>{name}</li>)}</ul><p className="context-note">Der technische Herkunftsnachweis bezieht sich auf die übertragene Namensliste, nicht auf die Original-Webseite.</p><Source source={catalog.dhl.source} /></>}</details>
    <details className="context-section"><summary>Netzanschluss, Solarstrom & Batteriespeicher</summary><p className="context-note">Für diesen Standort liegen noch keine bestätigte Netzleistung, Stromverbrauchsdaten oder Angaben zu Solar- und Speicheranlagen vor.</p><ul className="context-links"><li><a href="https://www.vnbdigital.de/" target="_blank" rel="noreferrer">Zuständigen Netzbetreiber finden · VNBdigital <ExternalLink size={12} /></a></li><li><a href="https://www.marktstammdatenregister.de/MaStR/Datendownload" target="_blank" rel="noreferrer">Gemeldete Energieanlagen suchen · Marktstammdatenregister <ExternalLink size={12} /></a></li><li><a href="https://re.jrc.ec.europa.eu/pvg_tools/en/" target="_blank" rel="noreferrer">Möglichen Solarertrag berechnen · PVGIS <ExternalLink size={12} /></a></li></ul><p className="context-note">Koordinaten: {site ? `${n(site.lat, 5)}, ${n(site.lon, 5)}` : "kein Standort gewählt"}. Diese Quellen sind nicht an die Rechnung angeschlossen. Nur der Netzbetreiber kann die verfügbare Anschlussleistung bestätigen; ein möglicher Solarertrag sagt nichts über den tatsächlichen Strombedarf aus.</p></details>
    {Object.keys(errors).length > 0 && <button type="button" className="economics-export" onClick={() => setRetry((r) => r + 1)}><RotateCcw size={15} /> Daten erneut laden</button>}
  </details>;
}
