import React, { useRef } from "react";
import { Download, Upload } from "lucide-react";
import { bidFileName, bidFileText, readBidFile } from "./bidFile.js";

/**
 * Export and Import in a bid tab's heading: Export downloads the bid as a file; Import loads one
 * (onLoad receives the saved state, onError the reason a file cannot be loaded).
 */
export default function BidFileTools({ state, module, title, onLoad, onError, testid = "cfd" }) {
  const input = useRef(null);
  function exportBid() {
    const blob = new Blob([bidFileText(state, { module, title })], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = bidFileName(state, { module });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importBid(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      onLoad(readBidFile(await file.text(), { module, title }), file.name);
    } catch (err) {
      onError(err.message);
    }
  }
  return (
    <>
      <button type="button" className="rtc-reset" onClick={exportBid} data-testid={`${testid}-export`} title="Download the bid as a file: every input, the own RE as sized, the forms and letters"><Download size={13} /> Export</button>
      <button type="button" className="rtc-reset" onClick={() => input.current?.click()} data-testid={`${testid}-import`} title="Load a bid file exported from this tab"><Upload size={13} /> Import</button>
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={importBid} data-testid={`${testid}-import-file`} />
    </>
  );
}
