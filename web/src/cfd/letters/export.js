// Downloading the CfD letters: the shared helper (web/src/seci/letters/export.js) with this
// pack's Word route and file prefix; the PDF goes through the engine as for every pack.
import { downloadLetters as download } from "../../seci/letters/export.js";

export const LETTERS_ROUTE = "/api/cfd/letters";
export const FILE_PREFIX = "SECI_CfD_I";

/** Download the letters as one Word file ("word") or one PDF ("pdf"), each letter from a new page. */
export function downloadLetters(letters, kind) {
  return download(letters, kind, { route: LETTERS_ROUTE, prefix: FILE_PREFIX });
}
