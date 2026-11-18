// The bid as a file: the whole tab state (inputs, finance terms, the own RE as sized, forms and
// letters) in one JSON file a bidder can keep, e-mail or load on another machine. Loading it puts
// the same state in the tab, so the strike price, the returns and the workbook come out the same
// as where it was written. Used by the CfD Bid, CfD Own Solar and FDRE-X Bid tabs.

export const BID_FILE_APP = "TenderOS";
export const BID_FILE_VERSION = 1;

/** The file's text for a tab's state. */
export function bidFileText(state, { module, title }) {
  return JSON.stringify({ app: BID_FILE_APP, kind: "bid", module, title, version: BID_FILE_VERSION, exportedAt: new Date().toISOString(), state }, null, 1);
}

/** The file name: the tab, the contracted MW and the date. */
export function bidFileName(state, { module }) {
  const mw = state?.inputs?.contractedMw ?? state?.bid?.baseMw; // the CfD tabs, or the Tender to Bid shape (FDRE-X)
  return `tenderos-${module}${Number.isFinite(mw) ? `-${mw}mw` : ""}-${new Date().toISOString().slice(0, 10)}.json`;
}

/**
 * The saved state in a bid file's text, for the tab `module`; throws an Error whose message says
 * what is wrong (not a TenderOS bid file, a bid of another tab, a newer version).
 */
export function readBidFile(text, { module, title }) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error("The file is not a TenderOS bid file (it is not JSON).");
  }
  if (!file || file.app !== BID_FILE_APP || file.kind !== "bid" || typeof file.state !== "object" || !file.state) throw new Error("The file is not a TenderOS bid file.");
  if (file.module !== module) throw new Error(`The file is a bid of the ${file.title || file.module} tab; open it there, not in the ${title} tab.`);
  if (!(file.version <= BID_FILE_VERSION)) throw new Error("The file was written by a newer TenderOS; update the application to open it.");
  return file.state;
}
