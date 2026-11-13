# 번호표 추적(시제품, 개선 계획 B3·B4): 장면마다 찾은 번호표 후보를 장면 사이에 이어 "같은 딱지"로 묶고,
# 딱지마다 읽기를 모아 다수결로 번호를 정한다. 읽기가 쌓여 번호가 바뀌면 정정한다(11 → 17).
# 처음 보는 번호가 확정되면 그것이 "새 상품" 신호다. 사라졌다 같은 번호로 다시 보이면 같은 상품으로 본다.
#
#  - 이 파일은 순수 계산만 한다: 시계·파일·그림을 만지지 않는다. 시간은 장면 시각 t(초)로만 들어온다.
#    그림에서 번호표를 찾는 일은 sw/tagfind.py, 글자 읽기·채점은 sw/bench_tags.py.
#  - 입력: 장면 한 장의 후보들 Obs(x, y, w, h, reads) — 화면 0~1 좌표(왼쪽 위 원점), reads는 읽힌 숫자 글자들(못 읽었으면 빈 튜플).
#  - 출력: 사건(dict) — "새 딱지" · "번호 확정" · "번호 정정" · "다시 보임" · "사라짐" · "배경".
#  - 쓰는 법: st = State(); st, ev = step(st, t, obs_list, params)  (또는 TagTracker().feed(t, obs_list))
from __future__ import annotations

import math
from dataclasses import dataclass, field, replace

NEW, CONFIRM, CORRECT, AGAIN, GONE, STATIC = "새 딱지", "번호 확정", "번호 정정", "다시 보임", "사라짐", "배경"


@dataclass(frozen=True)
class Params:
    # 잇기(같은 딱지인가)
    gate: float = 0.10          # 바로 다음 장면에서 중심이 움직여도 되는 거리(화면 폭 대비)
    gate_per_sec: float = 0.45  # 장면 사이가 벌어질수록 더 느슨하게(초당). 카메라를 손에 들고 움직인다
    gate_max: float = 0.60
    gate_tight: float = 0.07    # "같은 자리"로 보는 거리: 읽기가 달라도 같은 딱지로 잇는다(초당 5장에서 한 장 사이)
    tight_dt: float = 0.5       # 같은 자리 규칙을 쓰는 장면 간격(초). 1초 1장에서는 꺼진다
    size_ratio: float = 2.5     # 크기(넓이의 제곱근)가 이 배수 넘게 달라지면 다른 딱지
    aspect: float = 9 / 16      # 세로 거리를 가로와 같은 자로 재려는 화면 비(높이/폭)
    lost_after: float = 1.5     # 이만큼 안 보이면 자리로는 더 잇지 않는다
    relink: float = 6.0         # 그 뒤에도 이 시간 안에 같은 번호가 읽히면 자리와 상관없이 같은 딱지
    gone_after: float = 3.0     # 이만큼 안 보이면 "사라짐"
    rejoin_within: float = 900.0  # 사라진 번호가 이 시간 안에 다시 확정되면 같은 상품("다시 보임")
    # 다수결
    min_seen: int = 2           # 이만큼 보여야 "새 딱지"로 알린다(한 장짜리 헛것 거르기)
    confirm_reads: int = 3      # 같은 번호로 온전히 읽힌 장수
    confirm_share: float = 0.6  # 자릿수 빠진 읽기를 뺀 읽기 중 그 번호의 비율
    correct_margin: int = 1     # 확정 뒤 다른 번호가 이만큼 더 많이 읽히면 정정
    digits: int | None = None   # 번호 자릿수를 아는 방송이면(예: 3) 그 자릿수만 번호로 인정
    confusable: tuple = (("1", "7"),)  # 글씨체 때문에 서로 헷갈리는 숫자: 다른 자리여도 같은 딱지의 읽기로 받는다
    # 배경(방송 내내 붙은 글자)
    static_after: float = 90.0  # 이만큼 보이는 동안
    static_spread: float = 0.012  # 중심이 이만큼도 안 움직였으면 배경


@dataclass(frozen=True)
class Obs:
    x: float
    y: float
    w: float
    h: float
    reads: tuple = ()

    @property
    def cx(self):
        return self.x + self.w / 2

    @property
    def cy(self):
        return self.y + self.h / 2


@dataclass(frozen=True)
class Vote:
    number: str | None
    full: int = 0       # 그 번호로 온전히 읽힌 수
    partial: int = 0    # 그 번호의 자릿수가 빠진 읽기 수(388의 "38")
    total: int = 0
    share: float = 0.0  # full / (total - partial)


@dataclass(frozen=True)
class Track:
    id: int
    t0: float
    t1: float
    x: float
    y: float
    w: float
    h: float
    vx: float = 0.0
    vy: float = 0.0
    seen: int = 1
    reads: tuple = ()           # ((읽기, 수), …)
    number: str | None = None   # 확정된 번호
    told: bool = False          # "새 딱지"를 알렸나
    gone: bool = False          # "사라짐"을 알렸나
    static: bool = False
    area: float = 0.0           # 가장 크게 보였을 때 넓이
    lo: tuple = (0.0, 0.0)      # 중심이 움직인 범위
    hi: tuple = (0.0, 0.0)
    first_no_t: float | None = None  # 번호가 처음 확정된 시각

    @property
    def cx(self):
        return self.x + self.w / 2

    @property
    def cy(self):
        return self.y + self.h / 2


@dataclass(frozen=True)
class State:
    tracks: tuple = ()
    next_id: int = 1
    owner: tuple = ()   # ((번호, 딱지 id), …) 확정 번호의 주인


# ---------- 읽기 비교 ----------
def is_partial(short, long):
    """short가 long에서 자릿수가 빠진 읽기인가(순서는 그대로): 388 → 38·88·3"""
    if not short or len(short) >= len(long):
        return False
    it = iter(long)
    return all(ch in it for ch in short)


def is_confusable(a, b, pairs=Params.confusable):
    """자릿수는 같고 다른 자리가 모두 헷갈리는 숫자 쌍인가: 11 ↔ 17"""
    if a == b or len(a) != len(b):
        return False
    ok = {frozenset(p) for p in pairs}
    return all(x == y or frozenset((x, y)) in ok for x, y in zip(a, b))


def relation(reads, number, pairs=Params.confusable):
    """딱지의 번호(확정 번호 또는 지금 1등)와 이번 읽기들의 사이: same / near / free / conflict"""
    if number is None or not reads:
        return "free"
    if number in reads:
        return "same"
    if any(is_partial(r, number) or is_partial(number, r) or is_confusable(r, number, pairs) for r in reads):
        return "near"
    return "conflict"


def vote(reads, digits=None):
    """읽기 묶음 {읽기: 수} → 다수결. 자릿수가 빠진 읽기는 긴 번호의 경쟁자가 아니라 약한 근거(반 표)로 센다.

    388이 5번, 38이 3번이면 388. 38이 10번, 388이 1번이면 38(긴 쪽이 헛읽기).
    """
    reads = dict(reads)
    total = sum(reads.values())
    best, key = None, None
    for q, n in reads.items():
        if not q or n <= 0 or (digits is not None and len(q) != digits):
            continue
        part = sum(c for r, c in reads.items() if is_partial(r, q))
        k = (n + 0.5 * part, n, len(q), q)
        if key is None or k > key:
            best, key = (q, n, part), k
    if best is None:
        return Vote(None, 0, 0, total, 0.0)
    q, n, part = best
    return Vote(q, n, part, total, n / (total - part) if total > part else 0.0)


def confirmed(v, p):
    return v.number is not None and v.full >= p.confirm_reads and v.share >= p.confirm_share


# ---------- 한 장 안에서 같은 딱지 합치기 ----------
def _overlap(a, b):
    ix = min(a.x + a.w, b.x + b.w) - max(a.x, b.x)
    iy = min(a.y + a.h, b.y + b.h) - max(a.y, b.y)
    if ix <= 0 or iy <= 0:
        return 0.0
    return ix * iy / min(a.w * a.h, b.w * b.h)


def merge_same_frame(obs, min_overlap=0.5):
    """한 장에서 같은 딱지를 두 번 읽은 것(전체 화면 읽기 + 확대 읽기)을 하나로. 읽기는 모두 표로 남긴다."""
    out = []
    for o in sorted(obs, key=lambda o: -(o.w * o.h)):
        for i, m in enumerate(out):
            if _overlap(o, m) >= min_overlap:
                out[i] = replace(m, reads=m.reads + o.reads)
                break
        else:
            out.append(o)
    return out


# ---------- 잇기 ----------
def _dist(ax, ay, bx, by, aspect):
    return math.hypot(ax - bx, (ay - by) * aspect)


def _pairs(tracks, obs, t, p):
    """이을 수 있는 (값, 딱지 차례, 후보 차례) — 값이 작을수록 먼저 잇는다"""
    out = []
    for i, k in enumerate(tracks):
        dt = t - k.t1
        if dt <= 0 or k.static and dt > p.lost_after:
            continue
        lead = k.number or vote(dict(k.reads), p.digits).number
        allow = min(p.gate_max, p.gate + p.gate_per_sec * dt)
        px, py = k.cx + k.vx * min(dt, 1.0), k.cy + k.vy * min(dt, 1.0)
        size_k = math.sqrt(k.w * k.h)
        for j, o in enumerate(obs):
            rel = relation(o.reads, lead, p.confusable)
            d = min(_dist(px, py, o.cx, o.cy, p.aspect), _dist(k.cx, k.cy, o.cx, o.cy, p.aspect))
            size_o = math.sqrt(o.w * o.h)
            size_ok = max(size_k, size_o) <= p.size_ratio * max(1e-6, min(size_k, size_o))
            near = dt <= p.lost_after and d <= allow and size_ok
            if rel == "conflict":
                # 읽기가 딴판이면 한 장 사이에 같은 자리일 때만 같은 딱지(그 뒤는 다수결이 가린다)
                if near and dt <= p.tight_dt and d <= p.gate_tight:
                    out.append((0.6 + d / allow, i, j))
            elif near:
                out.append((d / allow + (0.0 if rel == "same" else 0.2), i, j))
            elif rel == "same" and k.number is not None and dt <= p.relink:
                # 자리로는 못 이어도 확정 번호가 그대로 읽히면 같은 딱지(카메라가 크게 움직임, 손에 잠깐 가림)
                out.append((2.0 + d, i, j))
    return sorted(out)


def _add_reads(reads, new):
    """한 장에서 같은 읽기가 여러 번 나와도(전체 화면 읽기 + 확대 읽기) 한 표: 표의 단위는 "그렇게 읽힌 장면 수" """
    d = dict(reads)
    for r in sorted(set(new)):
        if r:
            d[r] = d.get(r, 0) + 1
    return tuple(sorted(d.items()))


def _sum_reads(a, b):
    d = dict(a)
    for r, n in b:
        d[r] = d.get(r, 0) + n
    return tuple(sorted(d.items()))


def _moved(k, o, t):
    dt = max(1e-6, t - k.t1)
    ocx, ocy = o.cx, o.cy
    return replace(
        k, t1=t, x=o.x, y=o.y, w=o.w, h=o.h,
        vx=(ocx - k.cx) / dt if dt <= 1.0 else 0.0, vy=(ocy - k.cy) / dt if dt <= 1.0 else 0.0,
        seen=k.seen + 1, reads=_add_reads(k.reads, o.reads), area=max(k.area, o.w * o.h),
        lo=(min(k.lo[0], ocx), min(k.lo[1], ocy)), hi=(max(k.hi[0], ocx), max(k.hi[1], ocy)),
    )


def _event(kind, t, k, **more):
    v = vote(dict(k.reads))
    e = {"kind": kind, "t": round(t, 2), "tag": k.id, "no": k.number, "reads": v.total,
         "since": round(k.t0, 2), "box": [round(k.x, 3), round(k.y, 3), round(k.w, 3), round(k.h, 3)]}
    e.update(more)
    return e


def step(state, t, obs, p=Params()):
    """장면 한 장을 넣는다 → (새 상태, 사건 목록). 상태를 고치지 않고 새로 만든다."""
    obs = merge_same_frame(obs)
    tracks = list(state.tracks)
    owner = dict(state.owner)
    events = []
    next_id = state.next_id

    used_t, used_o, touched = set(), set(), []
    for _, i, j in _pairs(tracks, obs, t, p):
        if i in used_t or j in used_o:
            continue
        used_t.add(i)
        used_o.add(j)
        tracks[i] = _moved(tracks[i], obs[j], t)
        touched.append(i)
    for j, o in enumerate(obs):
        if j in used_o:
            continue
        tracks.append(Track(id=next_id, t0=t, t1=t, x=o.x, y=o.y, w=o.w, h=o.h, reads=_add_reads((), o.reads),
                            area=o.w * o.h, lo=(o.cx, o.cy), hi=(o.cx, o.cy)))
        touched.append(len(tracks) - 1)
        next_id += 1

    seen_now = {tracks[i].id for i in touched}
    dead = set()
    for i in touched:
        k = tracks[i]
        if k.gone:
            # 사라졌다가 확정 번호가 다시 읽혀 이어진 딱지
            k = replace(k, gone=False)
            events.append(_event(AGAIN, t, k))
        if not k.told and k.seen >= p.min_seen:
            k = replace(k, told=True)
            events.append(_event(NEW, t, k))
        v = vote(dict(k.reads), p.digits)
        if k.number is None and confirmed(v, p):
            other = owner.get(v.number)
            host = next((n for n, q in enumerate(tracks) if q.id == other and n not in dead), None) if other is not None else None
            if host is not None and tracks[host].id in seen_now:
                pass  # 같은 번호의 딱지가 지금 따로 보인다: 둘 중 하나는 잘못 읽는 중이니 더 읽을 때까지 미룬다
            elif host is not None and k.t0 - tracks[host].t1 <= p.rejoin_within:
                # 앞서 확정한 번호가 다시 보인 것: 옛 딱지에 합친다(같은 상품)
                q = tracks[host]
                was_gone = q.gone
                k = replace(k, id=q.id, t0=q.t0, seen=q.seen + k.seen, reads=_sum_reads(q.reads, k.reads), number=q.number,
                            told=True, gone=False, area=max(q.area, k.area), first_no_t=q.first_no_t,
                            lo=k.lo, hi=k.hi)
                dead.add(host)
                # 잠깐 놓쳤다 이은 것(was_gone=False)도 알린다: "새 딱지"로 알린 임시 딱지가 어느 상품이었는지
                events.append(_event(AGAIN, t, k, away=round(k.t1 - q.t1, 2), merged=tracks[i].id, was_gone=was_gone))
            else:
                if host is not None:
                    dead.add(host)  # 아주 오래전에 사라진 같은 번호: 새 소개로 본다
                k = replace(k, number=v.number, first_no_t=t)
                owner[v.number] = k.id
                events.append(_event(CONFIRM, t, k, full=v.full, share=round(v.share, 2), again=host is not None))
        elif k.number is not None and v.number is not None and v.number != k.number:
            mine = dict(k.reads).get(k.number, 0)
            other = owner.get(v.number)
            host = next((n for n, q in enumerate(tracks) if q.id == other and n not in dead), None) if other not in (None, k.id) else None
            # 옛 번호가 새 번호의 자릿수 빠진 읽기였으면(38 → 388) 다수결이 뒤집힌 것으로 충분하다
            enough = v.full >= (0 if is_partial(k.number, v.number) else mine + p.correct_margin)
            if enough and v.full >= p.confirm_reads and not (host is not None and tracks[host].id in seen_now):
                if owner.get(k.number) == k.id:
                    del owner[k.number]
                old, more = k.number, {}
                if host is not None:
                    # 바로잡은 번호가 앞서 확정한 상품이었다: 그 딱지에 합친다
                    q = tracks[host]
                    more = {"merged": k.id}
                    k = replace(k, id=q.id, t0=q.t0, seen=q.seen + k.seen, reads=_sum_reads(q.reads, k.reads), gone=False,
                                area=max(q.area, k.area), first_no_t=q.first_no_t)
                    dead.add(host)
                k = replace(k, number=v.number)
                owner[v.number] = k.id
                events.append(_event(CORRECT, t, k, was=old, full=v.full, share=round(v.share, 2), **more))
        if not k.static and k.t1 - k.t0 >= p.static_after and max(k.hi[0] - k.lo[0], k.hi[1] - k.lo[1]) <= p.static_spread:
            k = replace(k, static=True)
            events.append(_event(STATIC, t, k))
        tracks[i] = k

    out = []
    for i, k in enumerate(tracks):
        if i in dead:
            continue
        away = t - k.t1
        if not k.told and away > p.lost_after:
            continue  # 한 장만 보인 헛것
        if k.told and not k.gone and away > p.gone_after:
            k = replace(k, gone=True)
            v = vote(dict(k.reads), p.digits)
            events.append(_event(GONE, t, k, last=round(k.t1, 2), full=dict(k.reads).get(k.number, 0) if k.number else 0,
                                 share=round(v.share, 2) if v.number == k.number else 0.0))
        if k.gone and (k.number is None or away > p.rejoin_within):
            if k.number is not None and owner.get(k.number) == k.id:
                del owner[k.number]
            continue
        out.append(k)
    return State(tuple(out), next_id, tuple(sorted(owner.items()))), events


def front(state, t, p=Params()):
    """지금 화면에서 가장 크게 보이는 딱지(판매자가 가까이 댄 것). 없으면 None"""
    live = [k for k in state.tracks if t - k.t1 <= p.lost_after and not k.static]
    return max(live, key=lambda k: k.w * k.h) if live else None


def products(events):
    """사건 열 → 번호별 요약 {번호: {first(처음 보인 시각), confirmed(확정 시각), last, reads, full, share, was(정정 전 번호들), again}}"""
    out = {}
    for e in events:
        no, tag = e.get("no"), e["tag"]
        if e["kind"] == CONFIRM:
            out[no] = {"no": no, "tag": tag, "first": e["since"], "confirmed": e["t"], "last": e["t"], "reads": e["reads"],
                       "full": e["full"], "share": e["share"], "was": [], "again": 0}
        elif e["kind"] == CORRECT:
            old = out.pop(e["was"], None)
            rec = out.get(no) or old or {"no": no, "tag": tag, "first": e["since"], "confirmed": e["t"], "was": [], "again": 0}
            rec["was"] = rec["was"] + [e["was"]]
            rec.update(no=no, tag=tag, last=e["t"], reads=e["reads"], full=e["full"], share=e["share"], corrected=e["t"])
            out[no] = rec
        elif e["kind"] in (GONE, AGAIN) and no in out:
            out[no]["last"] = e.get("last", e["t"])
            out[no]["reads"] = e["reads"]
            if e["kind"] == GONE:
                out[no]["full"], out[no]["share"] = e["full"], e["share"]
            else:
                out[no]["again"] += 1
    return out


@dataclass
class TagTracker:
    """상태를 들고 있는 얇은 껍데기: feed(t, 후보들) → 사건들. 사건은 events에 쌓인다."""
    params: Params = field(default_factory=Params)
    state: State = field(default_factory=State)
    events: list = field(default_factory=list)

    def feed(self, t, obs):
        self.state, ev = step(self.state, t, obs, self.params)
        self.events.extend(ev)
        return ev

    def finish(self, t):
        """방송 끝: 남은 딱지를 모두 "사라짐"으로 닫는다"""
        return self.feed(t + self.params.gone_after + 1e-3, [])

    def front(self, t):
        return front(self.state, t, self.params)

    def products(self):
        return products(self.events)
