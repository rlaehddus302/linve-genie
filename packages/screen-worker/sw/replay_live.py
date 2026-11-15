# 라이브 LLM 등록 재현 도구 (D-SCR-17): 끝난 방송의 일꾼 기록(transcript.jsonl·screen.jsonl·llm_live.jsonl)을 그때 시각대로 다시 흘려,
# LLM을 다시 부르지 않고 기록된 답을 판정 로직(sw.llm_live.LlmRegister)에 넣어 "무엇을 언제 서버로 보냈을지"를 잰다.
#  - 시계는 가짜(1초씩 흐름). 받아쓰기 줄·화면 장은 그때 일꾼이 읽은 시각(추정)에, LLM 답은 기록의 at 시각에 들어간다.
#  - 로직이 스스로 묻지 못하게 하고(par=0) 기록된 답만 넣는다. 물음이 날아가 있던 동안은 로직도 "묻는 중"으로 본다.
#    로직이 "이 줄은 묻지 않겠다"(reg.skipped)고 한 호출의 답은 넣지 않고 줄인 호출로 센다. 로직이 더 묻고 싶어 한 호출(가격 확인)은 횟수만 센다(답이 없다).
#  - 서버는 흉내만(FakeServer): 같은 번호는 처음 보낸 값이 남고, 번호 바로잡기·이름·금액 고치기는 그 위에 적용한다. 실제 서버·LLM은 부르지 않는다.
#    임시 등록(D-SCR-18~22)도 받는다: 임시로 올라간 상품은 확정하면 판매 중이 되고 거두면 없어진다(계약서 docs/retro/tentative-contract.md 2절의 답 모양).
#    서버 답은 바로 돌려주고 일꾼은 다음 초에 그 답을 본다. 판매자의 손 조작(먼저 확정·수정·지움)은 흉내 내지 않는다.
#  - 임시 등록 수치: "줄 도착→임시 등록"(그 줄을 읽은 때부터 임시로 올린 때), "줄 도착→서버에 처음 보임"(임시든 바로든 판매자 화면에 처음 뜬 때),
#    "줄 도착→보냄"(판매 중이 된 때 = 바로 등록했거나 확정한 때 — 감사 채팅·라벨이 나갈 수 있는 때), 틀린 값이 확정까지 간 수, 끝내 확정 못 한 임시 등록 수.
#    가짜 시계가 1초씩 흐르므로 1초보다 짧은 차이는 재지 못하고, 서버 왕복 시간은 들어 있지 않다.
#  - 실행이 여럿이면(방송 중 일꾼을 다시 켬) 앞선 실행의 이벤트를 다음 실행에 넘긴다(다시 켠 일꾼이 이어받는 것과 같게).
#  - 정답(products.json: 방송 끝의 번호·품종·가격, phase CLOSED = 판매자가 지운 번호)과 견줘 수치를 낸다.
# 사용:
#   python -m sw.replay_live <실행 폴더>... --truth <정답 products.json> [--wrong 2,5,27] [--logic <옛 llm_live.py>] [--mode both|before|after|flow]
#                            [--variant '이름:KEY=값,KEY=값']... [--detail <번호별 표 csv>] [--events <이벤트를 적을 폴더>]
#   --mode flow = 지금 방식(LLM_TENTATIVE=0) 대 임시 등록 흐름. --variant 는 환경변수를 바꾼 판을 하나 더(예: '규칙 끔:LLM_TENTATIVE_RULE=0').
#   실행 폴더는 방송 순서대로(이름순 정렬). 기록에는 손님 닉네임이 있으므로 저장소 안으로 복사하지 않는다(--detail·--events도 저장소 밖에) — 임시 폴더는 끝나면 지운다.
#   --logic 을 주면 "고치기 전"을 그 파일로 돌린다(예: git show <커밋>:packages/screen-worker/sw/llm_live.py > /tmp/old.py). 안 주면 LLM_REG_SAFE=0 으로 돌린다.
#   환경변수(LLM_PRICE_WAIT, LLM_NAME_SELLER …)를 바꿔 "고친 뒤"를 돌리면 그 값의 효과를 잴 수 있다. 6개 실행(3시간 10분)에 판마다 4분쯤 걸린다.
import argparse
import contextlib
import csv
import importlib.util
import inspect
import io
import json
import os
import re
import statistics
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
STT_MIN = 1.5        # 말이 끝나고 받아쓴 줄이 나오기까지 가장 빠른 때(추정, 초): 0.4초 멈춤 + 받아쓰기
SCREEN_LAG = 2.0     # 화면 한 장이 찍히고 읽혀 screen.jsonl에 적히기까지(추정, 초)
TAIL = 40            # 마지막 답 뒤로 더 흘리는 시간(기다리던 등록이 상한에 닿게)


class FakeTime:
    """로직 모듈의 time 자리에 끼우는 가짜 시계"""

    def __init__(self):
        self.now = 0.0

    def time(self):
        return self.now

    def sleep(self, sec):
        self.now += sec

    def strftime(self, fmt, *_):
        s = int(self.now) % 86400
        return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


class Late:
    """기록의 at 시각이 되면 답이 오는 Future"""

    def __init__(self, clock, at, out):
        self.clock, self.at, self.out = clock, at, out

    def done(self):
        return self.clock.now >= self.at

    def result(self):
        return self.out


class FakeServer:
    """서버 흉내(계약서 docs/retro/tentative-contract.md 2절의 규칙만): 번호 → 상품 {no, price, name, rid, state: "임시"·"판매"}.
    같은 번호는 처음 값이 남고, 임시 등록은 확정하면 판매 중이 되고 거두면 없어진다. 판매자의 손 조작(먼저 확정·수정·지움)은 흉내 내지 않는다.
    방송 중 다시 켠 일꾼들(여러 실행)이 한 서버에 차례로 보낸다"""

    def __init__(self):
        self.products = {}

    def apply(self, kind, at, b):
        """요청 하나를 넣고 서버 응답(방송 하나)을 돌려준다"""
        ps = self.products
        row = {"changed": False}
        if kind in ("send", "tentative"):
            if b["no"] not in ps:
                ps[b["no"]] = {"no": b["no"], "price": b["price"], "name": b.get("name") or "", "rid": b.get("requestId"), "at": at,
                               "state": "임시" if kind == "tentative" else "판매"}
                row = {"changed": True, **({"tentative": True} if kind == "tentative" else {})}
        elif kind in ("confirm", "withdraw"):
            p = ps.get(b["no"])
            to = b.get("to")
            if p is None:
                row["skip"] = "NO_PRODUCT"
            elif p["state"] != "임시":
                row["skip"] = "NOT_TENTATIVE"
            elif p["rid"] != b["rid"]:
                row["skip"] = "OTHER_REGISTER"
            elif kind == "withdraw":
                del ps[b["no"]]
                row = {"changed": True}
            elif to is not None and to != b["no"] and to in ps:
                row["skip"] = "TARGET_EXISTS"
            else:
                p["state"] = "판매"
                if b.get("price") is not None:
                    p["price"] = b["price"]
                if b.get("name"):
                    p["name"] = b["name"]
                if to is not None and to != b["no"]:
                    ps[to] = dict(ps.pop(b["no"]), no=to)
                row = {"changed": True}
        elif kind == "renumber":
            src = ps.get(b["from"])
            if src is None:
                row["skip"] = "NO_PRODUCT"
            elif b.get("rid") and src.get("rid") != b["rid"]:
                row["skip"] = "OTHER_REGISTER"
            elif b["drop"]:
                if b["to"] in ps:
                    del ps[b["from"]]
                    row = {"changed": True}
            elif b["to"] not in ps:
                ps[b["to"]] = dict(ps.pop(b["from"]), no=b["to"])
                row = {"changed": True}
            else:
                row["skip"] = "TARGET_EXISTS"
        elif kind in ("rename", "reprice") and b["no"] in ps:
            field = "name" if kind == "rename" else "price"
            row = {"changed": ps[b["no"]][field] != b[field]}
            ps[b["no"]][field] = b[field]
        return {"ok": True, "changed": row["changed"], **({"tentative": True} if row.get("tentative") else {}), "broadcasts": [row]}


class FakePoster:
    """서버로 보낸 것을 가짜 시각과 함께 적어 두고, 가짜 서버의 답을 바로 돌려준다(임시 등록·확정·거두기를 받는 서버)"""

    def __init__(self, clock, server=None, tentative=True):
        self.clock, self.calls = clock, []
        self.server = server if server is not None else FakeServer()
        self.tentative = tentative
        self.price_unit = None

    def tentative_ok(self):
        return self.tentative

    def _do(self, kind, b, on_result=None):
        self.calls.append((kind, self.clock.now, dict(b)))
        res = self.server.apply(kind, self.clock.now, b)
        if on_result is not None:
            on_result(res)

    def send(self, body, on_result=None):
        self._do("tentative" if "tentative" in body else "send", body, on_result)

    def confirm(self, vid, no, rid, to=None, price=None, name=None, n=1, on_result=None):
        self._do("confirm", {"no": no, "rid": rid, "to": to, "price": price, "name": name}, on_result)

    def withdraw(self, vid, no, rid, n=1, on_result=None):
        self._do("withdraw", {"no": no, "rid": rid}, on_result)

    def renumber(self, vid, frm, to, rid, drop=False):
        self._do("renumber", {"from": frm, "to": to, "rid": rid, "drop": drop})

    def rename(self, vid, no, name, n):
        self._do("rename", {"no": no, "name": name})

    def reprice(self, vid, no, price, n):
        self._do("reprice", {"no": no, "price": price})

    def pending(self):
        return 0


def load_logic(path=None, env=None, tag="x"):
    """llm_live.py(또는 다른 판 파일)를 환경변수를 바꿔 새 모듈로 읽는다 — 같은 프로세스에서 두 판을 견주려고"""
    old = {k: os.environ.get(k) for k in (env or {})}
    os.environ.update(env or {})
    try:
        spec = importlib.util.spec_from_file_location(f"sw._replay_{tag}", path or os.path.join(HERE, "llm_live.py"))
        mod = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = mod
        spec.loader.exec_module(mod)
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    return mod


def read_jsonl(path):
    out = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    return out


def sod(at):
    h, m, s = (int(x) for x in at.split(":"))
    return h * 3600 + m * 60 + s


def load_run(run):
    """실행 폴더 → 줄·화면·답과 그때 일꾼이 읽은 시각(그날 0시부터의 초, 추정)"""
    tr = read_jsonl(os.path.join(run, "transcript.jsonl"))
    sc = sorted(read_jsonl(os.path.join(run, "screen.jsonl")), key=lambda d: d["sec"])
    calls = read_jsonl(os.path.join(run, "llm_live.jsonl"))
    events = read_jsonl(os.path.join(run, "events.jsonl"))
    reg = [e for e in events if e.get("kind") == "LLM등록" and e.get("line_seen_wall") and e.get("sent_wall") and e.get("at")]
    # 벽시계(초) → 그날 0시부터의 초: 기록의 at(시:분:초)과 sent_wall의 차로 맞춘다
    day0 = statistics.median(e["sent_wall"] - sod(e["at"]) for e in reg) if reg else 0.0
    exact = {e["line"]: e["line_seen_wall"] - day0 for e in reg if e.get("line") is not None}
    lags = [exact[i] - tr[i]["end_sec"] for i in exact if i < len(tr)]
    asked = {}
    for c in calls:
        asked[c["upto"]] = min(asked.get(c["upto"], 1e18), sod(c["at"]) - c.get("sec", 0))
    if lags:
        wall0 = min(lags) - STT_MIN                          # 방송 0초의 시각
        lag = statistics.median(lags)
    elif calls:
        wall0 = min(asked[i] - tr[i]["end_sec"] for i in asked if i < len(tr)) - STT_MIN - 1
        lag = wall0 + STT_MIN + 1
    else:
        wall0, lag = 0.0, STT_MIN
    seen, cap = [], 1e18
    for i in range(len(tr) - 1, -1, -1):                     # 그 줄을 넣은 물음보다 늦게 읽혔을 수는 없다
        cap = min(cap, asked.get(i, 1e18))
        seen.append(min(exact.get(i, tr[i]["end_sec"] + lag), cap))
    seen.reverse()
    for i in range(1, len(seen)):
        seen[i] = max(seen[i], seen[i - 1])
    return {"name": os.path.basename(os.path.normpath(run)), "tr": tr, "seen": seen, "sc": sc, "wall0": wall0,
            "calls": [(sod(c["at"]) + 0.5, c) for c in calls], "recorded": [e for e in events if e.get("kind") == "LLM등록" and e.get("sent")]}


class AskCache:
    """로직이 스스로 묻게 할 때(묻는 때를 바꾼 판, D-SCR-40)의 답 창고: (지시문 글 + 묻는 글)의 sha1 → {answer, user, sec}.
    없는 물음은 todo.jsonl에 적고 빈 답(답 없음)으로 넘긴다 — 저장소 밖의 채우기 도구가 LLM에 물어 채운 뒤 다시 돌린다.
    답이 오는 때는 채울 때 잰 시간(sec), 없으면 miss_sec"""

    def __init__(self, folder, miss_sec=12.0, fixed_sec=None):
        self.folder, self.miss_sec, self.fixed_sec = folder, miss_sec, fixed_sec
        self.hit = self.miss = 0
        os.makedirs(folder, exist_ok=True)

    def __call__(self, user, sys_path):
        import hashlib
        with open(sys_path, encoding="utf-8") as f:
            sys_text = f.read()
        skey = hashlib.sha1(sys_text.encode()).hexdigest()
        sys_copy = os.path.join(self.folder, f"sys_{skey}.txt")
        if not os.path.exists(sys_copy):
            with open(sys_copy, "w", encoding="utf-8") as f:
                f.write(sys_text)
        key = hashlib.sha1((sys_text + "\0" + user).encode()).hexdigest()
        path = os.path.join(self.folder, key + ".json")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
            self.hit += 1
            return d["answer"], self.fixed_sec or d.get("sec") or self.miss_sec
        self.miss += 1
        with open(os.path.join(self.folder, "todo.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps({"key": key, "user": user, "sys": sys_copy}, ensure_ascii=False) + "\n")
        return "", self.fixed_sec or self.miss_sec


class FakeAsk:
    """로직의 ThreadPoolExecutor 자리: 묻는 즉시 창고에서 답을 찾고, 가짜 시계로 sec초 뒤에 오는 Future를 돌려준다"""

    def __init__(self, clock, cache):
        self.clock, self.cache = clock, cache

    def submit(self, fn, user, sys_path=None, *rest):
        answer, sec = self.cache(user, sys_path or fn.__globals__.get("SYS"))
        return Late(self.clock, self.clock.now + sec, answer)

    def shutdown(self, wait=False):
        pass


def replay_run(data, logic, prior=(), server=None, ask=None):
    """한 실행을 로직에 흘린다 → {calls: 서버로 보낸 것, events, fed: 넣은 답 수, cut: 줄인 호출 수, confirm: 로직이 더 바란 확인 호출 수}
    prior = 같은 방송의 앞선 실행이 남긴 이벤트(다시 켠 일꾼이 이어받는 것 — 로직이 받을 줄 알 때만 넘긴다)
    server = 앞선 실행들이 보낸 것이 남아 있는 가짜 서버(없으면 빈 서버) — 임시 등록의 답(올라감·이미 있는 번호)을 여기서 받는다
    ask = AskCache — 주면 기록된 답을 넣지 않고 로직이 스스로 묻는다(묻는 때를 바꾼 판). 받아쓰기 줄은 그때 읽힌 시각에 들어간다"""
    clock = FakeTime()
    logic.time = clock
    poster, events = FakePoster(clock, server), []
    tr, seen, sc = data["tr"], data["seen"], data["sc"]
    calls = sorted(data["calls"], key=lambda ac: ac[0] - ac[1].get("sec", 0))        # 물은 순서
    emit = lambda d: events.append(dict(d, at=clock.strftime("%H:%M:%S"), wall=clock.now))
    with tempfile.TemporaryDirectory(prefix="sw_replay_") as tmp, contextlib.redirect_stdout(io.StringIO()):
        params = inspect.signature(logic.LlmRegister.__init__).parameters
        kw = {}
        if "prior" in params:
            kw["prior"] = logic.prior_from_events(prior)
        if "prior_tent" in params:
            kw["prior_tent"] = logic.prior_tentative(prior)
        reg = logic.LlmRegister(tmp, poster, "replay00000", emit, par=1, **kw)
        reg.par = 0                                          # 스스로 묻지 않는다 — 기록된 답만
        if ask is not None:
            reg.ex.shutdown(wait=False)
            reg.ex, reg.par = FakeAsk(clock, ask), logic.PAR
            calls = []
        build, memo = reg.sc.build, {}

        def cached():                                        # 화면 구간 계산은 장이 늘 때만 다시(재현 속도)
            n = len(reg.sc.tokens)
            if n not in memo:
                memo.clear()
                memo[n] = build()
            return memo[n]

        reg.sc.build = cached
        cutting = getattr(reg, "safe", False)
        ti = si = ci = fed = cut = 0
        last_upto = -1
        flying = []                                          # [(답이 오는 시각, 기록, 로직에 넣은 항목)]
        t = int(seen[0]) if seen else 0
        end = int(max([at for at, _ in calls] + ([seen[-1]] if seen else [0]))) + TAIL
        if ask is not None:
            end += 60                                        # 스스로 물은 마지막 답이 올 때까지
        ftr = open(os.path.join(tmp, "transcript.jsonl"), "a", encoding="utf-8")
        fsc = open(os.path.join(tmp, "screen.jsonl"), "a", encoding="utf-8")
        try:
            while t <= end:
                clock.now = float(t)
                asked = []
                while ci < len(calls) and calls[ci][0] - calls[ci][1].get("sec", 0) <= t:
                    asked.append(calls[ci])
                    ci += 1
                need = max([c["upto"] for _, c in asked], default=-1)
                while ti < len(tr) and (seen[ti] <= t or ti <= need):
                    ftr.write(json.dumps(tr[ti], ensure_ascii=False) + "\n")
                    ti += 1
                ftr.flush()
                while si < len(sc) and data["wall0"] + sc[si]["sec"] + SCREEN_LAG <= t:
                    fsc.write(json.dumps(sc[si]) + "\n")
                    si += 1
                fsc.flush()
                for at, c in asked:                          # 물음이 날아가 있는 동안은 로직도 "묻는 중"으로 본다
                    ids = [int(m) for m in re.findall(r"^L(\d+) \[", c["user"], re.M)]
                    L = [(i, tr[i]["start_sec"], tr[i]["text"]) for i in ids if i < len(tr)]
                    item = (c["upto"], L, c["user"], at - c.get("sec", 0), c.get("why"), Late(clock, at, c["answer"]))
                    reg.flying.append(item)
                    flying.append((at, c, item))
                for at, c, item in [f for f in flying if f[0] <= t]:
                    flying.remove((at, c, item))
                    lo = min(last_upto, c["upto"] - 1)
                    last_upto = max(last_upto, c["upto"])
                    if cutting and all(j in reg.skipped for j in range(lo + 1, c["upto"] + 1)):
                        reg.flying.remove(item)              # 새 로직이면 묻지 않았을 호출 — 답을 넣지 않는다
                        cut += 1
                        continue
                    reg.asked_line, reg.asked_t = max(reg.asked_line, c["upto"]), tr[c["upto"]]["start_sec"]
                    fed += 1
                reg.tick()
                t += 1
        finally:
            ftr.close()
            fsc.close()
            reg.log.close()
            reg.ex.shutdown(wait=False)
        confirm = getattr(reg, "confirm_calls", 0)
    return {"calls": poster.calls, "events": events, "fed": fed, "cut": cut, "confirm": confirm, "recorded_calls": len(data["calls"]),
            "asked": reg.calls if ask is not None else fed, "ask_why": dict(getattr(reg, "ask_why", {})) if ask is not None else {}}


def nkey(name):
    return "".join((name or "").split()).casefold()


def score(results, truth, wrong=()):
    """여러 실행(방송 순서)의 결과를 한 서버에 차례로 넣은 셈으로 정답과 견준다"""
    selling = {p["no"]: p for p in truth if p.get("phase") != "CLOSED" and p["no"] not in wrong}
    srv = FakeServer()
    server = srv.products
    first, waits = {}, []                                    # first = 판매 중이 된 순간의 값(바로 등록했거나 임시 등록을 확정한 때) — 감사 채팅·라벨이 이 값으로 나간다
    tents, shown = {}, []                                    # 임시 등록(요청 번호 → 올린 값·결과), 줄 도착 → 서버에 처음 보이기까지(임시든 바로든)
    sends = dup = dup_diff = tent_dup = 0
    for res in results:
        wait_of, tent_of = {}, {}
        for e in res["events"]:
            if e.get("kind") == "LLM등록" and e.get("sent"):
                wait_of[(e["no"], round(e["wall"], 1))] = e.get("wait_sec")
            elif e.get("kind") == "LLM임시등록" and e.get("sent"):
                tent_of[e.get("rid")] = e
        for kind, at, b in res["calls"]:
            before = server.get(b["no"]) if "no" in b else None
            out = srv.apply(kind, at, b)
            if kind == "send":
                sends += 1
                if not out["changed"]:
                    dup += 1
                    dup_diff += b["price"] != before["price"]
                    continue
                rec = dict(server[b["no"]], wait=wait_of.get((b["no"], round(at, 1))))
                first[b["no"]] = rec
                if rec["wait"] is not None:
                    waits.append(rec["wait"])
                    shown.append(rec["wait"])
            elif kind == "tentative":
                if not out["changed"]:
                    tent_dup += 1
                    continue
                e = tent_of.get(b.get("requestId")) or {}
                tents[b.get("requestId")] = {"no": b["no"], "price": b["price"], "name": b.get("name") or "", "at": at, "wait": e.get("wait_sec"),
                                             "rule": bool(e.get("rule")), "end": None}
            elif kind == "confirm" and b["rid"] in tents:
                t = tents[b["rid"]]
                if not out["changed"]:
                    t["end"] = t["end"] or out["broadcasts"][0].get("skip")
                    continue
                no = b["to"] if b.get("to") is not None else b["no"]
                t["end"] = "확정"
                rec = dict(server[no], at=at, wait=wait_of.get((no, round(at, 1))), tent_wait=t["wait"])
                first[no] = rec
                if rec["wait"] is not None:
                    waits.append(rec["wait"])
                if t["wait"] is not None:
                    shown.append(t["wait"])
            elif kind == "withdraw" and b["rid"] in tents and out["changed"]:
                tents[b["rid"]]["end"] = "거둠"
    reg = set(first)
    bad = sorted(n for n in reg if n not in selling)
    good = sorted(n for n in reg if n in selling)
    priced = [n for n in good if selling[n].get("price") is not None]
    named = [n for n in good if nkey(selling[n].get("name"))]
    waits.sort()
    pct = lambda q, xs=waits: xs[min(len(xs) - 1, int(len(xs) * q))] if xs else None
    mean = lambda xs: round(sum(xs) / len(xs), 1) if xs else None
    twaits = sorted(t["wait"] for t in tents.values() if t["wait"] is not None)
    shown.sort()
    open_tents = sorted(t["no"] for t in tents.values() if t["end"] != "확정" and t["end"] != "거둠")
    tent_bad = sorted({t["no"] for t in tents.values() if t["no"] not in selling})
    wrong_price = sum(first[n]["price"] != selling[n]["price"] for n in priced)
    tentative = {
        "임시 등록 수(서버에 올라간 것)": len(tents),
        "그중 규칙으로 올린 수(LLM 답 전)": sum(t["rule"] for t in tents.values()),
        "임시 등록 → 확정된 수": sum(t["end"] == "확정" for t in tents.values()),
        "임시 등록 → 거둔 수": sum(t["end"] == "거둠" for t in tents.values()),
        "끝내 확정 못 한 임시 등록 수": len(open_tents),
        "이미 있는 번호라 서버가 넘긴 임시 등록 수": tent_dup,
        "임시로 올라간 정답에 없는 번호 수": len(tent_bad),
        "임시 금액이 정답과 달랐던 수(올릴 때)": sum(t["price"] != selling[t["no"]]["price"] for t in tents.values()
                                         if t["no"] in selling and selling[t["no"]].get("price") is not None),
        "줄 도착→임시 등록(초) 가운데값": pct(0.5, twaits),
        "줄 도착→임시 등록(초) 90%": pct(0.9, twaits),
        "줄 도착→임시 등록(초) 평균": mean(twaits),
        "줄 도착→서버에 처음 보임(초) 가운데값": pct(0.5, shown),
        "줄 도착→서버에 처음 보임(초) 90%": pct(0.9, shown),
        "줄 도착→서버에 처음 보임(초) 평균": mean(shown),
        "틀린 값이 확정(판매 중)까지 간 수": f"번호 {len(bad)} · 금액 {wrong_price}",
    }
    return {
        "보낸 등록 수": sends,
        "새 번호로 들어간 등록 수": len(reg),
        "이미 있는 번호라 서버가 넘긴 수": dup,
        "그중 금액이 서버 값과 달랐던 수": dup_diff,
        "정답에 없는(또는 지운) 번호로 보낸 수": len(bad),
        "정답 번호 중 등록된 수": f"{len(good)}/{len(selling)}",
        "첫 등록 금액이 정답과 다른 수": sum(first[n]["price"] != selling[n]["price"] for n in priced),
        "첫 등록 품종이 정답과 같은 수": f"{sum(nkey(first[n]['name']) == nkey(selling[n]['name']) for n in named)}/{len(named)}",
        "첫 등록 품종이 정답과 다른 수(빈 이름 빼고)": sum(bool(nkey(first[n]["name"])) and nkey(first[n]["name"]) != nkey(selling[n]["name"]) for n in named),
        "첫 등록 품종이 빈 수": sum(not nkey(first[n]["name"]) for n in named),
        "방송 끝의 금액이 정답과 다른 수(일꾼이 고친 뒤)": sum(server[n]["price"] != selling[n]["price"] for n in priced if n in server),
        "방송 끝의 품종이 정답과 같은 수(일꾼이 고친 뒤)": f"{sum(nkey(server[n]['name']) == nkey(selling[n]['name']) for n in named if n in server)}/{len(named)}",
        "줄 도착→보냄 지연(초) 가운데값": pct(0.5),
        "줄 도착→보냄 지연(초) 90%": pct(0.9),
        "줄 도착→보냄 지연(초) 평균": round(sum(waits) / len(waits), 1) if waits else None,
        "LLM 호출 수(기록)": sum(r["recorded_calls"] for r in results),
        "넣은 답 수": sum(r["fed"] for r in results),
        "줄인 호출 수": sum(r["cut"] for r in results),
        "더 바란 확인 호출 수": sum(r["confirm"] for r in results),
        "확인요청으로 남긴 수": sum(1 for r in results for e in r["events"] if e.get("kind") == "LLM확인요청"),
        "번호 근거가 없어 보류한 수": sum(1 for r in results for e in r["events"] if e.get("kind") == "LLM번호보류"),
        "앞 번호표라 보류한 수": sum(1 for r in results for e in r["events"] if e.get("kind") == "LLM앞번호표보류"),
        "숫자 쌍으로 번호를 바꾼 수": sum(1 for r in results for e in r["events"] if e.get("kind") == "LLM번호쌍판정"),
        **tentative,
        "_bad": bad, "_first": first, "_server": server, "_selling": selling, "_tents": tents, "_open_tents": open_tents, "_tent_bad": tent_bad,
    }


def detail(path, scores, truth):
    """번호마다 판별 첫 등록 값과 정답 — 저장소 밖에 쓴다(닉네임이 품종 칸에 섞일 수 있음)"""
    tv = {p["no"]: p for p in truth}
    nos = sorted(set().union(*(s["_first"] for s in scores.values())) | set(tv))
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        head = ["번호", "정답 금액", "정답 품종", "정답 상태"]
        for tag in scores:
            head += [f"{tag} 금액", f"{tag} 품종", f"{tag} 시각", f"{tag} 지연"]
        w.writerow(head)
        for n in nos:
            p = tv.get(n, {})
            row = [n, p.get("price"), p.get("name"), p.get("phase")]
            for s in scores.values():
                r = s["_first"].get(n)
                at = int(r["at"]) if r else None
                row += [r["price"], r["name"], f"{at // 3600:02d}:{at % 3600 // 60:02d}:{at % 60:02d}", r["wait"]] if r else ["", "", "", ""]
            w.writerow(row)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m sw.replay_live")
    ap.add_argument("runs", nargs="+", help="일꾼 실행 폴더(방송 순서대로)")
    ap.add_argument("--truth", required=True, help="정답 상품 목록 products.json")
    ap.add_argument("--wrong", default="", help="정답 목록에 남아 있지만 틀린 번호(쉼표로)")
    ap.add_argument("--logic", help="고치기 전 판 llm_live.py 파일(없으면 LLM_REG_SAFE=0)")
    ap.add_argument("--mode", choices=["before", "after", "both", "flow"], default="both",
                    help="flow = 지금 방식(LLM_TENTATIVE=0) 대 임시 등록 흐름(기본값)을 견준다 — 가짜 서버가 임시 등록·확정·거두기를 받는다")
    ap.add_argument("--variant", action="append", default=[], metavar="이름:KEY=값,KEY=값",
                    help="환경변수를 바꾼 판을 하나 더 돌린다(여러 번 쓸 수 있다). 예: --variant '규칙 끔:LLM_TENTATIVE_RULE=0'")
    ap.add_argument("--detail", help="번호별 첫 등록 값을 적을 CSV(저장소 밖 경로)")
    ap.add_argument("--events", help="재현에서 나온 이벤트·서버로 보낸 것을 판마다 적을 폴더(저장소 밖 경로)")
    a = ap.parse_args(argv)
    truth = json.load(open(a.truth, encoding="utf-8"))
    truth = truth["products"] if isinstance(truth, dict) else truth
    wrong = {int(x) for x in a.wrong.split(",") if x.strip()}
    runs = [load_run(r) for r in sorted(a.runs)]
    logics = {}
    if a.mode in ("before", "both"):
        logics["고치기 전"] = load_logic(a.logic, None if a.logic else {"LLM_REG_SAFE": "0"}, "before")
    if a.mode in ("after", "both"):
        logics["고친 뒤"] = load_logic(None, None, "after")
    if a.mode == "flow":
        logics["지금 방식"] = load_logic(None, {"LLM_TENTATIVE": "0"}, "plain")
        logics["임시 등록"] = load_logic(None, {"LLM_TENTATIVE": "1"}, "tentative")
    for k, spec in enumerate(a.variant):
        tag, _, pairs = spec.partition(":")
        logics[tag] = load_logic(None, dict(x.split("=", 1) for x in pairs.split(",") if "=" in x), f"variant{k}")
    scores = {}
    for tag, logic in logics.items():
        results, prior, server = [], [], FakeServer()
        for d in runs:                                       # 다시 켠 일꾼은 앞선 실행의 이벤트를 이어받고, 서버에는 앞선 실행이 보낸 것이 남아 있다
            results.append(replay_run(d, logic, prior, server))
            prior = prior + results[-1]["events"]
        scores[tag] = score(results, truth, wrong)
        scores[tag]["_results"] = results
    recorded = sum(len(d["recorded"]) for d in runs)
    print(f"실행 {len(runs)}개 · 그날 일꾼이 실제로 보낸 등록 {recorded}건 · 정답 {len(truth)}개(지운 번호 {sum(p.get('phase') == 'CLOSED' for p in truth)}개"
          + (f", 틀렸다고 따로 준 번호 {sorted(wrong)}" if wrong else "") + ")")
    keys = [k for k in next(iter(scores.values())) if not k.startswith("_")]
    width = max(len(k) for k in keys) + 2
    print(f"{'':<{width}}" + "".join(f"{t:>14}" for t in scores))
    for k in keys:
        print(f"{k:<{width}}" + "".join(f"{str(s[k]):>14}" for s in scores.values()))
    for tag, s in scores.items():
        print(f"{tag} · 정답에 없는 번호: {s['_bad']}")
        if s["_tents"]:
            print(f"{tag} · 끝내 확정 못 한 임시 등록: {s['_open_tents']} · 임시로 올라간 정답에 없는 번호: {s['_tent_bad']}")
    if len(scores) == 2:
        b, n = scores.values()
        print(f"고친 뒤에 빠진 정답 번호: {sorted(x for x in b['_first'] if x in b['_selling'] and x not in n['_first'])}")
    if a.detail:
        detail(a.detail, scores, truth)
        print(f"번호별 표: {a.detail}")
    if a.events:
        os.makedirs(a.events, exist_ok=True)
        for tag, sc in scores.items():
            with open(os.path.join(a.events, f"{tag}.jsonl"), "w", encoding="utf-8") as f:
                for d, res in zip(runs, sc["_results"]):
                    rows = [dict(e, run=d["name"]) for e in res["events"]]
                    rows += [dict(b, kind="서버:" + kind, wall=at, run=d["name"]) for kind, at, b in res["calls"]]
                    for e in sorted(rows, key=lambda e: e["wall"]):
                        f.write(json.dumps(e, ensure_ascii=False) + "\n")
        print(f"이벤트: {a.events}")
    return scores


if __name__ == "__main__":
    main()
