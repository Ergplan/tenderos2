"""Measures a soundtrack against the picture: python3 measure.py FILE DROP_SECONDS BUILD_SECONDS

Prints JSON: how long the track is, where its drop lands (the moment the track steps up and stays up, looked for
around the picture's drop), and how many dB the passage after the drop stands above
the intro. render.mjs uses the first to slide the track so the two drops coincide.
"""
import json
import subprocess
import sys

import numpy as np

SR = 8000


def main(path, drop, build):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype="<i2").astype(float) / 32768
    hop = SR // 100                                           # 10 ms
    rms = np.sqrt(np.convolve(x ** 2, np.ones(hop * 5) / (hop * 5), mode="same"))[::hop]
    db = 20 * np.log10(np.maximum(rms, 1e-5))
    t = np.arange(len(db)) / 100
    # the drop: the moment after which the track is, for four seconds, most above the two seconds
    # before it; looked for from three seconds before the picture's drop to ten after
    cum = np.concatenate([[0.0], np.cumsum(db)])
    mean = lambda i, j: (cum[min(j, len(db))] - cum[max(i, 0)]) / max(1, min(j, len(db)) - max(i, 0))
    cands = [i for i in range(len(db)) if drop - 3.0 <= t[i] <= drop + 10.0 and i >= 200 and i + 400 <= len(db)]
    best = max(cands, key=lambda i: mean(i, i + 400) - mean(i - 200, i)) if cands else int(drop * 100)
    # and exactly where in that neighbourhood the level jumps
    k = 15
    fine = [i for i in range(max(k, best - 60), min(len(db) - k, best + 60))]
    best = max(fine, key=lambda i: db[i:i + k].mean() - db[i - k:i].mean()) if fine else best
    drop_at = float(t[best])
    level = lambda a, b: float(20 * np.log10(max(1e-5, np.sqrt(np.mean(x[int(a * SR):int(b * SR)] ** 2)))))
    print(json.dumps({"seconds": round(len(x) / SR, 2), "dropAt": round(drop_at, 2), "introDb": round(level(0.3, build), 1), "dropDb": round(level(drop_at + 0.2, drop_at + 8), 1),
                      "contrastDb": round(level(drop_at + 0.2, drop_at + 8) - level(0.3, build), 1)}))


if __name__ == "__main__":
    main(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]))
