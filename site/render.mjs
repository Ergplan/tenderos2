// Renders the deck to site/public/TenderOS-deck.pdf and the share image to site/public/og.png
// with Playwright's Chromium, serving site/public on a local port. Run after build.mjs:
//   node site/render.mjs [--shots DIR]     (--shots also saves desktop and phone screenshots)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".csv": "text/csv", ".xml": "application/xml" };
const shotsAt = process.argv.indexOf("--shots");
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;

const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let f = join(PUB, p);
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  if (!existsSync(f)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const errors = [];
try {
  // the deck, one 1280×720 slide per page
  const deck = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await deck.goto(`${base}/deck/`, { waitUntil: "networkidle" });
  await deck.pdf({ path: join(PUB, "TenderOS-deck.pdf"), width: "1280px", height: "720px", printBackground: true, preferCSSPageSize: true });
  const slides = await deck.locator(".slide").count();
  console.log(`render: deck ${slides} slides → TenderOS-deck.pdf (${Math.round(statSync(join(PUB, "TenderOS-deck.pdf")).size / 1024)} KB)`);

  // the share image: the cover with the demo's headline numbers
  const data = JSON.parse(readFileSync(join(PUB, "data/cfd-demo.json"), "utf8"));
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await og.setContent(`<!doctype html><html><head><style>
    body{margin:0;width:1200px;height:630px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:radial-gradient(800px 420px at 90% -10%,rgba(226,181,28,.35),transparent 60%),linear-gradient(160deg,#1d1705,#3a2d06);color:#f6eed4;display:flex;flex-direction:column;justify-content:center;padding:0 80px;box-sizing:border-box}
    .b{font-size:84px;font-weight:900;letter-spacing:-.03em}.b i{font-style:normal;color:#e2b51c}
    p{font-size:38px;line-height:1.25;margin:10px 0 34px;max-width:960px}
    .k{display:flex;gap:44px}.k div{font-size:20px;color:#d9cda6}.k b{display:block;font-size:44px;color:#e2b51c}
    .f{position:absolute;bottom:34px;left:80px;font-size:20px;color:#b9ad88}</style></head><body>
    <div class="b"><i>Tender</i>OS</div><p>From the tender PDF to a winning bid, with every number traceable.</p>
    <div class="k"><div><b>${data.tender.conditions}</b>conditions with pages</div><div><b>${data.tender.changesQuoted}</b>amendment changes quoted</div><div><b>₹${data.winning.tariff.toFixed(2)}</b>strike price, SECI CfD-I</div><div><b>8</b>SECI auctions, open data</div></div>
    <div class="f">tenderos.joulewise.tech · by jouleWise</div></body></html>`);
  await og.screenshot({ path: join(PUB, "og.jpg"), type: "jpeg", quality: 86 });
  console.log("render: og.jpg 1200×630");

  // the page itself: no console errors, the charts drawn
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  for (const id of ["chart-scan", "chart-day", "chart-pool"]) {
    const n = await page.locator(`#${id} svg`).count();
    if (n !== 1) errors.push(`${id}: no chart`);
  }
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, "desktop-top.png") });
    for (const [i, name] of [[5, "size"], [6, "dispatch"], [8, "wins"], [9, "review"]]) {
      await page.locator(`.sim-rail button[data-stage="${i}"]`).click();
      await page.waitForTimeout(4200);
      await page.locator("#sim").screenshot({ path: join(SHOTS, `sim-${name}.png`) });
    }
    await page.locator("#results").screenshot({ path: join(SHOTS, "results.png") });
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true });
    phone.on("pageerror", (e) => errors.push(`phone: ${e}`));
    await phone.goto(`${base}/`, { waitUntil: "networkidle" });
    await phone.screenshot({ path: join(SHOTS, "phone-top.png") });
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) errors.push(`phone: page scrolls sideways by ${overflow}px`);
    await phone.locator("#simulation").scrollIntoViewIfNeeded();
    await phone.waitForTimeout(2500);
    await phone.screenshot({ path: join(SHOTS, "phone-sim.png") });
    const ds = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await ds.goto(`${base}/deck/`, { waitUntil: "networkidle" });
    const n = await ds.locator(".slide").count();
    for (let k = 0; k < n; k += 1) await ds.locator(".slide").nth(k).screenshot({ path: join(SHOTS, `slide-${String(k + 1).padStart(2, "0")}.png`) });
    console.log(`render: screenshots in ${SHOTS}`);
  }
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.error("render: page errors:\n" + errors.join("\n")); process.exit(1); }
console.log("render: page loads with no errors, three charts drawn");
