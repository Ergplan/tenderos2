// TenderOS public demo. The page's content is in the HTML; this file runs the guided tour (a
// cursor that drives each screen, until the visitor takes the mouse), the evidence and amendment
// viewers, the design studio, the what-if planner and the charts, all from /data/demo.json, which
// the build wrote from the application's own model.
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const NS = "http://www.w3.org/2000/svg";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    // colours are theme variables, set as style so the charts follow the day/night toggle
    for (const [k, v] of Object.entries(attrs)) { if ((k === "fill" || k === "stroke") && String(v).startsWith("var(")) n.style[k] = v; else n.setAttribute(k, v); }
    if (parent) parent.appendChild(n);
    return n;
  };
  const txt = (parent, x, y, s, attrs = {}) => { const t = el("text", { x, y, ...attrs }, parent); t.textContent = s; return t; };
  const V = (name) => `var(--${name})`;
  const nf = (v, d = 2) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
  const rs = (v, d = 2) => `₹${nf(v, d)}`;
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const lv = (l, v) => (l.pct ? `${+(v * 100).toFixed(2)}%` : `${+Number(v).toFixed(3)}`);

  // ---------------------------------------------------------------- day / night
  const sysLight = window.matchMedia("(prefers-color-scheme: light)");
  const isLight = () => (root.dataset.theme ? root.dataset.theme === "light" : sysLight.matches);
  const mark = () => {
    root.classList.toggle("is-light", isLight());
    const t = $("#theme-toggle");
    if (t) { const next = isLight() ? "night" : "day"; t.setAttribute("aria-label", `Switch to ${next} mode`); t.title = `${next[0].toUpperCase()}${next.slice(1)} mode`; }
    document.dispatchEvent(new Event("tos-theme"));
  };
  $("#theme-toggle")?.addEventListener("click", () => {
    const next = isLight() ? "dark" : "light";
    root.dataset.theme = next;
    try { localStorage.setItem("tos-theme", next); } catch (e) { /* private mode: this visit only */ }
    mark();
  });
  sysLight.addEventListener?.("change", mark);
  mark();

  // ---------------------------------------------------------------- small page behaviours
  // the isometric plants alternate between charging by day and supplying in the evening
  if (!reduce) { let ph = 0; const tick = () => { ph += 1; for (const s of $$("svg.iso")) { s.classList.toggle("phase-day", ph % 2 === 0); s.classList.toggle("phase-eve", ph % 2 === 1); } }; tick(); setInterval(tick, 3600); }
  const tabs = $$("#tt-tabs button");
  tabs.forEach((b) => b.addEventListener("click", () => { tabs.forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-selected", String(on)); $(`#tt-${x.dataset.tt}`).hidden = !on; }); }));
  const time = $(".time");
  if (time && "IntersectionObserver" in window) { const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { time.classList.add("seen"); io.disconnect(); } }, { threshold: 0.3 }); io.observe(time); }
  const chips = $$(".filters .chip");
  chips.forEach((c) => c.addEventListener("click", () => {
    const f = c.dataset.filter;
    chips.forEach((x) => x.classList.toggle("on", x === c));
    $$("#results-table > tbody > tr").forEach((r) => { r.hidden = f !== "all" && r.dataset.product !== f; });
    $$(".rc-row").forEach((r) => r.classList.toggle("dim", f !== "all" && r.dataset.product !== f));
  }));

  // ---------------------------------------------------------------- the tour
  const sim = $("#sim");
  if (!sim) return;
  const screen = $("#sim-screen"), cursor = $("#cursor"), playBtn = $("#sim-play"), bar = $("#sim-progress"), title = $("#sim-title"), modeTag = $("#sim-mode"), rail = $(".sim-rail", sim);
  const railTabs = $$("button", rail);
  const panels = railTabs.map((t) => document.getElementById(t.getAttribute("aria-controls")));
  const idOf = (k) => panels[k].id.replace("st-", "");
  const CANCEL = Symbol("cancel");
  let D = null, cur = 0, playing = false, tok = null, inView = false, started = false;
  // the screens a run of the tour visits: all thirteen, or five for the 90-second overview
  const SHORT = ["amend", "studio", "finance", "review", "pack"];
  let route = null;
  const onRoute = (k) => !route || route.includes(idOf(k));
  const after = (k) => { for (let j = k + 1; j < panels.length; j += 1) if (onRoute(j)) return j; return -1; };
  const first = () => { for (let j = 0; j < panels.length; j += 1) if (onRoute(j)) return j; return 0; };
  const speed = reduce ? 0.05 : 1;
  // `hold` freezes the tour where it is (the window has scrolled mostly out of view): every wait
  // stays pending until it is released, so the cursor and the narration pick up where they stopped
  let hold = false;
  const wait = (ms, t) => new Promise((res, rej) => { const end = () => { if (t.dead) rej(CANCEL); else if (hold) setTimeout(end, 200); else res(); }; setTimeout(end, ms * speed); });
  const at = (target) => (typeof target === "string" ? $(target, screen) : target);
  const place = (x, y, dur) => { cursor.classList.add("on"); cursor.style.transitionDuration = `${dur * speed}ms, 300ms`; cursor.style.transform = `translate(${x}px, ${y}px)`; };
  const moveTo = async (t, target, { fx = 0.5, fy = 0.55, dur = 750 } = {}) => {
    const n = at(target);
    if (!n) return null;
    const r = n.getBoundingClientRect(), s = screen.getBoundingClientRect();
    place(r.left - s.left + r.width * fx, r.top - s.top + r.height * fy, dur);
    await wait(dur + 70, t);
    return n;
  };
  const click = async (t, target, opts) => {
    const n = await moveTo(t, target, opts);
    if (!n) return;
    cursor.classList.add("click", "down"); n.classList.add("tap");
    await wait(170, t);
    cursor.classList.remove("down");
    n.click();
    await wait(330, t);
    cursor.classList.remove("click"); n.classList.remove("tap");
  };
  const thumb = (input, v) => { const r = input.getBoundingClientRect(), s = screen.getBoundingClientRect(), f = (v - +input.min) / (+input.max - +input.min); return [r.left - s.left + 9 + f * (r.width - 18), r.top - s.top + r.height / 2]; };
  const drag = async (t, target, to, dur = 1500) => {
    const input = at(target);
    if (!input) return;
    const from = +input.value, step = +input.step || 1;
    place(...thumb(input, from), 650);
    await wait(720, t);
    cursor.classList.add("down");
    const frames = Math.max(8, Math.round(dur / 55));
    for (let k = 1; k <= frames; k += 1) {
      const e = k / frames, eased = e < 0.5 ? 2 * e * e : 1 - (-2 * e + 2) ** 2 / 2;
      const raw = from + (to - from) * eased, v = Math.round(raw / step) * step;
      if (+input.value !== v) { input.value = v; input.dispatchEvent(new Event("input", { bubbles: true })); }
      place(...thumb(input, raw), 55);
      await wait(55, t);
    }
    cursor.classList.remove("down");
  };
  const countTo = (node, n, dur = 900, fmt = (v) => Math.round(v).toLocaleString("en-IN")) => {
    const t0 = performance.now(), d = dur * speed;
    const step = (now) => { const f = d ? Math.min(1, (now - t0) / d) : 1; node.textContent = fmt(n * (1 - (1 - f) ** 3)); if (f < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };

  // ---- the tender's page with passages marked (evidence and amendments)
  function setPage(fig, marks, caption) {
    if (!fig || !marks || !marks.length) return;
    const first = marks.find((m) => m.kind !== "was") || marks[0], key = first.page, pg = D.pages[key];
    const img = $("img", fig), sheet = $(".pv-sheet", fig), box = $(".pv-marks", fig), scroll = $(".pv-scroll", fig);
    sheet.style.aspectRatio = `${pg.w} / ${pg.h}`;
    if (img.getAttribute("src") !== pg.src) img.src = pg.src;
    img.alt = caption;
    $("figcaption", fig).innerHTML = `<span>${esc(caption)}</span><span>SECI's document</span>`;
    let k = 0, top = 1;
    box.innerHTML = marks.filter((m) => m.page === key).map((m) => m.rects.map(([x, y, w, h]) => { top = Math.min(top, y); k += 1; return `<i class="${m.kind}" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%;animation-delay:${Math.min(k * 28, 900)}ms"></i>`; }).join("")).join("");
    requestAnimationFrame(() => { scroll.scrollTop = Math.max(0, top * sheet.offsetHeight - 50); });
  }

  // ---- charts
  function scanChart(host) {
    const pts = D.scan, W = 600, H = 380, L = 54, R = 14, T = 16, B = 40;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
    const maxMw = pts[pts.length - 1].mw, lo = Math.floor(Math.min(...pts.map((p) => p.sp)) * 2) / 2 - 0.25, hi = Math.ceil(Math.max(...pts.map((p) => p.sp)) * 2) / 2;
    const x = (mw) => L + (mw / maxMw) * (W - L - R), y = (sp) => T + (1 - (sp - lo) / (hi - lo)) * (H - T - B);
    for (let v = Math.ceil(lo * 2) / 2; v <= hi + 1e-9; v += 0.5) { el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }, svg); txt(svg, L - 8, y(v) + 4, rs(v, 1), { "text-anchor": "end" }); }
    for (let v = 0; v <= maxMw; v += 10) txt(svg, x(v), H - B + 18, `${v}`, { "text-anchor": "middle" });
    txt(svg, (L + W - R) / 2, H - 4, "Own solar, MWac (100 MW contracted)", { "text-anchor": "middle" });
    const firstOk = pts.find((p) => p.shortMwh === 0);
    el("rect", { x: L, y: T, width: x(firstOk.mw) - L - 4, height: H - T - B, fill: V("heat"), opacity: 0.08 }, svg);
    txt(svg, L + 8, T + 16, "days short of 2 MWh/MW", { fill: V("heat") });
    const path = el("polyline", { points: pts.map((p) => `${x(p.mw)},${y(p.sp)}`).join(" "), fill: "none", stroke: V("power"), "stroke-width": 3, "stroke-linejoin": "round" }, svg);
    const len = pts.reduce((a, p, i) => (i ? a + Math.hypot(x(p.mw) - x(pts[i - 1].mw), y(p.sp) - y(pts[i - 1].sp)) : 0), 0);
    path.style.strokeDasharray = `${len}`;
    const dot = el("circle", { r: 6, cx: x(pts[0].mw), cy: y(pts[0].sp), fill: V("ink"), stroke: V("panel"), "stroke-width": 2, opacity: 0 }, svg);
    const best = pts.find((p) => p.mw === D.best);
    const bestG = el("g", {}, svg);
    el("circle", { r: 9, cx: x(best.mw), cy: y(best.sp), fill: V("power"), stroke: V("bg"), "stroke-width": 3 }, bestG);
    txt(bestG, x(best.mw) + 14, y(best.sp) + 26, `${best.mw} MWac · ${rs(best.sp)}/kWh, every day met`, { fill: V("ink"), "font-weight": 700 });
    host.replaceChildren(svg);
    const readout = $("#scan-readout");
    const done = `Lowest at ${best.mw} MWac: every day is met and ${rs(best.sp)}/kWh on these example inputs. More solar costs more than the charging power it replaces.`;
    return {
      rest() { path.style.strokeDashoffset = "0"; bestG.setAttribute("opacity", 1); dot.setAttribute("opacity", 0); readout.textContent = done; },
      play() {
        const dur = 3600 * speed, t0 = performance.now();
        bestG.setAttribute("opacity", 0); dot.setAttribute("opacity", 1);
        const frame = (t) => {
          const f = dur ? Math.min(1, (t - t0) / dur) : 1;
          path.style.strokeDashoffset = `${len * (1 - f)}`;
          const p = pts[Math.min(pts.length - 1, Math.floor(f * (pts.length - 1)))];
          dot.setAttribute("cx", x(p.mw)); dot.setAttribute("cy", y(p.sp));
          readout.textContent = `Trying ${p.mw} MWac · strike price ${rs(p.sp, 3)}/kWh · ${p.shortMwh ? `short ${Math.round(p.shortMwh).toLocaleString("en-IN")} MWh over the term` : "every day met"}`;
          if (f < 1) requestAnimationFrame(frame); else this.rest();
        };
        requestAnimationFrame(frame);
      },
    };
  }

  function surfaceChart(host) {
    const g = D.grid, nS = g.solar.length, nW = g.wind.length, W = 600, L = 50, R = 8, T = 6, B = 36, cw = (W - L - R) / nS, ch = 30, H = T + nW * ch + B;
    const e0 = D.win.inputs.essCrPerMwh, q0 = D.win.inputs.targetEquityIrr;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
    const cells = [];
    let lo = Infinity, hi = -Infinity, best = null;
    for (let si = 0; si < nS; si += 1) for (let wi = 0; wi < nW; wi += 1) { const ok = !physAt(si, wi).checks.includes("f"), sp = priceAt(si, wi, e0, q0); cells.push({ si, wi, ok, sp }); if (ok) { lo = Math.min(lo, sp); hi = Math.max(hi, sp); if (!best || sp < best.sp) best = cells[cells.length - 1]; } }
    const rects = cells.map((c) => {
      const t = c.ok ? Math.sqrt((c.sp - lo) / (hi - lo)) : 0;
      const r = el("rect", { x: L + c.si * cw + 1, y: T + (nW - 1 - c.wi) * ch + 1, width: cw - 2, height: ch - 2, rx: 2 }, svg);
      r.style.fill = c.ok ? `color-mix(in srgb, var(--heat) ${Math.round(t * 100)}%, var(--power))` : "var(--line-2)";
      r.style.opacity = c.ok ? 0.9 : 0.55;
      el("title", {}, r).textContent = `${g.solar[c.si]} MWac solar, ${g.wind[c.wi]} MW wind: ${rs(c.sp, 3)}/kWh${c.ok ? "" : ", breaks a tender condition"}`;
      return r;
    });
    const bx = L + best.si * cw, by = T + (nW - 1 - best.wi) * ch;
    const mark = el("g", {}, svg);
    el("rect", { x: bx - 1, y: by - 1, width: cw + 2, height: ch + 2, rx: 3, fill: "none", stroke: V("ink"), "stroke-width": 2.5 }, mark);
    const note = `Lowest: ${rs(best.sp)} at ${g.solar[best.si]} MWac, no wind`, nw = note.length * 6.6 + 16;
    el("rect", { x: bx + cw + 8, y: by - ch - 2, width: nw, height: 22, rx: 3, fill: V("panel"), stroke: V("ink"), "stroke-width": 1 }, mark);
    el("line", { x1: bx + cw, y1: by, x2: bx + cw + 8, y2: by - ch + 18, stroke: V("ink"), "stroke-width": 1 }, mark);
    txt(mark, bx + cw + 16, by - ch + 13, note, { fill: V("ink"), "font-weight": 700 });
    g.wind.forEach((w, wi) => txt(svg, L - 8, T + (nW - 1 - wi) * ch + ch / 2 + 4, `${w} MW`, { "text-anchor": "end" }));
    g.solar.forEach((sv, si) => { if (sv % 10 === 0) txt(svg, L + si * cw + cw / 2, H - B + 16, `${sv}`, { "text-anchor": "middle" }); });
    txt(svg, (L + W - R) / 2, H - 4, "Own solar, MWac", { "text-anchor": "middle" });
    host.replaceChildren(svg);
    return {
      rest() { rects.forEach((r) => { r.style.transition = "none"; r.style.visibility = ""; }); mark.setAttribute("opacity", 1); },
      play() { // the search: a coarse pass over the sizes, then the plants around the best
        mark.setAttribute("opacity", 0);
        rects.forEach((r) => { r.style.visibility = "hidden"; });
        const order = cells.map((c, k) => k).sort((a, b) => (cells[a].si % 2) - (cells[b].si % 2) || cells[a].wi - cells[b].wi || cells[a].si - cells[b].si);
        order.forEach((k, i) => setTimeout(() => { rects[k].style.visibility = ""; }, i * 30 * speed));
        setTimeout(() => mark.setAttribute("opacity", 1), order.length * 30 * speed + 150);
      },
    };
  }

  function mixChart(host) {
    const g = D.grid, nS = g.solar.length, W = 600, H = 170, L = 50, R = 8, T = 8, B = 30;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
    const rows = g.solar.map((sv, si) => physAt(si, 0)), max = Math.max(...rows.map((r) => r.own + r.market + r.group)) * 1.05;
    const x = (si) => L + (si / (nS - 1)) * (W - L - R), y = (v) => T + (1 - v / max) * (H - T - B);
    for (let v = 0; v <= max; v += 20) { el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }, svg); txt(svg, L - 8, y(v) + 4, `${v}`, { "text-anchor": "end" }); }
    const firstOk = rows.findIndex((r) => !r.checks.includes("f"));
    el("rect", { x: L, y: T, width: x(firstOk) - L, height: H - T - B, fill: V("heat"), opacity: 0.09 }, svg);
    txt(svg, L + 6, T + 14, "falls short", { fill: V("heat") });
    const areas = [];
    let acc = rows.map(() => 0);
    for (const [key, tone] of [["own", "evidence"], ["market", "violet"], ["group", "accent"]]) {
      const top = rows.map((r, k) => acc[k] + r[key]);
      areas.push(el("polygon", { points: [...top.map((v, k) => `${x(k)},${y(v)}`), ...acc.map((v, k) => `${x(k)},${y(v)}`).reverse()].join(" "), fill: V(tone), opacity: 0.85 }, svg));
      acc = top;
    }
    const bi = g.solar.indexOf(D.best);
    el("line", { x1: x(bi), x2: x(bi), y1: T, y2: H - B, stroke: V("ink"), "stroke-width": 1.6, "stroke-dasharray": "4 3" }, svg);
    txt(svg, x(bi) + 6, T + 14, "the optimum", { fill: V("ink"), "font-weight": 700 });
    g.solar.forEach((sv, si) => { if (sv % 10 === 0) txt(svg, x(si), H - B + 16, `${sv}`, { "text-anchor": si === 0 ? "start" : "middle" }); });
    host.replaceChildren(svg);
    return { rest() { areas.forEach((a2) => { a2.style.transition = "none"; a2.style.opacity = ""; }); }, play() { areas.forEach((a2, i) => { a2.style.transition = "none"; a2.style.opacity = 0; requestAnimationFrame(() => requestAnimationFrame(() => { a2.style.transition = `opacity .6s ease ${(600 + i * 450) * speed}ms`; a2.style.opacity = ""; })); }); } };
  }

  function dayChart(host) {
    const d = D.day, b = d.b, n = 96, W = 640, H = 300, L = 40, R = 44, T = 22, B = 30;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
    const maxMw = Math.max(...b.discharge, ...b.own.map((v, k) => v + b.bought[k])) * 1.08, bw = (W - L - R) / n;
    const y = (v) => T + (1 - v / maxMw) * (H - T - B), ys = (v) => T + (1 - v / 100) * (H - T - B), maxP = Math.max(...d.price), yp = (v) => T + (1 - v / (maxP * 1.05)) * (H - T - B);
    for (let v = 0; v <= maxMw; v += 25) { el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }, svg); txt(svg, L - 6, y(v) + 4, `${v}`, { "text-anchor": "end" }); }
    for (const v of [0, 50, 100]) txt(svg, W - R + 6, ys(v) + 4, `${v}%`);
    txt(svg, L - 6, T - 8, "MW", { "text-anchor": "end" }); txt(svg, W - R + 6, T - 8, "charge");
    for (let h = 0; h <= 24; h += 3) txt(svg, L + h * 4 * bw, H - B + 16, `${String(h).padStart(2, "0")}:00`, { "text-anchor": "middle" });
    const bars = [];
    for (let k = 0; k < n; k += 1) {
      const x0 = L + k * bw + 0.5, w = Math.max(1, bw - 1), own = b.own[k], bought = b.bought[k], dis = b.discharge[k];
      if (bought > 0.01) bars.push(el("rect", { x: x0, y: y(bought), width: w, height: y(0) - y(bought), fill: V("violet") }, svg));
      if (own > 0.01) bars.push(el("rect", { x: x0, y: y(own + bought), width: w, height: y(0) - y(own), fill: V("evidence") }, svg));
      if (dis > 0.01) bars.push(el("rect", { x: x0, y: y(dis), width: w, height: y(0) - y(dis), fill: V("accent") }, svg));
    }
    const price = el("polyline", { points: d.price.flatMap((p, h) => [`${L + h * 4 * bw},${yp(p)}`, `${L + (h + 1) * 4 * bw},${yp(p)}`]).join(" "), fill: "none", stroke: V("data"), "stroke-width": 1.6, "stroke-dasharray": "4 3" }, svg);
    const soc = el("polyline", { points: b.soc.map((v, k) => `${L + (k + 0.5) * bw},${ys(v)}`).join(" "), fill: "none", stroke: V("power"), "stroke-width": 2.4, "stroke-linejoin": "round" }, svg);
    const pk = d.price.indexOf(maxP);
    txt(svg, L + (pk + 0.5) * 4 * bw, yp(maxP) - 6, `${rs(maxP)}/kWh`, { "text-anchor": "middle", fill: V("data"), "font-weight": 600 });
    host.replaceChildren(svg);
    const all = [...bars, price, soc];
    return {
      rest() { all.forEach((x) => { x.style.transition = "none"; x.style.opacity = ""; }); },
      play() { all.forEach((x, i) => { x.style.transition = "none"; x.style.opacity = 0; requestAnimationFrame(() => requestAnimationFrame(() => { x.style.transition = `opacity .3s ease ${(i < bars.length ? i * 9 : bars.length * 9 + 200) * speed}ms`; x.style.opacity = ""; })); }); },
    };
  }

  function heatMap(canvas) {
    const g = canvas.getContext("2d"), s = D.heat, cw = canvas.width / 365, ch = canvas.height / 24;
    const col = (name) => getComputedStyle(root).getPropertyValue(`--${name}`).trim();
    const draw = (days) => {
      const up = col("evidence"), down = col("accent");
      g.clearRect(0, 0, canvas.width, canvas.height);
      for (let dI = 0; dI < days; dI += 1) for (let h = 0; h < 24; h += 1) {
        const v = s.charCodeAt(dI * 24 + h) - 106;
        if (!v) continue;
        g.globalAlpha = Math.min(1, 0.25 + Math.abs(v) / 6); g.fillStyle = v > 0 ? up : down;
        g.fillRect(dI * cw, h * ch, cw + 0.5, ch + 0.5);
      }
      g.globalAlpha = 1;
    };
    let shown = 365;
    document.addEventListener("tos-theme", () => draw(shown));
    return {
      rest() { shown = 365; draw(365); },
      play() { const t0 = performance.now(), dur = 2600 * speed; const f = (t) => { const p = dur ? Math.min(1, (t - t0) / dur) : 1; shown = Math.round(365 * p); draw(shown); if (p < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); },
    };
  }

  function cashChart(host) {
    const rows = D.rows, W = 640, H = 270, L = 40, R = 10, T = 14, B = 28;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
    const max = Math.max(...rows.map((r) => r.opex + r.debtService + r.tax + Math.max(0, r.fcfe)), ...rows.map((r) => r.revenue)) * 1.05, bw = (W - L - R) / rows.length;
    const y = (v) => T + (1 - v / max) * (H - T - B);
    for (let v = 0; v <= max; v += 20) { el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }, svg); txt(svg, L - 6, y(v) + 4, `${v}`, { "text-anchor": "end" }); }
    const bars = [];
    rows.forEach((r, k) => {
      let acc = 0;
      for (const [key, tone] of [["opex", "dim"], ["debtService", "data"], ["tax", "heat"], ["fcfe", "power"]]) {
        const v = Math.max(0, r[key]);
        if (v > 0.05) bars.push(el("rect", { x: L + k * bw + 3, y: y(acc + v), width: bw - 6, height: y(acc) - y(acc + v), fill: V(tone), rx: 1 }, svg));
        acc += v;
      }
      txt(svg, L + k * bw + bw / 2, H - B + 15, `${r.year}`, { "text-anchor": "middle" });
    });
    el("polyline", { points: rows.map((r, k) => `${L + k * bw + bw / 2},${y(r.revenue)}`).join(" "), fill: "none", stroke: V("ink"), "stroke-width": 1.5, "stroke-dasharray": "3 3" }, svg);
    txt(svg, W - R - 4, y(rows[rows.length - 2].revenue) - 6, "revenue", { "text-anchor": "end", fill: V("ink") });
    txt(svg, L + (rows.length * bw) / 2, H - 2, "Contract year (the last year releases working capital and reserves)", { "text-anchor": "middle" });
    host.replaceChildren(svg);
    return { rest() {}, play() { bars.forEach((b2, i) => { b2.style.opacity = 0; requestAnimationFrame(() => requestAnimationFrame(() => { b2.style.transition = `opacity .3s ease ${i * 14 * speed}ms`; b2.style.opacity = ""; })); }); } };
  }

  function driversChart(host) {
    const ds = D.drivers, W = 520, rowH = 28, L = 230, R = 64, T = 4, H = T + ds.length * rowH + 30;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
    const total = ds.reduce((a, d) => a + d.value, 0), x = (v) => L + (v / (total * 1.02)) * (W - L - R);
    let acc = 0;
    const bars = [];
    ds.forEach((d, k) => {
      const yy = T + k * rowH, a = Math.min(acc, acc + d.value), w = Math.max(2, Math.abs(x(acc + d.value) - x(acc)));
      txt(svg, L - 8, yy + 17, d.label.length > 34 ? `${d.label.slice(0, 33)}…` : d.label, { "text-anchor": "end" });
      bars.push(el("rect", { x: x(a), y: yy + 5, width: w, height: rowH - 10, fill: d.value < 0 ? V("heat") : k === 0 ? V("accent") : V("power"), opacity: k === 0 ? 1 : 0.8, rx: 2 }, svg));
      acc += d.value;
      txt(svg, x(Math.max(acc, acc - d.value)) + 6, yy + 17, `${d.value < 0 ? "−" : ""}${rs(Math.abs(d.value))}`, { fill: V("ink"), "font-weight": 600 });
    });
    el("line", { x1: L, x2: x(total), y1: H - 22, y2: H - 22, stroke: V("line-2") }, svg);
    txt(svg, x(total), H - 6, `= ${rs(total)}/kWh`, { "text-anchor": "end", fill: V("ink"), "font-weight": 700 });
    host.replaceChildren(svg);
    return { rest() {}, play() { bars.forEach((b2, i) => { b2.style.transformBox = "fill-box"; b2.style.transformOrigin = "left"; b2.style.transform = "scaleX(0)"; requestAnimationFrame(() => requestAnimationFrame(() => { b2.style.transition = `transform .45s ease ${i * 140 * speed}ms`; b2.style.transform = ""; })); }); } };
  }

  function tornadoChart(host) {
    const ls = D.levers.slice(0, 10), base = D.win.tariff, W = 600, rowH = 34, L = 222, R = 150, T = 26, H = T + ls.length * rowH + 4, lim = 0.16;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
    const mid = L + (W - L - R) / 2, x = (dv) => mid + (Math.max(-lim, Math.min(lim, dv)) / lim) * ((W - L - R) / 2);
    el("line", { x1: mid, x2: mid, y1: T - 6, y2: H - 4, class: "axis" }, svg);
    txt(svg, mid, 12, `${rs(base)} now`, { "text-anchor": "middle", fill: V("ink"), "font-weight": 600 });
    txt(svg, L, 12, "lower"); txt(svg, W - R, 12, "higher", { "text-anchor": "end" });
    txt(svg, W - R + 14, 12, "a step down · up", { "font-size": 10.5 });
    const bars = [];
    ls.forEach((l, k) => {
      const yy = T + k * rowH;
      txt(svg, L - 10, yy + 14, l.label.length > 32 ? `${l.label.slice(0, 31)}…` : l.label, { "text-anchor": "end", fill: V("ink"), "font-weight": 600 });
      txt(svg, L - 10, yy + 27, `now ${lv(l, l.value)}${l.pct ? "" : ` ${l.unit.replace(" per contracted MW", "/MW")}`.slice(0, 18)}, step ${lv(l, l.step)}`, { "text-anchor": "end", "font-size": 10 });
      [[l.down, 5], [l.up, 18]].forEach(([p, dy]) => {
        const dv = p - base;
        if (Math.abs(dv) < 5e-4) return;
        const x0 = Math.min(mid, x(dv)), w = Math.abs(x(dv) - mid);
        bars.push(el("rect", { x: x0, y: yy + dy, width: Math.max(1.5, w), height: 11, fill: dv < 0 ? V("power") : V("heat"), rx: 1.5 }, svg));
        if (Math.abs(dv) > lim) txt(svg, x0 + w - 4, yy + dy + 9.5, "▸", { "text-anchor": "end", fill: V("bg"), "font-size": 10 });
      });
      txt(svg, W - R + 14, yy + 20, `${rs(l.down, 3)} · ${rs(l.up, 3)}`, { fill: V("ink"), "font-size": 11.5, "font-family": "var(--mono)" });
    });
    host.replaceChildren(svg);
    return { rest() {}, play() { bars.forEach((b2, i) => { b2.style.opacity = 0; requestAnimationFrame(() => requestAnimationFrame(() => { b2.style.transition = `opacity .3s ease ${i * 45 * speed}ms`; b2.style.opacity = ""; })); }); } };
  }

  function poolChart(host) {
    const rows = D.pool, W = 640, H = 290, L = 60, R = 16, T = 14, B = 40;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
    const max = Math.max(...rows.map((r) => Math.abs(r.cr))) * 1.1, bw = (W - L - R) / rows.length, y = (v) => T + (1 - (v + max) / (2 * max)) * (H - T - B);
    for (const v of [-100, -50, 0, 50, 100]) { if (Math.abs(v) > max) continue; el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? "axis" : "grid" }, svg); txt(svg, L - 6, y(v) + 4, `${v > 0 ? "+" : ""}${v}`, { "text-anchor": "end" }); }
    const cy = y(D.tender.corpusCr);
    el("line", { x1: L, x2: W - R, y1: cy, y2: cy, stroke: V("gold"), "stroke-dasharray": "5 4", "stroke-width": 1.4 }, svg);
    txt(svg, L + 6, cy - 5, `the whole corpus, ₹${D.tender.corpusCr} crore`, { fill: V("gold") });
    txt(svg, W - R - 4, T + 12, "the Pool pays", { fill: V("bad"), "text-anchor": "end" }); txt(svg, L + 6, H - B - 6, "the Pool collects", { fill: V("good") });
    const bars = [];
    rows.forEach((r, i) => {
      const x0 = L + i * bw + 5, w = bw - 10, top = r.cr >= 0 ? y(r.cr) : y(0), h = Math.max(1.5, Math.abs(y(r.cr) - y(0)));
      bars.push(el("rect", { x: x0, y: top, width: w, height: h, rx: 2, fill: r.yours ? V("gold") : r.cr >= 0 ? V("bad") : V("good"), opacity: r.yours ? 1 : 0.78 }, svg));
      txt(svg, x0 + w / 2, H - B + 16, rs(r.sp, r.yours ? 2 : 1), { "text-anchor": "middle", "font-weight": r.yours ? 700 : 400, fill: r.yours ? V("ink") : V("dim") });
      if (r.yours) txt(svg, x0 + w / 2, y(0) - 10, "this bid", { "text-anchor": "middle", fill: V("ink"), "font-weight": 700 });
    });
    txt(svg, (L + W - R) / 2, H - 4, "Strike price, ₹/kWh", { "text-anchor": "middle" });
    host.replaceChildren(svg);
    return { rest() {}, play() { bars.forEach((b2, i) => { b2.style.opacity = 0; requestAnimationFrame(() => requestAnimationFrame(() => { b2.style.transition = `opacity .35s ease ${i * 80 * speed}ms`; b2.style.opacity = ""; })); }); } };
  }

  function compsChart(host, which) {
    const cs = D.comps, ev = D.evening, bids = [["This bid", D.review.winning.tariff, "power"], ["The over-built bid", D.review.overbuilt.tariff, "bad"]];
    const rows = [...cs.map((c) => ({ label: c.code, sub: c.buys, lo: c.lo, hi: c.hi, tone: "dim" })), { label: "Evening market, all hours", sub: "IEX price year, 18:00–24:00", lo: ev.all, hi: ev.all, tone: "data" }, { label: "Evening market, 2 dearest hours", sub: "what the CfD plant sells into", lo: ev.chosen, hi: ev.chosen, tone: "data" }, ...bids.map(([label, v, tone], k) => ({ label, sub: k === 0 ? "competitive inputs, 100 MW" : "150 MW, battery over-built", lo: v, hi: v, tone, bid: k === 0 ? "winning" : "overbuilt" }))];
    const W = 600, rowH = 30, L = 208, R = 62, T = 8, H = T + rows.length * rowH + 22, lo = 2.5, hi = 9.2;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
    const x = (v) => L + ((Math.min(v, hi) - lo) / (hi - lo)) * (W - L - R);
    for (let v = 3; v <= 9; v += 1) { el("line", { x1: x(v), x2: x(v), y1: T, y2: H - 20, class: "grid" }, svg); txt(svg, x(v), H - 6, `₹${v}`, { "text-anchor": "middle" }); }
    rows.forEach((r, k) => {
      const yy = T + k * rowH + rowH / 2, on = !r.bid || r.bid === which, off = r.lo > hi;
      const g = el("g", { opacity: on ? 1 : 0.3 }, svg);
      txt(g, L - 10, yy - 1, r.label, { "text-anchor": "end", fill: V("ink"), "font-weight": r.bid ? 700 : 600, "font-size": 11.5 });
      txt(g, L - 10, yy + 11, r.sub, { "text-anchor": "end", "font-size": 9.5 });
      if (r.hi > r.lo) el("line", { x1: x(r.lo) - 3, x2: x(r.hi) + 3, y1: yy, y2: yy, stroke: V(r.tone), "stroke-width": 10, "stroke-linecap": "round" }, g);
      else if (off) el("path", { d: `M${x(hi) - 4} ${yy - 6} l10 6 l-10 6 z`, fill: V(r.tone) }, g);
      else el("circle", { cx: x(r.lo), cy: yy, r: r.bid ? 7 : 5.5, fill: V(r.tone), stroke: V("panel"), "stroke-width": 2 }, g);
      txt(g, (off ? x(hi) : x(r.hi)) + 12, yy + 4, r.hi > r.lo ? `${nf(r.lo)}–${nf(r.hi)}` : rs(r.lo), { fill: V("ink"), "font-weight": 600, "font-size": 11 });
    });
    host.replaceChildren(svg);
  }

  // ---- screens: `rest` puts a screen in its finished state, `script` drives it with the cursor
  const S = {};
  const charts = {};

  S.upload = {
    rest(p) { $$(".file", p).forEach((f) => f.classList.add("in", "known")); $("#dropzone").classList.remove("over"); const c = $("#read-count"); c.textContent = c.dataset.total; $$(".extract b", p).forEach((b) => { b.textContent = b.dataset.n; }); },
    async script(t, p) {
      const files = $$(".file", p), dz = $("#dropzone"), count = $("#read-count");
      files.forEach((f) => f.classList.remove("in", "known")); count.textContent = "0"; $$(".extract b", p).forEach((b) => { b.textContent = "0"; });
      place(40, 40, 0); await wait(200, t);
      cursor.classList.add("down"); dz.classList.add("over");
      await moveTo(t, dz, { fx: 0.45, fy: 0.4, dur: 900 });
      cursor.classList.remove("down");
      for (const f of files) { f.classList.add("in"); await wait(150, t); }
      dz.classList.remove("over");
      await wait(400, t);
      countTo(count, +count.dataset.total, 2400);
      for (const f of files) { f.classList.add("known"); await wait(330, t); }
      for (const b of $$(".extract b", p)) { countTo(b, +b.dataset.n, 700); await wait(420, t); }
      await wait(900, t);
    },
  };

  const pickEv = (id) => { const e = D.ev.find((x) => x.id === id); if (!e) return; $$("#ev-list button").forEach((b) => b.classList.toggle("on", b.dataset.ev === id)); setPage($("#ev-page"), D.marks[`ev-${id}`], `${e.doc} · ${e.clause} · page ${e.page}`); };
  S.read = {
    init() { $$("#ev-list button").forEach((b) => b.addEventListener("click", () => pickEv(b.dataset.ev))); },
    rest() { pickEv(D.ev[0].id); },
    async script(t) { await wait(1800, t); for (const id of ["ceiling", "emd", "corpusCap"]) { await click(t, `#ev-list button[data-ev="${id}"]`, { fx: 0.3 }); await wait(2300, t); } },
  };

  const am = { amd: 3, id: "a3-rfs-40.3" };
  const pickChange = (id) => {
    const c = D.changes.find((x) => x.id === id);
    if (!c) return;
    am.id = id; am.amd = c.amd;
    $$("#am-line button").forEach((b) => b.classList.toggle("on", +b.dataset.amd === c.amd));
    $$("#am-net button").forEach((b) => b.classList.toggle("on", b.dataset.change === id));
    $("#am-list").innerHTML = D.changes.filter((x) => x.amd === c.amd).map((x) => `<li><button type="button" data-change="${x.id}" class="${x.id === id ? "on" : ""}"><span>${esc(x.topic)}</span><small>${esc(x.document)} ${esc(x.clause.replace(/ \(.*\)/, ""))}</small></button></li>`).join("");
    $("#am-list .on")?.scrollIntoView({ block: "nearest" });
    $("#am-body").innerHTML = `<h5>${esc(c.topic)}</h5><div class="am-meta"><span class="cite">${esc(c.amdTitle)} · ${esc(c.document)} ${esc(c.clause)} · p.${c.page}</span><span class="am-count">${c.isNew ? "new clause" : `<b class="minus">−${c.removed}</b> words · <b class="plus">+${c.added}</b> words`}</span></div><p class="diff">${c.diff}</p><p class="am-effect"><span>What it does to the bid</span>${esc(c.effect)}</p>`;
    $("#am-body").scrollTop = 0;
    setPage($("#am-page"), D.marks[id], `${c.amdTitle} · page ${c.page}`);
  };
  S.amend = {
    init() {
      $("#am-net").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) pickChange(b.dataset.change); });
      $("#am-list").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) pickChange(b.dataset.change); });
      $$("#am-line button").forEach((b) => b.addEventListener("click", () => pickChange(D.changes.find((x) => x.amd === +b.dataset.amd).id)));
    },
    rest() { pickChange("a3-rfs-40.3"); },
    async script(t) {
      await wait(2600, t);
      await click(t, '#am-net button[data-change="a2-rfs-4.3"]'); await wait(2800, t);
      await click(t, '#am-line button[data-amd="4"]', { fx: 0.4 }); await wait(1500, t);
      await click(t, '#am-list button[data-change="a4-rfs-42.2.b"]', { fx: 0.4 }); await wait(3000, t);
      await click(t, '#am-net button[data-change="a3-rfs-9.3.a.iv"]'); await wait(2600, t);
    },
  };

  const pickCond = (bid) => { $$("#cond-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.bid === bid)); $("#cond-list").innerHTML = D.checks[bid].map((c, k) => `<li class="${c.status}" style="animation-delay:${k * 60}ms"><span class="st">${c.status === "met" ? "Met" : c.status === "failed" ? "Failed" : "Watch"}</span><b>${esc(c.label)}</b><span class="d">${esc(c.detail.length > 150 ? `${c.detail.slice(0, 148)}…` : c.detail)}</span></li>`).join(""); };
  S.conditions = {
    init() { $$("#cond-toggle button").forEach((b) => b.addEventListener("click", () => pickCond(b.dataset.bid))); },
    rest() { pickCond("win"); },
    async script(t) { await wait(2200, t); await click(t, '#cond-toggle button[data-bid="over"]'); await wait(3200, t); await click(t, '#cond-toggle button[data-bid="win"]'); await wait(1200, t); },
  };

  S.team = {
    init(p) { $("#team-fill").addEventListener("click", () => $$(".tin", p).forEach((r, k) => setTimeout(() => r.classList.add("filled"), k * 90 * speed))); $("#team-fillin").addEventListener("click", () => $('.tin[data-k="essCrPerMwh"]', p).classList.add("has-clip")); },
    rest(p) { $$(".tin", p).forEach((r) => r.classList.add("filled")); $$(".msg", p).forEach((m) => m.classList.add("in")); const r = $('.tin[data-k="essCrPerMwh"]', p); r.classList.add("has-clip", "signed"); r.classList.remove("amber", "focus"); $(".tv", r).textContent = $(".tv", r).dataset.v; },
    async script(t, p) {
      const row = $('.tin[data-k="essCrPerMwh"]', p), tv = $(".tv", row), msgs = $$(".msg", p);
      $$(".tin", p).forEach((r) => r.classList.remove("filled", "has-clip", "signed", "amber", "focus")); msgs.forEach((m) => m.classList.remove("in"));
      await wait(700, t);
      await click(t, "#team-fill"); await wait(1500, t);
      await moveTo(t, row, { fx: 0.7 }); row.classList.add("focus"); await wait(500, t);
      msgs[0].classList.add("in"); await wait(1900, t);
      msgs[1].classList.add("in"); await wait(1500, t);
      await click(t, "#team-fillin"); await wait(900, t);
      msgs[2].classList.add("in"); row.classList.add("signed"); await wait(1900, t);
      msgs[3].classList.add("in"); tv.textContent = "₹0.82 cr/MWh"; row.classList.remove("signed"); row.classList.add("amber"); await wait(2600, t);
      tv.textContent = tv.dataset.v; row.classList.remove("amber", "focus"); row.classList.add("signed"); await wait(500, t);
    },
  };

  // ---- the design studio: every plant size is a simulated point, cost and return are interpolated
  const sd = { s: 10, w: 0, e: 0.85, q: 0.13, iso: "", saved: [], scripted: false };
  const G = () => D.grid;
  const bracket = (arr, v) => { let k = 0; while (k < arr.length - 2 && v > arr[k + 1]) k += 1; return [k, Math.max(0, Math.min(1, (v - arr[k]) / (arr[k + 1] - arr[k])))]; };
  const priceAt = (si, wi, e, q) => {
    const g = G(), [ei, ef] = bracket(g.ess, e), [qi, qf] = bracket(g.irr, q), base = (si * g.wind.length + wi) * g.ess.length;
    const p = (a, b) => g.sp[(base + a) * g.irr.length + b];
    return (1 - ef) * ((1 - qf) * p(ei, qi) + qf * p(ei, qi + 1)) + ef * ((1 - qf) * p(ei + 1, qi) + qf * p(ei + 1, qi + 1));
  };
  const capexAt = (si, wi, e) => { const g = G(), [ei, ef] = bracket(g.ess, e), base = (si * g.wind.length + wi) * g.ess.length; return (1 - ef) * g.capex[base + ei] + ef * g.capex[base + ei + 1]; };
  const physAt = (si, wi) => G().phys[si * G().wind.length + wi];
  function studio() {
    const g = G(), si = g.solar.indexOf(sd.s), wi = g.wind.indexOf(sd.w), ph = physAt(si, wi), sp = priceAt(si, wi, sd.e, sd.q), failed = ph.checks.includes("f");
    $("#sd-solar-v").textContent = `${sd.s} MWac`; $("#sd-wind-v").textContent = `${sd.w} MW`; $("#sd-ess-v").textContent = `${rs(sd.e)} cr/MWh`; $("#sd-irr-v").textContent = `${(sd.q * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
    $("#sd-sp").textContent = rs(sp);
    const gap = sp - D.evening.chosen, price = $(".sd-price");
    price.classList.toggle("bad", failed); price.classList.toggle("up", !failed && sp > D.win.tariff + 0.02);
    $("#sd-vs").textContent = failed ? "this plant breaks the tender's conditions" : Math.abs(gap) < 0.05 ? `at the evening market (${rs(D.evening.chosen)}): the Pool is about neutral` : gap > 0 ? `${rs(gap)} above the evening market: the Pool pays` : `${rs(-gap)} below the evening market: the Pool collects`;
    $("#sd-capex").textContent = `₹${Math.round(capexAt(si, wi, sd.e)).toLocaleString("en-IN")} cr`;
    const sh = $("#sd-short"); sh.textContent = ph.shortDays.toLocaleString("en-IN"); sh.classList.toggle("bad", ph.shortDays > 0);
    const ownLabel = sd.s && sd.w ? "Own solar and wind, into the battery" : sd.w ? "Own wind, into the battery" : "Own solar, into the battery";
    const parts = [["own", ownLabel, sd.s || sd.w ? ph.own : 0], ["wind", "Own wind, supplied directly", sd.w ? ph.windDirect : 0], ["market", "Green market, into the battery", ph.market], ["group", "Group RE, into the battery", ph.group]], tot = parts.reduce((a, x) => a + x[2], 0) || 1;
    $("#sd-mix").innerHTML = parts.map(([c, , v]) => `<i class="${c}" style="width:${(v / tot) * 100}%"></i>`).join("");
    let key = $(".mix-key", $("#sd-mix").parentNode);
    if (!key) { key = document.createElement("div"); key.className = "mix-key"; $("#sd-mix").after(key); }
    const tone = { own: "evidence", wind: "data", market: "violet", group: "accent" };
    key.innerHTML = parts.filter((x) => x[2] > 0.05).map(([c, l, v]) => `<span><i style="background:var(--${tone[c]})"></i>${l} ${nf(v, 0)} GWh a year</span>`).join("");
    $$("#sd-checks li").forEach((li, k) => { const c = ph.checks[k]; li.className = c === "f" ? "failed" : c === "i" ? "info" : "met"; li.title = `${g.checks[k].label}: ${ph.detail[k]}`; });
    const isoKey = `${sd.s}|${sd.w}`;
    if (sd.iso !== isoKey && window.TOSIso) { sd.iso = isoKey; $("#sd-iso").innerHTML = window.TOSIso.plant({ kind: "cfd", solarMw: sd.s, windMw: sd.w, bessMwh: 200, reserve: { solarMw: 40, windMw: 20 }, text: { title: `Plant with ${sd.s} MWac of solar and ${sd.w} MW of wind`, bessSub: "100 MW / 200 MWh" } }); }
    return sp;
  }
  const setSd = (patch) => { Object.assign(sd, patch); $("#sd-solar").value = sd.s; $("#sd-wind").value = sd.w; $("#sd-ess").value = sd.e; $("#sd-irr").value = sd.q * 100; return studio(); };
  const saveScenario = (name, sp, s = sd.s, w = sd.w) => {
    sd.saved.push({ name, s, w, sp }); if (sd.saved.length > 6) sd.saved.shift();
    const box = $("#sd-saved"); box.hidden = false;
    $("tbody", box).innerHTML = sd.saved.map((x, k) => `<tr class="${k === sd.saved.length - 1 ? "new" : ""}"><td>${esc(x.name)}</td><td class="num">${x.s}</td><td class="num">${x.w}</td><td class="num">${nf(x.sp, 3)}</td><td class="num">${x.sp - D.win.tariff >= 0 ? "+" : "−"}${Math.abs(x.sp - D.win.tariff).toFixed(3)}</td></tr>`).join("");
  };
  S.studio = {
    init() {
      $("#sd-solar").addEventListener("input", (e) => { sd.s = +e.target.value; studio(); }); $("#sd-wind").addEventListener("input", (e) => { sd.w = +e.target.value; studio(); });
      $("#sd-ess").addEventListener("input", (e) => { sd.e = +e.target.value; studio(); }); $("#sd-irr").addEventListener("input", (e) => { sd.q = +e.target.value / 100; studio(); });
      $("#sd-opt").addEventListener("click", () => {
        const g = G(), wi = g.wind.indexOf(sd.w);
        let bestS = null, bestP = Infinity;
        g.solar.forEach((s, si) => { if (physAt(si, wi).checks.includes("f")) return; const p = priceAt(si, wi, sd.e, sd.q); if (p < bestP) { bestP = p; bestS = s; } });
        if (bestS == null) return;
        const stepTo = () => { if (sd.s === bestS) return; setSd({ s: sd.s + (bestS > sd.s ? 2 : -2) }); setTimeout(stepTo, 70 * speed); };
        stepTo();
      });
      $("#sd-save").addEventListener("click", () => saveScenario(`${sd.s} MWac${sd.w ? ` + ${sd.w} MW wind` : ""} · ${rs(sd.e)} · ${+(sd.q * 100).toFixed(2)}%`, studio()));
    },
    rest() { setSd({ s: D.best, w: 0, e: D.win.inputs.essCrPerMwh, q: D.win.inputs.targetEquityIrr }); },
    async script(t) {
      await wait(1200, t);
      await drag(t, "#sd-solar", 32, 1700); await wait(1100, t);
      await drag(t, "#sd-solar", 4, 1700); await wait(1700, t);
      await click(t, "#sd-opt"); await wait(1500, t);
      await drag(t, "#sd-wind", 10, 900); await wait(1700, t);
      await drag(t, "#sd-wind", 0, 700); await wait(500, t);
      await drag(t, "#sd-ess", 0.72, 1300); await wait(1200, t);
      await drag(t, "#sd-irr", 12, 900); await wait(1200, t);
      if (!sd.scripted) { sd.scripted = true; await click(t, "#sd-save"); }
      await wait(1400, t);
    },
  };

  S.size = {
    init() { charts.scan = scanChart($("#chart-scan")); charts.surface = surfaceChart($("#chart-surface")); charts.mix = mixChart($("#chart-mix")); },
    rest() { charts.scan.rest(); charts.surface.rest(); charts.mix.rest(); },
    async script(t) { charts.scan.play(); charts.surface.play(); charts.mix.play(); await moveTo(t, "#chart-scan", { fx: 0.2, fy: 0.3 }); await moveTo(t, "#chart-scan", { fx: 0.28, fy: 0.72, dur: 2400 }); await wait(1200, t); await moveTo(t, "#chart-surface", { fx: 0.3, fy: 0.75, dur: 1100 }); await wait(2600, t); await moveTo(t, "#chart-mix", { fx: 0.3, fy: 0.5, dur: 900 }); await wait(2200, t); },
  };
  S.dispatch = {
    init() { charts.day = dayChart($("#chart-day")); charts.heat = heatMap($("#heat")); },
    rest() { charts.day.rest(); charts.heat.rest(); },
    async script(t) { charts.day.play(); await wait(1600, t); charts.heat.play(); await moveTo(t, "#heat", { fx: 0.2, fy: 0.3 }); await moveTo(t, "#heat", { fx: 0.85, fy: 0.8, dur: 2600 }); await wait(1800, t); },
  };
  S.finance = {
    init(p) { charts.cash = cashChart($("#chart-cash")); charts.drivers = driversChart($("#chart-drivers")); $("#fin-sp").addEventListener("click", () => { const tr = $("#fin-trace"); tr.hidden = !tr.hidden; $("#fin-sp").classList.toggle("traced", !tr.hidden); }); $("#fin-sp").style.cursor = "pointer"; void p; },
    rest(p) { $("#fin-trace").hidden = true; $("#fin-sp").classList.remove("traced"); $$("[data-count]", p).forEach((b) => { b.textContent = `${b.dataset.pre || ""}${Number(b.dataset.count).toLocaleString("en-IN", { minimumFractionDigits: +b.dataset.dec, maximumFractionDigits: +b.dataset.dec })}${b.dataset.suf || ""}`; }); },
    async script(t, p) {
      $$("[data-count]", p).forEach((b) => countTo(b, +b.dataset.count, 1100, (v) => `${b.dataset.pre || ""}${v.toLocaleString("en-IN", { minimumFractionDigits: +b.dataset.dec, maximumFractionDigits: +b.dataset.dec })}${b.dataset.suf || ""}`));
      charts.cash.play(); await wait(1500, t); charts.drivers.play(); await wait(2600, t);
      await click(t, "#fin-sp", { fx: 0.6 }); await wait(3400, t);
    },
  };

  const wi = { t: "8.00", rej: [] };
  const planKey = (t, rej) => `${t}|${[...rej].sort().join(",")}`;
  function whatIf() {
    const plan = D.tracks.plans[planKey(wi.t, wi.rej)];
    $$("#wi-targets button").forEach((b) => b.classList.toggle("on", b.dataset.t === wi.t));
    const track = $("#wi-track"), out = $("#wi-out"), rejBox = $("#wi-rej");
    rejBox.hidden = !wi.rej.length;
    rejBox.innerHTML = wi.rej.length ? `Turned down: ${wi.rej.map((k) => `<button type="button" data-restore="${k}" title="Allow again">${esc((D.levers.find((l) => l.key === k) || { label: k }).label)} ×</button>`).join("")}` : "";
    if (!plan) { track.innerHTML = ""; out.innerHTML = "The application keeps searching beyond two levers turned down.<small>Ask for a walkthrough to see it on your bid.</small>"; return; }
    const SHOWN = 6;
    track.innerHTML = plan.steps.slice(0, SHOWN).map((s, k) => {
      const can = wi.rej.length < D.tracks.depth && k < D.tracks.fan && D.tracks.plans[planKey(wi.t, [...wi.rej, s.key])];
      return `<li style="animation-delay:${k * 80}ms"><span class="mv">${esc(s.label)} <small>${lv(s, s.from)} → ${lv(s, s.to)}${s.pct ? "" : ` ${esc(s.unit.replace(" per contracted MW", "/MW"))}`}</small></span><span class="pr">${rs(s.price, 3)}</span><span class="why">${esc(s.who)}</span><span class="ch ${s.p >= 0.999 ? "easy" : s.p >= 0.5 ? "neg" : "hard"}">${s.p >= 0.999 ? "within usual range" : s.p >= 0.5 ? "needs negotiation" : "a stretch"}</span>${can ? `<button type="button" class="rej" data-reject="${s.key}">Not for us</button>` : ""}</li>`;
    }).join("") + (plan.steps.length > SHOWN ? `<li class="more" style="animation-delay:${SHOWN * 80}ms"><span class="mv">${plan.steps.length - SHOWN} smaller moves follow <small>${plan.steps.slice(SHOWN, SHOWN + 4).map((x) => esc(x.label)).join(", ")}…</small></span><span class="pr">${rs(plan.final, 3)}</span></li>` : "");
    const hard = plan.steps.filter((x) => x.p < 0.999).length;
    out.innerHTML = plan.reached ? `From ${rs(D.win.tariff)} to ${rs(plan.final, 3)} in ${plan.steps.length} move${plan.steps.length === 1 ? "" : "s"}, each priced by a real run of the model.<small>${hard ? `${hard} of them ${hard === 1 ? "needs" : "need"} negotiation or ${hard === 1 ? "is" : "are"} a stretch against the model's benchmark ranges.` : "Every move sits inside the range a bidder can usually reach."} This is what the price would be if the moves are achieved: each one still needs its evidence (a binding offer, a term sheet, an approval) before it is frozen into the bid.</small>` : `Out of reach: with every lever at its limit the price is ${rs(plan.floor ?? plan.final, 3)}.`;
  }
  S.whatif = {
    init() {
      charts.tornado = tornadoChart($("#chart-tornado"));
      $$("#wi-targets button").forEach((b) => b.addEventListener("click", () => { wi.t = b.dataset.t; wi.rej = []; whatIf(); }));
      $("#wi-track").addEventListener("click", (e) => { const b = e.target.closest("[data-reject]"); if (b) { wi.rej.push(b.dataset.reject); whatIf(); } });
      $("#wi-rej").addEventListener("click", (e) => { const b = e.target.closest("[data-restore]"); if (b) { wi.rej = wi.rej.filter((k) => k !== b.dataset.restore); whatIf(); } });
      $("#wi-save").addEventListener("click", (e) => { const plan = D.tracks.plans[planKey(wi.t, wi.rej)]; if (!plan) return; saveScenario(`What-if to ₹${wi.t}${wi.rej.length ? `, ${wi.rej.length} turned down` : ""}`, plan.final, D.best, 0); const b = e.currentTarget, old = b.innerHTML; b.textContent = "Saved to scenarios ✓"; setTimeout(() => { b.innerHTML = old; }, 1800); });
    },
    rest() { wi.t = D.tracks.targets[0].toFixed(2); wi.rej = []; whatIf(); },
    async script(t) {
      charts.tornado.play(); await wait(2600, t);
      await click(t, '#wi-targets button[data-t="7.50"]'); await wait(3000, t);
      await click(t, "#wi-track .rej"); await wait(3400, t);
      await click(t, "#wi-save"); await wait(1500, t);
    },
  };

  S.wins = { init() { charts.pool = poolChart($("#chart-pool")); }, rest() {}, async script(t) { charts.pool.play(); await wait(4800, t); } };

  const pickReview = (bid) => {
    const r = D.review[bid], shown = r.findings.slice(0, 9);
    $$("#rv-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.bid === bid));
    $("#rv-sum").textContent = r.summary;
    $("#rv-list").innerHTML = shown.map((f, k) => `<li class="${f.severity}" style="animation-delay:${k * 55}ms" title="${esc(f.detail)}"><span>${f.severity === "block" ? "Blocks" : f.severity === "warn" ? "Cost" : "Note"}</span>${esc(f.title)}</li>`).join("") + (r.findings.length > shown.length ? `<li class="note"><span>+${r.findings.length - shown.length}</span>more findings in the application</li>` : "");
    compsChart($("#chart-comps"), bid);
  };
  S.review = {
    init() { $$("#rv-toggle button").forEach((b) => b.addEventListener("click", () => pickReview(b.dataset.bid))); },
    rest() { pickReview("winning"); },
    async script(t) { await wait(2600, t); await click(t, '#rv-toggle button[data-bid="overbuilt"]'); await wait(4200, t); await click(t, '#rv-toggle button[data-bid="winning"]'); await wait(1400, t); },
  };
  S.pack = { rest() {}, async script(t, p) { $$(".pack li", p).forEach((li, k) => { li.style.animationDelay = `${k * 120}ms`; }); await wait(3200, t); } };

  // ---- the player: the cursor, the captions and the voice-over
  // what a visitor watched goes to the site's visit analytics (src/track.js); nothing if that is off
  const track = (name, data, once) => window.TOSTrack?.(name, data, once);
  const routeName = () => (route ? "90-second overview" : "full tour");
  const audio = new Audio();
  audio.preload = "auto";
  const voiceBtn = $("#sim-voice"), capBox = $("#sim-caption"), capText = $("#sim-caption-text");
  let voice = false, voiceChosen = false, wantVoice = false;
  const hasVoice = () => Object.values(D.narration || {}).some((n) => n.src);
  const setVoice = (on) => { voice = Boolean(on) && hasVoice(); voiceBtn.setAttribute("aria-pressed", String(voice)); voiceBtn.classList.toggle("on", voice); voiceBtn.classList.remove("nudge"); voiceBtn.title = voice ? "Turn the voice-over off" : "Turn the voice-over on"; if (!voice) audio.pause(); };
  // one screen's narration: resolves when the clip ends, fails to start, or the screen is left
  const speak = (id, t) => new Promise((res) => {
    const n = D.narration?.[id];
    if (!voice || !n?.src) { res(); return; }
    const done = () => { audio.onended = null; audio.onerror = null; res(); };
    audio.onended = done; audio.onerror = done;
    t.stop = () => { audio.pause(); done(); };
    audio.src = n.src;
    audio.play().then(() => track("Voice-over heard", { route: routeName() }, true)).catch(() => { setVoice(false); voiceBtn.classList.add("nudge"); done(); }); // the browser wants a click first
  });
  const setPlayLabel = () => { playBtn.textContent = playing ? "❚❚ Pause" : started ? "▶ Resume tour" : hasVoice() ? "▶ Play with voice" : "▶ Play tour"; playBtn.setAttribute("aria-label", playing ? "Pause the tour" : "Play the tour"); };
  const kill = () => { if (tok) { tok.dead = true; tok.stop?.(); } tok = null; audio.pause(); cursor.classList.remove("on", "down", "click"); bar.style.transition = "none"; bar.style.width = `${(cur / (panels.length - 1)) * 100}%`; };
  function show(k, auto) {
    kill();
    cur = (k + panels.length) % panels.length;
    const id = idOf(cur), p = panels[cur], n = D.narration?.[id];
    railTabs.forEach((b, i) => { b.setAttribute("aria-selected", String(i === cur)); b.classList.toggle("done", i < cur); b.tabIndex = i === cur ? 0 : -1; });
    rail.scrollTo({ left: railTabs[cur].offsetLeft - rail.clientWidth / 2 + railTabs[cur].clientWidth / 2, behavior: reduce ? "auto" : "smooth" });
    panels.forEach((x, i) => { x.hidden = i !== cur; x.classList.remove("play", "staged"); });
    title.textContent = `TenderOS · SECI CfD-I · ${$(".t", railTabs[cur]).textContent}`;
    bar.style.width = `${(cur / (panels.length - 1)) * 100}%`;
    S[id]?.rest?.(p);
    if (auto || sim.dataset.ready) track("Tour screen", { screen: id }, true);
    void p.offsetWidth; p.classList.add("play");
    capBox.hidden = !auto || !n;
    if (!auto) return;
    if (n) capText.textContent = n.text;
    capBox.classList.toggle("spoken", voice);
    p.classList.add("staged");
    const mine = { dead: false }; tok = mine;
    (async () => {
      try {
        const t0 = performance.now(), said = speak(id, mine);
        await wait(450, mine);
        await (S[id]?.script || (async (t) => wait(3000, t)))(mine, p);
        await said;
        if (mine.dead) throw CANCEL;
        // without the voice, leave time to read the caption
        if (!voice && n && !reduce) await new Promise((res, rej) => setTimeout(() => (mine.dead ? rej(CANCEL) : res()), Math.max(0, n.seconds * 620 - (performance.now() - t0))));
        await wait(voice ? 500 : 1300, mine);
        cursor.classList.remove("on");
        if (after(cur) < 0) { playing = false; setPlayLabel(); p.classList.remove("staged"); capBox.hidden = true; track("Tour finished", { route: routeName() }, true); } else show(after(cur), true);
      } catch (e) { if (e !== CANCEL) throw e; }
    })();
  }
  const pause = (byUser) => { if (!playing && !tok) return; playing = false; hold = false; sim.classList.remove("held"); kill(); panels[cur].classList.remove("staged"); S[idOf(cur)]?.rest?.(panels[cur]); setPlayLabel(); modeTag.hidden = !byUser; capBox.hidden = true; };
  const play = (withVoice) => { if (withVoice && !voiceChosen) setVoice(true); track("Tour started", { route: routeName() }, true); started = true; playing = true; modeTag.hidden = true; setPlayLabel(); show(after(cur) < 0 || !onRoute(cur) ? first() : cur, true); };

  // the landing page's first drawing: the tenders on the market, one after another
  function heroRotator() {
    const list = D.market?.hero || [], draw = $("#hero-draw"), cap = $("#hero-cap"), dots = $$("#hero-dots button");
    if (list.length < 2 || !draw || !window.TOSIso) return;
    let k = 0, timer = null, seen = true;
    const go = (i) => {
      k = (i + list.length) % list.length;
      draw.classList.add("swap");
      setTimeout(() => { draw.innerHTML = window.TOSIso.forTender(list[k]); cap.innerHTML = list[k].cap; draw.classList.remove("swap"); dots.forEach((d, j) => d.setAttribute("aria-selected", String(j === k))); }, reduce ? 0 : 260);
    };
    const arm = () => { clearInterval(timer); if (!reduce) timer = setInterval(() => { if (seen && !document.hidden) go(k + 1); }, 6500); };
    dots.forEach((d, j) => d.addEventListener("click", () => { go(j); arm(); }));
    if ("IntersectionObserver" in window) new IntersectionObserver((es) => { seen = es[es.length - 1].isIntersecting; }, { threshold: 0.2 }).observe(draw);
    arm();
  }

  fetch("/data/demo.json").then((r) => r.json()).then((data) => {
    D = data;
    panels.forEach((p, k) => S[idOf(k)]?.init?.(p));
    panels.forEach((p, k) => S[idOf(k)]?.rest?.(p));
    show(0, false);
    setPlayLabel();
    voiceBtn.hidden = !hasVoice();
    heroRotator();
    playBtn.addEventListener("click", () => (playing ? pause(false) : play(true)));
    document.querySelectorAll("#tour-routes button").forEach((b) => b.addEventListener("click", () => {
      route = b.dataset.route === "short" ? SHORT : null;
      document.querySelectorAll("#tour-routes button").forEach((x) => x.classList.toggle("on", x === b));
      railTabs.forEach((t, k) => t.classList.toggle("off-route", !onRoute(k)));
      if (playing) pause(false);
      cur = first(); play(true);
    }));
    // the demo request: no server behind this page, so it opens the visitor's own mail with the answers
    const form = document.getElementById("demo-form");
    if (form) form.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(form), line = (k, label) => (f.get(k) ? `${label}: ${f.get(k)}\n` : "");
      const body = `${line("name", "Name")}${line("company", "Company")}${line("email", "Work email")}${line("phone", "Phone")}${line("role", "Role")}${line("tender", "Tender type or reference")}${line("when", "Preferred time")}\n${f.get("goal") || ""}`;
      window.location.href = `mailto:${form.dataset.to}?subject=${encodeURIComponent(`TenderOS demo request${f.get("company") ? `: ${f.get("company")}` : ""}`)}&body=${encodeURIComponent(body)}`;
      document.getElementById("demo-sent").hidden = false;
    });
    voiceBtn.addEventListener("click", () => { voiceChosen = true; setVoice(!voice); if (playing) show(cur, true); });
    $("#sim-prev").addEventListener("click", () => { pause(true); show(cur - 1, false); });
    $("#sim-next").addEventListener("click", () => { pause(true); show(cur + 1, false); });
    railTabs.forEach((b, k) => b.addEventListener("click", () => { pause(true); show(k, false); }));
    rail.addEventListener("keydown", (e) => { if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return; e.preventDefault(); pause(true); show(cur + (e.key === "ArrowRight" ? 1 : -1), false); railTabs[cur].focus(); });
    // the visitor takes the controls (a click, a slider, a key): the tour stops and the screen is
    // theirs. Scrolling over the window is not taking the controls: the tour and its voice go on.
    for (const type of ["click", "input", "keydown"]) screen.addEventListener(type, (e) => { if (e.isTrusted && playing) { track("Took the controls", { screen: idOf(cur) }, true); pause(true); } }, { capture: true, passive: true });
    // a click on a link to the tour is a request to watch it: it may start with the voice
    document.querySelectorAll('a[href="#tour"]').forEach((link) => link.addEventListener("click", () => { wantVoice = true; }));
    // how much of the window is on screen, of what could be (a window taller than the screen counts
    // as fully shown when it fills the screen). The tour starts when half is in view, is held (voice
    // and cursor frozen in place) once more than half is out, and picks up again on return.
    const shown = () => { const r = sim.getBoundingClientRect(), vh = window.innerHeight; return Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)) / Math.max(1, Math.min(r.height, vh)); };
    let heldAudio = false, queued = false;
    const onView = () => {
      queued = false;
      inView = shown() >= 0.5;
      if (inView && !started && !reduce) { play(wantVoice); if (!voice) voiceBtn.classList.add("nudge"); }
      else if (!inView && playing && !hold) { hold = true; heldAudio = !audio.paused; audio.pause(); sim.classList.add("held"); }
      else if (inView && hold) { hold = false; sim.classList.remove("held"); if (playing && voice && heldAudio) audio.play().catch(() => {}); heldAudio = false; }
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(onView); } };
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue, { passive: true });
    onView();
    sim.dataset.ready = "1";
  }).catch((e) => { console.error("TenderOS demo data did not load", e); });
})();
