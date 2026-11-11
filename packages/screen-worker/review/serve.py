# 따라보기 검수 화면: 내려받은 방송 영상 + 화면 일꾼 결과 + 받아쓴 글 + 손님 채팅을 같은 시각으로 맞춰 보여 주고,
# 사람이 누른 맞음/틀림·빠진 상품을 runs/<방송>/labels.json에 저장한다. 이 맥 안에서만 연다(127.0.0.1).
# 사용: .venv/bin/python review/serve.py   → http://127.0.0.1:8765
import json, os, re, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sw.paths import FIRST as ROOT  # noqa: E402
RUNS, VIDEO, CHAT = (os.path.join(ROOT, d) for d in ("runs", "video", "chat"))
HERE = os.path.dirname(os.path.abspath(__file__))
NAMES = {"bossfix": "보스다육 — 규칙 고친 판", "boss": "보스다육 — 처음 판", "cheondong": "천동다육 · 홍사랑다육 2부 (11/7)", "sudam": "수담다육 · 붕붕 (11/7)",
         "gyeongseong": "경성다육 · 참사랑다육 (11/7)",
         "bosslive": "보스다육 — 11/8 실전 테스트 (지금까지 제일 좋은 설정)",
         "bosslivefix": "보스다육 — 11/8 실전 테스트 (번 없이 말한 번호·이상한 가격 고친 판)",
         "bossfinal": "보스다육 — 11/8 밤 23시 코드(번 없는 번호·206번 고치기 전, 옛 결과)",
         "bossfinalb": "보스다육 — 11/8 최종 + 206번·색금 보강",
         "bossoct": "보스다육 — 10/5 처음 보는 방송 시험(지금 코드)",
         "now_boss": "보스다육 11/8 — 정답 대조(지금 일꾼, 11/10 다시 돌림)",
         "now_luxury": "럭셔리다육 11/4 — 정답 대조(지금 일꾼, 11/10 다시 돌림)",
         "now_dayukholic": "다육홀릭tv(고운다육) 11/3 — 처음 보는 방송 정답 대조",
         "now_gyeongseong": "경성다육 11/2 2부(플라워데코) — 실전 테스트 정답 대조(11/10 코드)"}
# 정답지(share/): 영상 번호 → CSV(번호, 가격, 메모). 있으면 화면에 정답과 맞았는지를 같이 보여 준다
SHARE = os.path.join(os.path.dirname(HERE), "..", "share")
TRUTH = {"flK4emzquko": "보스다육_20261108_정답지.csv", "CTpU2iLAIdA": "럭셔리다육_20261104_정답지.csv", "04n9t0Md9U0": "다육홀릭_20261103_정답지.csv",
         "1aKI6G8j3Vs": "경성다육_20261102_정답지.csv"}


def truth(vid):
    p = os.path.join(SHARE, TRUTH.get(vid, "-"))
    if not os.path.exists(p):
        return {}
    import csv
    return {r["번호"]: {"price": int(r["가격"]) if r["가격"] else None, "memo": r.get("메모") or ""} for r in csv.DictReader(open(p, encoding="utf-8-sig"))}


def runs():
    out = []
    for d in sorted(os.listdir(RUNS)):
        m = re.fullmatch(r"([a-z]+(?:_[a-z]+)*)_([\w-]{11})", d)
        if m and os.path.isdir(os.path.join(RUNS, d)):
            done = os.path.exists(os.path.join(RUNS, d, "decisions.csv"))
            out.append({"run": d, "vid": m.group(2), "name": NAMES.get(m.group(1), m.group(1)), "done": done})
    return out


def jsonl(p):
    return [json.loads(l) for l in open(p, encoding="utf-8")] if os.path.exists(p) else []


def chat(vid):
    rows = []
    p = os.path.join(CHAT, f"{vid}.live_chat.json")
    for line in open(p, encoding="utf-8") if os.path.exists(p) else []:
        r = json.loads(line).get("replayChatItemAction", {})
        off = int(r.get("videoOffsetTimeMsec", 0)) / 1000
        for a in r.get("actions", []):
            it = a.get("addChatItemAction", {}).get("item", {}).get("liveChatTextMessageRenderer")
            if not it:
                continue
            txt = "".join(x.get("text") or (x.get("emoji", {}).get("shortcuts") or [""])[0] for x in it["message"]["runs"])
            badge = " ".join(b["liveChatAuthorBadgeRenderer"].get("tooltip", "") for b in it.get("authorBadges", []))
            rows.append({"t": round(off, 1), "who": it.get("authorName", {}).get("simpleText", ""), "seller": bool(re.search("Moderator|Owner", badge)), "x": txt})
    return rows


def data(run):
    d = os.path.join(RUNS, run)
    vid = run[-11:]
    screen = {}
    for r in jsonl(os.path.join(d, "screen.jsonl")):
        if r["t"]:
            screen[r["sec"]] = sorted({z[0] for z in r["t"]}, key=lambda n: -max(z[4] for z in r["t"] if z[0] == n))
    lab = os.path.join(d, "labels.json")
    # 같은 번호가 확정·확정취소를 오간 기록(고치기 전 판의 일꾼)은 처음 뜬 것 하나만 남긴다
    events, seen = [], []
    for e in jsonl(os.path.join(d, "events.jsonl")):
        if e["kind"] == "확정취소":
            continue
        if e["kind"] != "금액" and any(k == e["kind"] and n == e["no"] and abs(s - e["start_sec"]) < 240 for k, n, s in seen):
            continue
        if e["kind"] != "금액":
            seen.append((e["kind"], e["no"], e["start_sec"]))
        events.append(e)
    return {"run": run, "vid": vid, "events": events, "transcript": jsonl(os.path.join(d, "transcript.jsonl")),
            "screen": screen, "chat": chat(vid), "truth": truth(vid), "labels": json.load(open(lab, encoding="utf-8")) if os.path.exists(lab) else {}}


def numinfo(run, no):
    """번호 하나의 근거 전부: OCR이 그 번호를 읽은 초(그 초에 읽힌 글자 전부·위치), 판매자 말에서 그 번호가 나온 문장, 판정 기록"""
    import csv
    from sw.decide import numbers_bare, numbers_loose, numbers_with_beon
    d = os.path.join(RUNS, run)
    scr = {r["sec"]: r["t"] for r in jsonl(os.path.join(d, "screen.jsonl"))}
    ocr = [{"sec": s, "t": t} for s, t in sorted(scr.items()) if any(z[0] == no for z in t)]
    spaced = re.compile(r"(?<!\d)" + r"\s*[ ,.]\s*".join(str(no)) + r"(?!\d)") if no >= 10 else None
    stt = []
    for r in jsonl(os.path.join(d, "transcript.jsonl")):
        x = r["text"]
        how = [k for k, f in (("'N번'", numbers_with_beon), ("번 없이·분/원", numbers_loose), ("숫자만", numbers_bare)) if no in f(x)]
        if not how and (re.search(rf"(?<!\d){no}(?!\d)", x) or (spaced and spaced.search(x))):
            how = ["글자에는 있지만 번호로 못 뽑음"]
        if how:
            stt.append({"t": r["start_sec"], "x": x, "how": ", ".join(how)})
    near = sorted({s for m in stt for s in range(int(m["t"]) - 2, int(m["t"]) + 8) if s in scr})
    dec = []
    p = os.path.join(d, "decisions.csv")
    for r in csv.DictReader(open(p, encoding="utf-8-sig")) if os.path.exists(p) else []:
        if r["number"] == str(no) or any(c.split(":")[0] == str(no) for c in r["image_candidates"].split(";") if c):
            dec.append(r)
    ev = [e for e in jsonl(os.path.join(d, "events.jsonl")) if e.get("no") == no and e["kind"] in ("확정", "확인요청", "확정취소")]
    return {"no": no, "ocr": ocr, "near": [{"sec": s, "t": scr[s]} for s in near], "stt": stt, "decisions": dec, "events": ev,
            "frames": os.path.isdir(os.path.join(d, "frames"))}


_PROB = {}


def problems():
    """믿을 만한 정답 방송(sw.rescore.SETS)을 지금 판정 코드로 다시 판정해, 맞게 확정·틀린 확정·확인요청·놓친 번호를 근거·금액과 같이 모은다(사람이 직접 확인용)"""
    import collections
    import csv
    from sw.decide import decide, loose_at, numbers_loose, numbers_priced, numbers_with_beon
    from sw.rescore import SETS
    from sw.screen import Screen
    if _PROB:
        return _PROB["v"]
    out = []
    for name, run, tcsv in SETS:
        d = os.path.join(RUNS, run)
        T = {}
        for r in csv.DictReader(open(os.path.join(SHARE, tcsv), encoding="utf-8-sig")):
            T[int(r["번호"])] = {"price": int(r["가격"]) if r["가격"] else None, "memo": r.get("메모") or ""}
        sc, scr = Screen(), {}
        for r in jsonl(os.path.join(d, "screen.jsonl")):
            scr[r["sec"]] = r["t"]
            sc.add(r["sec"], [tuple(z) for z in r["t"]])
        trs = jsonl(os.path.join(d, "transcript.jsonl"))
        voice = sorted((r["start_sec"], v) for r in trs for v in numbers_with_beon(r["text"]))
        loose = sorted(x for r in trs for x in loose_at(r["start_sec"], r.get("end_sec", r["start_sec"]), r["text"]))
        priced = sorted((r["start_sec"], v) for r in trs for v in numbers_priced(r["text"]))
        segs, cand, mains = sc.build()
        items = decide(segs, cand, voice, loose=loose, priced=priced)
        A = {g["no"] for g in items if g["auto"]}
        asked = {g["no"] for g in items if not g["auto"] and not g.get("noise")} - A
        from sw.run_regress import run as rerun
        got, _ = rerun(d)                      # 같은 판정 + 금액 규칙(LLM 없이)
        price = {}
        for x in got:
            price.setdefault(x["no"], (x["price"], x["check"]))
        pick = []
        for n in sorted(A & set(T)):
            pick.append(("맞게 확정", n, next(g for g in items if g["no"] == n and g["auto"])))
        for n in sorted({g["no"] for g in items if g["auto"]} - set(T)):
            pick.append(("틀린 확정(정답지에 없음)", n, next(g for g in items if g["no"] == n and g["auto"])))
        for n in sorted(asked):
            pick.append(("확인요청 — 실제 상품" if n in T else "확인요청 — 정답지에 없음", n, next(g for g in items if g["no"] == n and not g["auto"] and not g.get("noise"))))
        for n in sorted(set(T) - A - asked):
            g = next((g for g in items if g["no"] == n), None)
            if g is None:
                secs = [x for x, t in scr.items() if any(z[0] == n for z in t)]
                m = re.search(r"(\d+):(\d\d):(\d\d)", T[n]["memo"])
                t0 = min(secs) if secs else (int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) if m else 0)
                g = {"no": n, "s": t0, "e": t0, "why": "이 번호로 된 판정이 없음", "reads": collections.Counter(), "vs": collections.Counter()}
            pick.append(("놓침", n, g))
        for cat, n, g in pick:
            s0, e0 = int(g["s"]), int(g["e"])
            lines = []
            for r in trs:
                if s0 - 30 <= r["start_sec"] <= e0 + 25:
                    c = collections.Counter(mains.get(i) for i in range(int(r["start_sec"]) - 1, int(r["start_sec"]) + 4) if mains.get(i) is not None)
                    x = r["text"]
                    lines.append({"t": r["start_sec"], "x": x, "scr": c.most_common(1)[0][0] if c else None,
                                  "me": n in numbers_with_beon(x) or n in numbers_loose(x)})
            seen = [x for x in range(s0 - 30, e0 + 31) if any(z[0] == n for z in scr.get(x, []))]
            fr = seen[:: max(1, len(seen) // 10)][:10] if seen else [x for x in range(s0 - 6, e0 + 10, 3) if x in scr][:8]
            pp = price.get(n)
            out.append({"bc": name, "run": run, "vid": run[-11:], "cat": cat, "no": n, "s": s0, "e": e0, "why": g["why"],
                        "price": pp[0] if pp else None, "price_check": bool(pp and pp[1]),
                        "reads": dict(g["reads"].most_common(4)), "vs": dict(g["vs"].most_common(4)), "truth": T.get(n),
                        "lines": lines, "seen_n": len(seen), "frames": [{"sec": x, "t": scr[x]} for x in fr]})
    _PROB["v"] = out
    return out


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json; charset=utf-8"):
        b = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        p = unquote(self.path.split("?")[0])
        if p == "/":
            return self.send(200, open(os.path.join(HERE, "viewer.html"), "rb").read(), "text/html; charset=utf-8")
        if p == "/problems":
            return self.send(200, open(os.path.join(HERE, "problems.html"), "rb").read(), "text/html; charset=utf-8")
        if p == "/api/problems":
            return self.send(200, problems())
        if p == "/api/runs":
            return self.send(200, runs())
        m = re.fullmatch(r"/api/data/([a-z_]+_[\w-]{11})", p)
        if m:
            return self.send(200, data(m.group(1)))
        m = re.fullmatch(r"/api/num/([a-z_]+_[\w-]{11})/(\d+)", p)
        if m:
            return self.send(200, numinfo(m.group(1), int(m.group(2))))
        m = re.fullmatch(r"/frame/([a-z_]+_[\w-]{11})/(\d+)\.jpg", p)
        if m:
            f = os.path.join(RUNS, m.group(1), "frames", f"{int(m.group(2)):06d}.jpg")
            if os.path.exists(f):
                return self.send(200, open(f, "rb").read(), "image/jpeg")
        m = re.fullmatch(r"/video/([\w-]{11})\.mp4", p)
        if m:
            return self.video(os.path.join(VIDEO, m.group(1) + ".mp4"))
        m = re.fullmatch(r"/photo/([a-z_]+_[\w-]{11})/(photos/[\w.-]+\.jpg)", p)
        if m:
            f = os.path.join(RUNS, m.group(1), m.group(2))
            if os.path.exists(f):
                return self.send(200, open(f, "rb").read(), "image/jpeg")
        self.send(404, {"error": "없음"})

    def video(self, f):
        """영상 앞뒤로 넘기기용 Range 응답"""
        if not os.path.exists(f):
            return self.send(404, {"error": "영상이 아직 없어요"})
        size = os.path.getsize(f)
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m.group(1):
                start = int(m.group(1))
            if m.group(2):
                end = int(m.group(2))
        end = min(end, start + 8 * 1024 * 1024 - 1, size - 1)
        self.send_response(206 if rng else 200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if rng:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with open(f, "rb") as fh:
            fh.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = fh.read(min(1 << 20, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                left -= len(chunk)

    def do_POST(self):
        m = re.fullmatch(r"/api/labels/([a-z_]+_[\w-]{11})", self.path)
        if not m or not os.path.isdir(os.path.join(RUNS, m.group(1))):
            return self.send(404, {"error": "없음"})
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        tmp = os.path.join(RUNS, m.group(1), "labels.json.tmp")
        json.dump(body, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        os.replace(tmp, os.path.join(RUNS, m.group(1), "labels.json"))
        self.send(200, {"ok": True})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"따라보기 검수 화면: http://127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
