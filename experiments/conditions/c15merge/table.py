"""The worlds table: live cells at 1 / 60 / 120 / 180 / 240 s and the books, per run.

python experiments/conditions/c15merge/table.py

Rows: the final runs (the toy's photosynthesising founders; maze, caves and rings from the founder A/B, where ?habit=pigments in the URL
is what the toy now does by itself), the first runs with the old light + burn founders, ?carbon=0 in the same harness where run.
"""
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "runs")
FINAL = {
    "maze": "c15m-lv2-pig", "thicket": "c15m-f-thicket-s7", "caves": "c15m-lv3-caves-pigments", "delta": "c15m-f-delta-s7",
    "forest": "c15m-f-forest-s7", "hive": "c15m-f-hive-s7", "rings": "c15m-lv3-rings-pigments", "spiral": "c15m-f-spiral-s7",
    "islands": "c15m-f-islands-s7", "sieve": "c15m-f-sieve-s7", "open dish": "c15m-f-open-s7",
    "hive s12": "c15m-f-hive-s12", "spiral s12": "c15m-f-spiral-s12",
}
OTHER = {   # light + burn founders (carbon on), the usual spread, ?carbon=0 in this harness
    "maze": ["c15m-w-maze-s7", "c15m-lv2-mix", "c15m-lv2-off"], "caves": [None, "c15m-lv3-caves-mix", None],
    "rings": [None, "c15m-lv3-rings-mix", None], "hive": [None, None, "c15m-f-hive-s7-off"],
    "spiral": [None, None, "c15m-f-spiral-s7-off"], "open dish": [None, None, "c15m-f-open-s7-off"],
}
U1 = {"maze": "973 -> 459", "thicket": "876 -> 1161", "caves": "197 -> 263", "delta": "375 -> 1074", "forest": "907 -> 640",
      "hive": "963 -> 844", "rings": "416 -> 173", "spiral": "410 -> 604", "islands": "1009 -> 1235", "sieve": "1075 -> 1313",
      "open dish": "2000 -> 279 (200 s)"}


def series(name):
    """Live cells at 0 / 60 / 120 / 180 / 240 s from samples.csv (the probe's 1 s count where there is one), and the worst books."""
    if not name:
        return None
    d = os.path.join(ROOT, name)
    if not os.path.exists(os.path.join(d, "samples.csv")):
        return None
    import csv
    rows = list(csv.DictReader(open(os.path.join(d, "samples.csv"))))
    at = {round(float(r["t"])): r["alive"] for r in rows}
    worst = {}
    if os.path.exists(os.path.join(d, "meta.json")):
        for e in json.load(open(os.path.join(d, "meta.json"))).get("evals", []):
            try:
                r = json.loads(e.get("result"))
            except (TypeError, ValueError):
                continue
            if isinstance(r, dict) and "alive" in r:
                if round(e["t"]) == 1:
                    at[0] = r["alive"]
                for k in ("cRound", "atoms", "charge", "energy"):
                    if r.get(k) is not None:
                        worst[k] = max(worst.get(k, 0), abs(r[k]))
    return " / ".join(str(at.get(t, "-")) for t in (0, 60, 120, 180, 240)), worst


if __name__ == "__main__":
    print("| world | carbon on, cells at 1 / 60 / 120 / 180 / 240 s | U1 (?carbon=0, built in place) 1 s -> 240 s | "
          "old light + burn founders | usual spread | ?carbon=0 here | books (worst abs) |")
    print("|---|---|---|---|---|---|---|")
    for k, n in FINAL.items():
        s = series(n)
        o = [series(x) for x in OTHER.get(k, [None, None, None])]
        books = " ".join(f"{a} {v:.2g}" for a, v in s[1].items()) if s else ""
        print(f"| {k} | {s[0] if s else '-'} | {U1.get(k, '')} | " + " | ".join(x[0] if x else "" for x in o) + f" | {books} |")
