import { z } from "zod";
import { financeSchema, type FinanceInput } from "./contracts.js";

const annualSchema = z.object({ year: z.number().int().min(2020).max(2100),
  deliveredKwh: z.number().finite().nonnegative(), gridKwh: z.number().finite().nonnegative(),
  completedSessions: z.number().finite().nonnegative() }).strict();
export type AnnualVolume = z.infer<typeof annualSchema>;

export function calculateCashflows(raw: AnnualVolume[], input: FinanceInput) {
  const volumes = z.array(annualSchema).min(1).max(10).parse(raw);
  const f = financeSchema.parse(input);
  if (volumes.some((v, i) => i > 0 && v.year !== volumes[i - 1].year + 1)) throw new Error("Jahresreihe muss lückenlos aufsteigend sein");
  if (volumes.some((v) => v.gridKwh + 1e-7 < v.deliveredKwh)) throw new Error("Energiebezug kleiner als abgegebene Energie");
  if (f.replacements.some((x) => !volumes.some((v) => v.year === x.year))) throw new Error("Ersatzinvestition außerhalb des Planzeitraums");
  let cumulativeCashflow = -f.capex, cumulativeDiscountedCashflow = -f.capex;
  let paybackYear: number | null = f.capex === 0 ? volumes[0].year - 1 : null;
  let discountedPaybackYear: number | null = paybackYear;
  const years = volumes.map((v, i) => {
    const priceFactor = (1 + f.priceEscalation) ** i;
    const costFactor = (1 + f.costEscalation) ** i;
    const revenue = v.deliveredKwh * f.salePricePerKwh * priceFactor;
    const electricityCost = v.gridKwh * f.electricityPricePerKwh * costFactor;
    const variableCost = v.deliveredKwh * f.variableCostPerKwh * costFactor;
    const fixedCost = f.fixedCostAnnual * costFactor;
    const operatingCashflow = revenue - electricityCost - variableCost - fixedCost;
    const replacementCapex = f.replacements.filter((x) => x.year === v.year).reduce((s, x) => s + x.amount, 0);
    const residualValue = i === volumes.length - 1 ? f.residualValue : 0;
    const projectCashflow = operatingCashflow - replacementCapex + residualValue;
    const discountedCashflow = projectCashflow / (1 + f.discountRate) ** (i + 1);
    cumulativeCashflow += projectCashflow;
    cumulativeDiscountedCashflow += discountedCashflow;
    if (paybackYear === null && cumulativeCashflow >= 0) paybackYear = v.year;
    if (discountedPaybackYear === null && cumulativeDiscountedCashflow >= 0) discountedPaybackYear = v.year;
    const contributionPerKwh = f.salePricePerKwh * priceFactor - f.variableCostPerKwh * costFactor
      - (v.deliveredKwh > 0 ? v.gridKwh / v.deliveredKwh : 1) * f.electricityPricePerKwh * costFactor;
    return { ...v, revenue, electricityCost, variableCost, fixedCost, operatingCashflow, replacementCapex, residualValue,
      projectCashflow, discountedCashflow, cumulativeCashflow, cumulativeDiscountedCashflow,
      breakEvenEnergyKwh: contributionPerKwh > 0 && v.deliveredKwh > 0 ? fixedCost / contributionPerKwh : null };
  });
  // Replacement spending can make a previously recovered investment negative again.
  const recoverySustained = paybackYear !== null && years.filter((y) => y.year >= paybackYear!).every((y) => y.cumulativeCashflow >= 0);
  const discountedRecoverySustained = discountedPaybackYear !== null && years.filter((y) => y.year >= discountedPaybackYear!).every((y) => y.cumulativeDiscountedCashflow >= 0);
  return { initialCashflow: -f.capex, years, npv: cumulativeDiscountedCashflow, paybackYear, discountedPaybackYear,
    recoverySustained, discountedRecoverySustained,
    basis: "Projekt-Cashflows netto, vor Steuern und Finanzierung; Zahlungen am Jahresende, Investition vor Betriebsbeginn." };
}
