// TenderOS public demo: the simulation's steps, autoplay and charts, and the results filter.
// The content is already in the HTML; this file only animates it and draws the charts from the
// numbers the build embedded (#demo-data), which come from the application's own model.
(() => {
  const D = JSON.parse(document.getElementById("demo-data")?.textContent || "{}");
  const NS = "http://www.w3.org/2000/svg";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    // colours are theme variables, set as style so the charts follow the day/night toggle
    for (const [k, v] of Object.entries(attrs)) { if ((k === "fill" || k === "stroke") && String(v).startsWith("var(")) n.style[k] = v; else n.setAttribute(k, v); }
    if (parent) parent.appendChild(n);
    return n;
  };
  const txt = (parent, x, y, s, attrs = {}) => { const t = el("text", { x, y, ...attrs }, parent); t.textContent = s; return t; };
  const css = (name) => `var(${name})`;
  const rs = (v, d = 2) => `₹${v.toFixed(d)}`;

  // ---------------------------------------------------------------- charts
  function scanChart(host) {
    const pts = D.scan || [];
    if (!pts.length) return null;
    const W = 680, H = 300, L = 54, R = 18, T = 16, B = 40;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
    const maxMw = pts[pts.length - 1].mw;
    const lo = Math.floor(Math.min(...pts.map((p) => p.sp)) * 2) / 2 - 0.25, hi = Math.ceil(Math.max(...pts.map((p) => p.sp)) * 2) / 2;
    const x = (mw) => L + (mw / maxMw) * (W - L - R);
    const y = (sp) => T + (1 - (sp - lo) / (hi - lo)) * (H - T - B);
    for (let v = Math.ceil(lo * 2) / 2; v <= hi + 1e-9; v += 0.5) { el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }, svg); txt(svg, L - 8, y(v) + 4, rs(v, 1), { "text-anchor": "end" }); }
    for (let v = 0; v <= maxMw; v += 10) txt(svg, x(v), H - B + 18, `${v}`, { "text-anchor": "middle" });
    txt(svg, (L + W - R) / 2, H - 4, "Own solar, MWac (100 MW contracted)", { "text-anchor": "middle" });
    const firstOk = pts.find((p) => p.shortMwh === 0);
    if (firstOk) {
      el("rect", { x: L, y: T, width: x(firstOk.mw) - L - 4, height: H - T - B, fill: css("--short"), opacity: 0.07 }, svg);
      txt(svg, L + 8, T + 16, "days short of 2 MWh/MW", { fill: css("--short") });
    }
    const path = el("polyline", { points: pts.map((p) => `${x(p.mw)},${y(p.sp)}`).join(" "), fill: "none", stroke: css("--power"), "stroke-width": 3, "stroke-linejoin": "round" }, svg);
    const len = pts.reduce((a, p, i) => (i ? a + Math.hypot(x(p.mw) - x(pts[i - 1].mw), y(p.sp) - y(pts[i - 1].sp)) : 0), 0);
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;
    const dot = el("circle", { r: 6, cx: x(pts[0].mw), cy: y(pts[0].sp), fill: css("--ink"), stroke: css("--card"), "stroke-width": 2 }, svg);
    const best = pts.find((p) => p.mw === D.best) || firstOk;
    const bestG = el("g", { opacity: 0 }, svg);
    el("circle", { r: 9, cx: x(best.mw), cy: y(best.sp), fill: css("--power"), stroke: css("--bg"), "stroke-width": 3 }, bestG);
    txt(bestG, x(best.mw) + 14, y(best.sp) + 26, `${best.mw} MWac · ${rs(best.sp)}/kWh, every day met`, { fill: css("--ink"), "font-weight": 700 });
    host.replaceChildren(svg);
    const readout = document.getElementById("scan-readout");
    return {
      play(done) {
        const steps = pts.length, dur = reduce ? 0 : 3600;
        const t0 = performance.now();
        const frame = (t) => {
          const f = dur ? Math.min(1, (t - t0) / dur) : 1;
          path.style.strokeDashoffset = `${len * (1 - f)}`;
          const p = pts[Math.min(steps - 1, Math.floor(f * (steps - 1)))];
          dot.setAttribute("cx", x(p.mw)); dot.setAttribute("cy", y(p.sp));
          if (readout) readout.textContent = `Trying ${p.mw} MWac · strike price ${rs(p.sp, 3)}/kWh · ${p.shortMwh ? `short ${Math.round(p.shortMwh).toLocaleString("en-IN")} MWh over the term` : "every day met"}`;
          if (f < 1) requestAnimationFrame(frame);
          else {
            bestG.setAttribute("opacity", 1); dot.setAttribute("opacity", 0);
            if (readout) readout.textContent = `Optimum: ${best.mw} MWac of own solar · strike price ${rs(best.sp, 2)}/kWh · every day met. More solar costs more than the charging power it replaces.`;
            done?.();
          }
        };
        bestG.setAttribute("opacity", 0); dot.setAttribute("opacity", 1);
        requestAnimationFrame(frame);
      },
    };
  }

  function dayChart(host) {
    const d = D.day;
    if (!d) return null;
    const W = 680, H = 310, L = 46, R = 54, T = 26, B = 34;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
    const maxMw = Math.max(...d.discharge, ...d.charge) * 1.1;
    const maxP = Math.max(...d.price, 10) * 1.05;
    const bw = (W - L - R) / 24;
    const y = (v) => T + (1 - v / maxMw) * (H - T - B);
    const yp = (v) => T + (1 - v / maxP) * (H - T - B);
    const stepMw = maxMw > 80 ? 25 : maxMw > 40 ? 10 : 5;
    for (let v = 0; v <= maxMw; v += stepMw) { el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }, svg); txt(svg, L - 6, y(v) + 4, `${v}`, { "text-anchor": "end" }); }
    for (let v = 0; v <= maxP; v += 2) txt(svg, W - R + 6, yp(v) + 4, rs(v, 0));
    txt(svg, L - 6, T - 4, "MW", { "text-anchor": "end" });
    txt(svg, W - R + 6, T - 4, "₹/kWh", {});
    for (let h = 0; h < 24; h += 3) txt(svg, L + h * bw + bw / 2, H - B + 16, `${String(h).padStart(2, "0")}:00`, { "text-anchor": "middle" });
    const bars = [];
    for (let h = 0; h < 24; h += 1) {
      const x0 = L + h * bw + 2, w = bw - 4;
      const own = d.own[h] || 0, bought = d.bought[h] || 0, dis = d.discharge[h] || 0;
      if (bought > 0.01) bars.push(el("rect", { x: x0, y: y(bought), width: w, height: y(0) - y(bought), fill: css("--bought"), rx: 2 }, svg));
      if (own > 0.01) bars.push(el("rect", { x: x0, y: y(own + bought), width: w, height: y(0) - y(own), fill: css("--solar"), rx: 2 }, svg));
      if (dis > 0.01) bars.push(el("rect", { x: x0, y: y(dis), width: w, height: y(0) - y(dis), fill: css("--battery"), rx: 2 }, svg));
    }
    const line = el("polyline", { points: d.price.map((p, h) => `${L + h * bw + bw / 2},${yp(p)}`).join(" "), fill: "none", stroke: css("--price"), "stroke-width": 2.2 }, svg);
    const c0 = Math.min(...d.chosen), c1 = Math.max(...d.chosen);
    txt(svg, L + c0 * bw - 6, y(Math.max(...d.chosen.map((h) => d.discharge[h]))) + 14, "battery supplies", { "text-anchor": "end", fill: css("--battery"), "font-weight": 700 });
    host.replaceChildren(svg);
    return {
      play(done) {
        bars.forEach((b, i) => { b.style.transformOrigin = `0 ${y(0)}px`; b.style.transform = "scaleY(0)"; b.style.transition = reduce ? "none" : `transform .5s ease ${i * 0.06}s`; });
        line.style.opacity = 0; line.style.transition = reduce ? "none" : "opacity .6s ease 1.2s";
        requestAnimationFrame(() => requestAnimationFrame(() => { bars.forEach((b) => { b.style.transform = "scaleY(1)"; }); line.style.opacity = 1; }));
        setTimeout(() => done?.(), reduce ? 0 : 2200);
      },
    };
  }

  function poolChart(host) {
    const rows = D.pool || [];
    if (!rows.length) return null;
    const W = 680, H = 290, L = 64, R = 20, T = 14, B = 40;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
    const max = Math.max(...rows.map((r) => Math.abs(r.cr))) * 1.1;
    const bw = (W - L - R) / rows.length;
    const y = (v) => T + (1 - (v + max) / (2 * max)) * (H - T - B);
    for (const v of [-max * 0.9, -max * 0.45, 0, max * 0.45, max * 0.9]) { el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? "axis" : "grid" }, svg); txt(svg, L - 6, y(v) + 4, `${v > 0 ? "+" : ""}${Math.round(v)}`, { "text-anchor": "end" }); }
    txt(svg, L + 4, T + 12, "Pool pays (₹ cr a year)", { fill: css("--bad") });
    txt(svg, L + 4, H - B - 6, "Pool collects", { fill: css("--good") });
    txt(svg, 4, (H - B) / 2, "₹ cr", {});
    const bars = [];
    rows.forEach((r, i) => {
      const x0 = L + i * bw + 5, w = bw - 10;
      const top = r.cr >= 0 ? y(r.cr) : y(0);
      const h = Math.max(1.5, Math.abs(y(r.cr) - y(0)));
      bars.push(el("rect", { x: x0, y: top, width: w, height: h, rx: 3, fill: r.yours ? css("--power") : r.cr >= 0 ? css("--bad") : css("--good"), opacity: r.yours ? 1 : 0.75 }, svg));
      txt(svg, x0 + w / 2, H - B + 16, rs(r.sp, r.yours ? 2 : 1), { "text-anchor": "middle", "font-weight": r.yours ? 700 : 400, fill: r.yours ? css("--ink") : css("--muted") });
      if (r.yours) txt(svg, x0 + w / 2, y(0) - 10, "your quote", { "text-anchor": "middle", fill: css("--ink"), "font-weight": 700 });
    });
    txt(svg, (L + W - R) / 2, H - 4, "Strike price, ₹/kWh", { "text-anchor": "middle" });
    host.replaceChildren(svg);
    return {
      play(done) {
        bars.forEach((b, i) => { b.style.opacity = 0; b.style.transition = reduce ? "none" : `opacity .35s ease ${i * 0.08}s`; });
        requestAnimationFrame(() => requestAnimationFrame(() => bars.forEach((b) => { b.style.opacity = ""; })));
        setTimeout(() => done?.(), reduce ? 0 : 1600);
      },
    };
  }

  // ---------------------------------------------------------------- the simulation
  const sim = document.getElementById("sim");
  if (sim) {
    const tabs = [...sim.querySelectorAll(".sim-rail button")];
    const panels = tabs.map((t) => document.getElementById(t.getAttribute("aria-controls")));
    const playBtn = document.getElementById("sim-play");
    const bar = document.getElementById("sim-progress");
    const title = document.getElementById("sim-title");
    const charts = {
      size: scanChart(document.getElementById("chart-scan")),
      dispatch: dayChart(document.getElementById("chart-day")),
      wins: poolChart(document.getElementById("chart-pool")),
    };
    const HOLD = [4200, 6500, 8000, 5000, 5200, 6200, 5600, 4800, 5600, 6400, 5000];
    let cur = 0, playing = false, timer = null, readTimer = null;

    const countUp = (panel) => {
      panel.querySelectorAll("[data-count]").forEach((b) => {
        const target = Number(b.dataset.count), dec = Number(b.dataset.dec || 0), pre = b.dataset.pre || "", suf = b.dataset.suf || "";
        const t0 = performance.now(), dur = reduce ? 0 : 1200;
        const step = (t) => { const f = dur ? Math.min(1, (t - t0) / dur) : 1; b.textContent = `${pre}${(target * (1 - (1 - f) ** 3)).toFixed(dec)}${suf}`; if (f < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      });
    };
    const stagger = (panel) => {
      let i = 0;
      panel.querySelectorAll(".files li, .terms li, .change, .grp, .inputs tbody tr, .tile, .rv li, .pack li").forEach((n) => { n.style.animationDelay = `${(i++) * (panel.id === "st-read" ? 0.55 : 0.18)}s`; });
    };
    const readCounter = (panel) => {
      const c = panel.querySelector("#read-count");
      if (!c) return;
      const total = Number(c.nextElementSibling?.textContent.replace(/\D/g, "")) || 0;
      clearInterval(readTimer);
      let n = 0;
      readTimer = setInterval(() => { n = Math.min(total, n + Math.ceil(total / 60)); c.textContent = n; if (n >= total) clearInterval(readTimer); }, reduce ? 1 : 80);
    };

    const show = (i, { animate = true } = {}) => {
      cur = (i + tabs.length) % tabs.length;
      tabs.forEach((t, k) => { t.setAttribute("aria-selected", String(k === cur)); t.classList.toggle("done", k < cur); t.tabIndex = k === cur ? 0 : -1; });
      panels.forEach((p, k) => { p.hidden = k !== cur; p.classList.remove("play"); });
      const p = panels[cur];
      title.textContent = `TenderOS · SECI CfD-I · ${tabs[cur].querySelector(".t").textContent}`;
      if (animate) { void p.offsetWidth; stagger(p); p.classList.add("play"); }
      countUp(p);
      readCounter(p);
      const key = p.id.replace("st-", "");
      charts[key]?.play();
      bar.style.transition = "none"; bar.style.width = "0";
      if (playing) {
        requestAnimationFrame(() => { bar.style.transition = `width ${HOLD[cur]}ms linear`; bar.style.width = "100%"; });
        clearTimeout(timer);
        timer = setTimeout(() => { if (cur === tabs.length - 1) stop(); else show(cur + 1); }, HOLD[cur]);
      }
    };
    const stop = () => { playing = false; clearTimeout(timer); playBtn.textContent = "▶ Play"; playBtn.setAttribute("aria-label", "Play"); bar.style.transition = "none"; bar.style.width = "0"; };
    const start = () => { playing = true; playBtn.textContent = "❚❚ Pause"; playBtn.setAttribute("aria-label", "Pause"); show(cur === tabs.length - 1 ? 0 : cur); };
    playBtn.addEventListener("click", () => (playing ? stop() : start()));
    document.getElementById("sim-prev").addEventListener("click", () => { stop(); show(cur - 1); });
    document.getElementById("sim-next").addEventListener("click", () => { stop(); show(cur + 1); });
    tabs.forEach((t, k) => t.addEventListener("click", () => { stop(); show(k); }));
    sim.querySelector(".sim-rail").addEventListener("keydown", (e) => {
      if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault(); stop(); show(cur + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1)); tabs[cur].focus();
    });
    show(0, { animate: false });
    // start playing the first time the simulation scrolls into view
    if ("IntersectionObserver" in window && !reduce) {
      const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); if (!playing && cur === 0) start(); } }, { threshold: 0.45 });
      io.observe(sim);
    }
  }

  // ---------------------------------------------------------------- day / night
  // The page follows the system theme until the visitor picks one; the choice is kept in
  // localStorage ("tos-theme") and applied before paint by the inline script in <head>.
  const root = document.documentElement;
  const sysLight = window.matchMedia("(prefers-color-scheme: light)");
  const isLight = () => (root.dataset.theme ? root.dataset.theme === "light" : sysLight.matches);
  const mark = () => {
    root.classList.toggle("is-light", isLight());
    const t = document.getElementById("theme-toggle");
    if (t) { const next = isLight() ? "night" : "day"; t.setAttribute("aria-label", `Switch to ${next} mode`); t.title = `${next[0].toUpperCase()}${next.slice(1)} mode`; }
  };
  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    const next = isLight() ? "dark" : "light";
    root.dataset.theme = next;
    try { localStorage.setItem("tos-theme", next); } catch (e) { /* private mode: this visit only */ }
    mark();
  });
  sysLight.addEventListener?.("change", mark);
  mark();

  // ---------------------------------------------------------------- results filter
  const chips = [...document.querySelectorAll(".filters .chip")];
  chips.forEach((c) => c.addEventListener("click", () => {
    const f = c.dataset.filter;
    chips.forEach((x) => x.classList.toggle("on", x === c));
    document.querySelectorAll("#results-table > tbody > tr").forEach((r) => { r.hidden = f !== "all" && r.dataset.product !== f; });
    document.querySelectorAll(".rc-row").forEach((r) => r.classList.toggle("dim", f !== "all" && r.dataset.product !== f));
  }));
})();
