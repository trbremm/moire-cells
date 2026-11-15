"""Markdown tables of experiments/tissue/sweep.csv, one per series (for TISSUE.md); notes from notes.json (run -> plain words).

    python experiments/tissue/tables.py > tables.md
"""
import csv
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def f(x, d=2):
    try:
        return f"{float(x):.{d}f}"
    except (TypeError, ValueError):
        return "-"


def main():
    rows = list(csv.DictReader(open(os.path.join(HERE, "sweep.csv"), encoding="utf-8")))
    notes = {}
    p = os.path.join(HERE, "notes.json")
    if os.path.exists(p):
        notes = json.load(open(p, encoding="utf-8"))
    series = []
    for r in rows:
        if r["series"] not in series:
            series.append(r["series"])
    for s in series:
        print(f"\n#### Series `{s}`\n")
        two = any(r["sameRandom"] and r["series"] == s and r["sameType80"] for r in rows)
        head = "| run | what changed | score | islands | hold | persist | re-form | contacts | compact | inner motion R/s |"
        if two:
            head += " same-type contacts (random) | B out/in |"
        print(head + " what it looks like |")
        print("|" + "---|" * (head.count("|") ) )
        for r in rows:
            if r["series"] != s:
                continue
            kind = {"tissue": " **T**", "islands": " **I**"}.get(r["kind"], "")
            line = (f"| {r['name']} | {r['description']} | {f(r['score'])}{kind if r['kind'] == 'tissue' else ''} | "
                    f"{f(r['iscore'])}{kind if r['kind'] == 'islands' else ''} | {f(r['hold'])} | {f(r['persist'])} | "
                    f"{f(r['reform'])} | {f(r['contacts'], 1)} | {f(r['compact'])} | {f(r['internal'])} |")
            if two:
                line += f" {f(r['sameType80'])} ({f(r['sameRandom'])}) | {f(r['radialBA80'])} |"
            print(line + f" {notes.get(r['name'], '')} |")


if __name__ == "__main__":
    main()
