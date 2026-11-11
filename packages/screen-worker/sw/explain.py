# 틀린 상품 들여다보기: 번호마다 그 시각의 화면 사진(OCR이 읽은 숫자 상자 표시), 받아쓴 말, 판정 기록을 한 장(HTML)에 모은다.
# 사용: python -m sw.explain <결과 폴더> <번호[@초][:메모]> ...   → <결과 폴더>/explain/index.html
#   예: python -m sw.explain runs/bossfinalb_x 237:"237 만원 놓침" 247@4969:"2만원인데 1만"
import collections
import csv
import html
import json
import os
import sys

from PIL import Image, ImageDraw

from . import price
from .decide import numbers_loose, numbers_with_beon


def hms(t):
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}"


def main():
    run, specs = sys.argv[1], sys.argv[2:]
    src = run if os.path.isdir(os.path.join(run, "frames")) else run.replace("bossfinalb", "bossfinal")
    screen = {d["sec"]: d["t"] for d in map(json.loads, open(os.path.join(run, "screen.jsonl"), encoding="utf-8"))}
    tr = [json.loads(l) for l in open(os.path.join(run, "transcript.jsonl"), encoding="utf-8")]
    dec = list(csv.DictReader(open(os.path.join(run, "decisions.csv"), encoding="utf-8-sig")))
    lines = [(d["start_sec"], d["text"]) for d in tr]
    unit = price.seller_unit(lines)
    out = os.path.join(run, "explain")
    os.makedirs(out, exist_ok=True)
    parts = []
    for spec in specs:
        memo = ""
        if ":" in spec:
            spec, memo = spec.split(":", 1)
        no, at = (int(x) for x in spec.split("@")) if "@" in spec else (int(spec), None)
        # 기준 시각: 주어진 초 → 판정 기록 → 판매자가 그 번호를 말한 첫 시각 → 화면에 처음 읽힌 시각
        rec = [d for d in dec if int(d["number"]) == no]
        said = [d["start_sec"] for d in tr if no in numbers_with_beon(d["text"]) or no in numbers_loose(d["text"]) or str(no) in d["text"]]
        seen = sorted(s for s, t in screen.items() if any(z[0] == no for z in t))
        if at is None:
            at = float(rec[0]["start_sec"]) if rec else (said[0] if said else (seen[0] if seen else 0))
        lo, hi = at - 40, at + 70
        # 화면: 그 구간 초마다 읽힌 숫자(크기 큰 순)
        reads = collections.Counter()
        for s in range(int(lo), int(hi)):
            for z in screen.get(s, []):
                reads[z[0]] += 1
        # 사진: 그 번호가 읽힌 장면 2장 + 기준 시각 1장
        shots = [s for s in seen if lo <= s <= hi][:1] + [s for s in seen if lo <= s <= hi][-1:] + [int(at)]
        imgs = []
        for s in dict.fromkeys(shots):
            fp = os.path.join(src, "frames", f"{s:06d}.jpg")
            if not os.path.exists(fp):
                continue
            im = Image.open(fp).convert("RGB")
            W, H = im.size
            dr = ImageDraw.Draw(im)
            for n, x, y, w, h in screen.get(s, []):
                col = (0, 200, 0) if n == no else (255, 60, 60)
                dr.rectangle([x * W, y * H, (x + w) * W, (y + h) * H], outline=col, width=3)
                dr.text((x * W, max(0, y * H - 14)), str(n), fill=col)
            im.thumbnail((360, 640))
            name = f"{no}_{s}.jpg"
            im.save(os.path.join(out, name), quality=80)
            imgs.append((name, s, [z[0] for z in screen.get(s, [])]))
        # 말: 기준 앞 40초 ~ 뒤 70초
        rows = []
        for d in tr:
            if lo <= d["start_sec"] <= hi:
                x = html.escape(d["text"])
                hit = no in d.get("nos", []) or no in numbers_loose(d["text"])
                mark = "번호로 알아들음" if no in d.get("nos", []) else ("번 없이 알아들음" if no in numbers_loose(d["text"]) else ("숫자는 있으나 못 알아들음" if str(no) in d["text"] else ""))
                ps = ", ".join(f"{v:,}" for v, _ in price.prices_said(d["text"], unit))
                rows.append(f"<tr class='{'hit' if hit else ('miss' if mark else '')}'><td>{hms(d['start_sec'])}</td><td>{x}</td><td>{mark}</td><td>{ps}</td></tr>")
        rec_txt = "<br>".join(f"{hms(float(d['start_sec']))}~{hms(float(d['end_sec']))} <b>{d['status']}</b> — {html.escape(d['reason'])} (화면 {d['image_candidates']} · 말 {d['voice_mentions']})" for d in rec) or "판정 기록 없음(화면 구간도, 음성 후보도 안 생김)"
        parts.append(f"""<section><h2>{no}번 <small>{hms(at)}</small> <span class=memo>{html.escape(memo)}</span></h2>
<p class=rec>{rec_txt}</p>
<p>화면 {hms(lo)}~{hms(hi)}에 읽힌 숫자(장 수): {', '.join(f'<b>{n}</b>:{c}' if n == no else f'{n}:{c}' for n, c in reads.most_common(8)) or '없음'}</p>
<div class=imgs>{''.join(f"<figure><img src='{n}'><figcaption>{hms(s)} 읽음: {', '.join(map(str, r)) or '없음'}</figcaption></figure>" for n, s, r in imgs)}</div>
<table><tr><th>시각</th><th>받아쓴 말</th><th>번호</th><th>말한 가격</th></tr>{''.join(rows)}</table></section>""")
    page = f"""<!doctype html><meta charset=utf-8><title>틀린 상품 들여다보기</title>
<style>body{{font-family:-apple-system,sans-serif;margin:16px;max-width:1100px}}section{{border-top:2px solid #ccc;padding:8px 0 20px}}
h2 small{{color:#666;font-weight:normal}}.memo{{color:#c00;font-size:15px;margin-left:8px}}.rec{{background:#f5f5f5;padding:6px}}
.imgs{{display:flex;gap:8px;flex-wrap:wrap}}figure{{margin:0}}figcaption{{font-size:12px}}table{{border-collapse:collapse;font-size:13px;margin-top:8px;width:100%}}
td,th{{border:1px solid #ddd;padding:3px 6px;vertical-align:top}}tr.hit{{background:#e6ffe6}}tr.miss{{background:#fff0e0}}</style>
<h1>틀린 상품 들여다보기</h1><p>초록 상자 = 그 번호로 읽힌 번호표, 빨간 상자 = 다른 숫자. 초록 줄 = 번호로 알아들은 말, 주황 줄 = 숫자는 말했는데 번호로 못 알아들은 말.</p>
{''.join(parts)}"""
    open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(page)
    print(os.path.join(out, "index.html"))


if __name__ == "__main__":
    main()
