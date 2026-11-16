// Renders the deck to site/public/TenderOS-deck.pdf and the share image to site/public/og.jpg
// with Playwright's Chromium, serving site/public on a local port, and tests the page: every
// screen of the tour, the studio's sliders, the what-if planner, the guided tour's cursor, day
// mode, a phone. Run after build.mjs:
//   node site/render.mjs [--shots DIR]     (--shots also saves screenshots of every screen)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".mp3": "audio/mpeg", ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".csv": "text/csv", ".xml": "application/xml" };
const shotsAt = process.argv.indexOf("--shots");
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
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
const check = (ok, what) => { if (!ok) errors.push(what); };
const watch = (page, name) => { page.on("console", (m) => { if (m.type() === "error") errors.push(`${name}: ${m.text()}`); }); page.on("pageerror", (e) => errors.push(`${name}: ${e}`)); };
const ready = async (page) => { await page.goto(`${base}/`, { waitUntil: "networkidle" }); await page.waitForSelector("#sim[data-ready]"); };
try {
  // ---- the deck, one 1280×720 slide per page
  const deck = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(deck, "deck");
  await deck.goto(`${base}/deck/`, { waitUntil: "networkidle" });
  await deck.evaluate(() => document.fonts.ready);
  await deck.pdf({ path: join(PUB, "TenderOS-deck.pdf"), width: "1280px", height: "720px", printBackground: true, preferCSSPageSize: true });
  const slides = await deck.locator(".slide").count();
  const over = await deck.evaluate(() => [...document.querySelectorAll(".slide")].map((s, k) => { const f = s.querySelector("footer").getBoundingClientRect().top; const low = Math.max(...[...s.children].filter((c) => c.tagName !== "FOOTER").map((c) => c.getBoundingClientRect().bottom)); return low > f + 1 ? k + 1 : 0; }).filter(Boolean));
  check(!over.length, `deck: content runs into the footer on slide ${over.join(", ")}`);
  console.log(`render: deck ${slides} slides → TenderOS-deck.pdf (${Math.round(statSync(join(PUB, "TenderOS-deck.pdf")).size / 1024)} KB)`);
  if (SHOTS) for (let k = 0; k < slides; k += 1) await deck.locator(".slide").nth(k).screenshot({ path: join(SHOTS, `slide-${String(k + 1).padStart(2, "0")}.png`) });

  // ---- the share image
  const data = JSON.parse(readFileSync(join(PUB, "data/demo.json"), "utf8"));
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await og.setContent(`<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter+Tight:wght@400;500;700&display=swap"><style>
    body{margin:0;width:1200px;height:630px;font-family:"Inter Tight","Helvetica Neue",Arial,sans-serif;background:#141517;background-image:linear-gradient(90deg,#1e2023 1px,transparent 1px);background-size:150px 100%;color:#efeeeb;display:flex;flex-direction:column;justify-content:center;padding:0 80px;box-sizing:border-box}
    .b{font-size:44px;font-weight:500;letter-spacing:-.035em}.b i{font-style:normal;color:#b8962e}
    h1{font-size:92px;line-height:.96;letter-spacing:-.035em;text-transform:uppercase;margin:18px 0 34px}h1 em{font-style:normal;color:#3dd68c;display:block}
    .k{display:flex;gap:44px}.k div{font-size:19px;color:#cbcac6}.k b{display:block;font-size:40px;font-weight:700;color:#3dd68c}
    .f{position:absolute;bottom:34px;left:80px;font-size:18px;color:#939190;font-family:"IBM Plex Mono",monospace;letter-spacing:.12em;text-transform:uppercase}</style></head><body>
    <div class="b"><i>Tender</i>OS</div><h1>Months of bid work.<em>Done in hours.</em></h1>
    <div class="k"><div><b>${data.tender.conditions}</b>conditions with pages</div><div><b>${data.tender.changes}</b>amendment changes</div><div><b>Daily</b>SECI and NHPC market scan</div><div><b>${data.stats.sims}</b>15-year simulations</div></div>
    <div class="f">tenderos.joulewise.tech · by jouleWise · on your premises</div></body></html>`);
  await og.waitForLoadState("networkidle"); await og.evaluate(() => document.fonts.ready);
  await og.screenshot({ path: join(PUB, "og.jpg"), type: "jpeg", quality: 86 });
  console.log("render: og.jpg 1200×630");

  // ---- the page: every screen of the tour, by hand
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, colorScheme: "dark", reducedMotion: "reduce" });
  watch(page, "page");
  await ready(page);
  const stages = await page.locator(".sim-rail button").count();
  check(stages === 13, `tour: ${stages} screens`);
  const sim = page.locator("#sim");
  for (let k = 0; k < stages; k += 1) {
    await page.locator(`.sim-rail button[data-stage="${k}"]`).click();
    await page.waitForTimeout(350);
    const id = await page.evaluate(() => document.querySelector(".stage:not([hidden])").id);
    if (id === "st-read" || id === "st-amend") {
      await page.waitForFunction((sel) => { const i = document.querySelector(`${sel} img`); return i && i.complete && i.naturalWidth > 0; }, id === "st-read" ? "#ev-page" : "#am-page");
      check(await page.locator(`#${id} .pv-marks i`).count() > 0, `${id}: no passage marked on the page`);
    }
    if (id === "st-amend") {
      check(await page.locator("#am-body .diff del").count() > 0 && await page.locator("#am-body .diff ins").count() >= 0, "amendments: no word diff");
      await page.locator('#am-net button[data-change="a2-rfs-4.3"]').click();
      check((await page.locator("#am-body h5").textContent()).includes("battery"), "amendments: the chip did not open its change");
      await page.locator('#am-net button[data-change="a3-rfs-40.3"]').click();
    }
    if (id === "st-conditions") { await page.locator('#cond-toggle button[data-bid="over"]').click(); check(await page.locator("#cond-list li.failed").count() >= 1, "conditions: the over-built bid fails none"); await page.locator('#cond-toggle button[data-bid="win"]').click(); check(await page.locator("#cond-list li.failed").count() === 0, "conditions: the competitive bid fails one"); }
    if (id === "st-studio") {
      const read = () => page.locator("#sd-sp").textContent();
      const p0 = await read();
      await page.locator("#sd-solar").fill("4"); const p1 = await read();
      check(p0 === `₹${data.win.tariff.toFixed(2)}` && p1 !== p0, `studio: price ${p0} → ${p1}`);
      check(await page.locator("#sd-checks li.failed").count() > 0, "studio: 4 MWac fails no condition");
      check(await page.locator("#sd-iso .iso-table").count() === 2, "studio: the array did not follow the slider");
      await page.locator("#sd-wind").fill("10"); check(await page.locator("#sd-iso .iso-turbine").count() === 2, "studio: no wind array");
      await page.locator("#sd-solar").fill("0"); await page.locator("#sd-wind").fill("20");
      const mixKey = await page.locator("#st-studio .mix-key").textContent();
      check(!mixKey.includes("solar") && mixKey.includes("Own wind, into the battery"), `studio: with no solar the charging mix reads "${mixKey}"`);
      await page.locator("#sd-wind").fill("0"); await page.locator("#sd-opt").click(); await page.waitForTimeout(400);
      check(await read() === p0 && await page.locator("#sd-solar").inputValue() === String(data.best), `studio: optimise ended at ${await page.locator("#sd-solar").inputValue()} MWac`);
      await page.locator("#sd-ess").fill("0.72"); check(parseFloat((await read()).slice(1)) < data.win.tariff, "studio: cheaper battery did not lower the price");
      await page.locator("#sd-save").click(); check(await page.locator("#sd-saved tbody tr").count() === 1, "studio: scenario not saved");
      if (SHOTS) { await page.locator("#sd-solar").fill("30"); await page.locator("#sd-wind").fill("15"); await page.waitForTimeout(200); await sim.screenshot({ path: join(SHOTS, "stage-06b-studio-big.png") }); }
      await page.locator(`.sim-rail button[data-stage="${k}"]`).click(); await page.waitForTimeout(200);
    }
    if (id === "st-whatif") {
      await page.locator('#wi-targets button[data-t="7.50"]').click();
      const n0 = await page.locator("#wi-track li").count(), first = await page.locator("#wi-track li .mv").first().textContent();
      await page.locator("#wi-track .rej").first().click();
      const first2 = await page.locator("#wi-track li .mv").first().textContent();
      check(!(await page.locator("#st-whatif").textContent()).includes("% likely"), "what-if: a bare likelihood is still shown");
      check(n0 > 0 && first !== first2 && await page.locator("#wi-rej button").count() === 1, "what-if: turning a lever down did not replan");
    }
    if (id === "st-review") { await page.locator('#rv-toggle button[data-bid="overbuilt"]').click(); check(await page.locator("#rv-list li.block").count() >= 3, "review: the over-built bid has no blocking findings"); if (SHOTS) await sim.screenshot({ path: join(SHOTS, "stage-12b-review-over.png") }); await page.locator('#rv-toggle button[data-bid="winning"]').click(); }
    for (const c of await page.locator(`#${id} .chart`).all()) check(await c.locator("svg").count() === 1, `${id}: a chart is empty`);
    if (SHOTS) await sim.screenshot({ path: join(SHOTS, `stage-${String(k + 1).padStart(2, "0")}-${id.replace("st-", "")}.png`) });
  }
  // the landing page: no price in the hero, the phone number, the tenders on the market
  check(!(await page.locator(".hero").textContent()).includes("₹"), "hero: a price is shown on the landing page");
  check(await page.locator('a[href="tel:+918796792724"]').count() >= 4, "phone: the number is missing somewhere");
  check(await page.locator(".sticker").isVisible() && (await page.locator(".sticker").evaluate((n) => getComputedStyle(n).position)) === "fixed", "sticker: not floating");
  check((await page.locator(".hero .kicker").textContent()).includes("every IPP") && await page.locator("#security svg.iso-security .iso-num").count() === 15, "hero kicker or security drawing missing");
  const dots = await page.locator("#hero-dots button").count();
  check(dots >= 3 && await page.locator("#hero-draw svg.iso").count() === 1, `hero: ${dots} tenders drawn`);
  const cap0 = await page.locator("#hero-cap b").textContent();
  await page.locator("#hero-dots button").nth(1).click(); await page.waitForTimeout(150);
  check((await page.locator("#hero-cap b").textContent()) !== cap0, "hero: the drawing did not change with the tender");
  check(await page.locator(".events li").count() >= 1 && await page.locator(".open-tenders .src-nhpc").count() >= 1, "market: no change feed, or no NHPC tender");
  // the demo request stays on this page and is about TenderOS
  check(await page.locator('a[href="#demo"]').count() >= 3 && await page.locator("#demo-form input[name=company]").count() === 1 && await page.locator('a[href*="joulewise.tech/contact"]').count() === 0, "demo: the booking journey is not on this page");
  check(await page.locator("#buy .steps4 > div").count() === 4 && await page.locator("table.modes tbody tr").count() === 2, "buying steps or deployment modes missing");
  // tender types, sections
  for (const tt of ["fdre", "bess", "cfd"]) { await page.locator(`#tt-tabs button[data-tt="${tt}"]`).click(); check(await page.locator(`#tt-${tt} svg.iso`).isVisible(), `tender type ${tt}: no drawing`); if (SHOTS) await page.locator("#tenders").screenshot({ path: join(SHOTS, `tenders-${tt}.png`) }); }
  if (SHOTS) { await page.screenshot({ path: join(SHOTS, "hero.png") }); for (const s of ["time", "optimiser", "team", "security", "what"]) await page.locator(`#${s}`).screenshot({ path: join(SHOTS, `section-${s}.png`) }); }
  await page.close();

  // ---- the guided tour: the cursor drives, then the visitor takes over
  const tour = await browser.newPage({ viewport: { width: 1366, height: 900 }, colorScheme: "dark" });
  watch(tour, "tour");
  await ready(tour);
  await tour.locator("#sim").scrollIntoViewIfNeeded(); // the tour starts by itself when it comes into view
  await tour.waitForFunction(() => document.querySelector("#cursor").classList.contains("on"), null, { timeout: 8000 });
  await tour.waitForFunction(() => !document.querySelector("#st-read").hidden, null, { timeout: 30000 });
  if (SHOTS) { await tour.waitForTimeout(3500); await tour.locator("#sim").screenshot({ path: join(SHOTS, "tour-cursor.png") }); }
  // a little scrolling leaves the tour running; more than half out of view holds it; back, it goes on
  const state = () => tour.evaluate(() => [document.querySelector("#sim-play").textContent.includes("Pause"), document.querySelector("#sim").classList.contains("held")]);
  await tour.mouse.move(700, 500); await tour.mouse.wheel(0, 140); await tour.waitForTimeout(400);
  let st = await state(); check(st[0] && !st[1], `scroll: a small scroll stopped the tour (${st})`);
  await tour.evaluate(() => window.scrollTo(0, 0)); await tour.waitForTimeout(400);
  st = await state(); check(st[0] && st[1], `scroll: out of view did not hold the tour (${st})`);
  const stageHeld = await tour.evaluate(() => document.querySelector(".stage:not([hidden])").id);
  await tour.waitForTimeout(1500);
  check(await tour.evaluate(() => document.querySelector(".stage:not([hidden])").id) === stageHeld, "scroll: the tour moved on while held");
  await tour.locator("#sim").scrollIntoViewIfNeeded(); await tour.waitForTimeout(500);
  st = await state(); check(st[0] && !st[1], `scroll: back in view did not resume (${st})`);
  await tour.locator(".sim-rail button[data-stage='5']").click();
  await tour.locator("#sim-play").click();
  await tour.waitForFunction(() => +document.querySelector("#sd-solar").value >= 28, null, { timeout: 15000 });
  if (SHOTS) await tour.locator("#sim").screenshot({ path: join(SHOTS, "tour-studio-drag.png") });
  await tour.locator("#sd-view, .sd-view").first().click({ position: { x: 30, y: 30 } });
  check(await tour.locator("#sim-mode").isVisible() && !(await tour.locator("#cursor").evaluate((c) => c.classList.contains("on"))), "tour: taking the mouse did not stop it");
  // the 90-second overview visits five screens
  await tour.locator('#tour-routes button[data-route="short"]').click(); await tour.waitForTimeout(700);
  check(await tour.evaluate(() => document.querySelector(".stage:not([hidden])").id) === "st-amend" && await tour.locator(".sim-rail button.off-route").count() === 8, "tour: the short route did not start on the amendments");
  await tour.close();

  // ---- the voice-over: Play turns it on, the caption carries the same words, the button turns it off
  const vo = await browser.newPage({ viewport: { width: 1366, height: 900 }, colorScheme: "dark", reducedMotion: "reduce" });
  watch(vo, "voice");
  await ready(vo);
  check(await vo.locator("#sim-voice").isVisible() && (await vo.locator("#sim-play").textContent()).includes("voice"), "voice: no voice control");
  await vo.locator("#sim-play").click();
  await vo.waitForTimeout(900);
  const asked = await vo.evaluate(() => performance.getEntriesByType("resource").filter((r) => r.name.includes("/audio/")).map((r) => r.name.split("/").pop()));
  check(await vo.locator("#sim-voice").getAttribute("aria-pressed") === "true" && asked.some((n) => n.startsWith("upload-")), `voice: not playing the first clip (${asked.join(", ") || "no clip requested"})`);
  check(await vo.locator("#sim-caption").isVisible() && (await vo.locator("#sim-caption-text").textContent()).includes("Contract for Difference"), "voice: no caption");
  if (SHOTS) await vo.locator("#sim").screenshot({ path: join(SHOTS, "voice-caption.png") });
  await vo.locator("#sim-voice").click();
  check(await vo.locator("#sim-voice").getAttribute("aria-pressed") === "false", "voice: the button did not turn it off");
  await vo.close();

  // ---- day mode and the toggle; a phone
  const day = await browser.newPage({ viewport: { width: 1366, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
  watch(day, "day");
  await ready(day);
  if (SHOTS) { await day.screenshot({ path: join(SHOTS, "day-hero.png") }); await day.locator(".sim-rail button[data-stage='2']").click(); await day.waitForTimeout(600); await day.locator("#sim").screenshot({ path: join(SHOTS, "day-amend.png") }); await day.locator("#security").screenshot({ path: join(SHOTS, "day-security.png") }); }
  await day.locator("#theme-toggle").click();
  const after = await day.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem("tos-theme"), getComputedStyle(document.body).backgroundColor]);
  check(after[0] === "dark" && after[1] === "dark" && after[2] === "rgb(20, 21, 23)", `toggle: ${after.join(" ")}`);
  await day.close();
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, colorScheme: "dark", reducedMotion: "reduce" });
  watch(phone, "phone");
  await ready(phone);
  for (const k of [0, 2, 5, 9]) { await phone.locator(`.sim-rail button[data-stage="${k}"]`).click(); await phone.waitForTimeout(250); const o = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); check(o <= 1, `phone: screen ${k + 1} scrolls sideways by ${o}px`); if (SHOTS) await phone.locator("#sim").screenshot({ path: join(SHOTS, `phone-stage-${k + 1}.png`) }); }
  if (SHOTS) await phone.screenshot({ path: join(SHOTS, "phone-hero.png") });
  await phone.close();
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.error("render: FAILED\n  " + errors.join("\n  ")); process.exit(1); }
console.log(`render: 13 screens, studio, what-if, guided tour, voice-over, market feed, day mode and phone all pass${SHOTS ? `; screenshots in ${SHOTS}` : ""}`);
