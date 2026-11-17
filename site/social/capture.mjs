// Records the tour's dashboard screens for the LinkedIn animation, frame by frame.
//
//   node site/social/capture.mjs --survey DIR     a still every half second of each screen, to choose the cuts
//   node site/social/capture.mjs                  the frames the animation uses → site/social/footage/<clip>/
//
// The built site (site/public) is served locally and the tour is played on each screen with the
// page's clock under this script's control: time moves 20 ms, every CSS animation and transition
// is moved the same 20 ms, a picture is taken. So the footage is 50 frames to the second of the
// page's own time however slow the photography is, and the animation can play it fast or slow
// without a stutter. The footage is not committed (it is a few hundred megabytes): run this
// before render.mjs.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, "../public"), OUT = join(HERE, "footage");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".mp3": "audio/mpeg", ".jpg": "image/jpeg" };
const surveyAt = process.argv.indexOf("--survey");
const SURVEY = surveyAt > 0 ? process.argv[surveyAt + 1] : null;
const DT = 20, W = 1100, H = 800, CLIP_H = 760, SHARP = 1.5; // 1.5 device pixels a pixel: the animation zooms in on the action

// each clip: the tour's screen, and the seconds of it (from Play) that are kept
export const CLIPS = [
  { name: "read", screen: "read", from: 0.4, to: 5.0 },
  { name: "track", screen: "amend", from: 2.0, to: 6.2 },
  { name: "size", screen: "studio", from: 1.0, to: 8.4 },
  { name: "price", screen: "finance", from: 0.1, to: 6.8 },
  { name: "prove", screen: "dispatch", from: 0.1, to: 5.2 },
];
const SURVEY_SCREENS = ["read", "amend", "studio", "size", "dispatch", "finance", "whatif", "review"];

const server = createServer((req, res) => {
  let f = join(PUB, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  if (!existsSync(f)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

async function record(screen, seconds, each) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SURVEY ? 1 : SHARP, colorScheme: "dark" });
  await page.clock.install();
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#sim[data-ready]");
  await page.evaluate(() => document.fonts.ready);
  // the chat button and the page's header stay out of the picture
  await page.addStyleTag({ content: "#chat-open, #chat, header.top { display: none !important; } html { scroll-behavior: auto !important; } .sim-rail { scroll-behavior: auto !important; }" });
  await page.evaluate(() => { const s = document.querySelector("#sim"); window.scrollTo(0, s.getBoundingClientRect().top + scrollY - 8); });
  await page.waitForFunction(() => document.querySelector("#cursor").classList.contains("on"), null, { timeout: 20000 }); // the tour starts itself in view
  await page.locator(`.sim-rail button[aria-controls="st-${screen}"]`).click();                                           // the screen, at rest
  await page.locator("#sim-voice").click(); await page.locator("#sim-voice").click();                                       // the voice chosen, and off
  await page.mouse.move(4, 4);
  await page.evaluate(() => { const s = document.querySelector("#sim"); window.scrollTo(0, s.getBoundingClientRect().top + scrollY - 8); });
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 200));
  await page.evaluate(() => {
    // every animation and transition is taken off the wall clock and moved by hand
    const seen = new WeakMap();
    window.__step = (dt) => {
      for (const a of document.getAnimations()) {
        if (!seen.has(a)) { try { a.pause(); a.currentTime = 0; } catch (e) { continue; } seen.set(a, 0); }
        const t = seen.get(a) + dt, end = a.effect?.getComputedTiming().endTime;
        seen.set(a, t);
        try { if (Number.isFinite(end) && t >= end) a.finish(); else a.currentTime = t; } catch (e) { /* a removed animation */ }
      }
    };
    window.__step(0);
    document.querySelector("#sim-play").click();
  });
  const box = await page.evaluate(() => { const r = document.querySelector("#sim").getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; });
  const clip = { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, CLIP_H, H - box.y) };
  const steps = Math.round((seconds * 1000) / DT);
  for (let k = 0; k <= steps; k += 1) {
    await each(page, k, (k * DT) / 1000, clip);
    await page.clock.runFor(DT);
    await page.evaluate((dt) => window.__step(dt), DT);
  }
  const where = await page.evaluate(() => document.querySelector(".stage:not([hidden])").id);
  await page.close();
  return { clip, where };
}

try {
  if (SURVEY) {
    mkdirSync(SURVEY, { recursive: true });
    for (const screen of SURVEY_SCREENS) {
      const r = await record(screen, 14, async (page, k, t, clip) => { if (k % 25 === 0) await page.screenshot({ path: join(SURVEY, `${screen}-${t.toFixed(1).padStart(4, "0")}.jpg`), type: "jpeg", quality: 60, clip }); });
      console.log(`capture: surveyed ${screen} (${r.clip.width} × ${r.clip.height}, ended on ${r.where})`);
    }
  } else {
    const meta = { fps: 1000 / DT, clips: {} };
    for (const c of CLIPS) {
      const dir = join(OUT, c.name);
      rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
      let n = 0;
      const r = await record(c.screen, c.to, async (page, k, t, clip) => { if (t >= c.from - 1e-6) { n += 1; await page.screenshot({ path: join(dir, `f${String(n).padStart(4, "0")}.jpg`), type: "jpeg", quality: 90, clip }); } });
      meta.clips[c.name] = { frames: n, width: r.clip.width, height: r.clip.height, sharp: SHARP, seconds: +(n / meta.fps).toFixed(2), screen: c.screen, from: c.from };
      console.log(`capture: ${c.name}: ${n} frames of the ${c.screen} screen, ${r.clip.width} × ${r.clip.height}`);
    }
    writeFileSync(join(OUT, "footage.json"), `${JSON.stringify(meta, null, 1)}\n`);
  }
} finally {
  await browser.close();
  server.close();
}
