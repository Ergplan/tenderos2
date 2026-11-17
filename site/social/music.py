"""The soundtrack of the LinkedIn animation, written in code: python3 music.py CUES.json OUT.wav

An original electronic track at 120 beats a minute in A minor, synthesised here with numpy, so
there is nothing to license. It is arranged on the animation's own cue points (window.CUES in
linkedin.html): a low, sparse opening with a hit on each number, a build under "months of bid
work" that cuts to silence, the drop on "Done in hours.", a chord change for each of the five
steps, a pulled-back passage for "your bid never leaves your premises" and a last chord on the
name. Every slam in the picture gets an impact in the sound.
"""
import json
import sys
import wave

import numpy as np

SR = 44100
rng = np.random.default_rng(7)


def note(semitones_from_a2):
    return 110.0 * 2 ** (semitones_from_a2 / 12)


# chords as semitones from A2: A minor, F major, C major, G major
CHORDS = {"Am": [0, 3, 7, 12], "F": [-4, 0, 3, 8], "C": [3, 7, 10, 15], "G": [-2, 2, 5, 10], "Am9": [0, 3, 7, 14]}
ROOT = {"Am": -12, "F": -16, "C": -9, "G": -14, "Am9": -12}


def band(x, lo=None, hi=None):
    """Keep the frequencies between lo and hi (a plain FFT mask with soft edges)."""
    f = np.fft.rfftfreq(len(x), 1 / SR)
    g = np.ones_like(f)
    if lo:
        g *= 1 / (1 + (lo / np.maximum(f, 1e-6)) ** 6)
    if hi:
        g *= 1 / (1 + (f / hi) ** 6)
    return np.fft.irfft(np.fft.rfft(x) * g, len(x))


def tone(freq, dur, harmonics=1, decay=0.0, shape="saw"):
    """A note: a sine, or a saw or square built from a few harmonics, optionally dying away."""
    t = np.arange(int(dur * SR)) / SR
    y = np.zeros_like(t)
    for h in range(1, harmonics + 1):
        if shape == "square" and h % 2 == 0:
            continue
        if freq * h > 9000:
            break
        y += np.sin(2 * np.pi * freq * h * t) / h
    if decay:
        y *= np.exp(-t * decay)
    return y


def fade(y, a=0.004, r=0.02):
    n = len(y)
    na, nr = min(int(a * SR), n // 2), min(int(r * SR), n // 2)
    y = y.copy()
    y[:na] *= np.linspace(0, 1, na)
    y[n - nr:] *= np.linspace(1, 0, nr)
    return y


def kick(amp=1.0):
    t = np.arange(int(0.42 * SR)) / SR
    f = 44 + 120 * np.exp(-t * 34)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 8.5)
    y[: int(0.004 * SR)] += 0.5 * rng.standard_normal(int(0.004 * SR))
    return fade(y * amp, 0.001, 0.03)


def boom(amp=1.0):
    """The impact under a slam: a long low thud with a burst of noise on top."""
    t = np.arange(int(1.6 * SR)) / SR
    f = 34 + 85 * np.exp(-t * 16)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 3.2)
    n = band(rng.standard_normal(len(t)), 300, 5000) * np.exp(-t * 14) * 0.5
    return fade((y + n) * amp, 0.001, 0.2)


def noise_hit(dur, lo, hi, decay):
    t = np.arange(int(dur * SR)) / SR
    return fade(band(rng.standard_normal(len(t)), lo, hi) * np.exp(-t * decay), 0.001, 0.02)


def clap():
    y = noise_hit(0.3, 700, 4500, 22)
    for d in (0.011, 0.023):
        k = int(d * SR)
        y[k:] += 0.6 * y[:-k]
    return y


def sweep(dur, f0, f1, rise=True):
    """A riser (or, backwards, a whoosh): a climbing tone inside a swelling band of noise."""
    t = np.arange(int(dur * SR)) / SR
    f = f0 * (f1 / f0) ** (t / dur)
    env = (t / dur) ** 2 if rise else np.sin(np.pi * t / dur) ** 2
    y = 0.35 * np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.8 * band(rng.standard_normal(len(t)), 900, 9000)
    return fade(y * env, 0.01, 0.01)


def reverb(x, mix=0.25):
    """A small hall: four feedback delays, worked a block at a time."""
    out = np.zeros(len(x) + SR * 2)
    dry = np.concatenate([x, np.zeros(SR * 2)])
    for d, g in ((1557, 0.80), (1617, 0.79), (1491, 0.81), (1422, 0.82)):
        y = dry.copy()
        for k in range(d, len(y), d):
            y[k:k + d] += g * y[k - d:k][: len(y[k:k + d])]
        out += y / 4
    return dry[: len(x)] * (1 - mix) + band(out, 150, 6000)[: len(x)] * mix


def main(cues_path, out_path):
    cues = json.load(open(cues_path))
    dur, beat = cues["dur"], 60 / cues["bpm"]
    n = int((dur + 0.05) * SR)
    drums, bass, pads, arp, fx = (np.zeros((2, n)) for _ in range(5))

    def put(buf, y, at, gain=1.0, pan=0.0):
        k = int(round(at * SR))
        if k >= n or k < 0:
            return
        y = y[: n - k] * gain
        buf[0, k:k + len(y)] += y * (1 - max(pan, 0))
        buf[1, k:k + len(y)] += y * (1 + min(pan, 0))

    scenes = cues["scenes"]
    by = lambda cue: [s for s in scenes if s["cue"] == cue]
    drop, end, prem, build, intro = by("drop")[0], by("end")[0], by("premises")[0], by("build")[0], by("intro")[0]
    beats = by("beat")
    groove_from, groove_to = drop["from"], prem["from"]

    # which chord sounds when
    plan = [(0.0, build["from"], "Am"), (build["from"], drop["from"], "Am"), (drop["from"], drop["to"], "Am")]
    for s, c in zip(beats, ["Am", "F", "C", "G", "Am"]):
        plan.append((s["from"], s["to"], c))
    plan += [(prem["from"], prem["to"], "F"), (end["from"], dur, "Am9")]
    chord_at = lambda t: next(c for a, b, c in plan if a <= t < b)

    K, B, HAT, OHAT, CLAP, CRASH = kick(), boom(), noise_hit(0.05, 7000, None, 70), noise_hit(0.22, 6000, None, 16), clap(), noise_hit(2.2, 3500, None, 2.4)

    # ---- drums
    kicks = []
    t = intro["from"]
    while t < dur - 0.4:
        level = 0.0
        if intro["from"] <= t < build["from"]:
            level = 0.45 if round((t - intro["from"]) / beat) % 2 == 0 else 0.0          # a slow pulse
        elif build["from"] <= t < drop["from"] - beat:
            level = 0.8
        elif groove_from <= t < groove_to:
            level = 1.0
        elif prem["from"] <= t < end["from"]:
            level = 0.7 if round((t - prem["from"]) / beat) % 2 == 0 else 0.0
        elif end["from"] <= t < end["from"] + 2.01:
            level = 0.8 if round((t - end["from"]) / beat) % 2 == 0 else 0.0
        if level:
            put(drums, K, t, level)
            kicks.append(t)
        t += beat
    t = build["from"]
    while t < groove_to:                                                                   # hats: quiet eighths in the build, sixteenths in the groove
        in_groove = groove_from <= t < groove_to
        if t < drop["from"] - beat or in_groove:
            step = round((t - build["from"]) / (beat / 4))
            if in_groove or step % 2 == 0:
                put(drums, HAT, t, (0.30 if step % 4 == 2 else 0.16) * (1.0 if in_groove else 0.7), pan=0.25)
            if in_groove and step % 8 == 6:
                put(drums, OHAT, t, 0.2, pan=-0.25)
        t += beat / 4
    t = groove_from + beat
    while t < groove_to:                                                                   # the clap on two and four
        put(drums, CLAP, t, 0.55)
        t += 2 * beat
    roll, k = drop["from"] - 1.5, 0                                                        # a snare roll that quickens into the cut
    while roll < drop["from"] - 0.26:
        put(drums, noise_hit(0.09, 900, 6000, 40), roll, 0.25 + 0.5 * (k / 14))
        roll += beat / (2 if k < 4 else 4)
        k += 1

    # ---- bass: eighth notes on the root, pulled down under every kick
    t = build["from"]
    while t < end["from"] + 2.0:
        active = (build["from"] <= t < drop["from"] - beat) or (groove_from <= t < groove_to) or (prem["from"] <= t < end["from"]) or t >= end["from"]
        if active:
            c = chord_at(min(t, dur - 0.01))
            f = note(ROOT[c])
            long = t >= prem["from"]
            y = fade(tone(f, beat * (1.9 if long else 0.46), 6, 0.0 if long else 4.0), 0.004, 0.03) + 0.6 * fade(tone(f / 2, beat * (1.9 if long else 0.46)), 0.004, 0.03)
            put(bass, y, t, 0.34)
            t += beat * 2 if long else beat / 2
        else:
            t += beat / 2
    duck = np.ones(n)
    for kt in kicks:
        k = int(kt * SR)
        m = min(n - k, int(0.22 * SR))
        duck[k:k + m] = np.minimum(duck[k:k + m], 1 - 0.75 * np.exp(-np.arange(m) / SR * 16))
    bass *= duck

    # ---- pads and stabs
    def chord(name, length, bright, decay=0.0):
        y = np.zeros((2, int(length * SR)))
        for st in CHORDS[name]:
            for side, det in ((0, 0.997), (1, 1.003)):
                y[side] += tone(note(st) * det, length, bright, decay)
        return y / len(CHORDS[name])

    drone = chord("Am", build["from"] + 0.2, 2)                                             # the opening: one low held chord
    for side in (0, 1):
        put(pads, fade(band(drone[side], None, 600), 0.6, 0.6), 0.0, 0.5, pan=0.4 if side else -0.4)
    for a, b, c in plan:
        if a >= build["from"]:
            y = chord(c, b - a + 0.15, 7)
            lvl = 0.16 if a < drop["from"] else 0.26 if a < prem["from"] else 0.30
            for side in (0, 1):
                put(pads, fade(band(y[side], 120, 2600 if a < prem["from"] else 1800), 0.03 if a >= drop["from"] else 0.5, 0.15), a, lvl, pan=0.5 if side else -0.5)
    pads[:, : int(prem["from"] * SR)] *= 0.55 + 0.45 * duck[: int(prem["from"] * SR)]
    for h in cues["hits"]:                                                                 # a bright stab of the chord with every slam from the drop on
        if h >= drop["from"] - 0.01:
            y = chord(chord_at(min(h, dur - 0.01)), 0.5, 12, 7.0)
            for side in (0, 1):
                put(pads, fade(y[side], 0.002, 0.05), h + 0.06, 0.5, pan=0.3 if side else -0.3)

    # ---- the arpeggio: sixteenths up and down the chord, with an echo
    t, i = groove_from, 0
    order = [0, 1, 2, 3, 2, 1]
    while t < groove_to:
        c = CHORDS[chord_at(t)]
        st = c[order[i % len(order)]] + (12 if (i // len(order)) % 2 else 0)
        y = fade(tone(note(st + 12), 0.16, 5, 16, "square"), 0.002, 0.02)
        put(arp, y, t, 0.2, pan=0.35 if i % 2 else -0.35)
        put(arp, y, t + beat * 0.75, 0.08, pan=-0.35 if i % 2 else 0.35)
        t += beat / 4
        i += 1

    # ---- impacts, risers, whooshes
    for h in cues["hits"]:
        big = h < 0.05 or abs(h - drop["from"]) < 0.01 or abs(h - end["from"]) < 0.01
        put(fx, B, h + 0.04, 1.0 if big else 0.75)
        put(fx, noise_hit(0.5, 1500, 8000, 9), h + 0.04, 0.22 if big else 0.14)
    put(fx, sweep(drop["from"] - 0.25 - (build["from"] + 1.0), 180, 5200), build["from"] + 1.0, 0.5)   # the riser into the drop
    strike = next((h for h in cues["hits"] if abs(h - (build["from"] + 2.0)) < 0.01), None)
    if strike is not None:                                                                # "months", struck out: a tone falling away
        tt = np.arange(int(0.7 * SR)) / SR
        put(fx, fade(np.sin(2 * np.pi * np.cumsum(900 * np.exp(-tt * 5) + 60) / SR) * np.exp(-tt * 3), 0.002, 0.1), strike + 0.02, 0.35)
    for s in [drop] + beats + [end]:
        put(fx, CRASH, s["from"] + 0.02, 0.5 if s in (drop, end) else 0.16)
    for s in beats + [prem]:
        put(fx, sweep(0.5, 400, 3000, rise=False), s["from"], 0.3)
    put(fx, sweep(1.2, 300, 4200), end["from"] - 1.2, 0.34)                               # a short riser into the name

    # the silence before the drop makes the drop
    cut0, cut1 = int((drop["from"] - 0.24) * SR), int((drop["from"] - 0.01) * SR)
    gap = np.zeros(cut1 - cut0)
    gap[:400] = np.linspace(1, 0, 400)
    for buf in (drums, bass, pads, arp):
        buf[:, cut0:cut1] *= gap

    wet = np.stack([reverb(pads[c] + 0.7 * arp[c] + 0.5 * fx[c], 0.3) for c in (0, 1)])
    mix = 0.95 * drums + 0.9 * bass + wet + 0.25 * fx
    t_all = np.arange(n) / SR
    # the shape of the whole piece: held back at the start, climbing through the build, full from
    # the drop, pulled back for "your premises", full again on the name
    level = np.interp(t_all, [0, intro["from"], build["from"], drop["from"] - 0.25, drop["from"], prem["from"] - 0.05, prem["from"], end["from"] - 0.05, end["from"], dur],
                      [0.5, 0.32, 0.42, 0.8, 1.0, 1.0, 0.55, 0.7, 1.0, 1.0])
    mix *= level
    mix *= np.clip((dur - t_all) / 1.8, 0, 1) ** 1.5                                       # the fade at the end
    mix[:, : int(0.005 * SR)] *= np.linspace(0, 1, int(0.005 * SR))
    mix = np.tanh(mix * 0.9)
    mix *= 0.89 / np.max(np.abs(mix))
    with wave.open(out_path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix.T * 32767).astype("<i2").tobytes())
    print(f"music: {dur} s at {cues['bpm']} beats a minute, {len(cues['hits'])} impacts → {out_path}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
