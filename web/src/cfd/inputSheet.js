// The bid's inputs as rows of an Excel template (web/src/cfd/inputWorkbook.js writes and reads the
// file): every input box of the CfD Bid, CfD Own Solar and FDRE-X Bid tabs (the bid agent's
// catalogue, ./agent.js and ../fdrex/agent.js agentInputs) and the finance team's terms that sit in
// state.fin, state.costs and state.bess, each with its group, unit, allowed values, the "Fill up for
// me please" value and a comment that says what the input is and how the model uses it.
//
// A row is { key, group, label, kind, unit, pct, min, max, int, options, benchmark, comment,
// get(state), set(state, value) }. kind is number | date | boolean | choice; a percent row (pct)
// holds a fraction in the state and is written and read in percent (24 means 24%). set returns
// the new state or throws an Error whose message says what is allowed. Plain JavaScript with no
// browser APIs, checked in Node by tools/check_bid_input_sheet.mjs.

import * as E from "../rtc/engine.js";
import { V3_FIN_DEFAULTS } from "../rtc/financeV3.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// what an input is and what the model does with it, where the box's own hint does not say enough
const ABOUT = {
  contractedMw: "The capacity you bid, in whole MW. Every per-MW input below (battery MWh and MW per MW, transmission, admin) is multiplied by it.",
  effectiveDate: "The date the contract becomes effective. Every date of the bid follows from it: the documents and the bank guarantee, financial closure, the commissioning date and the end of the term.",
  sellMarket: "The power-exchange segment whose hourly prices the model uses for the peak supply and for any sale of surplus.",
  useMarket: "Yes lets the battery charge from power bought on the green day-ahead market (GDAM) within the tender's limit on bought power. No: only your own RE (and group RE if chosen) charges it.",
  useGroup: "Yes lets the battery charge from a group company's RE at the price below, within the tender's limit, after month 36.",
  merchant: "Yes sells the own RE the battery does not need on the exchange, on days the supply is met. No: that energy is curtailed and earns nothing.",
  dayInjection: "Whether you hold grid connectivity for the solar hours as well. No: nothing is injected from 06:00 to 18:00, so solar beyond what the battery needs is curtailed.",
  psm: "Yes takes ₹0.02/kWh off every bill for the whole term in exchange for SECI's Payment Security Mechanism. You choose once, in the Covering Letter.",
  afterTerm: "What the plant does once the contract ends: nothing (its value ends with the term) or years of sale at market prices.",
  augmentation: "Every year: the battery's faded MWh are replaced each year at the battery price (falling by the rate under Costs), so the usable MWh stay at nameplate. None: the capacity fades by the degradation rate. A year-by-year schedule is set further down (Battery augmentation by year).",
  shortfallPolicy: "Meet every day: the optimiser sizes the own RE so that no day falls short. Pay the penalty: a day may fall short where the penalty is cheaper than more plant.",
  merchantYears: "How many years after the term the plant keeps selling at market prices.",
  essMwhPerMw: "Usable battery energy for each contracted MW, at the meter.",
  essMwPerMw: "Battery inverter (PCS) power for each contracted MW.",
  solarMw: "The co-located solar in MW AC. Leave the value the template shows to let the app size it ('Sized for you' on the Design step); a different number becomes your size and the app keeps it.",
  windMw: "The own wind in MW. Leave the value the template shows to let the app size it; a different number becomes your size.",
  availability: "Share of the contracted supply actually delivered, after outages.",
  solarCuf: "Annual AC energy ÷ (MWac × 8,760 h), at the point the losses on the Design step say (the billing meter when the losses are not modelled).",
  solarDegradation: "Loss of solar output each year.",
  windCuf: "Annual energy ÷ (MW × 8,760 h).",
  essDegradation: "Loss of usable battery energy each year before augmentation.",
  groupCharges: "Transmission charges, losses and fees on the group company's power, on top of its price.",
  essCrPerMwh: "All-in battery cost: cells, PCS, balance of plant, EPC, in ₹ crore per MWh of nameplate.",
  solarCrPerMw: "Solar EPC cost in ₹ crore per MW AC (the DC:AC ratio gives the MWp).",
  windCrPerMw: "Wind cost in ₹ crore per MW.",
  preopPct: "Pre-operative expenses, contingency, financing fees and (when the construction months are 0) the interest during construction, as a share of the hard cost.",
  essOmLakhPerMwh: "Battery O&M in ₹ lakh per MWh a year, escalating at the O&M escalation.",
  solarOmLakhPerMw: "Solar O&M in ₹ lakh per MW AC a year (put a land lease here too if it scales with the solar), escalating at the O&M escalation.",
  windOmLakhPerMw: "Wind O&M in ₹ lakh per MW a year.",
  otherFixedLakhPerMw: "Scheduling and forecasting, SLDC/RLDC fees, admin, in ₹ lakh per contracted MW a year. Named lines can be added on the Other fixed costs sheet instead.",
  insurancePct: "Insurance a year as a share of the capex.",
  omEscalation: "Yearly escalation of all O&M unless a technology's own escalation is set further down.",
  targetEquityIrr: "The post-tax equity IRR the tariff is solved for.",
  debtFraction: "Debt as a share of the project cost; the rest is equity.",
  interestRate: "Interest on the term loan until any refinancing.",
  tenorYears: "Door-to-door tenor of the term loan.",
  taxRate: "Corporate tax rate (Section 115BAA: 25.17%).",
  essLifeYears: "Life over which the battery is depreciated in the books.",
  reLifeYears: "Life over which the solar and wind are depreciated in the books.",
  discountRate: "Rate for the levelised cost of energy shown beside the tariff; it does not change the tariff.",
  quoteTariff: "The tariff you intend to quote, to see its returns on the Financial model step. Blank: the model's solved tariff.",
  "fin.repayment": "How the principal is repaid: equal instalments, annuity (level debt service), sculpted to a target DSCR, balloon, bullet or step-up.",
  "fin.graceYears": "Years after the COD in which only interest is paid (within the tenor).",
  "fin.paymentsPerYear": "Instalments a year. Paying through the year means interest on the average balance, lower than on the opening balance.",
  "fin.targetDscr": "Used only with sculpted repayment: each year's principal keeps the DSCR at this level.",
  "fin.balloonPct": "Used only with balloon repayment: the share of the debt repaid in the last year.",
  "fin.stepUpPct": "Used only with step-up repayment: the yearly growth of the principal instalment.",
  "fin.refiYear": "The debt is refinanced at the end of this operating year at the rate and tenor below. 0: never.",
  "fin.refiRate": "Interest after the refinancing.",
  "fin.refiTenorYears": "Tenor of the refinanced debt, from the refinancing year.",
  "fin.refiFeePct": "Fee on the balance refinanced, expensed that year (include GST if it is a cost to you).",
  "fin.receivableDays": "Days of revenue owed by the buyer: working capital.",
  "fin.omStockMonths": "Months of O&M cost held as working capital.",
  "fin.sparesPctOm": "Maintenance spares held, as a share of the year's O&M.",
  "fin.wcInterestRate": "Interest on the working capital (0: funded by equity).",
  "fin.dsraMonths": "Months of debt service held in the debt service reserve, funded at the COD.",
  "costs.constructionMonths": "Months of construction over which the capex is spent and the interest during construction worked out month by month. 0: that interest is inside the pre-operative share.",
  "costs.drawdown": "How the capex is spent over the construction months.",
  "costs.drawOrder": "Whether debt and equity are drawn together or equity first (lower interest during construction).",
};

// fuller notes where the box's own hint is short: what the input is, how the model uses it, and
// what a usual value looks like (the benchmark the note also gives is "Fill up for me please"'s)
Object.assign(ABOUT, {
  merchantYears: "How many years after the term the plant keeps selling at market prices (the battery's evening sale and any surplus RE), with O&M and degradation continuing. Their cash flows count in the returns, so more years lower the tariff you need. 0: none.",
  marketCharges: "What you pay on top of the exchange price for each kWh bought on the green market to charge the battery: the exchange fee, ISTS/STU transmission charges and losses to your meter, in ₹/kWh. Typical 0.25 to 0.45.",
  groupPrice: "The price a group company's RE plant charges you for power that charges the battery, at its plant, in ₹/kWh. Used only when 'Group-company RE for charging' is Yes, after month 36 from the Effective Date and within the tender's limit (up to 50% of each year's energy). The charges below are added to it.",
  recPrice: "The price of a Renewable Energy Certificate (one per MWh). RECs are issued on supply sold in the brown markets (DAM, RTM); the CfDA lets you keep 50% of them (CfDA 9.2.vi). 0 if you will not sell them.",
  bilateralPrice: "The existing plant's price for its power at the plant, in ₹/kWh, fixed for the months above.",
  bilateralUse: "Before the green market: the existing plant charges the battery before any market power (a firm supply). Only where cheaper: it is used only in hours where it costs less than the green market. Own RE always charges first.",
  essMwhPerMw: "Usable battery energy for each contracted MW, at the billing meter, before degradation. The tender asks for at least the energy of its daily supply (CfD-I: 2 MWh per MW, Amendment-02; FDRE-X: 4 MWh per MW). More than the minimum lets the battery carry fade and losses without augmentation.",
  essMwPerMw: "Battery inverter (PCS) power for each contracted MW. At least 1, so the battery can supply the contracted MW in each hour of the supply.",
  reCodMonths: "When your own solar and wind start generating, in months after the battery's Scheduled Commencement (SCD). Until then the battery charges only from bought power within the tender's limits. CfD-I: by 36 months from the Effective Date, which is 21 months after the SCD.",
  solarDegradation: "Loss of solar output each year (0.5% a year is usual for mono PERC and TOPCon modules). The model applies it year by year to the hourly profile.",
  windCuf: "Annual wind energy ÷ (MW × 8,760 h), at the meter. Needed only when the own wind is above 0; 30 to 38% is usual for new turbines at good Indian sites.",
  windDegradation: "Loss of wind output each year; 0 for none (usual for wind).",
  rte: "Energy out of the battery ÷ energy into it, AC to AC, over a full cycle (85 to 90% is usual for LFP). Where it is quoted (PCS output or the meter) is set under Losses on the Design step.",
  essSocMin: "The supplier's lowest state of charge, in percent. Leave both state-of-charge cells empty when the battery energy above is quoted as usable; with a window the nameplate grows so that (maximum − minimum) × nameplate is the usable energy.",
  essSocMax: "The supplier's highest state of charge, in percent (see the minimum).",
  essDegradation: "Loss of usable battery energy each year before augmentation (about 2 to 2.5% a year at one cycle a day for LFP). Without augmentation the battery fades and days may fall short.",
  essCrPerMwh: "All-in battery cost: cells, PCS, transformers, balance of plant and EPC, in ₹ crore per MWh of nameplate (0.85 means ₹85 lakh per MWh). It also prices the augmentation, less the yearly fall below.",
  windCrPerMw: "Wind EPC cost in ₹ crore per MW, turbines to the pooling substation.",
  evacuationCrPerMw: "The line and bay from your plant to the ISTS substation at 220 kV or above (the Delivery Point), in ₹ crore per contracted MW.",
  augDecline: "How fast the battery price falls each year, applied to the augmentation bought in later years (5% a year means year-10 augmentation costs 0.95^10 of today's price).",
  essOmLakhPerMwh: "Battery O&M in ₹ lakh per MWh of nameplate a year, escalating at the O&M escalation (or the battery's own escalation if set).",
  windOmLakhPerMw: "Wind O&M in ₹ lakh per MW a year, escalating at the O&M escalation.",
  insurancePct: "Insurance a year as a share of the capex (0.15 to 0.3% is usual).",
  pxFee: "The exchange's transaction fee on each kWh you sell (CfD-I: yours, CfDA 4.2.7), in ₹/kWh.",
  lcCostPct: "The yearly cost of the Letter of Credit you open for SECI, as a share of its amount. CfD-I: LC = 2000 × MW × (₹10 − strike price) × 30 (CfDA 10.4.2).",
  pbgCostPct: "The yearly fee on the bank guarantees (EMD, PBG), as a share of the guarantee; the amounts and validity come from the RfS.",
  gstRate: "GST on SECI's charges (the RfS cost, the bid fee, the Contract Administration or Success Charges), a cost when you cannot set it off.",
  targetEquityIrr: "The post-tax equity IRR the tariff is solved for: the model finds the tariff at which the equity's cash flows give exactly this return.",
  debtFraction: "Debt as a share of the project cost; the rest is equity (and quasi-equity or mezzanine if set below). 70 to 75% is usual for RE with storage.",
  interestRate: "Interest on the term loan, a year, until any refinancing or step-down below.",
  tenorYears: "Door-to-door tenor of the term loan, from the COD, within the contract term.",
  taxRate: "Corporate tax rate: 25.17% under Section 115BAA (no MAT); 34.94% under the old regime.",
  essLifeYears: "Life over which the battery is depreciated in the books (straight line unless set otherwise).",
  reLifeYears: "Life over which the solar and wind are depreciated in the books.",
  "fin.graceYears": "Years after the COD in which only interest is paid; the principal is repaid over the rest of the tenor.",
  "fin.refiRate": "Interest a year after the refinancing.",
  "fin.refiTenorYears": "Tenor of the refinanced debt, counted from the refinancing year; the repayment continues under the same method (or the one set below).",
  "fin.sweep.fromYear": "The first operating year of the cash sweep.",
  "fin.caseFactors.p75": "P75 energy as a share of P50 (0.97 means 3% less), used when the generation case is P75.",
  "fin.caseFactors.p90": "P90 energy as a share of P50 (0.94 means 6% less), used when the generation case is P90.",
  "fin.quasi.lenderMinDscr": "Interest and principal on the quasi-equity are paid only in years whose senior DSCR is above this; otherwise the interest accrues.",
  "fin.quasi.repayFromYear": "The operating year from which the quasi-equity is repaid, out of cash above the DSCR floor.",
  "fin.mezz.rate": "Interest a year on the mezzanine, paid every year.",
  "fin.mezz.tenorYears": "Years over which the mezzanine is repaid.",
  "fin.mezz.graceYears": "Years in which only the mezzanine's interest is paid.",
  "fin.mezz.repayment": "Equal principal over the tenor, or the whole amount at the end.",
  "fin.carbon.tPerMwh": "Tonnes of CO₂ avoided per MWh (the grid emission factor; CEA's is about 0.71).",
  "fin.carbon.pricePerT": "Price of a carbon credit, ₹ per tonne.",
  "fin.carbon.years": "Years over which the credits are earned.",
  "fin.carbon.escalation": "Yearly rise of the carbon price.",
  "fin.repower.capexCr": "Cost of the solar repowering, ₹ crore, spent in the repowering year.",
  "fin.repower.upliftPct": "Rise in solar energy from the year after the repowering.",
  "fin.holdco.expensesCrPerYear": "Yearly costs of a holding company that holds the equity, for the holding-company IRR.",
  "fin.holdco.promoterShare": "The promoter's share of the holding company, for the promoter IRR.",
  "fin.fxBase": "₹ per USD today, the base of the exchange-rate sensitivity.",
  solarCrPerMw: "Solar EPC cost in ₹ crore per MW AC, modules to the pooling substation (the DC:AC ratio gives the MWp: at 1.4, ₹4 cr per MWac is ₹2.86 cr per MWp). Domestic cells and modules where the tender asks (CfD-I: RfS Annexure-B 1.d).",
});

// the finance team's terms beyond the boxes the agent sets (state.fin unless the key says costs.)
const pct = true;
const FIN_EXTRA = [
  ["Debt", "fin.lenderMinDscr", "Lender's minimum DSCR", { unit: "×", min: 1, max: 2, benchmark: 1.1, about: "The DSCR covenant: the minimum DSCR tile turns red below it." }],
  ["Debt", "fin.refiRepayment", "Repayment after refinancing", { kind: "choice", options: [["same", "Same method"], ...Object.entries(E.REPAYMENT_METHODS).map(([k, m]) => [k, m.label])], benchmark: "same", none: "same", about: "The repayment method of the refinanced debt." }],
  ["Debt", "fin.refiTopUpPct", "Top-up at the refinancing", { pct, min: 0, max: 50, benchmark: 0, about: "New debt at the refinancing as a share of the balance refinanced, paid out to equity. Needs a refinancing year." }],
  ["Debt", "fin.prepaymentPct", "Prepayment penalty", { pct, min: 0, max: 5, benchmark: 0, about: "Charged on principal prepaid outside the schedule: the refinancing take-out and any cash sweep (include GST if it is a cost)." }],
  ["Debt", "fin.rateStepDown.afterYears", "Rate step-down after", { unit: "years", min: 0, max: 25, int: true, benchmark: 0, about: "The interest falls to the rate below after this many operating years. 0: no step-down." }],
  ["Debt", "fin.rateStepDown.rate", "Rate after the step-down", { pct, min: 0, max: 25, benchmark: null, about: "Blank: the term loan's rate." }],
  ["Debt", "fin.topUp.year", "Top-up in year", { unit: "year", min: 0, max: 25, int: true, benchmark: 0, about: "A debt top-up in this operating year (usually 2 years after the COD), paid out to equity. 0: none." }],
  ["Debt", "fin.topUp.debtFraction", "Debt share after the top-up", { pct, min: 0, max: 95, benchmark: null, about: "Of the project cost. Blank: the debt share above." }],
  ["Debt", "fin.sweep.pct", "Cash sweep", { pct, min: 0, max: 100, benchmark: 0, about: "Share of the free cash to equity used to prepay principal. 0: no sweep." }],
  ["Debt", "fin.sweep.fromYear", "Sweep from year", { unit: "year", min: 1, max: 25, int: true, benchmark: 1 }],
  ["Debt", "fin.sweep.toYear", "Sweep to year", { unit: "year", min: 1, max: 25, int: true, benchmark: null, about: "Blank: to the end of the tenor." }],
  ["Debt", "fin.bridge.months", "Bridge loan", { unit: "months", min: 0, max: 36, int: true, benchmark: 0, about: "The first months of construction drawn on a bridge loan, then taken out by the term loan. 0: none." }],
  ["Debt", "fin.bridge.rate", "Bridge rate", { pct, min: 0, max: 25, benchmark: null, about: "Blank: the term loan's rate." }],
  ["Debt", "fin.bridge.feePct", "Bridge take-out fee", { pct, min: 0, max: 5, benchmark: 0, about: "Of the balance taken out by the term loan, capitalised with the interest during construction." }],
  ["Reserves", "fin.dsraBasis", "Debt service reserve basis", { kind: "choice", options: [["next", "Next year's debt service"], ["peak", "Peak of the years ahead"]], benchmark: "next", about: "What the reserve's months are counted on; the yearly change is put aside or released." }],
  ["Reserves", "fin.dsraInterestRate", "Interest on the reserve", { pct, min: 0, max: 12, benchmark: 0, about: "Earned on the reserve, booked in other income." }],
  ["Tax and depreciation", "fin.taxDepreciation", "Tax depreciation", { kind: "choice", options: [["wdv", "Written-down value"], ["slm", "Straight line"]], benchmark: "wdv", about: "How depreciation is claimed for tax." }],
  ["Tax and depreciation", "fin.wdvRate", "WDV rate for tax", { pct, min: 0, max: 100, benchmark: 15, about: "Used with written-down-value tax depreciation (15% for most plant and machinery under the Income-tax Act)." }],
  ["Tax and depreciation", "fin.bookDepreciation", "Book depreciation", { kind: "choice", options: [["slm", "Straight line"], ["wdv", "Written-down value"]], benchmark: "slm", about: "The method in the P&L and the net block (both are worked out)." }],
  ["Tax and depreciation", "fin.bookLifeYears", "Book life", { unit: "years", min: 1, max: 40, int: true, benchmark: 15, about: "Life of the assets in the books where no life by technology is set." }],
  ["Tax and depreciation", "fin.salvagePct", "Salvage value", { pct, min: 0, max: 30, benchmark: 0, about: "Value left at the end of the book life, as a share of the cost." }],
  ["Tax and depreciation", "fin.lossCarryYears", "Loss carry-forward", { unit: "years", min: 0, max: 30, int: true, benchmark: 8, about: "Business losses lapse after these years; unabsorbed depreciation never does." }],
  ["Tax and depreciation", "fin.thinCapPct", "Thin capitalisation cap", { pct, min: 0, max: 100, benchmark: 0, about: "Of EBITDA: interest on quasi-equity and mezzanine above it is carried forward. 0: off." }],
  ["Operating cost", "fin.solarOmEscalation", "Solar O&M escalation", { pct, min: 0, max: 15, benchmark: null, about: "Blank: the common O&M escalation." }],
  ["Operating cost", "fin.windOmEscalation", "Wind O&M escalation", { pct, min: 0, max: 15, benchmark: null, about: "Blank: the common O&M escalation." }],
  ["Operating cost", "fin.bessOmEscalation", "Battery O&M escalation", { pct, min: 0, max: 15, benchmark: null, about: "Blank: the common O&M escalation." }],
  ["Generation", "fin.generationCase", "Generation case", { kind: "choice", options: [["p50", "P50 (as modelled)"], ["p75", "P75"], ["p90", "P90"]], benchmark: "p50", about: "P75 and P90 scale the energy by the factors below." }],
  ["Generation", "fin.caseFactors.p75", "P75 factor", { unit: "× P50", min: 0.5, max: 1, benchmark: 0.97 }],
  ["Generation", "fin.caseFactors.p90", "P90 factor", { unit: "× P50", min: 0.5, max: 1, benchmark: 0.94 }],
  ["Funding below the senior debt", "fin.quasi.amountCr", "Quasi-equity", { unit: "₹ cr", min: 0, max: 100000, benchmark: 0, about: "Part of the funding, below the senior debt (for example CCDs). 0: none." }],
  ["Funding below the senior debt", "fin.quasi.rate", "Quasi-equity interest", { pct, min: 0, max: 25, benchmark: 12, about: "Paid when the senior DSCR clears the floor below, else accrued." }],
  ["Funding below the senior debt", "fin.quasi.lenderMinDscr", "Quasi-equity DSCR floor", { unit: "×", min: 1, max: 3, benchmark: 1.2 }],
  ["Funding below the senior debt", "fin.quasi.repayFromYear", "Quasi-equity repaid from year", { unit: "year", min: 1, max: 25, int: true, benchmark: 1 }],
  ["Funding below the senior debt", "fin.mezz.amountCr", "Mezzanine", { unit: "₹ cr", min: 0, max: 100000, benchmark: 0, about: "Part of the funding, below the senior debt, with fixed interest and repayment. 0: none." }],
  ["Funding below the senior debt", "fin.mezz.rate", "Mezzanine interest", { pct, min: 0, max: 25, benchmark: 14 }],
  ["Funding below the senior debt", "fin.mezz.tenorYears", "Mezzanine tenor", { unit: "years", min: 1, max: 25, int: true, benchmark: 10 }],
  ["Funding below the senior debt", "fin.mezz.graceYears", "Mezzanine moratorium", { unit: "years", min: 0, max: 10, int: true, benchmark: 0 }],
  ["Funding below the senior debt", "fin.mezz.repayment", "Mezzanine repayment", { kind: "choice", options: [["equal", "Equal principal"], ["bullet", "Bullet at the end"]], benchmark: "equal" }],
  ["Funding below the senior debt", "fin.mezz.feePct", "Mezzanine arrangement fee", { pct, min: 0, max: 5, benchmark: 0, about: "Of the amount, at drawdown." }],
  ["Other revenue and life", "fin.carbon.enabled", "Carbon credit revenue", { kind: "boolean", benchmark: false, about: "Yes adds carbon credits on the energy delivered and sold." }],
  ["Other revenue and life", "fin.carbon.tPerMwh", "Emission factor", { unit: "t CO₂/MWh", min: 0, max: 2, benchmark: 0.71 }],
  ["Other revenue and life", "fin.carbon.pricePerT", "Carbon credit price", { unit: "₹/t", min: 0, max: 100000, benchmark: 500 }],
  ["Other revenue and life", "fin.carbon.years", "Years credited", { unit: "years", min: 0, max: 25, int: true, benchmark: 10 }],
  ["Other revenue and life", "fin.carbon.escalation", "Carbon price escalation", { pct, min: 0, max: 15, benchmark: 3 }],
  ["Other revenue and life", "fin.repower.year", "Solar repowering in year", { unit: "year", min: 0, max: 25, int: true, benchmark: 0, about: "0: never." }],
  ["Other revenue and life", "fin.repower.capexCr", "Repowering capex", { unit: "₹ cr", min: 0, max: 100000, benchmark: 0 }],
  ["Other revenue and life", "fin.repower.upliftPct", "Solar energy uplift after repowering", { pct, min: 0, max: 100, benchmark: 0 }],
  ["Returns", "fin.holdco.expensesCrPerYear", "Holding company expenses", { unit: "₹ cr/yr", min: 0, max: 1000, benchmark: 0 }],
  ["Returns", "fin.holdco.promoterShare", "Promoter's share of the holding company", { pct, min: 0, max: 100, benchmark: 100 }],
  ["Returns", "fin.lenderReinvestRate", "Lender's reinvestment rate", { pct, min: 0, max: 25, benchmark: null, about: "For the lender's MIRR. Blank: the senior rate." }],
  ["Returns", "fin.capexUsdShare", "Capex in foreign currency", { pct, min: 0, max: 100, benchmark: 0, about: "Share of the hard cost exposed to the exchange rate (for the sensitivity)." }],
  ["Returns", "fin.fxBase", "Exchange rate", { unit: "₹/USD", min: 1, max: 500, benchmark: 83 }],
  ["Returns", "costs.moduleSharePct", "Modules in the solar capex", { pct, min: 0, max: 100, benchmark: 45, about: "The module-price sensitivity moves this share." }],
];

// an existing RE plant's power under a bilateral agreement (the CfD tabs)
const BILATERAL = [
  ["bilateralMonths", "Existing plant: available for", { unit: "months from the SCD", min: 0, max: 180, int: true, about: "An existing RE plant sells you power at a fixed price for these months from the battery's commissioning. 0 or blank: none." }],
  ["bilateralPrice", "Existing plant: its price", { unit: "₹/kWh", min: 0, max: 20, about: "At the plant, fixed for those months." }],
  ["bilateralCharges", "Existing plant: charges and losses", { unit: "₹/kWh", min: 0, max: 5, about: "ISTS charges and losses to your meter; 0 if the price is delivered." }],
  ["bilateralMw", "Existing plant: its size", { unit: "MW", min: 0, max: 5000, about: "Blank: as much as the battery takes; a size limits each hour to its output along the solar shape." }],
  ["reCostAtCod", "Own RE's cost spent when it is commissioned", { kind: "boolean", about: "Yes: the own RE's capex is spent (and funded) in the year it is commissioned, not before the battery's SCD. No: the whole project cost is spent before the SCD." }],
  ["bilateralUse", "Existing plant: use it", { kind: "choice", options: [["first", "Before the green market (a firm supply)"], ["cheapest", "Only where it is cheaper than the green market"]], about: "Own RE always charges first." }],
];

const getPath = (obj, path) => path.reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
const setPath = (obj, path, v) => {
  if (path.length === 1) return { ...(obj || {}), [path[0]]: v };
  return { ...(obj || {}), [path[0]]: setPath((obj || {})[path[0]] ?? V3_FIN_DEFAULTS[path[0]], path.slice(1), v) };
};

function finRow(group, key, label, o) {
  const [section, ...path] = key.split(".");
  const kind = o.kind || "number";
  return {
    key, group, label, kind, unit: o.pct ? "%" : o.unit || null, pct: Boolean(o.pct), min: o.min, max: o.max, int: Boolean(o.int), options: o.options || null,
    // the benchmarks above are written as shown (percent for a percent row); the row holds state units
    benchmark: o.pct && isNum(o.benchmark) ? o.benchmark / 100 : o.benchmark ?? null, about: ABOUT[key] || o.about || "",
    where: section === "costs" && key !== "costs.moduleSharePct" ? "Finance inputs step" : "Finance inputs step, More inputs (finance team)",
    get: (s) => { const v = getPath(s[section], path); return v === undefined || v === null ? o.none || null : v; },
    set: (s, v) => ({ ...s, [section]: setPath(s[section], path, kind === "choice" && o.none && v === o.none ? null : v) }),
  };
}

/** The group an agent input belongs to on the template. */
const STEP_NAME = { bid: "Bid inputs step", design: "Design step", financeInputs: "Finance inputs step", finance: "Financial model step" };
const GROUP_OF = {
  bid: "The bid", design: "Plant and resource", financeInputs: "Costs and financing", finance: "The quote",
};
const COSTS = new Set(["essCrPerMwh", "solarCrPerMw", "windCrPerMw", "evacuationCrPerMw", "preopPct", "augDecline", "essOmLakhPerMwh", "solarOmLakhPerMw", "windOmLakhPerMw", "otherFixedLakhPerMw", "insurancePct", "omEscalation", "pxFee", "lcCostPct", "pbgCostPct", "gstRate"]);
const SOURCING = new Set(["marketCharges", "groupPrice", "groupCharges", "priceEscalation", "gdamShareCap", "recPrice"]);
const FINANCING = new Set(["targetEquityIrr", "debtFraction", "interestRate", "tenorYears", "taxRate", "essLifeYears", "reLifeYears", "discountRate"]);

/**
 * The template's rows for a tab: `agentInputs` is the tab's catalogue (./agent.js or
 * ../fdrex/agent.js), `fields` its FIELDS and `choices` its CHOICES (for the hints), `bilateral`
 * whether the tab has the existing-plant inputs.
 */
export function sheetRows(state, { agentInputs, fields = [], choices = {}, bilateral = false }) {
  const hintOf = Object.fromEntries([...fields.map((f) => [f.key, f.hint]), ...Object.entries(choices).map(([k, c]) => [k, c.hint])]);
  const rows = [];
  const all = agentInputs({ ...state, inputs: { ...state.inputs, afterTerm: "merchant" } }); // the years after the term are always on the sheet
  for (const x of all) {
    if (x.key === "quoteTariff") continue; // added last
    const g = /^fin\.(receivable|omStock|spares|wcInterest|dsra)/.test(x.key) ? "Reserves" : x.key.startsWith("fin.") ? "Debt" : x.key.startsWith("costs.") ? "Construction"
      : COSTS.has(x.key) ? "Costs" : SOURCING.has(x.key) ? "Charging power and markets" : FINANCING.has(x.key) ? "Financing" : GROUP_OF[x.step] || "The bid";
    const kind = x.kind;
    rows.push({
      key: x.key, group: g, label: x.label, kind, unit: x.unit || null, pct: Boolean(x.pct), min: x.min, max: x.max,
      int: x.key === "contractedMw" || x.key === "merchantYears" || /graceYears|refiYear|refiTenorYears|constructionMonths/.test(x.key) || x.key === "tenorYears",
      // the agent's finance terms give their benchmark in percent, its other inputs in state units
      options: x.options || null, benchmark: x.pct && /^(fin|costs)\./.test(x.key) && isNum(x.benchmark) ? x.benchmark / 100 : x.benchmark ?? null,
      // the box's hint only where the note above does not already say it
      about: [ABOUT[x.key], ABOUT[x.key] && hintOf[x.key] && ABOUT[x.key].length > 110 ? null : hintOf[x.key]].filter(Boolean).join(" "),
      where: STEP_NAME[x.step] || null,
      get: x.get, set: x.set,
    });
  }
  if (bilateral) {
    for (const [key, label, o] of BILATERAL) {
      rows.push({ key, group: "Charging power and markets", label, kind: o.kind || "number", unit: o.unit || null, pct: false, min: o.min, max: o.max, int: Boolean(o.int), options: o.options || null,
        benchmark: null, about: ABOUT[key] || o.about, where: "Bid inputs step (CfD Own Solar)", get: (s) => s.inputs?.[key] ?? null, set: (s, v) => ({ ...s, inputs: { ...s.inputs, [key]: v } }) });
    }
  }
  rows.push({ key: "sizeAuto", group: "Plant and resource", label: "Own RE size", kind: "choice", options: [["auto", "Sized for you (the app sizes it again when an input changes)"], ["manual", "Your size (the solar and wind above)"]],
    benchmark: "auto", where: "Design step, below Optimise own RE", about: "Sized for you: the app finds the solar (and wind) for the least tariff after the upload and whenever an input changes. Your size: the app keeps the solar and wind above.",
    get: (s) => (s.sizeAuto === false ? "manual" : "auto"), set: (s, v) => ({ ...s, sizeAuto: v !== "manual" }) });
  for (const [group, key, label, o] of FIN_EXTRA) rows.push(finRow(group, key, label, o));
  rows.push({ key: "bess.augmentation", group: "Battery augmentation", label: "Battery augmentation (finance team)", kind: "choice",
    options: [["follow", "As 'Battery capacity over the term' above"], ["byYear", "Year by year: the Battery augmentation sheet"]], benchmark: "follow", where: "Finance inputs step, More inputs (finance team)",
    about: "Year by year: the MWh added in each operating year are read from the Battery augmentation sheet (blank cells there are no addition). As above: every year or none, per the choice in The bid.",
    get: (s) => (s.bess?.augmentation === "byYear" ? "byYear" : s.bess?.augmentation ? s.bess.augmentation : "follow"),
    set: (s, v) => (v === "byYear" ? { ...s, bess: { ...(s.bess || {}), augmentation: "byYear" } } : { ...s, bess: { ...(s.bess || {}), augmentation: null } }) });
  const quote = all.find((x) => x.key === "quoteTariff");
  if (quote) rows.push({ key: "quoteTariff", group: "The quote", label: quote.label, kind: "number", unit: quote.unit, pct: false, min: quote.min, max: quote.max, int: false, options: null, benchmark: null, about: ABOUT.quoteTariff, where: "Financial model step", get: quote.get, set: quote.set });
  return ordered(rows);
}

// the template's groups, in this order; within a group the rows keep the catalogue's order
const GROUP_ORDER = ["The bid", "Charging power and markets", "Plant and resource", "Battery augmentation", "Costs", "Operating cost", "Financing", "Debt", "Reserves", "Construction", "Tax and depreciation", "Generation", "Funding below the senior debt", "Other revenue and life", "Returns", "The quote"];
const ordered = (rows) => rows.map((r, k) => ({ r, k, g: GROUP_ORDER.indexOf(r.group) })).sort((a, b) => (a.g - b.g) || (a.k - b.k)).map((x) => x.r);

/** The operating years the Battery augmentation sheet covers. */
export const AUG_YEARS = 25;

/** The year-by-year battery augmentation: rows { year, pct (fraction of nameplate MWh) or null, cr (₹ cr) or null }. */
export function augmentationOf(state) {
  const pct = state.bess?.augmentationPct || [];
  const cr = state.bess?.augmentationCr || [];
  // from operating year 2 (the battery is new in year 1), as the finance team's table
  return Array.from({ length: AUG_YEARS + 1 }, (_, y) => ({ year: y, pct: isNum(pct[y]) && pct[y] > 0 ? pct[y] : null, cr: isNum(cr[y]) && cr[y] > 0 ? cr[y] : null })).slice(2);
}

/** The other fixed cost lines: [{ label, crPerYear, escalation (fraction or null) }]. */
export function otherLinesOf(state) {
  return (state.fin?.otherFixedLines || []).map((l) => ({ label: l.label || "", crPerYear: isNum(l.crPerYear) ? l.crPerYear : null, escalation: isNum(l.escalation) ? l.escalation : null }));
}
