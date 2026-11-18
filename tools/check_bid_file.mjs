// Checks for the bid file (web/src/cfd/bidFile.js): Export and Import in the CfD Bid, CfD Own Solar
// and FDRE-X Bid tabs. A state written and read back is the same state and prices the same; a file
// that is not a bid, a bid of another tab or of a newer version is refused with the reason.
// Run from the repository root:  node tools/check_bid_file.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bidFileName, bidFileText, readBidFile } from "../web/src/cfd/bidFile.js";
import * as M from "../web/src/cfd/model.js";

const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
const tab = { module: "cfd", title: "CfD bid · SECI" };
const state = M.fillWinning(M.defaultCfdState());
state.inputs = { ...state.inputs, contractedMw: 50, solarMw: 40, augmentation: "annual" };
const text = bidFileText(state, tab);
const back = readBidFile(text, tab);
assert.deepEqual(back, JSON.parse(JSON.stringify(state)), "the state read back is the state written");
const sim = (s) => M.runModel(M.mergeCfdState(s), prices).opYears.reduce((a, y) => a + y.deliveredMwh, 0);
assert.equal(sim(back), sim(state), "the bid read back runs the same");
assert.match(bidFileName(state, tab), /^tenderos-cfd-50mw-\d{4}-\d{2}-\d{2}\.json$/);
assert.throws(() => readBidFile("not json", tab), /not a TenderOS bid file/);
assert.throws(() => readBidFile(JSON.stringify({ app: "Other", state: {} }), tab), /not a TenderOS bid file/);
assert.throws(() => readBidFile(bidFileText(state, { module: "fdrex", title: "FDRE-X bid · SECI" }), tab), /FDRE-X bid · SECI tab; open it there/);
assert.throws(() => readBidFile(text.replace('"version": 1', '"version": 2'), tab), /newer TenderOS/);
console.log("OK  bid file: written and read back the same, refused with the reason when it is not this tab's bid");
