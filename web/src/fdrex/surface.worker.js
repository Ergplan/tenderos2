// Builds the FDRE-X tariff surface (./surface.js) off the page's thread while HiGHS sizes the plant.
// In: { id, state, prices }. Out: { id, type: "axes", axes }, then { id, type: "cells", cells } in
// small batches, then { id, type: "done" } (or { type: "error", error }).
import { surfaceAxes, surfaceCell, surfaceSeed } from "./surface.js";

self.onmessage = (ev) => {
  const { id, state, prices } = ev.data || {};
  try {
    const axes = surfaceAxes(state);
    self.postMessage({ id, type: "axes", axes });
    const seed = surfaceSeed(state, prices);
    let batch = [];
    // a serpentine order, so the surface grows across the grid as it is drawn
    for (let si = 0; si < axes.solarGrid.length; si += 1) {
      for (let k = 0; k < axes.windGrid.length; k += 1) {
        const wi = si % 2 ? axes.windGrid.length - 1 - k : k;
        batch.push(surfaceCell(seed, axes, si, wi, prices));
        if (batch.length >= 4) { self.postMessage({ id, type: "cells", cells: batch }); batch = []; }
      }
    }
    if (batch.length) self.postMessage({ id, type: "cells", cells: batch });
    self.postMessage({ id, type: "done" });
  } catch (err) {
    self.postMessage({ id, type: "error", error: String(err?.message || err) });
  }
};
