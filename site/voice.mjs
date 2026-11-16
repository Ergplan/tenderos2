// Records the tour's narration with OpenAI's text-to-speech API, one MP3 per screen.
//
//   node site/voice.mjs [--all]
//
// Text, voice and delivery are in site/src/narration.json. A clip is recorded again only when its
// text, the voice, the model or the instructions change (the file name carries their hash);
// --all records every clip. The key comes from OPENAI_API_KEY, or from the session's network
// proxy when that holds it. The site never calls OpenAI: the MP3s are committed in public/audio.
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "public/audio");
const N = JSON.parse(readFileSync(join(HERE, "src/narration.json"), "utf8"));
const all = process.argv.includes("--all");
mkdirSync(OUT, { recursive: true });
const manifest = { voice: N.voice, model: N.model, recordedAt: new Date().toISOString().slice(0, 10), clips: {} };
let made = 0;
for (const [id, text] of Object.entries(N.clips)) {
  const hash = createHash("sha1").update(`${N.model}|${N.voice}|${N.instructions}|${text}`).digest("hex").slice(0, 8);
  const file = `${id}-${hash}.mp3`, path = join(OUT, file);
  if (all || !existsSync(path) || statSync(path).size < 2000) {
    const body = JSON.stringify({ model: N.model, voice: N.voice, input: text, instructions: N.instructions, response_format: "mp3" });
    execFileSync("curl", ["-sS", "--fail-with-body", "-m", "120", "https://api.openai.com/v1/audio/speech", "-H", `Authorization: Bearer ${process.env.OPENAI_API_KEY || "proxy-injected"}`, "-H", "Content-Type: application/json", "-d", body, "-o", path], { stdio: ["ignore", "inherit", "inherit"] });
    if (statSync(path).size < 2000) throw new Error(`${id}: the API did not return audio (${readFileSync(path, "utf8").slice(0, 200)})`);
    // speech needs no more than 48 kbit/s mono: a quarter of the size the API returns
    try { execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path, "-ac", "1", "-b:a", "48k", `${path}.tmp.mp3`]); execFileSync("mv", [`${path}.tmp.mp3`, path]); } catch (e) { console.warn("voice: ffmpeg not available, keeping the clip as returned"); }
    made += 1;
    console.log(`voice: recorded ${file} (${Math.round(statSync(path).size / 1024)} KB)`);
  }
  let seconds = null;
  try { seconds = Math.round(Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf8" })) * 10) / 10; } catch (e) { /* no ffprobe: the player waits for the clip to end anyway */ }
  manifest.clips[id] = { file, bytes: statSync(path).size, seconds };
}
const keep = new Set(Object.values(manifest.clips).map((c) => c.file));
for (const f of readdirSync(OUT)) if (f.endsWith(".mp3") && !keep.has(f)) rmSync(join(OUT, f));
writeFileSync(join(HERE, "data-src/voice.json"), JSON.stringify(manifest, null, 1));
console.log(`voice: ${Object.keys(manifest.clips).length} clips, ${made} recorded now, voice "${N.voice}" (${N.model})`);
