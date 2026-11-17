// The LinkedIn animation's soundtrack, composed by ElevenLabs' music API.
//
//   node site/social/music-eleven.mjs [--takes 2] [--model music_v2_5]
//
// The animation's own cue points (window.CUES in linkedin.html) become the composition plan: a
// tense lead-in under the tender's numbers and "months of bid work", the drop on "Done in hours."
// carried through the five steps on the dashboard, and a close (a breakdown for "your bid never
// leaves your premises", then one hit on the name), each as long as its part of the picture. It
// also makes the two sound effects laid where the footage changes speed (sfx-fast, sfx-slow). Each take is saved
// as social/music/eleven-<n>.mp3; measure.py finds where its drop lands and how much louder the
// drop is than the intro, and the take that fits best is copied to social/music/eleven.mp3,
// which render.mjs lays under the picture. The key comes from ELEVENLABS_API_KEY, or from the
// session's network proxy when that holds it. Nothing on the site calls ElevenLabs.
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, statSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "music");
mkdirSync(OUT, { recursive: true });
const arg = (name, fallback) => { const k = process.argv.indexOf(name); return k > 0 ? process.argv[k + 1] : fallback; };
const TAKES = Number(arg("--takes", 3)), MODEL = arg("--model", "music_v2_5");

// the picture's structure
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
await page.goto(`${pathToFileURL(join(HERE, "linkedin.html")).href}?still`, { waitUntil: "domcontentloaded" });
const cues = await page.evaluate(() => window.CUES);
await browser.close();
const at = (cue) => cues.scenes.find((s) => s.cue === cue);
const drop = at("drop").from, breakdown = at("premises").from, build = at("build").from;
const ms = (s) => Math.round(s * 1000);
// The model gives a drop an eight-bar lead-in whatever it is asked: so it is asked for one, eight
// seconds longer than the picture's, and render.mjs cuts those eight seconds off the front.
const LEAD = 8;

const NO = ["vocals", "singing", "spoken word", "lyrics"];
// three parts, as long as the picture's: the lead-in to "Done in hours.", the five steps on the
// dashboard, and the close (your premises, then the name)
const PARTS = [
  ["Intro", ms(drop + LEAD), ["instrumental", "cinematic electronic", `${cues.bpm} BPM`, "dark and tense", "quiet pulsing synth ostinato", "ticking percussion", "deep sub bass hits", "no drum beat", "rising tension through the second half", "riser and snare roll into a hard stop", "modern technology brand film", "great production quality"], "{quiet tense pulse, then a riser and snare roll, then silence}"],
  ["Drop", ms(breakdown - drop), ["the drop: full energy from the very first beat", "no build-up inside this section", "loud driving four-on-the-floor kick", "punchy synth bass", "bold confident synth stabs", "energetic and uplifting", "wide stereo", `${cues.bpm} BPM`, "great production quality"], "{full band enters at once, loud, and keeps driving}"],
  ["Outro", ms(cues.dur - breakdown), ["half-time breakdown for two bars", "deep bass", "minimal drums", "then one big final impact", "triumphant sustained chord", "cymbal crash", "rings out to silence"], "{drums pull back, then one big hit that rings out}"],
];
const plan = MODEL === "music_v1"
  ? { positive_global_styles: PARTS[0][2], negative_global_styles: NO, sections: PARTS.map(([name, dur, styles]) => ({ section_name: name, positive_local_styles: styles, negative_local_styles: [], duration_ms: dur, lines: [] })) }
  : { chunks: PARTS.map(([name, dur, styles, direction]) => ({ text: `[${name}]\n${direction}`, duration_ms: dur, positive_styles: styles, negative_styles: NO })) };

// the sound of the footage changing speed (one whoosh for fast motion, one hit for slow motion)
// and the hit the name arrives on
const call = (path, body, file) => {
  try { execFileSync("curl", ["-sS", "--fail-with-body", "-m", "600", `https://api.elevenlabs.io${path}`, "-H", `xi-api-key: ${process.env.ELEVENLABS_API_KEY || "proxy-injected"}`, "-H", "Content-Type: application/json", "-d", JSON.stringify(body), "-D", `${file}.head`, "-o", file], { stdio: ["ignore", "inherit", "inherit"] }); }
  catch (err) { let said = ""; try { said = readFileSync(file, "utf8").slice(0, 400); } catch (x) { /* nothing came back */ } throw new Error(`music: ElevenLabs refused ${path}: ${said || err.message}`); }
  if (statSync(file).size < 4000) throw new Error(`music: ${file} is not audio (${readFileSync(file, "utf8").slice(0, 300)})`);
  const head = readFileSync(`${file}.head`, "utf8"); execFileSync("rm", ["-f", `${file}.head`]);
  return head;
};
const SFX = {
  fast: ["Fast-forward whoosh: a quick rising synthetic swoosh that accelerates, tape speeding up, clean, no voice, no music", 1.0],
  slow: ["Slow motion hit: a deep cinematic sub bass impact with a short downward pitch bend, time slowing down, clean, no voice, no music", 2.0],
  end: ["One huge cinematic final impact, a deep boom with a bright metallic shimmer and a long reverb tail that rings out, trailer ending hit, no voice, no music", 4.0],
};
if (!process.argv.includes("--no-sfx")) for (const [name, [text, seconds]] of Object.entries(SFX)) {
  call("/v1/sound-generation?output_format=mp3_44100_128", { text, duration_seconds: seconds, prompt_influence: 0.6 }, join(OUT, `sfx-${name}.mp3`));
  console.log(`music: sound effect "${name}" (${seconds} s)`);
}

if (process.argv.includes("--sfx-only")) process.exit(0);
const takes = [];
for (let k = 1; k <= TAKES; k += 1) {
  const file = join(OUT, `eleven-${k}.mp3`), seed = 1000 + k * 7919;
  const head = call("/v1/music?output_format=mp3_48000_192", { composition_plan: plan, model_id: MODEL, seed }, file);
  const m = JSON.parse(execFileSync("python3", [join(HERE, "measure.py"), file, String(drop + LEAD), String(drop + LEAD - 2)], { encoding: "utf8" }));
  const songId = (head.match(/^song-id:\s*(\S+)/im) || [])[1] || null;
  takes.push({ file: `eleven-${k}.mp3`, seed, songId, ...m });
  console.log(`music: take ${k}: ${m.seconds} s, drop lands at ${m.dropAt} s (asked for ${drop + LEAD} s), ${m.contrastDb} dB above the lead-in`);
}
// the take whose drop is where it was asked for and stands about 12 dB above its lead-in: enough
// to hit, not so much that the opening of the video is lost on a phone
const score = (t) => -Math.abs(t.contrastDb - 12) - 8 * Math.abs(t.dropAt - drop - LEAD);
const best = takes.reduce((a, b) => (score(b) > score(a) ? b : a));
copyFileSync(join(OUT, best.file), join(OUT, "eleven.mp3"));
writeFileSync(join(OUT, "eleven.json"), `${JSON.stringify({ made: new Date().toISOString().slice(0, 10), model: MODEL, dropCue: drop, lead: LEAD, plan, takes, chosen: best.file, dropAt: best.dropAt }, null, 1)}\n`);
console.log(`music: ${takes.length} takes from ${MODEL}; using ${best.file}`);
