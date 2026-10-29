// Round the clock: the financial-model workbook request (POST /api/rtc/model, laid out by
// web/lib/modelWorkbook.js). Everything comes from what the tab computed: the plant, the inputs,
// the 25-year model and, for the Live model sheet (web/lib/liveModel.js), the model's inputs and
// the hourly simulation's energy by year. Plain JavaScript (no JSX) so tools/check_live_model.mjs
// can build it in Node.
import * as E from "./engine.js";
import { cufPoint, genSource } from "../model/generation.js";

/** The financial inputs the Live model sheet reads. */
export const LIVE_FIN_KEYS = [
  "tariffEscalation", "solarOmLakhPerMw", "windOmLakhPerMw", "bessOmLakhPerMwh", "biomassOmLakhPerMw", "omEscalation", "insurancePct", "otherFixedCr",
  "biomassFuelRsPerKwh", "biomassFuelEscalation", "sellSurplus", "surplusPrice", "shortfallPenalty", "blockPenaltyMultiple", "debtFraction", "interestRate",
  "tenorYears", "repayment", "targetEquityIrr", "discountRate", "taxRate", "taxDepreciation", "wdvRate", "bookLifeYears", "salvagePct", "receivableDays",
  "graceYears", "paymentsPerYear", "targetDscr", "balloonPct", "stepUpPct", "refiYear", "refiRate", "refiTenorYears", "refiFeePct", "omStockMonths", "sparesPctOm", "wcInterestRate", "dsraMonths",
];
/** The cost keys the Live model reads (the construction schedule with them). */
export const LIVE_COST_KEYS = ["solarCrPerMw", "windCrPerMw", "bessCrPerMwh", "bessPcsCrPerMw", "biomassCrPerMw", "evacuationCr", "preopPct", "constructionMonths", "drawdown", "drawOrder"];

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));

/** The app's results, for the Live model's "Same as app?" column. */
export function liveResults(finance, fin) {
  return {
    tariff: finance.tariff,
    equityIrr: finance.equityIrr,
    irrGap: finance.equityIrr - fin.targetEquityIrr,
    projectIrr: finance.projectIrr,
    equityNpv: finance.equityNpv,
    projectNpv: finance.projectNpv,
    minDscr: finance.minDscr,
    avgDscr: finance.avgDscr,
    lcoe: finance.lcoe,
    levelisedTariff: finance.levelisedTariff,
    payback: finance.payback ?? "beyond the term",
    capexTotal: finance.capex.total,
    debt: finance.debt,
    equity: finance.equity,
    revenueTotal: finance.totals.revenue,
  };
}

const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;

/**
 * The workbook request for the Round the clock plant and its financial model.
 * fin: the model's financial inputs (with demandGrowth), bess: the battery at the 33 kV bus,
 * sites: { split: true } for solar and wind on separate sites, or null.
 */
export function rtcModelExport({ inputs, sizes, costs, fin, bess, sites, finance, profiles = null }) {
  const y1 = finance.rows[0];
  const n = finance.rows.length;
  const split = Boolean(sites?.split);
  const share = Math.min(1, Math.max(0, sizes.bessWindShare ?? 0));
  const capex = {
    solar: sizes.solarMw * costs.solarCrPerMw,
    wind: sizes.windMw * costs.windCrPerMw,
    bessEnergy: sizes.bessMwh * costs.bessCrPerMwh,
    bessPcs: sizes.bessMw * (costs.bessPcsCrPerMw || 0),
  };
  const pre = 1 + (costs.preopPct || 0);
  const lockedNote = finance.tariffLocked ? "Tariff fixed by you" : `Tariff that gives the ${pct(fin.targetEquityIrr, 2)} target equity IRR`;

  const outputs = [
    ["Tariff (₹/kWh)", finance.tariff, "tariff", lockedNote, "tariff"],
    ["Equity IRR", finance.equityIrr, "pct", "", "equityIrr"],
    ["Project IRR", finance.projectIrr, "pct", "", "projectIrr"],
    ["Equity NPV at the target IRR (₹ cr)", finance.equityNpv, "cr", "", "equityNpv"],
    ["Minimum DSCR", finance.minDscr, "x", "", "minDscr"],
    ["Average DSCR", finance.avgDscr, "x", "", "avgDscr"],
    ["Equity payback (year)", finance.payback ?? "beyond the term", "int", "", "payback"],
    ["Project cost (₹ cr)", finance.capex.total, "cr", `₹${(finance.capex.total / (inputs.plantCapacityMw || 1)).toFixed(2)} cr per contracted MW`, "capexTotal"],
    ["Debt (₹ cr)", finance.debt, "cr", "", "debt"],
    ["Equity (₹ cr)", finance.equity, "cr", "", "equity"],
    ["Levelised cost of supply (₹/kWh)", finance.lcoe, "tariff", `at a ${pct(fin.discountRate)} discount rate`, "lcoe"],
    ["Year-1 supply (MU)", y1.deliveredMu, "mu", `${pct(y1.dfr)} of demand (target ${pct(inputs.dfrTarget)})`],
    ["Lowest DFR over the term", finance.minLifetimeDfr, "pct", finance.minLifetimeDfr >= inputs.dfrTarget - 1e-6 ? "meets the target every year" : "below the target in some years"],
    [`Revenue over ${n} years (₹ cr)`, finance.totals.revenue, "cr", "", "revenueTotal"],
  ];
  const plant = [
    ["Contracted capacity (MW)", inputs.plantCapacityMw, "mw"],
    ["Annual energy (MU)", inputs.annualEnergyMu, "mu", `load factor ${pct((inputs.annualEnergyMu * 1000) / (inputs.plantCapacityMw * 8760))}`],
    ["Solar (MW)", sizes.solarMw, "mw", `${Math.round(y1.genBusMu || 0)} MU generated at the 33 kV bus in year 1 with wind`],
    ["Wind (MW)", sizes.windMw, "mw"],
    ["Battery power (MW)", sizes.bessMw, "mw", split ? "both sites together" : ""],
    ["Battery energy (MWh)", sizes.bessMwh, "mw", `${(sizes.bessMwh / (sizes.bessMw || 1)).toFixed(1)} h`],
    ...(split ? [
      ["Battery at the solar site (MW / MWh)", `${Math.round(sizes.bessMw * (1 - share))} MW / ${Math.round(sizes.bessMwh * (1 - share))} MWh`, "text"],
      ["Battery at the wind site (MW / MWh)", `${Math.round(sizes.bessMw * share)} MW / ${Math.round(sizes.bessMwh * share)} MWh`, "text"],
      ["Separate sites", "each battery charges from its own site only", "text", "split decided by the optimizer"],
    ] : []),
  ];
  const keyInputs = [
    ["Supply target", `${pct(inputs.dfrTarget)} of demand, ${inputs.dfrBasis === "monthly" ? "every month" : "over each year"}`, "text"],
    ["Losses to the 220 kV meter", `transformer ${pct(inputs.trafoLossPct, 2)}, line ${pct(inputs.lineLossPct, 2)}, other ${pct(inputs.lossPct || 0, 2)}`, "text"],
    ["Capex", `solar ₹${costs.solarCrPerMw} cr/MW · wind ₹${costs.windCrPerMw} cr/MW · battery ₹${costs.bessCrPerMwh} cr/MWh · pre-operative ${pct(costs.preopPct || 0)}`, "text"],
    ["Financing", `equity IRR ${pct(fin.targetEquityIrr)} · debt ${pct(fin.debtFraction, 0)} at ${pct(fin.interestRate, 2)} for ${fin.tenorYears} years · tax ${pct(fin.taxRate, 2)}`, "text"],
    ["Surplus sale", fin.sellSurplus ? `₹${fin.surplusPrice}/kWh` : "none", "text"],
  ];
  const notes = [
    "The plant and its energy come from the Round the clock tab: an hourly simulation of every year of the term, with degradation and battery augmentation.",
    "The Live model tab rebuilds the financial model as Excel formulas on these inputs and energies.",
  ];

  const inputsList = [];
  const add = (group, input, value, unit = "") => inputsList.push({ group, input, value, unit, source: "Round the clock tab" });
  add("Demand", "Annual energy", inputs.annualEnergyMu, "MU");
  add("Demand", "Contracted capacity", inputs.plantCapacityMw, "MW");
  add("Demand", "Supply target (DFR)", inputs.dfrTarget, "%");
  add("Demand", "Target basis", inputs.dfrBasis);
  add("Demand", "Design check", inputs.designCheck);
  add("Demand", "Demand growth", inputs.demandGrowth || 0, "%");
  add("Losses", "Other losses before the 33 kV bus", inputs.lossPct || 0, "%");
  add("Losses", "Power transformer 33/220 kV", inputs.trafoLossPct || 0, "%");
  add("Losses", "220 kV line to the GSS", inputs.lineLossPct || 0, "%");
  add("Plant", "Solar", sizes.solarMw, "MW");
  add("Plant", "Wind", sizes.windMw, "MW");
  add("Plant", "Battery power", sizes.bessMw, "MW");
  add("Plant", "Battery energy", sizes.bessMwh, "MWh");
  if (split) {
    add("Separate sites", "Battery share at the wind site", share, "%");
  }
  add("Battery", "Round-trip efficiency at the 33 kV bus", bess.rte, "%");
  add("Battery", "Capacity fade", bess.annualDegradation || 0, "%");
  add("Battery", "Augmentation", bess.augmentation || "none");
  add("Battery", "One-time augmentation year", bess.augmentationYear || 0, "year");
  add("Battery", "Battery price decline", bess.costDeclinePct || 0, "%");
  for (const [label, key, unit] of [["Solar", "solarCrPerMw", "₹ cr/MW"], ["Wind", "windCrPerMw", "₹ cr/MW"], ["Battery energy", "bessCrPerMwh", "₹ cr/MWh"], ["Battery power conversion", "bessPcsCrPerMw", "₹ cr/MW"], ["Evacuation", "evacuationCr", "₹ cr"], ["Pre-operative and IDC", "preopPct", "%"]]) {
    add("Capex", label, costs[key] || 0, unit);
  }
  for (const [label, key, unit] of [
    ["Solar O&M", "solarOmLakhPerMw", "₹ lakh/MW/yr"], ["Wind O&M", "windOmLakhPerMw", "₹ lakh/MW/yr"], ["Battery O&M", "bessOmLakhPerMwh", "₹ lakh/MWh/yr"],
    ["O&M escalation", "omEscalation", "%"], ["Insurance", "insurancePct", "%"], ["Other fixed cost", "otherFixedCr", "₹ cr/yr"],
    ["Solar degradation", "solarDegradation", "%"], ["Wind degradation", "windDegradation", "%"],
    ["Tariff escalation", "tariffEscalation", "%"], ["Shortfall penalty", "shortfallPenalty", "₹/kWh"], ["Surplus sale price", "surplusPrice", "₹/kWh"],
    ["Target equity IRR", "targetEquityIrr", "%"], ["Debt share", "debtFraction", "%"], ["Interest rate", "interestRate", "%"], ["Loan tenor", "tenorYears", "years"],
    ["Repayment", "repayment", ""], ["Corporate tax", "taxRate", "%"], ["Tax depreciation", "taxDepreciation", ""], ["WDV rate", "wdvRate", "%"],
    ["Book life", "bookLifeYears", "years"], ["Salvage value", "salvagePct", "%"], ["Receivable days", "receivableDays", "days"], ["Discount rate", "discountRate", "%"],
  ]) add("Operation and finance", label, fin[key] ?? 0, unit);
  add("Operation and finance", "Sell surplus", fin.sellSurplus ? "Yes" : "No");

  const capexRows = [
    ["Solar", capex.solar * pre, "cr"],
    ["Wind", capex.wind * pre, "cr"],
    ["Battery energy", capex.bessEnergy * pre, "cr"],
    ...(capex.bessPcs ? [["Battery power conversion", capex.bessPcs * pre, "cr"]] : []),
    ["Transmission / evacuation", (costs.evacuationCr || 0) * pre, "cr"],
    ["Total project cost (incl. pre-operative & IDC)", finance.capex.total, "cr", `pre-operative ${pct(costs.preopPct || 0)} of hard cost`],
    ["Debt", finance.debt, "cr", pct(fin.debtFraction, 0)],
    ["Equity", finance.equity, "cr"],
  ];

  const energy = { title: "Energy and tariff", lines: [
    ["Demand", "demandMu", "mu", "MU"], ["Generated at the 33 kV bus", "genBusMu", "mu", "MU"], ["Injected at the 33 kV bus", "injectedMu", "mu", "MU"],
    ["Power transformer loss", "trafoLossMu", "mu", "MU"], ["Transmission line loss", "lineLossMu", "mu", "MU"], ["At the 220 kV billing meter", "meterMu", "mu", "MU"],
    ["Delivered to the customer", "deliveredMu", "mu", "MU"], ["DFR (delivered ÷ demand)", "dfr", "pct", "", false],
    ["Surplus sold", "excessMu", "mu", "MU"], ["Curtailed", "curtailMu", "mu", "MU"], ["Shortfall vs target", "shortfallMu", "mu", "MU"],
    ["Tariff", "tariff", "tariff", "₹/kWh", false],
  ] };
  const revenue = { title: "Revenue", lines: [["Energy revenue", "energyRevenue"], ["Surplus sale revenue", "surplusRevenue"], ["Shortfall penalty", "penalty"], ["Total revenue", "revenue"]] };
  const costsSection = { title: "Operating costs", lines: [
    ["O&M", "om"], ["Insurance", "insurance"], ["Other fixed cost", "other"], ["Total operating cost", "opex"],
  ] };
  const statements = [
    energy, revenue, costsSection,
    { title: "Profit and loss", lines: [["EBITDA", "ebitda"], ["Book depreciation", "bookDep"], ["Interest", "interest"], ["Profit before tax", "pbt"], ["Tax depreciation", "taxDep"], ["Tax", "tax"], ["Profit after tax", "pat"]] },
    { title: "Cash flow", lines: [["Receivables", "receivables", "cr", "₹ cr", false], ["Working capital change", "dWc"], ["Battery augmentation", "augCapex"], ["CFADS", "cfads"], ["Debt service", "debtService"], ["Free cash to equity", "fcfe"], ["Cumulative equity cash", "cumEquity", "cr", "₹ cr", false], ["Project cash flow", "projectCf"]] },
    { title: "Debt", lines: [["Opening debt", "openingDebt", "cr", "₹ cr", false], ["Interest", "interest"], ["Principal", "principal"], ["Closing debt", "closingDebt", "cr", "₹ cr", false], ["DSCR", "dscr", "x", "×", false]] },
  ];

  const mwh = (v) => (Number.isFinite(v) ? v * 1000 : 0);
  return {
    fileName: `Round_the_clock_${Math.round(inputs.plantCapacityMw)}MW_financial_model`,
    title: "Round the clock supply · financial model",
    subtitle: [`${Math.round(inputs.plantCapacityMw)} MW contracted`, `${Math.round(inputs.annualEnergyMu)} MU a year`, `${n} years`, split ? "solar and wind on separate sites" : null].filter(Boolean).join(" · "),
    cover: { outputs, plant, inputs: keyInputs, tender: [], notes },
    conditions: [],
    inputs: inputsList,
    plant,
    capex: capexRows,
    rows: finance.rows,
    streams: [energy, revenue, costsSection, { title: "Capital spend in operation", lines: [["Battery augmentation", "augCapex"]] }],
    statements,
    flows: { equity: finance.equityFlows, project: finance.projectFlows },
    live: {
      engine: "simulation",
      sourceAll: "Round the clock tab",
      tariff: finance.tariff,
      tariffLocked: finance.tariffLocked,
      dfrTarget: inputs.dfrTarget,
      split,
      market: null,
      bessNote: split ? `both sites together; ${Math.round(share * 100)}% at the wind site` : null,
      on: { solar: true, wind: true, hydro: false, biomass: false, thermal: false, bess: true },
      sizes: pick(sizes, ["solarMw", "windMw", "bessMw", "bessMwh"]),
      costs: { ...pick(costs, LIVE_COST_KEYS), plants: [] },
      fin: pick(fin, LIVE_FIN_KEYS),
      bess: pick(bess, ["annualDegradation", "augmentation", "augmentationYear", "costDeclinePct"]),
      // the year-by-year energy of the tab's hourly simulation, from the model's own rows
      ops: finance.rows.map((r) => ({
        demandMWh: mwh(r.demandMu), deliveredMWh: mwh(r.deliveredMu), excessMWh: mwh(r.excessMu),
        genBusMWh: mwh(r.genBusMu), injectedMWh: mwh(r.injectedMu), trafoLossMWh: mwh(r.trafoLossMu), lineLossMWh: mwh(r.lineLossMu), meterMWh: mwh(r.meterMu),
      })),
      gen: profiles ? rtcGen(inputs, fin, profiles) : null,
      app: liveResults(finance, fin),
    },
  };
}

/** The generation build-up: the tab's profiles where they were measured, and their losses to the 33 kV bus (with any other loss). */
function rtcGen(inputs, fin, { solarCf, windCf, solarName, windName }) {
  const lf = E.lossFactors(inputs, 1);
  const aux = 1 - (inputs.lossPct || 0);
  return {
    solar: genSource({ cf: solarCf, toBus: 1 - lf.solar * aux, degradation: fin.solarDegradation, cufAt: cufPoint("solar", inputs.solarFileAt ?? undefined), profile: solarName ? `Uploaded solar profile ${solarName}` : "Typical solar profile" }),
    wind: genSource({ cf: windCf, toBus: 1 - lf.wind * aux, degradation: fin.windDegradation, cufAt: cufPoint("wind", inputs.windFileAt ?? undefined), profile: windName ? `Uploaded wind profile ${windName}` : "Typical wind profile" }),
  };
}

/** POST the request and save the workbook. */
export async function downloadRtcModel(payload) {
  const res = await fetch("/api/rtc/model", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${payload.fileName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
