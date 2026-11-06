import React, { useMemo, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Section, Stat, nf, pf } from "./ui";
import { useTrace } from "../model/ModelExplorer";
import * as E from "./engine";
import { rowsHave, yearLabel } from "./financeV3";

/**
 * The finance team's output sections of the shared financial model (docs/dev/FINANCE-V3-SPEC.md
 * §7 to §9): F.5 Returns, F.6 Tax schedule, F.7 Balance sheet and cash-flow statement, F.8 the
 * reverse-auction sensitivity. Every row reads the engine's result defensively: a row the model
 * does not carry yet is left out, so the sections work before and after the engine adds it.
 */

/** An engine export by name; null when this build of the engine does not have it. */
function engineFn(name) {
  const key = String(name);
  return typeof E[key] === "function" ? E[key] : null;
}

const COMPONENTS = [["solar", "Solar"], ["wind", "Wind"], ["bess", "Battery"], ["pcs", "Battery PCS"], ["evac", "Evacuation / pooling"], ["other", "Other capex"], ["preop", "Pre-operative"], ["idc", "Interest during construction"]];

const fmt = (v, d = 1) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "–";
  const n = Number(v);
  return n < 0 ? `(${nf(Math.abs(n), d)})` : nf(n, d);
};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** The year-by-year table used by the schedules: lines = [label, key | (row, y) => value, fmt, strong]. */
function YearTable({ rows, lines, y0 = null, traceLine = null, testid }) {
  const trace = useTrace();
  const traceable = Boolean(trace?.available);
  return (
    <div className="table-wrap rtc-model fin-table" data-testid={testid}>
      <table>
        <thead><tr><th>Line item</th>{y0 && <th>Y0</th>}{rows.map((r) => <th key={r.year}>{yearLabel(r)}</th>)}</tr></thead>
        <tbody>
          {lines.map(([label, key, d = 1, strong = false], i) => {
            if (!key) return <tr key={i} className="rtc-model-group"><td colSpan={rows.length + (y0 ? 2 : 1)}>{label}</td></tr>;
            const read = typeof key === "function" ? key : (r) => r[key];
            const tl = typeof key === "string" && traceLine ? traceLine[key] : null;
            return (
              <tr key={i} className={strong ? "rtc-model-total" : ""}>
                <td>{label}</td>
                {y0 && <td>{y0[label] === undefined ? "" : fmt(y0[label], d)}</td>}
                {rows.map((r, k) => (traceable && tl
                  ? <td key={r.year} className="is-traceable" onClick={() => trace.openTrace({ line: tl, year: r.year })} title="Show how this number is worked out">{d === "pct" ? pf(read(r, k), 1) : d === "x" ? fmt(read(r, k), 2) : fmt(read(r, k), d)}</td>
                  : <td key={r.year}>{d === "pct" ? pf(read(r, k), 1) : d === "x" ? fmt(read(r, k), 2) : fmt(read(r, k), d)}</td>))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** F.5 Returns: SPV, HoldCo and promoter IRRs, the lender's XIRR and MIRR, the coverage ratios. */
export function ReturnsSection({ finance, fin, index = "F.5" }) {
  const has = (k) => Number.isFinite(num(finance[k]));
  const tone = (v, floor) => (Number.isFinite(v) && v < floor ? "bad" : undefined);
  const ratio = (k) => (has(k) ? `${nf(finance[k], 2)}×` : "–");
  return (
    <Section index={index} title="Returns" note="Levered and unlevered, pre- and post-tax; at the SPV, the holding company and the promoter; the lender's view">
      <div className="rtc-grid rtc-grid-4" data-testid="fin-returns">
        <Stat label="Equity IRR (levered, post-tax)" value={pf(finance.equityIrr, 2)} detail="the SPV's equity" tone={tone(finance.equityIrr, fin.targetEquityIrr - 1e-4)} trace={{ key: "equityIrr" }} />
        <Stat label="Project IRR (unlevered, post-tax)" value={pf(finance.projectIrr, 2)} detail="on the project cash flow" trace={{ key: "projectIrr" }} />
        <Stat label="Equity IRR pre-tax" value={has("preTaxEquityIrr") ? pf(finance.preTaxEquityIrr, 2) : "–"} detail="before corporate tax" trace={{ key: "preTaxEquityIrr" }} />
        <Stat label="Project IRR pre-tax" value={has("preTaxProjectIrr") ? pf(finance.preTaxProjectIrr, 2) : "–"} detail="before corporate tax" trace={{ key: "preTaxProjectIrr" }} />
        <Stat label="HoldCo IRR" value={has("holdcoIrr") ? pf(finance.holdcoIrr, 2) : "–"} detail={`dividends, quasi-equity interest and repayments${fin.holdco?.expensesCrPerYear ? `, less ₹${nf(fin.holdco.expensesCrPerYear, 2)} cr a year` : ""}`} trace={{ key: "holdcoIrr" }} />
        <Stat label="Promoter IRR" value={has("promoterIrr") ? pf(finance.promoterIrr, 2) : "–"} detail={`${pf(fin.holdco?.promoterShare ?? 1, 0)} of the HoldCo`} trace={{ key: "promoterIrr" }} />
        <Stat label="Lender XIRR" value={has("lenderXirr") ? pf(finance.lenderXirr, 2) : "–"} detail="dated draws and debt service" trace={{ key: "lenderXirr" }} />
        <Stat label="Lender MIRR" value={has("lenderMirr") ? pf(finance.lenderMirr, 2) : "–"} detail={`reinvested at ${pf(fin.lenderReinvestRate ?? fin.interestRate, 2)}`} trace={{ key: "lenderMirr" }} />
        <Stat label="Minimum DSCR" value={ratio("minDscr")} detail={`average ${has("avgDscr") ? nf(finance.avgDscr, 2) : "–"}`} tone={tone(finance.minDscr, fin.lenderMinDscr ?? 1.1)} trace={{ key: "minDscr" }} />
        <Stat label="Minimum FSCR" value={ratio("minFscr")} detail="fixed charges added to both sides" trace={{ key: "minFscr" }} />
        <Stat label="Minimum LLCR" value={ratio("minLlcr")} detail="CFADS to the end of the tenor over the debt" trace={{ key: "minLlcr" }} />
        <Stat label="Minimum PLCR" value={ratio("minPlcr")} detail="CFADS to the end of the project over the debt" trace={{ key: "minPlcr" }} />
        {(num(finance.mezz) > 0 || num(finance.quasi) > 0) && <Stat label="Funding" value={`₹${nf(finance.capex?.total, 0)} cr`} detail={`debt ₹${nf(finance.debt, 0)}${num(finance.mezz) > 0 ? ` · mezzanine ₹${nf(finance.mezz, 0)}` : ""}${num(finance.quasi) > 0 ? ` · quasi-equity ₹${nf(finance.quasi, 0)}` : ""} · equity ₹${nf(finance.equity, 0)} cr`} />}
      </div>
    </Section>
  );
}

const TAX_TRACE = { taxableIncome: "taxable", lossSetOff: "lossSetOff", depSetOff: "depSetOff", lossCarried: "lossCf", depCarried: "depCf", interestDisallowed: "intDisallowed", interestCarried: "intCf", tax: "tax", taxDep: "taxDep", bookDep: "bookDep", bookDepSlm: "bookDepSlm", bookDepWdv: "bookDepWdv", taxDepSlm: "taxDepSlm", taxDepWdv: "taxDepWdv", grossBlock: "grossBlock", accDep: "accDep", netBlock: "netBlock" };

/** F.6 Tax schedule: taxable income after set-offs, the carry-forwards, the two depreciation bases and the net block by component. */
export function TaxSection({ finance, fin, index = "F.6" }) {
  const rows = finance.rows;
  const has = (k) => rows.some((r) => r[k] !== undefined && r[k] !== null);
  if (!has("taxableIncome") && !has("bookDepSlm")) return null;
  const lines = [
    ["Tax computation (₹ cr)", null],
    ["Profit before tax", "pbt"],
    ...(has("taxDep") ? [["Less tax depreciation (instead of book)", "taxDep"]] : []),
    ...(has("interestDisallowed") ? [["Interest disallowed (thin capitalisation)", "interestDisallowed"]] : []),
    ...(has("lossSetOff") ? [["Business loss set off", "lossSetOff"]] : []),
    ...(has("depSetOff") ? [["Unabsorbed depreciation set off", "depSetOff"]] : []),
    ...(has("taxableIncome") ? [["Taxable income", "taxableIncome", 1, true]] : []),
    ["Tax", "tax", 1, true],
    ...(has("lossCarried") ? [["Carried forward (₹ cr)", null], ["Business losses carried", "lossCarried"]] : []),
    ...(has("depCarried") ? [["Unabsorbed depreciation carried", "depCarried"]] : []),
    ...(has("interestCarried") ? [["Disallowed interest carried", "interestCarried"]] : []),
    ["Depreciation (₹ cr)", null],
    ...(has("bookDepSlm") ? [["Book, straight line", "bookDepSlm"]] : []),
    ...(has("bookDepWdv") ? [["Book, written-down value", "bookDepWdv"]] : []),
    [`Book depreciation used (${fin.bookDepreciation === "wdv" ? "written-down value" : "straight line"})`, "bookDep", 1, true],
    ...(has("taxDepSlm") ? [["Tax, straight line", "taxDepSlm"]] : []),
    ...(has("taxDepWdv") ? [["Tax, written-down value", "taxDepWdv"]] : []),
    [`Tax depreciation used (${fin.taxDepreciation === "wdv" ? "written-down value" : "straight line"})`, "taxDep", 1, true],
    ...(has("grossBlock") ? [["Fixed assets (₹ cr)", null], ["Gross block", "grossBlock"]] : []),
    ...(has("accDep") ? [["Accumulated depreciation", "accDep"]] : []),
    ...(has("netBlock") ? [["Net block", "netBlock", 1, true]] : []),
    ...(has("netBlockByComponent") ? COMPONENTS.filter(([k]) => rows.some((r) => Math.abs(r.netBlockByComponent?.[k] || 0) > 1e-9)).map(([k, label]) => [`Net block · ${label}`, (r) => r.netBlockByComponent?.[k]]) : []),
  ];
  return (
    <Section index={index} title="Tax schedule" note={`Corporate tax ${pf(fin.taxRate, 2)}${fin.thinCapPct ? ` · thin capitalisation at ${pf(fin.thinCapPct, 0)} of EBITDA` : ""}${fin.lossCarryYears ? ` · losses carried ${fin.lossCarryYears} years` : ""}`}>
      <YearTable rows={rows} lines={lines} traceLine={TAX_TRACE} testid="fin-tax" />
    </Section>
  );
}

const BS_TRACE = { netBlock: "netBlock", dsraBalance: "dsra", marginBalance: "marginBal", receivables: "recv", cash: "cash", retained: "retained", shareCapital: "shareCap", closingDebt: "closeDebt", mezzClosing: "mezzClose", quasiClosing: "quasiClose", quasiAccrued: "quasiAccr", sweepAccrued: "sweepAccr", wcBalance: "wcBal" };
const CF_TRACE = { ebitda: "ebitda", carbonRevenue: "carbonRev", tax: "tax", dWc: "dWc", wcInterest: "wcInt", guaranteeFees: "bgFees", dsraInterest: "dsraInt", marginInterest: "marginInt", augCapex: "aug", repowerCapex: "repower", extensionCapex: "extCapex", cfads: "cfads", interest: "interest", principal: "principal", sweepCr: "sweep", prepaymentFee: "prepayFee", refiFee: "refiFeeCr", topUpCr: "topUp", mezzInterest: "mezzInt", mezzPrincipal: "mezzPrin", quasiInterestPaid: "quasiInt", quasiRepaid: "quasiRepay", dDsra: "dDsra", dMargin: "dMargin", fcfe: "fcfe", cumEquity: "cumEq" };

/** F.7 Balance sheet with the asset split, and the cash-flow statement with every line of the model. */
export function StatementsSection({ finance, index = "F.7" }) {
  const rows = finance.rows;
  const has = (k) => rowsHave(rows, k);
  const anyRow = (k) => rows.some((r) => r[k] !== undefined && r[k] !== null);
  const gross = (k) => (r) => r.grossBlockByComponent?.[k];
  const bs = [
    ["Assets (₹ cr)", null],
    ...(anyRow("grossBlockByComponent") ? COMPONENTS.filter(([k]) => rows.some((r) => Math.abs(r.grossBlockByComponent?.[k] || 0) > 1e-9)).map(([k, label]) => [`Gross block · ${label}`, gross(k)]) : []),
    ...(anyRow("grossBlock") ? [["Gross block", "grossBlock"]] : []),
    ...(anyRow("accDep") ? [["Less accumulated depreciation", "accDep"]] : []),
    ...(anyRow("netBlock") ? [["Net block", "netBlock", 1, true]] : []),
    ...(has("dsraBalance") ? [["Debt service reserve", "dsraBalance"]] : []),
    ...(has("marginBalance") ? [["Margin money on guarantees", "marginBalance"]] : []),
    ["Receivables", "receivables"],
    ...(has("omStock") ? [["O&M in hand", "omStock"]] : []),
    ...(has("spares") ? [["Maintenance spares", "spares"]] : []),
    ...(anyRow("cash") ? [["Cash", "cash"]] : []),
    ...(anyRow("totalAssets") ? [["Total assets", "totalAssets", 1, true]] : []),
    ["Liabilities and equity (₹ cr)", null],
    ...(anyRow("shareCapital") ? [["Share capital", "shareCapital"]] : []),
    ...(anyRow("retained") ? [["Retained earnings", "retained"]] : []),
    ["Senior debt", "closingDebt"],
    ...(has("mezzClosing") ? [["Mezzanine", "mezzClosing"]] : []),
    ...(has("quasiClosing") ? [["Quasi-equity", "quasiClosing"]] : []),
    ...(has("quasiAccrued") ? [["Accrued quasi-equity interest", "quasiAccrued"]] : []),
    ...(has("sweepAccrued") ? [["Cash sweep accrued", "sweepAccrued"]] : []),
    ...(anyRow("totalLiabilities") ? [["Total liabilities and equity", "totalLiabilities", 1, true]] : []),
  ];
  const neg = (k) => (r) => (r[k] === null || r[k] === undefined ? null : -r[k]);
  const cf = [
    ["Operating (₹ cr)", null],
    ["EBITDA", "ebitda"],
    ...(has("carbonRevenue") ? [["of which carbon credits", "carbonRevenue"]] : []),
    ...(has("dsraInterest") ? [["Interest on the debt service reserve", "dsraInterest"]] : []),
    ...(has("marginInterest") ? [["Interest on margin money", "marginInterest"]] : []),
    ["Tax paid", neg("tax")],
    ["Working capital change", neg("dWc")],
    ...(has("wcInterest") ? [["Interest on working capital", neg("wcInterest")]] : []),
    ...(has("guaranteeFees") ? [["Guarantee fees", neg("guaranteeFees")]] : []),
    ["Investing (₹ cr)", null],
    ...(has("augCapex") ? [["Battery augmentation", neg("augCapex")]] : []),
    ...(has("repowerCapex") ? [["Solar repowering", neg("repowerCapex")]] : []),
    ...(has("extensionCapex") ? [["Life-extension capex", neg("extensionCapex")]] : []),
    ["Cash available for debt service", "cfads", 1, true],
    ["Financing (₹ cr)", null],
    ["Senior interest", neg("interest")],
    ["Senior principal", neg("principal")],
    ...(has("sweepCr") ? [["Cash sweep prepayment", neg("sweepCr")]] : []),
    ...(has("prepaymentFee") ? [["Prepayment penalty", neg("prepaymentFee")]] : []),
    ...(has("refiFee") ? [["Refinancing fee", neg("refiFee")]] : []),
    ...(has("topUpCr") ? [["Top-up debt drawn (paid to equity)", "topUpCr"]] : []),
    ...(has("mezzInterest") ? [["Mezzanine interest", neg("mezzInterest")]] : []),
    ...(has("mezzPrincipal") ? [["Mezzanine principal", neg("mezzPrincipal")]] : []),
    ...(has("quasiInterestPaid") ? [["Quasi-equity interest paid", neg("quasiInterestPaid")]] : []),
    ...(has("quasiRepaid") ? [["Quasi-equity repaid", neg("quasiRepaid")]] : []),
    ...(has("dDsra") ? [["Debt service reserve put aside (released)", neg("dDsra")]] : []),
    ...(has("dMargin") ? [["Margin money blocked (released)", neg("dMargin")]] : []),
    ["Free cash to equity", "fcfe", 1, true],
    ["Cumulative equity cash", "cumEquity"],
    ...(anyRow("cash") ? [["Cash at the end of the year", "cash"]] : []),
  ];
  const y0bs = { "Senior debt": finance.debt, Mezzanine: finance.mezz, "Quasi-equity": finance.quasi, "Share capital": finance.equity, "Gross block": finance.capex?.total, "Net block": finance.capex?.total, "Total assets": finance.capex?.total, "Total liabilities and equity": finance.capex?.total };
  const y0cf = { "Free cash to equity": -finance.equity, "Cash available for debt service": -finance.capex?.total };
  return (
    <Section index={index} title="Balance sheet and cash-flow statement" note="Every asset line, the funding below the senior debt, and every cash flow of the model">
      <div className="rtc-subhead">Balance sheet</div>
      <YearTable rows={rows} lines={bs} y0={y0bs} traceLine={BS_TRACE} testid="fin-balance" />
      <div className="rtc-subhead">Cash-flow statement</div>
      <YearTable rows={rows} lines={cf} y0={y0cf} traceLine={CF_TRACE} testid="fin-cashflow" />
    </Section>
  );
}

/**
 * F.8 Reverse-auction sensitivity: the tariff the target IRR needs under each case, from the
 * engine's sensitivities() on the same inputs as the model shown. It runs on request (many model
 * runs). modelArgs: { ctx, sizes, args } as passed to runFinancialModel.
 */
export function SensitivitySection({ finance, modelArgs, index = "F.8" }) {
  const [table, setTable] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  // the engine's sensitivities() (looked up by name so the screen builds before the engine carries it)
  const sensitivities = engineFn("sensitivities");
  const available = typeof sensitivities === "function" && Boolean(modelArgs);
  const stale = useMemo(() => table && table.at !== finance, [table, finance]);
  if (!available) return null;
  const run = () => {
    setRunning(true); setError("");
    // let the button repaint before the runs
    setTimeout(() => {
      try {
        const out = sensitivities(modelArgs.ctx ?? null, modelArgs.sizes, modelArgs.args);
        setTable({ rows: Array.isArray(out) ? out : out?.rows || [], at: finance });
      } catch (err) {
        setError(err?.message || String(err));
      } finally {
        setRunning(false);
      }
    }, 20);
  };
  const base = finance.tariff;
  return (
    <Section index={index} title="Reverse-auction sensitivity" note="The tariff your target IRR needs when one thing moves: how far you can go in the auction and what it would cost you"
      actions={<button type="button" className="secondary" onClick={run} disabled={running} data-testid="fin-sensitivity-run">{running ? <Loader2 className="spin" size={14} /> : <Play size={14} />} {table ? "Run again" : "Run sensitivities"}</button>}>
      {error && <div className="alert">{error}</div>}
      {!table && !error && <p className="rtc-note">Capex and module price, exchange rate, interest and refinancing rate, the generation case, a commissioning delay and a longer life. Press Run: it reruns the model a few dozen times.</p>}
      {table && (
        <div className="table-wrap rtc-model fin-table" data-testid="fin-sensitivity">
          {stale && <p className="rtc-note">The inputs changed since this table was run.</p>}
          <table>
            <thead><tr><th>What moves</th><th>Case</th><th>Tariff (₹/kWh)</th><th>vs base</th><th>Equity IRR</th><th>Min DSCR</th></tr></thead>
            <tbody>
              {table.rows.map((axis) => (axis.cases || []).map((c, k) => (
                <tr key={`${axis.key}-${k}`} data-testid={`fin-sensitivity-${axis.key}`}>
                  {k === 0 && <td rowSpan={axis.cases.length}>{axis.label}</td>}
                  <td>{c.label}</td>
                  <td>{Number.isFinite(c.tariff) ? `₹${nf(c.tariff, 3)}` : "–"}</td>
                  <td>{Number.isFinite(c.tariff) && Number.isFinite(base) ? `${c.tariff - base >= 0 ? "+" : "−"}₹${nf(Math.abs(c.tariff - base), 3)} (${pf((c.tariff - base) / base, 1)})` : "–"}</td>
                  <td>{Number.isFinite(c.equityIrr) ? pf(c.equityIrr, 2) : "–"}</td>
                  <td>{Number.isFinite(c.minDscr) ? nf(c.minDscr, 2) : "–"}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
