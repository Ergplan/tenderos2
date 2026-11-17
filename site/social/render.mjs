// Renders site/social/linkedin.html to an MP4 for LinkedIn (1080 × 1350, 30 frames a second):
// each frame is asked for by its time, photographed with Playwright's Chromium and piped to ffmpeg.
//   node site/social/render.mjs [--frames DIR] [--take N] [--music FILE] [--synth]
// --frames also saves a still every half second. The soundtrack is social/music/eleven.mp3,
// composed by ElevenLabs to the animation's structure (music-eleven.mjs), slid so that its drop
// falls on the picture's (--take N uses another of its takes, eleven-N.mp3), with ElevenLabs'
// two sound effects where the dashboard footage turns fast or slow; --music puts another audio
// file under the picture instead, and --synth (or no eleven.mp3) has music.py synthesise a track
// from the cue points.
// Writes site/public/social/tenderos-linkedin.mp4 and tenderos-linkedin.jpg (the cover frame).
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync, mkdtempSync, rmSync, existsSync } from "node:fs";
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
// the dashboard footage of the five steps (capture.mjs records it; it is not committed)
const footFile = join(HERE, "footage/footage.json");
if (!existsSync(footFile)) throw new Error("social: no dashboard footage. Run `node site/social/capture.mjs` first.");
const FOOTAGE = { ...JSON.parse(readFileSync(footFile, "utf8")), base: "footage/" };
await page.addInitScript(([f, foot]) => { window.FIGURES = f; window.FOOTAGE = foot; }, [FIGURES, FOOTAGE]);
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
const takeAt = process.argv.indexOf("--take");
const ELEVEN = join(HERE, takeAt > 0 ? `music/eleven-${process.argv[takeAt + 1]}.mp3` : "music/eleven.mp3");
let track = MUSIC, slide = 0, source = "the file given";
if (!track && !process.argv.includes("--synth") && existsSync(ELEVEN)) {
  track = ELEVEN; source = "ElevenLabs";
  const dropCue = cues.scenes.find((sc) => sc.cue === "drop").from;
  // the track was composed with a longer lead-in than the picture has (music-eleven.mjs): its drop
  // is found, and the track is slid (its front cut off, or silence put before it) so that drop is
  // the picture's
  const lead = existsSync(join(HERE, "music/eleven.json")) ? JSON.parse(readFileSync(join(HERE, "music/eleven.json"), "utf8")).lead || 0 : 0;
  const m = JSON.parse(execFileSync("python3", [join(HERE, "measure.py"), track, String(dropCue + lead), String(dropCue + lead - 2)], { encoding: "utf8" }));
  if (Math.abs(dropCue - m.dropAt) >= 0.04) slide = dropCue - m.dropAt;
  console.log(`social: ElevenLabs track, its drop at ${m.dropAt} s, the picture's at ${dropCue} s${slide ? `, slid by ${slide.toFixed(2)} s` : ""}`);
}
if (!track) {
  source = "music.py";
  writeFileSync(join(TMP, "cues.json"), JSON.stringify(cues));
  track = join(TMP, "music.wav");
  console.log(execFileSync("python3", [join(HERE, "music.py"), join(TMP, "cues.json"), track], { encoding: "utf8" }).trim());
}
const measured = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", track, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr;
const loud = parseFloat((measured.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.replace(/[^-\d.]/g, "") ?? "NaN");
if (!Number.isFinite(loud)) throw new Error("social: the soundtrack's loudness could not be measured");
const gain = Math.max(-20, Math.min(12, -14 - loud));
// the mix: the music, slid and levelled, and a whoosh or a hit wherever the footage turns fast or slow
const sfx = { fast: join(HERE, "music/sfx-fast.mp3"), slow: join(HERE, "music/sfx-slow.mp3") };
const turns = source === "ElevenLabs" && existsSync(sfx.fast) && existsSync(sfx.slow) ? cues.fx : [];
const LEVEL = { fast: -8, slow: -11, open: -13, end: -4 }; // dB under their own level, so they sit inside the music
const fast = turns.filter((e) => e.kind === "fast"), slow = turns.filter((e) => e.kind === "slow");
// and two more: the hit "A tender drops." opens on, and the one the name arrives on
const endHit = join(HERE, "music/sfx-end.mp3"), endAt = cues.scenes.find((sc) => sc.cue === "end").from;
const chain = [`[1:a]${slide > 0 ? `adelay=${Math.round(slide * 1000)}:all=1,` : slide < 0 ? `atrim=start=${(-slide).toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.5,` : ""}volume=${gain.toFixed(2)}dB[music]`];
const mixIn = ["[music]"];
const lay = [["fast", 2, fast.map((e) => [e.t, LEVEL.fast])], ["slow", 3, turns.length ? [[0.03, LEVEL.open], ...slow.map((e) => [e.t, LEVEL.slow])] : []], ["end", 4, turns.length && existsSync(endHit) ? [[endAt, LEVEL.end]] : []]];
for (const [k, input, list] of lay) {
  if (!list.length) continue;
  chain.push(`[${input}:a]aresample=48000,asplit=${list.length}${list.map((_, n) => `[${k}${n}]`).join("")}`);
  list.forEach(([at, level], n) => { chain.push(`[${k}${n}]adelay=${Math.round(at * 1000)}:all=1,volume=${level}dB[${k}d${n}]`); mixIn.push(`[${k}d${n}]`); });
}
chain.push(`${mixIn.join("")}amix=inputs=${mixIn.length}:normalize=0:duration=first,afade=t=out:st=${(dur - 0.9).toFixed(2)}:d=0.9,alimiter=limit=0.66:attack=2:release=60:level=false[out]`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", track, ...(turns.length ? ["-i", sfx.fast, "-i", sfx.slow, ...(existsSync(endHit) ? ["-i", endHit] : [])] : []), "-filter_complex", chain.join(";"), "-map", "0:v", "-map", "[out]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", String(dur), "-movflags", "+faststart", mp4]);
console.log(`social: soundtrack from ${source} at ${loud} LUFS, gain ${gain.toFixed(1)} dB${turns.length ? `, ${fast.length} whooshes and ${slow.length} hits on the speed changes` : ""}`);
if (!MUSIC) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", join(OUT, "tenderos-linkedin-music.mp3")]);
rmSync(TMP, { recursive: true, force: true });
if (errors.length) { console.error("social: FAILED\n  " + errors.join("\n  ")); process.exit(1); }
console.log(`social: ${total} frames, ${dur} s → ${mp4} (${(statSync(mp4).size / 1048576).toFixed(1)} MB)`);
