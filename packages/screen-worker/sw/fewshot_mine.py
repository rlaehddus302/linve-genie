# few-shot 예제 후보 뽑기(시험 방송은 쓰지 않음): 일꾼이 화면+말로 확정한 결과(은정답)와 관리자 글 정답으로
# "대본 90초 → 그 안에서 판 상품 목록" 짝을 만든다. 사람이 읽고 고른 것만 sw/fewshot_examples.json 에 넣는다.
#   종류: N번 / 번없이(숫자만·끊어 적힘) / 번호안말함(화면만) / 상품없음(설명·인사·크기·날짜 숫자)
# 사용: python -m sw.fewshot_mine > 후보.txt
import collections
import csv
import json
import os
import re

from .decide import numbers_loose, numbers_with_beon
from .paths import DATA, FIRST
from .score_run import final

# 시험 방송(보스 11/8·럭셔리 11/4·다육홀릭 11/3)은 빼고, 일꾼이 돌려 둔 다른 방송만
RUNS = ["bossoctr_QyGv6YOpKhA", "sudam_co1GHJ462j4", "gyeongseong_hbf8fOi37U0", "cheondong_9JBi5q5NTh0"]
ADMIN = {"수정": ("sujeong_20261103", "수정다육_20261103_ehT8SyVBNXY"), "다육사랑": ("dayuksarang1004_20261029", "다육사랑1004농원_20261029_8iSjiWdgYIA")}
PRE, POST = 20, 45


def hms(t):
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}"


def kind(why, said):
    if not said:
        return "번호안말함"
    if "번 없이" in why or "분/원" in why:
        return "번없이"
    return "N번"


def from_runs():
    out = []
    for run in RUNS:
        d = os.path.join(FIRST, "runs", run)
        if not os.path.exists(os.path.join(d, "events.jsonl")):
            continue
        E = [json.loads(l) for l in open(os.path.join(d, "events.jsonl"), encoding="utf-8")]
        tr = [json.loads(l) for l in open(os.path.join(d, "transcript.jsonl"), encoding="utf-8")]
        conf = sorted(final(E), key=lambda e: e["start_sec"])
        pr = {}
        for e in E:
            if e["kind"] == "금액":
                pr.setdefault(e["no"], e)
        for p in conf:
            a, b = p["start_sec"] - PRE, p["start_sec"] + POST
            lines = [(x["start_sec"], x["text"]) for x in tr if a <= x["start_sec"] <= b]
            if len(lines) < 4:
                continue
            ans, ok = [], True
            for q in conf:
                hit = [u for u, x in lines if q["no"] in numbers_with_beon(x) or q["no"] in numbers_loose(x)]
                # 구간 안에서 팔기 시작했거나, 구간 안에서 그 번호를 말한 상품(앞에서 시작해 이어 판 것) — 빠뜨리면 '건너뛰기'를 가르치게 됨
                if not (a <= q["start_sec"] <= b or (hit and abs(q["start_sec"] - a) <= 300)):
                    continue
                said = bool(hit)
                m = pr.get(q["no"])
                if not m or not m.get("agree"):
                    ok = False   # 가격이 규칙·LLM 같음이 아닌 상품이 섞이면 은정답을 믿기 어려움
                    break
                ans.append({"t": hms(hit[0] if hit else max(a, q["start_sec"])), "no": q["no"] if said else None, "price": m["pick"], "kind": kind(q.get("why", ""), said)})
            if ok and ans:
                out.append({"src": run, "a": a, "lines": lines, "ans": ans, "kinds": sorted({x["kind"] for x in ans})})
        # 상품 없는 90초(설명·인사): 앞뒤 60초 안에 확정 상품이 없고 숫자가 나오는 곳
        for i in range(0, len(tr), 15):
            a = tr[i]["start_sec"]
            b = a + PRE + POST
            if any(a - 60 <= q["start_sec"] <= b + 60 for q in conf):
                continue
            lines = [(x["start_sec"], x["text"]) for x in tr if a <= x["start_sec"] <= b]
            if len(lines) >= 4 and any(re.search(r"\d", x) for _, x in lines):
                out.append({"src": run, "a": a, "lines": lines, "ans": [], "kinds": ["상품없음"]})
    return out


def from_admin():
    out = []
    for k, (name, share) in ADMIN.items():
        st = [(float(r["start_sec"]), r["text"]) for r in csv.DictReader(open(os.path.join(DATA, "regress", "stt", "tm", "work", name, "stt_team.csv"), encoding="utf-8-sig"))]
        adm = []
        for r in csv.DictReader(open(os.path.join(DATA, "STT테스트용_공유", share, "정답_관리자번호가격.csv"), encoding="utf-8-sig")):
            nos = [int(x) for x in r["번호(파싱)"].split() if x.isdigit()]
            if len(nos) == 1 and r["가격(파싱)"].isdigit():
                adm.append((float(r["경과초"]), nos[0], int(r["가격(파싱)"])))
        for t, n, p in adm:
            a, b = t - 80, t + 10
            lines = [(u, x) for u, x in st if a <= u <= b]
            inwin = [(u, m, q) for u, m, q in adm if a <= u <= b + 30]
            ans = []
            for u, m, q in inwin:
                hit = [u2 for u2, x in lines if m in numbers_with_beon(x) or m in numbers_loose(x)]
                if not hit:
                    ans = None
                    break
                ans.append({"t": hms(hit[0]), "no": m, "price": q, "kind": "N번"})
            if ans and len(lines) >= 4:
                out.append({"src": k, "a": a, "lines": lines, "ans": ans, "kinds": ["N번(관리자 정답)"]})
    return out


if __name__ == "__main__":
    C = from_runs() + from_admin()
    by = collections.defaultdict(list)
    for c in C:
        by["+".join(c["kinds"])].append(c)
    json.dump(C, open(os.path.join(DATA, "regress", "fewshot_candidates.json"), "w", encoding="utf-8"), ensure_ascii=False)
    for k, v in sorted(by.items(), key=lambda kv: -len(kv[1])):
        print(f"{k}: {len(v)}개")
