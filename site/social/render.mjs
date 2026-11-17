// Renders site/social/linkedin.html to an MP4 for LinkedIn (1080 × 1350, 30 frames a second):
// each frame is asked for by its time, photographed with Playwright's Chromium and piped to ffmpeg.
//   node site/social/render.mjs [--frames DIR] [--music FILE]
// --frames also saves a still every half second. The soundtrack is written by music.py from the
// animation's own cue points; --music puts another audio file under the picture instead.
// Writes site/public/social/tenderos-linkedin.mp4 and tenderos-linkedin.jpg (the cover frame).
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../public/social");
mkdirSync(OUT, { recursive: true });
const framesAt = process.argv.indexOf("--frames");
const FRAMES = framesAt > 0 ? process.argv[framesAt + 1] : null;
if (FRAMES) mkdirSync(FRAMES, { recursive: true });
const musicAt = process.argv.indexOf("--music");
const MUSIC = musicAt > 0 ? process.argv[musicAt + 1] : null;
const TMP = mkdtempSync(join(tmpdir(), "tenderos-social-"));

// the figures shown are the site's own
const d = JSON.parse(readFileSync(join(HERE, "../public/data/demo.json"), "utf8"));
const FIGURES = { pages: d.tender.totalPages, changes: d.tender.changes, conditions: d.tender.conditions, sims: d.stats.sims, pricings: d.stats.pricings, seconds: Math.round(d.stats.seconds), blocks: 365 * 96 };
for (const [k, v] of Object.entries(FIGURES)) if (!Number.isFinite(v) || v <= 0) throw new Error(`social: no figure for ${k}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.addInitScript((f) => { window.FIGURES = f; }, FIGURES);
await page.goto(`${pathToFileURL(join(HERE, "linkedin.html")).href}?still`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const fontsOk = await page.evaluate(() => document.fonts.check('800 100px "Inter Tight"') && document.fonts.check('600 30px "IBM Plex Mono"'));
if (!fontsOk) throw new Error("social: the fonts did not load");
const { dur, fps, cues } = await page.evaluate(() => ({ dur: window.DURATION, fps: window.FPS, cues: window.CUES }));
const total = Math.round(dur * fps);

const mp4 = join(OUT, "tenderos-linkedin.mp4");
const silent = join(TMP, "picture.mp4");
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-profile:v", "high", "-r", String(fps), silent], { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise((res, rej) => ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg ended with ${code}`)))));
const clip = { x: 0, y: 0, width: 1080, height: 1350 };
for (let f = 0; f < total; f += 1) {
  await page.evaluate((t) => window.seek(t), f / fps);
  const shot = await page.screenshot({ type: "png", clip });
  if (!ff.stdin.write(shot)) await new Promise((r) => ff.stdin.once("drain", r));
  if (FRAMES && f % (fps / 2) === 0) await page.screenshot({ path: join(FRAMES, `t${String((f / fps).toFixed(1)).padStart(4, "0")}.jpg`), type: "jpeg", quality: 70, clip });
}
ff.stdin.end();
await done;
await page.evaluate(() => window.seek(window.COVER)); // the cover: "Done in hours."
await page.screenshot({ path: join(OUT, "tenderos-linkedin.jpg"), type: "jpeg", quality: 92, clip });
await browser.close();
// the soundtrack, written to the animation's cue points, then laid under the picture at a level
// that suits a feed (about -14 LUFS): one gain for the whole track, so its quiet opening and its
// loud drop keep their difference, and a limiter for the peaks
let track = MUSIC;
if (!track) {
  writeFileSync(join(TMP, "cues.json"), JSON.stringify(cues));
  track = join(TMP, "music.wav");
  console.log(execFileSync("python3", [join(HERE, "music.py"), join(TMP, "cues.json"), track], { encoding: "utf8" }).trim());
}
const measured = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", track, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr;
const loud = parseFloat((measured.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.replace(/[^-\d.]/g, "") ?? "NaN");
if (!Number.isFinite(loud)) throw new Error("social: the soundtrack's loudness could not be measured");
const gain = Math.max(-20, Math.min(12, -14 - loud));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", track, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", `volume=${gain.toFixed(2)}dB,alimiter=limit=0.66:attack=2:release=60:level=false`, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", String(dur), "-movflags", "+faststart", mp4]);
console.log(`social: soundtrack at ${loud} LUFS, gain ${gain.toFixed(1)} dB`);
if (!MUSIC) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", track, "-c:a", "libmp3lame", "-b:a", "192k", join(OUT, "tenderos-linkedin-music.mp3")]);
rmSync(TMP, { recursive: true, force: true });
if (errors.length) { console.error("social: FAILED\n  " + errors.join("\n  ")); process.exit(1); }
console.log(`social: ${total} frames, ${dur} s → ${mp4} (${(statSync(mp4).size / 1048576).toFixed(1)} MB)`);
