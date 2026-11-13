# 번호표 추적 시험대(개선 계획 B0·B3·B4·D2): 번호표 찾기 → 잘라 읽기(모델 비교) → 추적·다수결 → 채점.
# 영상·장면·일꾼 기록은 저장소 밖에 둔다(손님 닉네임이 섞인 기록을 저장소에 넣지 않는다). 방법과 수치는 docs/tagtrack.md.
#
#   python -m sw.bench_tags frames <영상> <장면 폴더> --t0 0 --t1 1800 --fps 5      # 초당 5장 뽑기(ffmpeg)
#   python -m sw.bench_tags read <장면 폴더> <읽기.jsonl> --fps 5 --readers vision,pponnx:<onnx>@<yml>  # 찾기 + 잘라 읽기 + 장당 시간
#   python -m sw.bench_tags sheet <장면 폴더> <읽기.jsonl> <모음.jpg> --n 150        # 눈으로 확인할 딱지 모음 한 장
#   python -m sw.bench_tags score <읽기.jsonl…> --truth products.json [--screen screen.jsonl…]  # 한 장·상품 단위 정확도, 속도
#   python -m sw.bench_tags replay <일꾼 기록 폴더…> --truth products.json [--cases cases.json]  # 기존 screen.jsonl만으로 추적 + 오등록 효과
#   python -m sw.bench_tags align <읽기.jsonl> <일꾼 기록 폴더>                       # 영상 시각 ↔ 일꾼 시각 맞추기
#   python -m sw.bench_tags plant <장면 폴더> <plant.jsonl> --fps 1                  # "손에 든 포기가 가운데로" 가늠용 신호
#   python -m sw.bench_tags plantscore <plant.jsonl> --screen screen.jsonl           # 그 신호가 새 번호표보다 얼마나 먼저 뜨나
import argparse
import collections
import glob
import json
import math
import os
import re
import subprocess
import sys
import time

from . import tagtrack as T

DIGITS = re.compile(r"^\d{1,4}$")


# ---------- 읽기 모델 ----------
def clean(text):
    """읽힌 글자 → 숫자 글자 또는 None('419.' '4 19' → '419', 글자가 섞이면 None)"""
    s = re.sub(r"[\s.,·번]", "", text or "")
    return s if DIGITS.match(s) else None


class VisionReader:
    """지금 일꾼이 쓰는 Apple Vision(맥 전용)을 잘라 낸 딱지에"""
    name = "vision"

    def __init__(self, level="accurate"):
        from ocrmac import ocrmac
        self.ocr, self.level = ocrmac, level

    def read(self, crops):
        from PIL import Image
        out = []
        for c in crops:
            im = Image.fromarray(c[:, :, ::-1])
            best = None
            for txt, cf, _ in self.ocr.OCR(im, recognition_level=self.level, language_preference=["en-US"]).recognize():
                d = clean(txt)
                if d and (best is None or cf > best[1]):
                    best = (d, round(float(cf), 3))
            out.append(best)
        return out


class PaddleReader:
    """PaddleOCR 글자 인식 모델(PP-OCRv6_medium_rec 등). 글줄에 맞게 자른 조각을 넣는다"""
    name = "pp"

    def __init__(self, model="PP-OCRv6_medium_rec", batch=8):
        from paddleocr import TextRecognition
        self.m, self.batch = TextRecognition(model_name=model), batch

    def read(self, crops):
        if not crops:
            return []
        out = []
        for r in self.m.predict(input=list(crops), batch_size=self.batch):
            d = clean(r["rec_text"])
            out.append((d, round(float(r["rec_score"]), 3)) if d else None)
        return out


class OnnxReader:
    """같은 인식 모델의 ONNX 변환본(paddle2onnx)을 onnxruntime으로. 앞뒤 처리는 PaddleOCR과 같다(높이 48, CTC)"""
    name = "pponnx"
    wide = False   # True: Vision과 같은 넉넉한 조각을 받는다(찾기가 첫 숫자를 놓쳐도 조각 안에 들어오게)
    flip = False   # True: 거꾸로 선 딱지를 위해 180도 돌린 것도 읽어 확신이 높은 쪽을 쓴다

    def __init__(self, onnx_path, yml_path, providers=None):
        import onnxruntime as ort
        import yaml
        so = ort.SessionOptions()
        so.intra_op_num_threads = int(os.environ.get("TAG_ONNX_THREADS", "2"))
        self.s = ort.InferenceSession(onnx_path, so, providers=providers or ["CPUExecutionProvider"])
        self.inp = self.s.get_inputs()[0].name
        self.chars = [""] + list(yaml.safe_load(open(yml_path, encoding="utf-8"))["PostProcess"]["character_dict"]) + [" "]

    def read(self, crops):
        out = []
        for c in crops:
            best = self._one(c)
            if self.flip:
                other = self._one(c[::-1, ::-1])
                if other and (best is None or (len(other[0]), other[1]) > (len(best[0]), best[1])):
                    best = other
            out.append(best)
        return out

    def _one(self, c):
        import cv2
        import numpy as np
        c = np.ascontiguousarray(c)
        h, w = c.shape[:2]
        nw = max(16, min(320, int(round(48 * w / h))))
        x = cv2.resize(c, (nw, 48)).astype("float32") / 255.0
        x = ((x - 0.5) / 0.5).transpose(2, 0, 1)[None]
        pad = np.zeros((1, 3, 48, max(nw, 160)), "float32")
        pad[:, :, :, :nw] = x
        p = self.s.run(None, {self.inp: pad})[0][0]
        idx, prob = p.argmax(1), p.max(1)
        txt, cf, prev = [], [], 0
        for i, q in zip(idx, prob):   # CTC: 빈칸(0)과 같은 글자의 되풀이를 걷어 낸다
            if i != 0 and i != prev:
                txt.append(self.chars[i] if i < len(self.chars) else "")
                cf.append(float(q))
            prev = i
        d = clean("".join(txt))
        return (d, round(sum(cf) / len(cf), 3)) if d and cf else None


def make_reader(name):
    if name == "vision":
        return VisionReader()
    if name == "visionfast":
        r = VisionReader("fast")
        r.name = "visionfast"
        return r
    if name == "pp":
        return PaddleReader()
    if name.startswith("pp:"):
        r = PaddleReader(name[3:])
        r.name = name
        return r
    if name.startswith("pponnx"):
        kind, path = name.split(":", 1)   # pponnx[w][f]:<모델.onnx>@<inference.yml> — w = 넉넉한 조각, f = 거꾸로도 읽기
        onnx, yml = path.split("@")
        r = OnnxReader(onnx, yml)
        r.name, r.wide, r.flip = kind, "w" in kind[6:], "f" in kind[6:]
        return r
    raise SystemExit(f"모르는 읽기 모델: {name}")


# ---------- 장면 뽑기·읽기 ----------
def cmd_frames(a):
    os.makedirs(a.out, exist_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-threads", str(a.threads), "-ss", str(a.t0)]
    if a.t1:
        cmd += ["-t", str(a.t1 - a.t0)]
    cmd += ["-i", a.video, "-vf", f"fps={a.fps}", "-q:v", "4", "-start_number", "0", os.path.join(a.out, "%06d.jpg")]
    subprocess.run(cmd, check=True)
    json.dump({"video": a.video, "t0": a.t0, "t1": a.t1, "fps": a.fps}, open(os.path.join(a.out, "frames.json"), "w"))
    print("장면", len(glob.glob(os.path.join(a.out, "*.jpg"))), "장 →", a.out)


def frame_list(folder, every=1, limit=0, start=0):
    fs = sorted(f for f in os.listdir(folder) if f.endswith(".jpg"))[start::every]
    return fs[:limit] if limit else fs


def cmd_read(a):
    import cv2
    from . import tagfind as F
    readers = [make_reader(n) for n in a.readers.split(",") if n]
    fs = frame_list(a.frames, a.every, a.limit, a.start)
    done = set()
    if a.resume and os.path.exists(a.out):
        keep = load_reads(a.out)
        done = {r["f"] for r in keep}
        with open(a.out, "w", encoding="utf-8") as o:   # 끊긴 줄을 걷어 내고 이어 쓴다
            for r in keep:
                o.write(json.dumps(r, ensure_ascii=False) + "\n")
    o = open(a.out, "a" if a.resume else "w", encoding="utf-8")
    static = F.StaticMask(horizon=max(30, int(a.static_sec * a.fps / a.every))) if a.static_sec else None
    t_all = time.perf_counter()
    for n, f in enumerate(fs):
        if f in done:
            continue
        i = int(f[:6])
        ms = {}
        t = time.perf_counter()
        img = cv2.imread(os.path.join(a.frames, f))
        ms["load"] = (time.perf_counter() - t) * 1000
        t = time.perf_counter()
        if static:
            static.update(img)
        tags = F.find_tags(img, ignore=static.mask() if static else None)[:a.max_tags]
        # Vision: 여백을 넉넉히, 옆에 잘린 숫자가 있으면 넓혀서(맞음 85.6% → 89.6%)
        crops = [F.crop_tag(img, g, pad=0.35, height=96, extend=True) for g in tags]
        # 글자 인식 모델: 글줄에 딱 맞게, 높이 48. 넓히면 숫자 아닌 것이 섞여 오히려 나빠졌다(89.6% → 87.3%)
        lines = [F.crop_tag(img, g, pad=0.12, height=48, extend=False) for g in tags]
        ms["find"] = (time.perf_counter() - t) * 1000
        rec = {"f": f, "i": i, "t": round(a.t0 + i / a.fps, 3),
               "tags": [{"box": [round(float(v), 4) for v in (g.x, g.y, g.w, g.h)], "score": float(g.score), "chars": g.chars} for g in tags]}
        for r in readers:
            t = time.perf_counter()
            res = r.read(crops if r.name.startswith("vision") or getattr(r, "wide", False) else lines)
            ms[r.name] = (time.perf_counter() - t) * 1000
            for g, x in zip(rec["tags"], res):
                g[r.name] = list(x) if x else None
        rec["ms"] = {k: round(v, 1) for k, v in ms.items()}
        o.write(json.dumps(rec, ensure_ascii=False) + "\n")
        if n % 200 == 0:
            o.flush()
            print(f"{n}/{len(fs)}  {time.perf_counter() - t_all:.0f}초", flush=True)
        if a.sleep:
            time.sleep(a.sleep)
    o.close()
    print("끝", len(fs), "장", f"{time.perf_counter() - t_all:.0f}초")


def load_reads(path):
    """읽기.jsonl → 시각순 줄들. 중간에 멈춘 실행이 남긴 끊긴 마지막 줄은 버린다"""
    rows = []
    for l in open(path, encoding="utf-8"):
        try:
            rows.append(json.loads(l))
        except json.JSONDecodeError:
            pass
    return sorted(rows, key=lambda r: r["t"])


def cmd_sheet(a):
    """눈으로 확인: 딱지 조각을 고르게 뽑아 한 장에 붙이고, 아래에 모델별 읽기를 적는다"""
    import cv2
    import numpy as np
    from . import tagfind as F
    rows = [r for r in load_reads(a.reads) if r["tags"]]
    cells = [(r, k) for r in rows for k in range(len(r["tags"]))]
    step = max(1, len(cells) // a.n)
    cells = cells[a.offset::step][:a.n]
    cw, ch, cols = 150, 60, a.cols
    sheet = np.full(((len(cells) + cols - 1) // cols * (ch + 30), cols * cw, 3), 40, np.uint8)
    for n, (r, k) in enumerate(cells):
        img = cv2.imread(os.path.join(a.frames, r["f"]))
        g = F.find_tags(img)
        tag = r["tags"][k]
        m = min(g, key=lambda q: abs(q.x - tag["box"][0]) + abs(q.y - tag["box"][1]), default=None)
        if m is None:
            continue
        c = F.crop_tag(img, m, height=ch)
        c = c[:, :cw - 4]
        y, x = (n // cols) * (ch + 30), (n % cols) * cw
        sheet[y:y + c.shape[0], x:x + c.shape[1]] = c
        label = " ".join(f"{name[0].upper()}:{(tag.get(name) or ['-'])[0]}" for name in a.readers.split(","))
        cv2.putText(sheet, label, (x + 2, y + ch + 12), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(sheet, f"{r['i']}", (x + 2, y + ch + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.33, (150, 150, 150), 1, cv2.LINE_AA)
    cv2.imwrite(a.out, sheet, [cv2.IMWRITE_JPEG_QUALITY, a.quality])
    print(a.out, len(cells), "조각")


# ---------- 추적·채점 ----------
def valid_numbers(truth_path, lo=200, hi=499):
    """방송 끝 상품 목록에서 판매자가 남긴 번호(그 날 쓴 번호대 안)"""
    P = json.load(open(truth_path, encoding="utf-8"))["products"]
    return {str(p["no"]) for p in P if p["phase"] == "SELLING" and lo <= p["no"] <= hi}


def to_obs(row, reader, min_conf=0.0):
    out = []
    for g in row["tags"]:
        x = g.get(reader)
        reads = (x[0],) if x and x[1] >= min_conf else ()
        out.append(T.Obs(g["box"][0], g["box"][1], g["box"][2], g["box"][3], reads))
    return out


def run_tracker(rows, reader, params, min_conf=0.0, need_read=False):
    """읽기 줄들 → (추적기, 장면별 [(딱지 id, 후보 차례)]). need_read: 읽힌 후보만 넣는다(못 읽은 흰 조각은 버림)"""
    tr = T.TagTracker(params)
    for r in rows:
        obs = to_obs(r, reader, min_conf)
        if need_read:
            obs = [o for o in obs if o.reads]
        tr.feed(r["t"], obs)
    if rows:
        tr.finish(rows[-1]["t"])
    return tr


def classify(read, truth):
    if read is None:
        return "못 읽음"
    if read == truth:
        return "맞음"
    if T.is_partial(read, truth):
        return "자릿수 빠짐"
    return "다른 번호"


def truth_by_track(frames, valid, params):
    """후보마다의 근사 정답: 읽기를 추적·다수결한 딱지의 번호가 그 날 상품 목록에 있을 때만 정답으로 쓴다.

    frames: [(장면 이름, 시각, [Obs])] → {(장면 이름, 후보 차례): 번호}
    """
    st, owner_of = T.State(), {}
    assigned = []  # (장면, 차례, 딱지 id)
    final = {}
    for key, t, obs in frames:
        keep = [(k, o) for k, o in enumerate(obs) if o.reads]
        st, ev = T.step(st, t, [o for _, o in keep], params)
        for e in ev:
            if e["kind"] in (T.AGAIN, T.CORRECT) and "merged" in e:
                owner_of[e["merged"]] = e["tag"]
        for k, o in keep:
            m = [q for q in st.tracks if q.t1 == t and abs(q.x - o.x) < 1e-9 and abs(q.y - o.y) < 1e-9]
            if m:
                assigned.append((key, k, m[0].id))
        for q in st.tracks:
            if q.number:
                final[q.id] = q.number

    def root(i):
        while i in owner_of and owner_of[i] != i:
            i = owner_of[i]
        return i
    out = {}
    for key, k, tid in assigned:
        no = final.get(root(tid))
        if no in valid:
            out[(key, k)] = no
    return out


def truth_per_crop(rows, readers, valid, params):
    """딱지 조각의 정답: 모델 하나에 치우치지 않게 모든 모델의 읽기를 한데 모아 다수결한다 → {(장면 파일, 후보 차례): 번호}"""
    frames = [(r["f"], r["t"], [T.Obs(g["box"][0], g["box"][1], g["box"][2], g["box"][3], tuple(g[n][0] for n in readers if g.get(n))) for g in r["tags"]])
              for r in rows]
    return truth_by_track(frames, valid, params)


def how(got, no):
    """그 장면에서 한 방법이 낸 읽기들(got)이 정답 번호 no를: 맞음 / 자릿수 빠짐 / 다른 번호 / 못 읽음"""
    if no in got:
        return "맞음"
    if any(T.is_partial(x, no) for x in got):
        return "자릿수 빠짐"
    return "다른 번호" if got else "못 읽음"


KINDS = ("맞음", "자릿수 빠짐", "다른 번호", "못 읽음")


def cmd_score(a):
    readers = [n for n in a.readers.split(",") if n]
    valid = valid_numbers(a.truth) if a.truth else None
    p = T.Params(**json.loads(a.params)) if a.params else T.Params()
    crop = {n: collections.Counter() for n in readers}
    frame = {n: collections.Counter() for n in ["지금(전체 화면 두 번)"] + readers}
    prod = {n: {"확정": set(), "정정": 0, "새 딱지": 0, "다시 보임": 0, "걸린": []} for n in readers}
    ms = collections.defaultdict(list)
    n_rows = n_tags = 0
    for fi, path in enumerate(a.reads):
        rows = load_reads(path)
        n_rows += len(rows)
        n_tags += sum(len(r["tags"]) for r in rows)
        span = (rows[0]["t"], rows[-1]["t"])
        print(f"{os.path.basename(path)}: 장면 {len(rows)}장 · {span[0]:.0f}~{span[1]:.0f}초 · 초당 {(len(rows) - 1) / max(1e-9, span[1] - span[0]):.2f}장")
        # 1) 딱지 한 장
        truth = truth_per_crop(rows, readers, valid, p) if valid else {}
        by = {(r["f"], k): g for r in rows for k, g in enumerate(r["tags"])}
        for key, no in truth.items():
            for n in readers:
                crop[n][classify((by[key].get(n) or [None])[0], no)] += 1
        # 2) 추적 + 다수결 뒤 상품 단위
        for n in readers:
            tr = run_tracker(rows, n, p, need_read=True)
            k = collections.Counter(e["kind"] for e in tr.events)
            prod[n]["확정"] |= set(tr.products())
            prod[n]["정정"] += k[T.CORRECT]
            prod[n]["새 딱지"] += k[T.NEW]
            prod[n]["다시 보임"] += k[T.AGAIN]
            prod[n]["걸린"] += [e["t"] - e["since"] for e in tr.events if e["kind"] == T.CONFIRM and (not valid or e["no"] in valid)]
            if a.events:
                with open(a.events.replace("{reader}", n).replace("{n}", str(fi)), "w", encoding="utf-8") as o:
                    for e in tr.events:
                        o.write(json.dumps(e, ensure_ascii=False) + "\n")
        for r in rows:
            for k, v in r.get("ms", {}).items():
                ms[k].append(v)
            for n in readers:
                ms["찾기+" + n].append(r["ms"].get("load", 0) + r["ms"].get("find", 0) + r["ms"].get(n, 0))
        # 3) 같은 장면에서 지금 방식(전체 화면 Vision 두 번 = 그 실행의 screen.jsonl)과 견주기
        if a.screen and valid:
            base = {d["sec"]: d["t"] for d in map(json.loads, open(a.screen[fi], encoding="utf-8"))}
            bt = truth_by_track([(sec, float(sec), [T.Obs(z[1], z[2], z[3], z[4], (str(z[0]),)) for z in base[sec]]) for sec in sorted(base)], valid, p)
            want = collections.defaultdict(set)   # 장면(초) → 그 장면에 보인 정답 번호들(어느 방법으로든 딱지에 붙은 것)
            for (f, k), no in truth.items():
                want[int(f[:6])].add(no)
            for (sec, k), no in bt.items():
                want[sec].add(no)
            idx = {r["i"]: r for r in rows}
            for sec, nos in want.items():
                r = idx.get(sec)
                if r is None:
                    continue
                for no in nos:
                    frame["지금(전체 화면 두 번)"][how([str(z[0]) for z in base.get(sec, [])], no)] += 1
                    for n in readers:
                        frame[n][how([g[n][0] for g in r["tags"] if g.get(n)], no)] += 1
    print(f"\n모두 장면 {n_rows}장 · 딱지 후보 {n_tags}개(장당 {n_tags / max(1, n_rows):.2f})")
    if valid:
        print("\n[딱지 한 장] 찾은 조각 가운데 근사 정답이 붙은 것(모든 모델 읽기를 모은 다수결 번호가 그 날 상품 목록에 있는 딱지)")
        for n in readers:
            c, tot = crop[n], sum(crop[n].values())
            read = tot - c["못 읽음"]
            print(f"  {n:10s} {tot}조각: " + " · ".join(f"{k} {c[k]}({c[k] / max(1, tot):.1%})" for k in KINDS)
                  + f" | 읽은 것 중 맞음 {c['맞음'] / max(1, read):.1%} · 자릿수 빠짐 {c['자릿수 빠짐'] / max(1, read):.1%} · 다른 번호 {c['다른 번호'] / max(1, read):.1%}")
    print("\n[추적 다수결 뒤 상품 단위]")
    for n in readers:
        got = prod[n]["확정"]
        line = f"  {n:10s} 확정 번호 {len(got)}개 · 정정 {prod[n]['정정']}번 · 새 딱지 {prod[n]['새 딱지']} · 다시 보임 {prod[n]['다시 보임']}"
        if valid:
            bad = sorted(got - valid, key=lambda x: (len(x), x))
            line += f" · 상품 목록에 있는 번호 {len(got & valid)}개(확정의 {len(got & valid) / max(1, len(got)):.1%}, 상품 {len(valid)}개의 {len(got & valid) / len(valid):.1%}) · 없는 번호 {len(bad)}개 {bad[:40]}"
        d = sorted(prod[n]["걸린"])
        if d:
            line += f"\n  {'':10s} 딱지가 처음 보인 뒤 번호 확정까지: 가운데값 {d[len(d) // 2]:.1f}초 · 90% {d[int(len(d) * 0.9)]:.1f}초"
        print(line)
    print("\n[장당 처리 시간 ms] 가운데값 / 90% / 평균")
    for k in sorted(ms):
        v = sorted(ms[k])
        mean = sum(v) / len(v)
        extra = f"  → 한 프로세스로 초당 {1000 / mean:.1f}장, 초당 5장이면 한 코어의 {mean * 5 / 10:.0f}%" if k.startswith("찾기+") else ""
        print(f"  {k:14s} {v[len(v) // 2]:7.1f} / {v[int(len(v) * 0.9)]:7.1f} / {mean:7.1f}{extra}")
    if a.screen and valid:
        print("\n[같은 장면에서: 그 장면에 보인 번호표를 맞게 읽었나] (어느 방법으로든 딱지에 정답이 붙은 장면·번호 쌍)")
        for n, c in frame.items():
            tot = sum(c.values())
            print(f"  {n:16s} {tot}쌍: " + " · ".join(f"{k} {c[k]}({c[k] / max(1, tot):.1%})" for k in KINDS))


# ---------- 기존 일꾼 기록(screen.jsonl)만으로 ----------
def hms(s):
    h, m, x = s.split(":")
    return int(h) * 3600 + int(m) * 60 + int(x)


def load_run(d, params):
    rows = sorted((json.loads(l) for l in open(os.path.join(d, "screen.jsonl"), encoding="utf-8")), key=lambda r: r["sec"])
    ev = [json.loads(l) for l in open(os.path.join(d, "events.jsonl"), encoding="utf-8")]
    tr, snaps = T.TagTracker(params), {}
    for r in rows:
        tr.feed(float(r["sec"]), [T.Obs(z[1], z[2], z[3], z[4], (str(z[0]),)) for z in r["t"]])
        snaps[r["sec"]] = tr.state
    if rows:
        tr.finish(rows[-1]["sec"])
    return {"dir": d, "rows": rows, "events": ev, "tracker": tr, "snaps": snaps}


def state_at(run, sec):
    import bisect
    keys = run.get("keys")
    if keys is None:
        keys = run["keys"] = sorted(run["snaps"])
    i = bisect.bisect_right(keys, sec)
    return run["snaps"][keys[i - 1]] if i else T.State()


def verdict(run, no, s, e, p, grace=2.0, old=45.0, wait=15.0):
    """등록 하나(번호 no, 판매자 말 [s, e]초)를 추적기가 그때 알던 것으로 판정.

    통과: 그 번호가 확정된 딱지이고 말하는 동안(±grace) 화면에 보였으며, 묵은 딱지(old초 넘게 전부터 보임)가 아니다.
    보류: 그 밖. 보류한 등록은 wait초 안에 새로 확정되는 딱지가 있으면 그 번호로 간다(새 딱지 = 새 상품).
    """
    st = state_at(run, e + grace)
    mine = [k for k in st.tracks if k.number == str(no)]
    seen = [k for k in mine if k.t1 >= s - grace]
    if not mine:
        why = "확정된 딱지가 아님"
    elif not seen:
        why = "말할 때 화면에 없음"
    elif s - seen[0].t0 > old and not any(ev["kind"] == T.AGAIN and ev["no"] == str(no) and s - old <= ev["t"] <= e + grace
                                          for ev in run["tracker"].events):
        why = "묵은 딱지"
    else:
        return {"pass": True, "why": "확정된 딱지가 보임", "next": None}
    nxt = next((ev for ev in run["tracker"].events
                if ev["kind"] in (T.CONFIRM, T.CORRECT) and e - 5 <= ev["t"] <= e + wait and ev["no"] != str(no)), None)
    return {"pass": False, "why": why, "next": nxt["no"] if nxt else None}


def load_video(reads, reader, params, offsets, runs):
    """영상에서 뽑은 장면의 읽기(영상 시각) 하나로 추적하고, 일꾼 실행마다 그 실행의 시각으로 옮겨 볼 수 있게 한다.

    offsets: {폴더 이름 끝 6자리(시작 시각): 영상 시각 − 일꾼 시각}. 추적기는 방송 내내 하나(다시 떠도 기억이 이어진다)."""
    rows = load_reads(reads)
    tr, snaps = T.TagTracker(params), {}
    for r in rows:
        tr.feed(r["t"], [o for o in to_obs(r, reader) if o.reads])
        snaps[r["t"]] = tr.state
    tr.finish(rows[-1]["t"])
    keys = sorted(snaps)
    for run in runs:
        off = offsets[os.path.basename(run["dir"])[-6:]]
        run.update(off=off, tracker=tr, snaps=snaps, keys=keys)
    return tr, rows


def cmd_replay(a):
    p = T.Params(**json.loads(a.params)) if a.params else T.Params()
    valid = valid_numbers(a.truth)
    runs = [load_run(d, p) for d in sorted(a.runs)]
    allp = collections.defaultdict(list)
    raw = collections.Counter()
    if a.reads:
        tr, vrows = load_video(a.reads, a.reader, p, json.loads(a.offsets), runs)
        pr = tr.products()
        k = collections.Counter(e["kind"] for e in tr.events)
        print(f"영상 읽기({a.reader}) 장면 {len(vrows)} · 새 딱지 {k[T.NEW]} · 번호 확정 {k[T.CONFIRM]} · 정정 {k[T.CORRECT]} · 다시 보임 {k[T.AGAIN]} · 배경 {k[T.STATIC]}")
        for e in tr.events:
            if e["kind"] == T.CORRECT:
                print(f"    정정 {e['t']:.1f}초 {e['was']} → {e['no']}")
        for n, x in pr.items():
            allp[n].append(x)
        for r in vrows:
            for g in r["tags"]:
                if g.get(a.reader):
                    raw["전체"] += 1
                    raw["상품 목록에 있는 번호" if g[a.reader][0] in valid else "없는 번호"] += 1
    for run in ([] if a.reads else runs):
        tr = run["tracker"]
        pr = tr.products()
        k = collections.Counter(e["kind"] for e in tr.events)
        bad = sorted(n for n in pr if n not in valid)
        print(f"{os.path.basename(run['dir'])}: 장면 {len(run['rows'])} · 새 딱지 {k[T.NEW]} · 번호 확정 {k[T.CONFIRM]} · 정정 {k[T.CORRECT]} · 다시 보임 {k[T.AGAIN]} · 확정 번호 {len(pr)}개, 상품 목록에 없는 것 {bad}")
        for e in tr.events:
            if e["kind"] == T.CORRECT:
                print(f"    정정 {e['t']:.0f}초 {e['was']} → {e['no']}")
        for n, x in pr.items():
            allp[n].append(x)
        for r in run["rows"]:
            for z in r["t"]:
                raw["전체"] += 1
                raw["상품 목록에 있는 번호" if str(z[0]) in valid else "없는 번호"] += 1
    print(f"\n읽기 {raw['전체']}번 중 상품 목록에 없는 번호 {raw['없는 번호']}번({raw['없는 번호'] / max(1, raw['전체']):.1%})")
    print(f"추적 다수결로 확정된 번호 {len(allp)}개: 상품 목록에 있는 번호 {len(set(allp) & valid)}/{len(valid)}, 없는 번호 {sorted(set(allp) - valid)}")
    print(f"확정되지 않은 상품 번호: {sorted(valid - set(allp))}")
    # 어제 등록(LLM등록) 전체에 판정 규칙을 대 본다
    cases = json.load(open(a.cases, encoding="utf-8")) if a.cases else {"missing": [], "stale": []}
    stale = {(c["at"], c["no"]): c["right"] for c in cases["stale"]}
    missing = {(c["at"], c["no"]) for c in cases["missing"]}
    tally = collections.Counter()
    rows = []
    for run in runs:
        for e in run["events"]:
            if e["kind"] != "LLM등록" or not e.get("sent", True):
                continue
            off = run.get("off", 0.0)   # 영상 읽기로 볼 때는 일꾼 시각을 영상 시각으로 옮긴다
            s, en = e["start_sec"] + off, e.get("line_end_sec", e["start_sec"]) + off
            v = verdict(run, e["no"], s, en, p, a.grace, a.old, a.wait)
            key = next((k for k in list(stale) + list(missing) if k[1] == e["no"] and abs(hms(k[0]) - hms(e["at"])) <= a.at_tol), None)
            kind = "없는 번호" if key in missing else "앞 번호" if key in stale else ("없는 번호(표 밖)" if str(e["no"]) not in valid else "맞는 등록")
            tally[(kind, "통과" if v["pass"] else "보류")] += 1
            if not v["pass"] and kind == "맞는 등록":
                tally[("맞는 등록 보류 까닭", v["why"])] += 1
                # 보류한 맞는 등록: 그 번호가 뒤에 확정돼 풀리는 데 걸린 시간
                later = next((ev["t"] for ev in run["tracker"].events if ev["kind"] in (T.CONFIRM, T.CORRECT, T.AGAIN) and ev["no"] == str(e["no"]) and ev["t"] >= en), None)
                tally[("맞는 등록 보류", "뒤에 확정됨" if later is not None and later - en <= a.wait else "안 풀림" if later is None else "늦게 확정")] += 1
            rows.append((e["at"], e["no"], kind, v, stale.get(key)))
    print("\n[어제 등록에 규칙을 댔을 때] (통과 = 그대로 등록, 보류 = 임시로 두고 새 딱지를 기다림)")
    for kind in ("없는 번호", "없는 번호(표 밖)", "앞 번호", "맞는 등록"):
        ps, hd = tally[(kind, "통과")], tally[(kind, "보류")]
        if ps + hd:
            print(f"  {kind:12s} {ps + hd}건 → 보류 {hd} · 통과 {ps}")
    print("  맞는 등록 보류의 까닭:", {k[1]: v for k, v in tally.items() if k[0] == "맞는 등록 보류 까닭"})
    print(f"  맞는 등록 보류의 뒤({a.wait:.0f}초 안에 그 번호가 확정되면 풀림):", {k[1]: v for k, v in tally.items() if k[0] == "맞는 등록 보류"})
    for at, no, kind, v, right in sorted(rows):
        if kind != "맞는 등록" or a.verbose:
            print(f"    {at} {no:>4}번 {kind:10s} {'통과' if v['pass'] else '보류'} ({v['why']})" + (f" · 맞는 번호 {right}" if right else "") + (f" · 뒤이어 확정된 새 딱지 {v['next']}" if v["next"] else ""))
    found = {(k, n) for k in list(stale) + list(missing) for at, n, kind, v, r in rows if k[1] == n and abs(hms(k[0]) - hms(at)) <= a.at_tol}
    lost = [k for k in list(stale) + list(missing) if (k, k[1]) not in found]
    if lost:
        print("  기록에서 못 찾은 사례:", lost)


def cmd_align(a):
    """영상에서 읽은 번호(영상 시각)와 일꾼 기록 screen.jsonl(일꾼 시각 = 일꾼이 뜬 뒤 초)을 겹쳐 가장 잘 맞는 차이를 찾는다.

    영상 시각 = 일꾼 시각 + offset. 처음 짐작은 (폴더 이름의 시작 시각 − 방송 시작 시각)."""
    rows = load_reads(a.reads)
    video = collections.defaultdict(set)
    for r in rows:
        for g in r["tags"]:
            x = g.get(a.reader)
            if x:
                video[round(r["t"] * 5)].add(x[0])
    worker = {d["sec"]: {str(z[0]) for z in d["t"]} for d in map(json.loads, open(os.path.join(a.run, "screen.jsonl"), encoding="utf-8"))}
    worker = {s: v for s, v in worker.items() if v}
    best = []
    k = a.guess - a.span
    while k <= a.guess + a.span:
        hit = tot = 0
        for s, nums in worker.items():
            got = video.get(round((s + k) * 5))
            if got is None:
                continue
            tot += 1
            hit += bool(nums & got)
        if tot >= 30:
            best.append((hit / tot, hit, tot, round(k, 1)))
        k += 0.2
    best.sort(reverse=True)
    for b in best[:5]:
        print(f"offset {b[3]:8.1f}초  일치 {b[1]}/{b[2]} ({b[0]:.1%})")


# ---------- 식물 가늠 ----------
def cmd_plant(a):
    """장면마다 가벼운 신호를 적는다: 살색 넓이, 화면 가운데 선명도, 앞 장면과의 차이(가운데). 판정은 문서의 분석 참고"""
    import cv2
    import numpy as np
    fs = frame_list(a.frames, a.every, a.limit)
    prev = None
    with open(a.out, "w", encoding="utf-8") as o:
        for f in fs:
            i = int(f[:6])
            t0 = time.perf_counter()
            img = cv2.imread(os.path.join(a.frames, f))
            small = cv2.resize(img, (320, 180), interpolation=cv2.INTER_AREA)
            ycc = cv2.cvtColor(small, cv2.COLOR_BGR2YCrCb)
            skin = ((ycc[:, :, 1] >= 138) & (ycc[:, :, 1] <= 175) & (ycc[:, :, 2] >= 85) & (ycc[:, :, 2] <= 130) & (ycc[:, :, 0] >= 70))
            g = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            c = g[36:144, 64:256]
            lap = cv2.Laplacian(g, cv2.CV_32F)
            sharp_c, sharp_o = float(lap[36:144, 64:256].var()), float(np.concatenate([lap[:36].ravel(), lap[144:].ravel()]).var())
            diff = float(np.abs(c.astype(np.int16) - prev.astype(np.int16)).mean()) if prev is not None else 0.0
            prev = c
            ys, xs = np.nonzero(skin)
            hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
            plant = (hsv[:, :, 1] >= 70) & ~skin   # 색이 짙은 점(잎) — 자갈·흙·종이는 색이 옅다
            o.write(json.dumps({"i": i, "t": round(a.t0 + i / a.fps, 3), "skin": round(float(skin.mean()), 4),
                                "skin_c": round(float(skin[36:144, 64:256].mean()), 4),
                                "skin_x": round(float(xs.mean()) / 320, 3) if len(xs) else None,
                                "plant_c": round(float(plant[36:144, 64:256].mean()), 4),
                                "sharp_c": round(sharp_c, 1), "sharp_o": round(sharp_o, 1), "diff_c": round(diff, 2),
                                "ms": round((time.perf_counter() - t0) * 1000, 1)}) + "\n")
    print("끝", len(fs))


def onsets(rows, key, on, off, quiet=3.0):
    """신호가 off 아래로 quiet초 넘게 있다가 on 위로 올라온 순간들"""
    out, low_since, high = [], None, False
    for r in rows:
        v = r.get(key) or 0.0
        if v >= on:
            if not high and low_since is not None and r["t"] - low_since >= quiet:
                out.append(r["t"])
            high, low_since = True, None
        elif v < off:
            if high or low_since is None:
                low_since = r["t"]
            high = False
    return out


def cmd_plantscore(a):
    """가벼운 신호(살색·가운데 변화·가운데 선명도)가 새 번호표보다 얼마나 먼저 뜨는지 가늠한다.

    새 상품 시각 = 추적기가 처음 확정한 번호의 딱지가 처음 보인 시각(since). 신호가 그 앞 window초 안에 켜졌으면 "앞서 잡음"."""
    rows = sorted((json.loads(l) for l in open(a.plant, encoding="utf-8")), key=lambda r: r["t"])
    p = T.Params(**json.loads(a.params)) if a.params else T.Params(digits=3)
    tr = T.TagTracker(p)
    for d in sorted((json.loads(l) for l in open(a.screen, encoding="utf-8")), key=lambda d: d["sec"]):
        if rows[0]["t"] <= d["sec"] <= rows[-1]["t"]:
            tr.feed(float(d["sec"]), [T.Obs(z[1], z[2], z[3], z[4], (str(z[0]),)) for z in d["t"]])
    intro = sorted(e["since"] for e in tr.events if e["kind"] == T.CONFIRM and not e["again"])
    print(f"구간 {rows[0]['t']:.0f}~{rows[-1]['t']:.0f}초 · 장면 {len(rows)}장 · 새 번호표 {len(intro)}개")
    ms = sorted(r["ms"] for r in rows)
    print(f"신호 계산 {ms[len(ms) // 2]:.1f}ms/장(가운데값)")
    def pct(key, q):
        v = sorted(r.get(key) or 0.0 for r in rows)
        return v[int((len(v) - 1) * q)]
    # 손에 든 포기: 살색(손)이 넓고 가운데에 색 짙은 잎이 넓다 — 둘 다 그 구간의 위쪽 30%일 때 1
    s_on, p_on = pct("skin", 0.7), pct("plant_c", 0.7)
    for r in rows:
        r["hold"] = 1.0 if (r.get("skin") or 0) >= s_on and (r.get("plant_c") or 0) >= p_on else 0.0
    tests = [("살색 넓이(화면 전체)", "skin", pct("skin", 0.7), pct("skin", 0.5)),
             ("살색 넓이(가운데)", "skin_c", pct("skin_c", 0.7), pct("skin_c", 0.5)),
             ("가운데 잎 넓이", "plant_c", pct("plant_c", 0.7), pct("plant_c", 0.5)),
             ("손 + 가운데 잎", "hold", 1.0, 1.0),
             ("가운데 변화", "diff_c", pct("diff_c", 0.85), pct("diff_c", 0.6)),
             ("가운데 선명도", "sharp_c", pct("sharp_c", 0.7), pct("sharp_c", 0.5))]
    dur = max(1.0, rows[-1]["t"] - rows[0]["t"])
    print("  (우연 = 번호표와 아무 상관 없이 같은 횟수로 켜져도 그 창 안에 들어올 비율)")
    for name, key, on, off in tests:
        ons = onsets(rows, key, on, off)
        chance = 1 - math.exp(-len(ons) * (a.window + 1) / dur)
        leads, used = [], set()
        for t in intro:
            c = [o for o in ons if t - a.window <= o <= t + 1]
            if c:
                leads.append(t - c[-1])
                used.add(c[-1])
        leads.sort()
        early = [x for x in leads if x >= 1]
        line = f"  {name:14s} 켜짐 {len(ons)}번(기준 {on:.3g}↑ {off:.3g}↓) · 새 번호표 {len(intro)}개 중 앞 {a.window:.0f}초 안에 켜짐 {len(leads)}개({len(leads) / max(1, len(intro)):.0%}, 우연 {chance:.0%})"
        if leads:
            line += f" · 앞선 시간 가운데값 {leads[len(leads) // 2]:.0f}초 · 1초 넘게 앞선 것 {len(early)}개 · 번호표와 무관한 켜짐 {len(ons) - len(used)}번({(len(ons) - len(used)) / max(1, len(ons)):.0%})"
        print(line)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("frames")
    s.add_argument("video"); s.add_argument("out"); s.add_argument("--t0", type=float, default=0); s.add_argument("--t1", type=float, default=0)
    s.add_argument("--fps", type=float, default=5); s.add_argument("--threads", type=int, default=2)
    s = sub.add_parser("read")
    s.add_argument("frames"); s.add_argument("out"); s.add_argument("--fps", type=float, default=1); s.add_argument("--t0", type=float, default=0)
    s.add_argument("--readers", default="vision,pp"); s.add_argument("--every", type=int, default=1); s.add_argument("--limit", type=int, default=0)
    s.add_argument("--start", type=int, default=0); s.add_argument("--max-tags", type=int, default=8); s.add_argument("--resume", action="store_true")
    s.add_argument("--sleep", type=float, default=0.0, help="장면 사이에 쉬는 초(같은 기계의 방송 일꾼을 방해하지 않게)")
    s.add_argument("--static-sec", type=float, default=180.0, help="이만큼 내내 어두운 점은 붙박이 글자(가게 이름 띠)로 지운다. 0이면 끔")
    s = sub.add_parser("sheet")
    s.add_argument("frames"); s.add_argument("reads"); s.add_argument("out"); s.add_argument("--n", type=int, default=150); s.add_argument("--cols", type=int, default=10)
    s.add_argument("--offset", type=int, default=0); s.add_argument("--readers", default="vision,pp"); s.add_argument("--quality", type=int, default=70)
    s = sub.add_parser("score")
    s.add_argument("reads", nargs="+"); s.add_argument("--truth"); s.add_argument("--screen", nargs="*", help="읽기 파일과 같은 차례의 screen.jsonl(1초 1장 장면일 때)")
    s.add_argument("--readers", default="vision,pp"); s.add_argument("--params")
    s.add_argument("--events", help="사건을 적을 파일({reader} → 모델 이름, {n} → 읽기 파일 차례)")
    s = sub.add_parser("replay")
    s.add_argument("runs", nargs="+"); s.add_argument("--truth", required=True); s.add_argument("--cases"); s.add_argument("--params")
    s.add_argument("--grace", type=float, default=2.0); s.add_argument("--old", type=float, default=45.0); s.add_argument("--wait", type=float, default=15.0)
    s.add_argument("--at-tol", type=int, default=15); s.add_argument("--verbose", action="store_true")
    s.add_argument("--reads", help="영상 장면의 읽기.jsonl — 주면 screen.jsonl 대신 이것으로 추적한다(--offsets 필요)")
    s.add_argument("--reader", default="vision"); s.add_argument("--offsets", help='{"105438": 초, …} 영상 시각 − 일꾼 시각')
    s = sub.add_parser("align")
    s.add_argument("reads"); s.add_argument("run"); s.add_argument("--guess", type=float, required=True); s.add_argument("--span", type=float, default=120)
    s.add_argument("--reader", default="vision")
    s = sub.add_parser("plant")
    s.add_argument("frames"); s.add_argument("out"); s.add_argument("--fps", type=float, default=5); s.add_argument("--t0", type=float, default=0)
    s.add_argument("--every", type=int, default=1); s.add_argument("--limit", type=int, default=0)
    s = sub.add_parser("plantscore")
    s.add_argument("plant"); s.add_argument("--screen", required=True); s.add_argument("--window", type=float, default=20.0); s.add_argument("--params")
    a = ap.parse_args()
    {"frames": cmd_frames, "read": cmd_read, "sheet": cmd_sheet, "score": cmd_score, "replay": cmd_replay, "align": cmd_align, "plant": cmd_plant,
     "plantscore": cmd_plantscore}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
