import React, { useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, TriangleAlert, Upload, X } from "lucide-react";
import { sheetRows } from "./inputSheet.js";
import { buildInputWorkbook, readInputWorkbook, templateFileName } from "./inputWorkbook.js";

/**
 * "Download input template" and "Upload bid inputs" beside "Fill up for me please": the bid's
 * inputs as an Excel template (yellow input cells with notes, dropdowns and range checks, filled
 * with the tab's current values) and the same file read back into the tab. The file is written
 * and read in the browser; it is not sent to the server. A file with any wrong cell loads
 * nothing and lists each cell with the reason.
 *
 * catalogue: { agentInputs, fields, choices, bilateral } for ./inputSheet.js sheetRows; meta:
 * { module, title, tender }.
 */
export default function InputSheetTools({ state, setState, catalogue, meta, testid = "cfd" }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const rowsOf = (s) => sheetRows(s, catalogue);

  async function download() {
    setBusy("template");
    try {
      const ExcelJS = (await import("exceljs/dist/exceljs.min.js")).default;
      const wb = buildInputWorkbook(ExcelJS, { state, rows: rowsOf(state), meta });
      const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = templateFileName(state, meta);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setResult({ ok: false, errors: [{ sheet: "", cell: "", label: "The template", value: "", message: `could not be written: ${err.message}` }] });
    } finally {
      setBusy(null);
    }
  }

  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("upload");
    try {
      const JSZip = (await import("jszip")).default;
      const res = await readInputWorkbook(JSZip, await file.arrayBuffer(), { state, rows: rowsOf(state), meta });
      if (res.ok) setState(res.state);
      setResult({ ...res, name: file.name });
    } catch (err) {
      setResult({ ok: false, name: file.name, errors: [{ sheet: "", cell: "", label: "The file", value: "", message: err.message }] });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button type="button" className="secondary" onClick={download} disabled={Boolean(busy)} data-testid={`${testid}-sheet-template`} title="An Excel file of every bid input with your current values: fill the yellow cells (each has a note), then upload it">
        <FileSpreadsheet size={14} /> {busy === "template" ? "Writing the template…" : "Download input template"}
      </button>
      <button type="button" className="secondary" onClick={() => input.current?.click()} disabled={Boolean(busy)} data-testid={`${testid}-sheet-upload`} title="Load every input from a filled template; nothing loads if a cell is wrong">
        <Upload size={14} /> {busy === "upload" ? "Reading…" : "Upload bid inputs"}
      </button>
      <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={upload} data-testid={`${testid}-sheet-file`} />
      {result && (
        <div className={`cfd-sheet-result ${result.ok ? "ok" : "bad"}`} data-testid={`${testid}-sheet-result`} role="status">
          <button type="button" className="rtc-icon-btn cfd-sheet-close" onClick={() => setResult(null)} title="Close"><X size={12} /></button>
          {result.ok ? (
            <>
              <strong><CheckCircle2 size={14} /> Loaded {result.name}: {result.read} inputs read, {result.changes.length} changed.</strong>
              {result.changes.length > 0 ? (
                <table>
                  <thead><tr><th>Input</th><th>Was</th><th>Now</th></tr></thead>
                  <tbody>{result.changes.map((c, k) => <tr key={k}><td>{c.label}</td><td>{fmt(c.from, c.unit)}</td><td>{fmt(c.to, c.unit)}</td></tr>)}</tbody>
                </table>
              ) : <span>Every value in the file is the app's already.</span>}
            </>
          ) : (
            <>
              <strong><TriangleAlert size={14} /> {result.name ? `${result.name}: ` : ""}nothing was loaded. {result.errors.every((e) => !e.sheet) ? result.errors[0].message : `Correct ${result.errors.length === 1 ? "this cell" : `these ${result.errors.length} cells`} and upload again.`}</strong>
              {result.errors.some((e) => e.sheet) && (
              <table>
                <thead><tr><th>Cell</th><th>Input</th><th>Typed</th><th>What is wrong</th></tr></thead>
                <tbody>{result.errors.map((e, k) => <tr key={k}><td>{e.sheet ? `${e.sheet} ${e.cell}` : "–"}</td><td>{e.label}</td><td>{e.value}</td><td>{e.message}</td></tr>)}</tbody>
              </table>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

const fmt = (v, unit) => (v === null || v === undefined || v === "" ? "–" : `${v}${unit && typeof v === "number" ? ` ${unit}` : ""}`);
