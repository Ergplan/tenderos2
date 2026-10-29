// Checks for the CUF file download and the 25-year justification (web/src/plant/cufFile.js,
// web/src/plant/justification.js): the hourly CSV has 8,760 data rows, its header comments name
// the source, the CUFs, the measuring point, the degradation and the date, its values are the
// profile's and the uploaded file's; the by-year CSV has one row per PPA year with the model's
// degradation factor (web/src/rtc/engine.js yearFactors) applied; the justification returns the
// expected headings, states the year-25 CUF, the P90 and the typical ranges.
// Run from the repository root:   node tools/check_cuf_file.mjs
import assert from "node:assert/strict";
import * as E from "../web/src/rtc/engine.js";
import { scaleToCuf } from "../web/src/bid/model.js";
import { calendarOf, cufByYearCsv, cufCsv, yearCufTable, yearFactorOf } from "../web/src/plant/cufFile.js";
import { INTERANNUAL, cufJustification } from "../web/src/plant/justification.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const mean = (a) => Array.from(a).reduce((s, v) => s + v, 0) / a.length;
const lines = (csv) => csv.split("\n").filter((l) => l.length);
const comments = (csv) => lines(csv).filter((l) => l.startsWith("#"));
const data = (csv) => lines(csv).filter((l) => !l.startsWith("#")).slice(1);

// ---- the profile the bid uses: an "uploaded" file at its own CUF, scaled to the CUF entered
const raw = E.synthSolarCf({ targetCuf: 0.228, dcAc: 1.3 });
const cuf = 0.245;
const values = scaleToCuf(raw, cuf);
near(mean(values), cuf, 1e-6, "scaled profile sits at the CUF entered");
const date = new Date("2026-10-29T10:00:00Z");

// ---- calendar: hour 0 is 1 January 00:00, hour 8759 is 31 December 23:00, February has 28 days
assert.deepEqual(calendarOf(0), { month: 1, day: 1, hour: 0 });
assert.deepEqual(calendarOf(8759), { month: 12, day: 31, hour: 23 });
assert.deepEqual(calendarOf(31 * 24 + 27 * 24 + 5), { month: 2, day: 28, hour: 5 });
assert.deepEqual(calendarOf(31 * 24 + 28 * 24), { month: 3, day: 1, hour: 0 });

// ---- the hourly CSV
const csv = cufCsv({ kind: "solar", values, raw, cuf, rawCuf: mean(raw), name: "site_2019.csv", degradation: 0.005, cufAt: "Inverter output (LV AC)", date, years: 25 });
const rows = data(csv);
assert.equal(rows.length, 8760, "8,760 data rows");
const head = comments(csv).join("\n");
assert.match(head, /Source: uploaded file site_2019\.csv/);
assert.match(head, /CUF entered \(used in the bid\): 24\.50%/);
assert.match(head, /CUF of the file: 22\.80%/);
assert.match(head, /Measured at: Inverter output \(LV AC\)/);
assert.match(head, /Degradation per year applied by the model: 0\.50% over 25 years/);
assert.match(head, /Date: 2026-10-29/);
const header = lines(csv).find((l) => !l.startsWith("#"));
assert.equal(header, "Hour of year,Month,Day,Hour,Capacity factor used in the bid,Capacity factor of the uploaded file");
for (const h of [0, 1, 4000, 8759]) {
  const cells = rows[h].split(",");
  assert.equal(Number(cells[0]), h + 1, "hour of year");
  const c = calendarOf(h);
  assert.deepEqual(cells.slice(1, 4).map(Number), [c.month, c.day, c.hour], `calendar of hour ${h}`);
  near(Number(cells[4]), values[h], 1e-6, `used value at hour ${h}`);
  near(Number(cells[5]), raw[h], 1e-6, `file value at hour ${h}`);
}
near(mean(rows.map((r) => Number(r.split(",")[4]))), cuf, 1e-5, "the CSV's mean is the CUF entered");
near(mean(rows.map((r) => Number(r.split(",")[5]))), 0.228, 1e-5, "the CSV's file column has the file's CUF");

// ---- without an upload: the typical profile, no file column
const typical = E.synthWindCf({ targetCuf: 0.33 });
const csvTyp = cufCsv({ kind: "wind", values: typical, cuf: mean(typical), degradation: 0, date });
assert.equal(data(csvTyp).length, 8760);
assert.match(comments(csvTyp).join("\n"), /Source: Typical wind profile/);
assert.match(comments(csvTyp).join("\n"), /CUF of the file: no file uploaded/);
assert.equal(lines(csvTyp).find((l) => !l.startsWith("#")), "Hour of year,Month,Day,Hour,Capacity factor used in the bid");
assert.equal(data(csvTyp)[100].split(",").length, 5);
assert.throws(() => cufCsv({ values: new Float64Array(100) }), /8760/);

// ---- the by-year table and CSV: the model's degradation factor, year by year
for (const y of [1, 2, 10, 25]) {
  const f = E.yearFactors(y, { solarDegradation: 0.005 }, { augmentation: "annual" });
  near(yearFactorOf("solar", y, 0.005), f.solarFactor, 1e-12, `solar factor year ${y} is the engine's`);
  near(yearFactorOf("wind", y, 0.01), E.yearFactors(y, { windDegradation: 0.01 }, { augmentation: "annual" }).windFactor, 1e-12, `wind factor year ${y}`);
}
const table = yearCufTable({ kind: "solar", cuf, degradation: 0.005, years: 25 });
assert.equal(table.length, 25);
near(table[0].cuf, cuf, 1e-12, "year 1 at the CUF entered");
near(table[24].factor, 0.995 ** 24, 1e-12, "year 25 factor");
near(table[24].cuf, cuf * 0.995 ** 24, 1e-12, "year 25 CUF");
near(table[24].cumulative, table.reduce((s, r) => s + r.mwhPerMw, 0), 1e-6, "cumulative adds up");
near(table[9].mwhPerMw, table[9].cuf * 8760, 1e-9, "energy per MW = CUF × 8,760");
const byYear = cufByYearCsv({ kind: "solar", cuf, degradation: 0.005, years: 25, name: "site_2019.csv", date });
const yrows = data(byYear);
assert.equal(yrows.length, 25, "one row per PPA year");
assert.equal(lines(byYear).find((l) => !l.startsWith("#")), "Year,Degradation factor,CUF,Energy per MW (MWh),Cumulative energy per MW (MWh)");
assert.ok(!comments(byYear).join("\n").includes("CUF of the file"), "no file CUF in the by-year header");
assert.match(comments(byYear).join("\n"), /Degradation factor = \(1 - degradation per year\) \^ \(year - 1\)/);
for (const r of yrows) {
  const [y, f, c, e, cum] = r.split(",").map(Number);
  near(f, 0.995 ** (y - 1), 1e-6, `factor year ${y}`);
  near(c, cuf * f, 1e-6, `CUF year ${y}`);
  near(e, c * 8760, 0.06, `energy year ${y}`);
  near(cum, table[y - 1].cumulative, 0.06, `cumulative year ${y}`);
}
assert.equal(data(cufByYearCsv({ kind: "wind", cuf: 0.33, degradation: 0, years: 20 })).length, 20, "the PPA term sets the rows");
assert.ok(data(cufByYearCsv({ kind: "wind", cuf: 0.33, degradation: 0, years: 20 })).every((r) => Number(r.split(",")[1]) === 1), "no degradation: factor 1 every year");

// ---- the justification
const monthly = E.monthlyMeans(values);
const stats = { cuf, rawCuf: 0.228, monthly, peak: Math.max(...values), zeroShare: values.filter((v) => v <= 1e-6).length / 8760 };
const j = cufJustification({ kind: "solar", stats, name: "site_2019.csv", cuf, rawCuf: 0.228, degradation: 0.005, years: 25, p50p90: { p50: cuf, p90: 0.228 }, cufAt: "Inverter output (LV AC)" });
assert.match(j.title, /^Solar CUF: why one year's hourly profile is used for 25 years$/);
assert.deepEqual(j.paragraphs.map((p) => p.heading), [
  "The profile used in the bid",
  "Why one year's profile stands for 25 years",
  "P50, P75 and P90",
  "Year-to-year variability",
  "Degradation and the CUF in year 25",
  "Evidence to attach to the bid",
  "What the model does not capture",
]);
const text = j.paragraphs.map((p) => p.text).join("\n");
const cuf25 = `${(cuf * 0.995 ** 24 * 100).toFixed(2)}%`;
assert.ok(text.includes(`${cuf25} in year 25`), `mentions the year-25 CUF ${cuf25}`);
near(j.year25.cuf, cuf * 0.995 ** 24, 1e-12, "year25.cuf");
assert.equal(j.yearTable.length, 25);
assert.match(text, /typical meteorological year/);
assert.match(text, /site_2019\.csv/);
assert.match(text, /file's own CUF is 22\.80%/);
assert.match(text, /scales its level to the CUF entered/);
assert.match(text, /measured at: Inverter output \(LV AC\)/);
assert.match(text, /P90 CUF entered is 22\.80%/);
assert.match(text, /0\.500% a year|by 0\.50%/);
assert.match(text, /±3–5%/);
assert.match(text, /not figures measured at this site/);
assert.match(text, /curtailment by the grid/);
assert.match(text, /availability/);
assert.match(text, /independent assessor/);
assert.deepEqual(INTERANNUAL, { solar: [0.03, 0.05], wind: [0.08, 0.12] });

// wind, typical profile, no degradation, no P90
const w = cufJustification({ kind: "wind", cuf: 0.33, degradation: 0, years: 20 });
assert.equal(w.paragraphs[1].heading, "Why one year's profile stands for 20 years");
const wt = w.paragraphs.map((p) => p.text).join("\n");
assert.match(wt, /typical wind profile shape built into the model/);
assert.match(wt, /applies no degradation to wind/);
assert.match(wt, /33\.00% in year 1 and 33\.00% in year 20/);
assert.match(wt, /No P90 CUF has been entered/);
assert.match(wt, /±8–12%/);
assert.ok(!wt.includes("undefined") && !wt.includes("NaN") && !/–(?!\d)/.test(wt), "no missing numbers in the text");
assert.ok(!text.includes("undefined") && !text.includes("NaN"), "no missing numbers in the solar text");

console.log("check_cuf_file: ok");
