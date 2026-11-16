// Isometric plant drawings for the TenderOS demo site, as SVG strings so the same code draws in the
// browser (the design studio redraws on every slider move) and in the build (the deck). The
// projection is the application's own (web/src/rtc/isoIcons.jsx): x to the lower right, y to the
// lower left, z up. Colours come from classes (.iso-*) defined in iso.css on the theme tokens.
(function (root) {
  const C = Math.cos(Math.PI / 6);
  const f = (n) => (Math.round(n * 10) / 10).toString();

  function Scene(scale = 4) {
    const items = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (px, py) => { if (px < x0) x0 = px; if (py < y0) y0 = py; if (px > x1) x1 = px; if (py > y1) y1 = py; };
    const P = (x, y, z = 0) => { const px = (x - y) * C * scale, py = (x + y) * 0.5 * scale - z * scale; grow(px, py); return [px, py]; };
    const pts = (list) => list.map(([x, y, z]) => P(x, y, z).map(f).join(",")).join(" ");
    const seg = (a, b, cls, extra = "") => { const [ax, ay] = P(...a), [bx, by] = P(...b); return `<line class="${cls}" x1="${f(ax)}" y1="${f(ay)}" x2="${f(bx)}" y2="${f(by)}"${extra}/>`; };
    const add = (layer, depth, svg) => items.push({ layer, depth, svg });
    const boxSvg = (x, y, z, w, d, h, tone) => `<g class="iso-box iso-${tone}"><polygon class="f-right" points="${pts([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]])}"/><polygon class="f-front" points="${pts([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]])}"/><polygon class="f-top" points="${pts([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]])}"/></g>`;
    const S = {
      P,
      pad(x, y, w, d, cls = "") { add(0, x + y, `<polygon class="iso-pad ${cls}" points="${pts([[x, y, 0], [x + w, y, 0], [x + w, y + d, 0], [x, y + d, 0]])}"/>`); },
      box(x, y, w, d, h, tone, z = 0) { add(1, x + y + (w + d) / 2, boxSvg(x, y, z, w, d, h, tone)); },
      /** A solar table: a tilted module face on two legs. */
      table(x, y, w = 7, d = 3, delay = 0) {
        add(1, x + y + (w + d) / 2, `<g class="iso-table" style="animation-delay:${delay}ms">${seg([x + 1, y + d, 0], [x + 1, y + d, 0.9], "iso-leg")}${seg([x + w - 1, y + d, 0], [x + w - 1, y + d, 0.9], "iso-leg")}${seg([x + 1, y, 0], [x + 1, y, 2.6], "iso-leg")}${seg([x + w - 1, y, 0], [x + w - 1, y, 2.6], "iso-leg")}<polygon class="iso-pv" points="${pts([[x, y, 2.6], [x + w, y, 2.6], [x + w, y + d, 0.9], [x, y + d, 0.9]])}"/>${[0.25, 0.5, 0.75].map((k) => seg([x + w * k, y, 2.6], [x + w * k, y + d, 0.9], "iso-pv-grid")).join("")}${seg([x, y + d / 2, 1.75], [x + w, y + d / 2, 1.75], "iso-pv-grid")}</g>`);
      },
      /** A wind turbine: tower, nacelle and a three-blade rotor that turns. */
      turbine(x, y, H = 16, R = 7, phase = 0, delay = 0) {
        const [hx, hy] = P(x, y, H);
        P(x, y, H + R); P(x - R * 0.5, y + R * 0.5, H); P(x + R * 0.5, y - R * 0.5, H);
        const L = R * scale;
        const blade = (a) => `<path class="iso-blade" transform="rotate(${a})" d="M0 0 L${f(L * 0.08)} ${f(-L * 0.25)} L0 ${f(-L)} L${f(-L * 0.05)} ${f(-L * 0.25)} Z"/>`;
        add(1, x + y, `<g class="iso-turbine" style="animation-delay:${delay}ms">${seg([x, y, 0], [x, y, H], "iso-tower")}<ellipse class="iso-nacelle" cx="${f(hx)}" cy="${f(hy)}" rx="${f(scale * 0.9)}" ry="${f(scale * 0.6)}"/><g transform="translate(${f(hx)} ${f(hy)}) scale(0.62 1)"><g class="iso-rotor" style="animation-delay:-${phase}s"><circle r="${f(L)}" fill="none" stroke="none"/>${blade(0)}${blade(120)}${blade(240)}<circle class="iso-hub" r="${f(scale * 0.45)}"/></g></g></g>`);
      },
      /** A battery container with doors and a status light. */
      container(x, y, w = 9, d = 3.2, h = 3.4, delay = 0) {
        add(1, x + y + (w + d) / 2, `<g class="iso-cont" style="animation-delay:${delay}ms">${boxSvg(x, y, 0, w, d, h, "bess")}${[0.25, 0.5, 0.75].map((k) => seg([x + w * k, y + d, 0.3], [x + w * k, y + d, h - 0.3], "iso-door")).join("")}${seg([x + w, y + d * 0.3, h * 0.7], [x + w, y + d * 0.7, h * 0.7], "iso-led")}</g>`);
      },
      /** A pooling substation: a transformer with radiators and two gantries. */
      substation(x, y) {
        S.pad(x, y, 18, 12, "yard");
        add(1, x + y + 9, `${boxSvg(x + 3, y + 3, 0, 6, 5, 4.2, "steel")}${[0.2, 0.4, 0.6, 0.8].map((k) => seg([x + 3 + 6 * k, y + 8, 0.4], [x + 3 + 6 * k, y + 8, 3.6], "iso-door")).join("")}${boxSvg(x + 5, y + 4.6, 4.2, 0.8, 0.8, 1.6, "steel")}`);
        for (const gx of [12, 15.5]) add(1, x + y + gx + 6, `${seg([x + gx, y + 2, 0], [x + gx, y + 2, 7], "iso-steel-line")}${seg([x + gx, y + 10, 0], [x + gx, y + 10, 7], "iso-steel-line")}${seg([x + gx, y + 2, 7], [x + gx, y + 10, 7], "iso-steel-line")}${seg([x + gx, y + 4, 7], [x + gx, y + 4, 5.6], "iso-wire")}${seg([x + gx, y + 6, 7], [x + gx, y + 6, 5.6], "iso-wire")}${seg([x + gx, y + 8, 7], [x + gx, y + 8, 5.6], "iso-wire")}`);
      },
      /** A transmission tower; `wireTo` draws the conductors to the next tower. */
      pylon(x, y, H = 15, wireTo = null) {
        const arm = (z, r) => `${seg([x, y - r, z], [x, y + r, z], "iso-steel-line")}`;
        let wires = "";
        if (wireTo) {
          for (const [z, r] of [[H * 0.78, 3.2], [H * 0.9, 2.4]]) for (const sgn of [-1, 1]) {
            const [ax, ay] = P(x, y + sgn * r, z), [bx, by] = P(wireTo[0], wireTo[1] + sgn * r, z);
            wires += `<path class="iso-wire" d="M${f(ax)} ${f(ay)} Q${f((ax + bx) / 2)} ${f((ay + by) / 2 + scale * 1.6)} ${f(bx)} ${f(by)}"/>`;
          }
        }
        add(1, x + y, `${wires}${seg([x - 1.4, y - 1.4, 0], [x, y, H], "iso-steel-line")}${seg([x + 1.4, y - 1.4, 0], [x, y, H], "iso-steel-line")}${seg([x - 1.4, y + 1.4, 0], [x, y, H], "iso-steel-line")}${seg([x + 1.4, y + 1.4, 0], [x, y, H], "iso-steel-line")}${seg([x - 0.9, y + 0.9, H * 0.36], [x + 0.9, y + 0.9, H * 0.36], "iso-steel-line")}${seg([x - 0.5, y + 0.5, H * 0.64], [x + 0.5, y + 0.5, H * 0.64], "iso-steel-line")}${arm(H * 0.78, 3.2)}${arm(H * 0.9, 2.4)}`);
      },
      /** An office block (the power exchange, SECI, the buying utility). */
      building(x, y, w, d, h, tone = "office") {
        let win = "";
        for (let zz = 2; zz < h - 1; zz += 2.4) win += seg([x + 1, y + d, zz], [x + w - 1, y + d, zz], "iso-window") + seg([x + w, y + 1, zz], [x + w, y + d - 1, zz], "iso-window");
        add(1, x + y + (w + d) / 2, `${boxSvg(x, y, 0, w, d, h, tone)}${win}`);
      },
      /** A line of moving dashes along the ground: energy (or money) flowing from the first point to the last. */
      flow(points, tone = "supply", z = 0.2) {
        const d = points.map(([x, y], k) => { const [px, py] = P(x, y, z); return `${k ? "L" : "M"}${f(px)} ${f(py)}`; }).join(" ");
        add(0.5, 0, `<path class="iso-flow-bed" d="${d}"/><path class="iso-flow flow-${tone}" d="${d}"/>`);
      },
      /** A label with a small heading and a value under it, anchored at a point of the scene. */
      label(x, y, z, title, sub = "", anchor = "middle", dx = 0, dy = 0) {
        const [px, py] = P(x, y, z);
        grow(px + dx - 70, py + dy - 14); grow(px + dx + 70, py + dy + (sub ? 16 : 4));
        add(2, 0, `<text class="iso-label" x="${f(px + dx)}" y="${f(py + dy)}" text-anchor="${anchor}">${title}${sub ? `<tspan class="iso-sub" x="${f(px + dx)}" dy="13">${sub}</tspan>` : ""}</text>`);
      },
      svg({ cls = "", title = "", pad = 14 } = {}) {
        const w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
        const body = items.slice().sort((a, b) => a.layer - b.layer || a.depth - b.depth).map((i) => i.svg).join("");
        return `<svg class="iso ${cls}" viewBox="0 0 ${f(w)} ${f(h)}" role="img" aria-label="${title}"><g transform="translate(${f(pad - x0)} ${f(pad - y0)})">${body}</g></svg>`;
      },
    };
    return S;
  }

  /**
   * A plant for a tender: own solar and wind, the battery yard, the pooling substation, the line to
   * the grid and who is at the other end. `kind`: cfd | fdre | bess. Sizes are in MW / MWh; the
   * drawing shows one table per `mwPerTable`, one turbine per `mwPerTurbine`, one container per
   * `mwhPerContainer`, so it grows and shrinks with the bid.
   */
  function plant({ kind = "cfd", solarMw = 10, windMw = 0, bessMwh = 200, mwPerTable = 2, mwPerTurbine = 5, mwhPerContainer = 20, labels = true, text = {}, reserve = null } = {}) {
    const S = Scene(4);
    // (u, v): across and down the page; the plant is laid out left to right along u at one depth
    // (generation, storage, substation, grid, buyer) while every part is drawn in the projection
    const at = (u, v) => [(v + u) / 2, (v - u) / 2];
    const nT = Math.max(0, Math.round(solarMw / mwPerTable));
    const nW = Math.min(8, Math.max(0, Math.round(windMw / mwPerTurbine)));
    const nC = Math.max(0, Math.round(bessMwh / mwhPerContainer));
    // `reserve` keeps the drawing's frame fixed while the sizes move (the studio's sliders): the
    // field is laid out for the largest solar and room is kept for the wind rows
    const rows = 4, colsT = Math.max(2, Math.ceil((reserve ? Math.round(reserve.solarMw / mwPerTable) : nT) / rows));
    const hasField = kind !== "bess" && (nT > 0 || nW > 0 || Boolean(reserve)), windOnly = hasField && !nT && !reserve, hasBess = nC > 0;
    const fieldW = hasField ? (windOnly ? 40 : colsT * 8.5 + 1.5) : 0, fieldD = hasField ? rows * 5.4 + 1.5 : 0;
    const perCol = 5, colsC = Math.max(1, Math.ceil(nC / perCol)), yardW = colsC * 11 + 1, yardD = Math.min(perCol, Math.max(nC, 1)) * 4.4 + 1.5;
    const vc = hasField ? (fieldW + fieldD) / 2 : (yardW + yardD) / 2; // the depth everything is centred on
    const uGen = hasField ? fieldW + 5 : 0;
    const uY = uGen + yardD, [bx, by] = at(uY, vc - (yardW + yardD) / 2);
    const uS = (hasBess ? uY + yardW + 5 : uGen) + 12, [sx, sy] = at(uS, vc - 15);
    const uP = [uS + 18 + 8, uS + 18 + 21], pyl = uP.map((u) => at(u, vc));
    const uE = uP[1] + 9 + 12, [ex, ey] = at(uE, vc - 12);
    const line = (u0, u1, dv) => [at(u0, vc + dv), at(u1, vc + dv)];
    const uStore = hasBess ? uY - yardD / 2 : uS - 8; // where generation is taken to
    if (hasField) {
      S.pad(-2, -2, fieldW + 2, fieldD + 2, "park");
      for (let k = 0; k < nT; k += 1) { const c = Math.floor(k / rows), rI = k % rows; S.table(c * 8.5, rI * 5.4, 7, 3, k * 18); }
      if (labels && (nT || reserve)) S.label(fieldW / 2 - 6, fieldD + 1, 0, text.solar || "Solar", `${solarMw} MWac`, "middle", 0, 18);
      // wind stands behind the solar field, or on the ground itself when there is no solar
      const gap = windOnly ? 9 : Math.min(10, (fieldW - 6) / 3.4), wx = (k) => (windOnly ? 5 : 2) + (k % 4) * gap + (k >= 4 ? gap / 2 : 0), wy = (k) => (windOnly ? (k >= 4 ? 15 : 5) : -9 - (k >= 4 ? 10 : 0));
      if (reserve && reserve.windMw) { S.P(wx(0), -19, 23); S.P(wx(7), -19, 23); }
      for (let k = 0; k < nW; k += 1) S.turbine(wx(k), wy(k), 15, 6, (k * 1.3) % 5, k * 40);
      if (nW && labels) { if (windOnly) S.label(fieldW / 2 - 6, fieldD + 1, 0, text.wind || "Wind", `${windMw} MW`, "middle", 0, 18); else S.label(wx(Math.min(nW, 4) - 1) / 2 + 1, nW > 4 ? -19 : -9, 23, text.wind || "Wind", `${windMw} MW`, "middle", 0, -4); }
      if (nT || windOnly) S.flow(line(fieldW * 0.62, uStore, 3), hasBess ? "charge" : "supply");
      if (nW && !windOnly) S.flow([[wx(Math.min(nW, 4) - 1) + 2, -8], at(uGen - 2, vc - 9), at(uStore, vc - 3)], "wind");
    }
    if (hasBess) {
      S.pad(bx - 1.5, by - 1, yardW + 1.5, yardD + 1, "yard");
      for (let k = 0; k < nC; k += 1) { const c = Math.floor(k / perCol), rI = k % perCol; S.container(bx + c * 11, by + rI * 4.4, 9, 3.2, 3.4, k * 22); }
      if (labels) S.label(bx + yardW / 2 - 4, by + yardD + 1, 0, text.bess || "Battery", text.bessSub || `${bessMwh} MWh`, "middle", 0, 18);
    }
    S.substation(sx, sy);
    if (labels) S.label(sx + 9, sy + 13, 0, text.sub || "Pooling substation", "", "middle", 14, 20);
    S.pylon(pyl[0][0], pyl[0][1], 15, pyl[1]); S.pylon(pyl[1][0], pyl[1][1], 15, null);
    if (labels) S.label(...at((uP[0] + uP[1]) / 2, vc), 17, text.grid || "ISTS grid", "", "middle", 0, -8);
    S.building(ex, ey, 12, 12, 11, "office");
    if (labels) S.label(ex + 6, ey + 6, 12.5, text.buyer || "Power exchange", text.buyerSub || "", "middle", 0, text.buyerSub ? -32 : -18);
    const uFrom = hasBess ? uY + (yardW - yardD) / 2 : uS - 8;
    S.flow(line(uFrom, uE - 2, -2), "supply");
    if (hasBess && (kind === "cfd" || kind === "bess")) S.flow(line(uE - 2, uFrom, 2.5), "bought");
    if (kind === "cfd") {
      const [px, py] = at(uE - 1.5, vc + 29);
      S.building(px, py, 9, 9, 7, "pool");
      if (labels) S.label(px + 4.5, py + 10, 0, text.pool || "SECI's CfD Pool", text.poolSub === undefined ? "pays or collects the difference" : text.poolSub, "middle", 0, 18);
      S.flow([at(uE, vc + 13), at(uE, vc + 28)], "money");
    }
    return S.svg({ cls: `iso-plant iso-${kind}`, title: text.title || "Plant schematic" });
  }

  /**
   * The plant a tender asks for, from what its title says: the drawing for a tender on the market
   * (the landing page's first picture). Sizes are symbolic above a few hundred MW: the drawing
   * shows the mix, the labels carry the tender's own figures.
   */
  function forTender(t) {
    const cap = t.capacity || {}, mw = cap.mw || (cap.kw ? cap.kw / 1000 : 0), mwh = cap.mwh || 0, c = t.category || "";
    const tables = (n) => ({ solarMw: n * 2, mwPerTable: 2 }), turbines = (n) => ({ windMw: n * 5, mwPerTurbine: 5 }), boxes = (n) => ({ bessMwh: n * 20, mwhPerContainer: 20 });
    const size = (v, lo, hi, ref) => Math.max(lo, Math.min(hi, Math.round(lo + (hi - lo) * Math.min(1, (v || ref / 2) / ref))));
    const mwText = mw ? `${Math.round(mw).toLocaleString("en-IN")} MW` : "", storeText = mwh ? `${Math.round(mwh).toLocaleString("en-IN")} MWh` : "storage";
    const text = { title: t.title, buyer: t.source, buyerSub: "to the buying utilities" };
    let o;
    if (c === "cfd") o = { kind: "cfd", ...tables(6), ...turbines(0), ...boxes(size(mwh, 6, 14, 2000)), text: { ...text, buyer: "Power exchange", buyerSub: "", solar: "Own RE", bessSub: `${mwText} / ${storeText}` } };
    else if (c === "bess") o = { kind: "bess", solarMw: 0, windMw: 0, ...boxes(size(mwh, 8, 20, 8000)), text: { ...text, bess: "Battery", bessSub: mwh ? `${mwText} / ${storeText}` : mwText } };
    else if (c === "wind") o = { kind: "fdre", solarMw: 0, ...turbines(size(mw, 4, 8, 1500)), bessMwh: 0, text: { ...text, wind: "Wind" } };
    else if (c === "solar" || c === "rooftop") o = { kind: "fdre", ...tables(size(mw, 6, 20, 1500)), windMw: 0, bessMwh: 0, text: { ...text, solar: c === "rooftop" ? "Rooftop solar" : "Solar" } };
    else if (c === "solar+ess") o = { kind: "fdre", ...tables(size(mw, 10, 20, 1500)), windMw: 0, ...boxes(8), text: { ...text, bessSub: storeText } };
    else o = { kind: "fdre", ...tables(size(mw, 10, 20, 1500)), ...turbines(size(mw, 3, 6, 1500)), ...boxes(size(mwh, 6, 14, 6000)), text: { ...text, bessSub: storeText } };
    const svg = plant(o);
    // a firm-supply tender states what is contracted, not how much solar or wind stands behind it
    if (!["cfd", "bess", "wind", "solar", "rooftop", "solar+ess"].includes(c)) return svg.replace(/<tspan class="iso-sub"[^>]*>\d+ MW(ac)?<\/tspan>/g, "");
    // the labels carry the tender's figures, not the drawing's symbolic ones
    return svg.replace(/<tspan class="iso-sub"([^>]*)>(\d+) MWac<\/tspan>/, mw && c !== "cfd" ? `<tspan class="iso-sub"$1>${c === "rooftop" ? `${Math.round(cap.kw || mw * 1000).toLocaleString("en-IN")} kW` : mwText}</tspan>` : "").replace(/<tspan class="iso-sub"([^>]*)>(\d+) MW<\/tspan>/, mw ? `<tspan class="iso-sub"$1>${mwText}</tspan>` : "");
  }

  root.TOSIso = { Scene, plant, forTender };
})(typeof globalThis !== "undefined" ? globalThis : window);
