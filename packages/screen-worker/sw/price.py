# 금액: 확정된 상품을 파는 동안 판매자가 한 말에서 가격 후보를 모으고, 규칙과 맥 LLM(Gemma 3 12B)으로 1순위를 고른다.
# 금액은 자동 확정하지 않는다 — 판매자가 청구 전에 한 번 확인한다. 여기서는 미리 채울 값과 후보만 만든다.
# 시험(scratchpad stt/price/price_test.py, 214건): 규칙 81%, Gemma 83%, 둘이 같으면 96% 맞음, 후보에 정답 92%.
# LLM은 가격을 직접 쓰지 않고 후보 번호만 고른다(2026-11-08: Gemma가 '60만원'을 60,000으로 바꾸는 실수가 고가 판매자에서 방송마다 20~45건).
import collections
import math
import multiprocessing as mp
import os
import re

from .decide import numbers_with_beon

LLM_MODEL = "mlx-community/gemma-3-12b-it-4bit"

# ---------- 한국어 숫자 읽기 (scratchpad stt/tools/kor.py를 옮김) ----------
_D = {"영": 0, "공": 0, "일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "륙": 6, "칠": 7, "팔": 8, "구": 9}
_SMALL = {"십": 10, "백": 100, "천": 1000}
_CH = "0-9일이삼사오육륙칠팔구십백천만"
_EXPR = re.compile(rf"[{_CH}][{_CH},.]*")


def _to_int(s):
    s = s.replace(",", "").replace(" ", "")
    if re.fullmatch(r"\d+(\.\d+)?", s):
        return int(float(s))
    total, block, cur = 0, 0, None
    i = 0
    while i < len(s):
        c = s[i]
        if c.isdigit():
            j = i
            while j < len(s) and (s[j].isdigit() or s[j] == "."):
                j += 1
            try:
                cur = float(s[i:j])
            except ValueError:
                return None
            i = j
            continue
        if c in _D:
            cur = _D[c]
        elif c in _SMALL:
            block += (cur if cur is not None else 1) * _SMALL[c]
            cur = None
        elif c == "만":
            block += cur or 0
            total += (block if block else 1) * 10000
            block, cur = 0, None
        else:
            return None
        i += 1
    return int(total + block + (cur or 0))


def _exprs(text):
    text = re.sub(r"([일이삼사오육칠팔구십백]+) ([일이삼사오육칠팔구십백]+ ?번)", r"\1\2", text)
    text = re.sub(r"([천만])(\d+\s*번)", r"\1 \2", text)
    text = re.sub(r"([천만원])([일이삼사오육칠팔구십백]+\s*번)", r"\1 \2", text)
    out = []
    for m in _EXPR.finditer(text):
        raw = m.group(0).strip(" ,.")
        if not raw:
            continue
        after = text[m.end():m.end() + 2].lstrip()
        v = _to_int(raw)
        if v is None:
            continue
        if after.startswith("번"):
            kind = "no"
        elif "천" in raw or "만" in raw or after.startswith("원"):
            kind = "price"
        else:
            kind = "bare"
        if re.fullmatch(r"[일이삼사오육륙칠팔구]", raw) and kind == "bare":
            continue
        if raw in ("만", "천", "백", "십") and not after.startswith("원"):
            continue
        out.append((v, kind, raw))
    return out


def _merged(text):
    out = []
    for x in _exprs(text):
        if out and out[-1][1] == "price" and x[1] == "price" and out[-1][2].endswith("만") and x[0] < 10000 and not x[2].endswith("만"):
            out[-1] = (out[-1][0] + x[0], "price", out[-1][2] + " " + x[2])
            continue
        out.append(x)
    return out


# 받아쓰기가 '번'을 '만'으로 적거나 번호에 '만원'을 붙여 적음: "179만 파고다 4천원"(179번), "309만원"(309번 만원).
# 세 자리 + 만은 번호로 본다(이 시장에서 100만원 넘는 상품은 드묾). 세 자리 + 만원 → 번호 + 만원
_NO_MAN = re.compile(r"(?<![\d,.])(\d{3})\s?만(\s?원)?")


def _no_man(text):
    # "만원의 행복"을 받아쓰기가 "많은 행복"으로 적음(보스다육 261번)
    text = re.sub(r"많은\s?행복", "만원 행복", text)
    # "십 몇만원씩", "20 몇 만원에": 정해진 값이 아닌 어림 가격은 가격이 아니다(보스다육 289번이 1만으로)
    text = re.sub(r"[0-9일이삼사오육칠팔구십백]*\s*몇\s*(?:십\s*)?(?:만|천)\s*원?", " ", text)
    # "309만원"(309번 만원)처럼 세 자리 번호에 붙은 만은 번호 + 만원으로 본다. 단 끝자리가 0인 세 자리("100만원", "150만원", "250만원")는
    # 고가 판매자의 가격이라 그대로 둔다(경성다육 11/2: 100만원 상품 7개가 1만원으로 — 번호표 100·150도 있지만 그때는 "100번"이라고 말함)
    return _NO_MAN.sub(lambda m: m.group(0) if m.group(1).endswith("0") else (f"{m.group(1)} 만원" if m.group(2) else f"{m.group(1)} "), text)


# 가격 상한: 고가 판매자는 수백만원도 판다(경성다육 11/2 프랭크 슈퍼클론 500만원·250만원). 예전 200만원 상한이면 가격을 못 찾음
MAX_PRICE = 10_000_000


def prices_in(text):
    text = _no_man(text)
    # "만 5천원"·"만 오천원": 앞에 숫자 없는 '만'을 '1만'으로
    text = re.sub(r"(?<![0-9일이삼사오육칠팔구십백천])만\s+(?=[0-9일이삼사오육칠팔구])", "1만 ", text)
    return [v for v, k, _ in _merged(text) if k == "price" and 500 <= v <= MAX_PRICE]


# ---------- 상품 시간의 말 고르기·규칙 ----------
def trim(lines, no, known=None):
    """이 번호를 처음 말하기 전 다른 번호를 말한 줄까지는 앞 상품, 마지막으로 말한 뒤 다른 번호를 말한 줄부터는 다음 상품으로 보고 잘라 낸다"""
    from .decide import numbers_bare
    # 번호만 말한 것("248 만원 갈게요", "273 레옹색금")도 상품 경계로(세 자리만: 두 자리 '30'은 가격일 수 있음)
    # known(이 방송 화면에 번호표로 보인 번호들)를 주면, 번 없이 말한 숫자는 그 안에 있을 때만 경계로 쓴다
    # ("100 이상 주고 들인 아이", "2 3 5 5 7cm" 같은 가격·크기 숫자에서 상품을 끊지 않게 — 보스다육 10/5 235번 50만원)
    nums = lambda x: numbers_with_beon(x) + [v for v in numbers_bare(x) if v >= 100 and (known is None or v in known)]
    own = [i for i, (t, x) in enumerate(lines) if no in nums(x)]
    if not own:
        return lines
    other = lambda x: any(v != no and v >= 10 for v in nums(x))
    start = next((i + 1 for i in range(own[0] - 1, -1, -1) if other(lines[i][1])), 0)
    if os.environ.get("TRIM_FIRST"):
        # 이 번호를 말한 첫 덩어리에서 끝낸다: 다음 상품으로 넘어간 뒤 "○○님 감사드립니다 237"처럼 다시 나온 번호는 이어 붙이지 않음
        end = next((i for i in range(own[0] + 1, len(lines)) if other(lines[i][1])), len(lines))
    else:
        end = next((i for i in range(own[-1] + 1, len(lines)) if other(lines[i][1])), len(lines))
    return lines[start:end]


# 단위를 뺀 가격("40짜리", "13까지", "10에 갈게요", "30이구요"): 판매자가 평소 만원 단위로 말하면 ×1만으로 읽는다
_BARE = re.compile(r"(?<![\d.,~])(\d{1,3})\s*(?=까지|짜리|이면|에\s*(?:드|갈|가|줄|팔|드릴)|이구요|이고요|이에요|입니다)")


def common(lines):
    """이 방송에서 가장 많이 말한 가격(없으면 None) — 가격을 못 찾았거나 이상한 상품에 미리 채우는 값(판매자가 확인)"""
    ps = collections.Counter(p for _, x in lines for p in prices_in(x))
    return ps.most_common(1)[0][0] if ps else None


def fill(r, typ, com):
    """규칙 1순위 → (채울 가격, 확인 필요인지). 못 찾았거나 이상하면(1,010원 등) 이 방송에서 가장 흔한 가격을 채우고 확인 필요로"""
    if r is None or odd(r, typ):
        return com, True
    return r, False


def typical(lines):
    """이 방송에서 말한 가격의 가운데값(없으면 None)"""
    ps = sorted(p for _, x in lines for p in prices_in(x))
    return ps[len(ps) // 2] if ps else None


def odd(v, typ):
    """판매자가 확인해야 할 이상한 가격: 500원 단위가 아님(받아쓰기가 '만원'을 '1010원'으로 적은 사례).
    ('평소 가격의 1/5보다 작음' 조건은 뺌: 보스다육 10/5에서 실제 5,000원 상품을 3만원으로 덮어씀 — 한 방송에 5천~50만원이 섞여 팔림)"""
    return v is not None and v % 500 != 0


def seller_unit(lines):
    """이 판매자가 평소 말하는 가격 단위: 말한 가격의 가운데값이 만원 이상이면 10,000, 아니면 None(단위 생략 가격을 읽지 않음)"""
    ps = sorted(p for _, x in lines for p in prices_in(x))
    return 10000 if ps and ps[len(ps) // 2] >= 10000 else None


def prices_said(text, unit=None):
    """한 줄에서 가격 [(값, 말한 모양)] — 말한 순서대로. unit이 있으면 단위 생략 가격도"""
    out = []
    t2 = re.sub(r"(?<![0-9일이삼사오육칠팔구십백천])만\s+(?=[0-9일이삼사오육칠팔구])", "1만 ", _no_man(text))
    for v, k, raw in _merged(t2):
        if k == "price" and 500 <= v <= MAX_PRICE:
            out.append((v, raw))
    if unit:
        for m in _BARE.finditer(text):
            n = int(m.group(1))
            if 1 <= n <= 200 and not numbers_with_beon(text[m.start():m.end() + 2]):
                out.append((n * unit, m.group(0).strip() + "(단위 생략)"))
    return out


# 가격의 주인 정하기(사용자 제안 2026-11-09): 가격을 말한 문장에 번호가 있으면 그 번호, 없으면 그 순간 화면에 가장 크게 보인 번호표.
# 시간 틀로 묶으면 앞뒤 상품 가격이 섞인다(보스 10/5 231에 '295번 25만원', 11/8 303/311).
_SCREEN = {"mains": None, "known": None}


def use_screen(mains, known):
    """이 방송의 초마다 가장 큰 번호표 {초: 번호}와 화면에 번호표로 보인 번호들 — 주면 가격의 주인을 화면으로도 정한다"""
    _SCREEN["mains"], _SCREEN["known"] = mains, known


def _owner(t, x, no):
    """이 줄에서 말한 가격의 주인: 문장 속 번호 → 그 순간 화면 번호표 → 모름(None)"""
    from .decide import numbers_bare
    known = _SCREEN["known"]
    said = set(numbers_with_beon(x)) | {v for v in numbers_bare(x) if v >= 100 and (known is None or v in known)}
    if said:
        return no if no in said else next(iter(said))
    mains = _SCREEN["mains"]
    if mains:
        near = [mains.get(i) for i in range(int(t) - 3, int(t) + 4)]
        near = [v for v in near if v is not None]
        if near:
            return collections.Counter(near).most_common(1)[0][0]
    return None


def rule_owned(lines, no, unit=None):
    """주인이 이 번호인 가격만 센다(+ 같은 문장 가산점). 주인을 모르는 가격은 약하게(0.3). 주인 있는 가격이 하나도 없으면 None"""
    cnt = collections.Counter()
    owned = False
    for t, x in lines:
        ps = prices_said(x, unit)
        if not ps:
            continue
        o = _owner(t, x, no)
        w = 1.0 if o == no else (0.3 if o is None else 0.0)
        owned |= o == no
        for v, _ in ps:
            cnt[v] += w
    if not owned:
        return None
    cnt += said_with_number(lines, no, unit)
    return max(cnt, key=lambda v: cnt[v]) if cnt else None


def rule(lines, no, unit=None):
    """가장 많이 말한 가격(판매자는 최종 가격을 여러 번 되풀이한다). 같은 횟수면 번호를 마지막으로 말한 줄까지의 마지막 가격 쪽.
    시험(214건): 럭셔리 93→98%, 수정 84→89%, 다육사랑 68→76% (예전 '번호 직전 마지막 가격' 대비)"""
    allp = [v for _, x in lines for v, _ in prices_said(x, unit)]
    if not allp:
        return None
    mode = os.environ.get("PRICE_OWNER")
    if mode == "1" and _SCREEN["mains"] is not None:
        r = rule_owned(lines, no, unit)
        if r is not None:
            return r
    if mode in ("strip", "strip_text") and _SCREEN["mains"] is not None:
        # 조심스러운 판: 지금 시간 틀 그대로, 확실히 다른 상품 것인 가격만 뺀다(문장에 다른 번호 / 그 순간 화면에 다른 번호표가 분명히 보임)
        kept = []
        for t, x in lines:
            o = _owner(t, x, no)
            if o is not None and o != no and (mode == "strip" or numbers_with_beon(x)):
                continue
            kept.append((t, x))
        allp2 = [v for _, x in kept for v, _ in prices_said(x, unit)]
        if allp2:
            lines, allp = kept, allp2
    # 횟수(판매자는 최종 가격을 되풀이) + 번호와 같은 문장 가산점(앞뒤 상품 가격이 횟수로 이기지 못하게)
    tau = float(os.environ.get("PT_TAU", 0))
    if tau:
        # 시험: 번호를 말한 때에서 멀수록 덜 센다(다음 상품으로 넘어간 뒤 말한 가격이 횟수로 이기지 못하게)
        from .decide import numbers_loose
        own = [t for t, x in lines if no in numbers_with_beon(x) or no in numbers_loose(x)]
        cnt = collections.Counter()
        for t, x in lines:
            w = math.exp(-min(abs(t - u) for u in own) / tau) if own else 1.0
            for v, _ in prices_said(x, unit):
                cnt[v] += w
        cnt += said_with_number(lines, no, unit)
    else:
        cnt = collections.Counter(allp) + said_with_number(lines, no, unit)
    top = max(cnt.values())
    tied = [v for v in cnt if cnt[v] == top]
    if len(tied) == 1:
        return tied[0]
    near = rule_last(lines, no, unit)
    return near if near in tied else tied[-1]


W_AFTER, W_SENT = (float(x) for x in os.environ.get("PW", "1,0.5").split(","))


def said_with_number(lines, no, unit=None):
    """번호와 같은 문장에서 말한 가격의 가산점 Counter("247 2만원 가구요", "215번 자 이거는 5000원"): 번호 바로 뒤 가격 2점, 그 문장의 다른 가격 1점.
    앞뒤 상품 가격("248 만원")이나 지나가는 말("원래 5만원에서 10만원")이 횟수로 이기지 못하게(보스다육 11/8 215·247·252·292번)"""
    from .decide import numbers_loose
    score = collections.Counter()
    for _, x in lines:
        if no not in numbers_with_beon(x) and no not in numbers_loose(x):
            continue
        m = re.search(rf"(?<![\d]){no}(?![\d])\s*번?", x)
        if m:
            after = prices_said(x[m.end():], unit)
            if after:
                score[after[0][0]] += W_AFTER
        for v, _ in prices_said(x, unit):
            score[v] += W_SENT
    return score


def rule_last(lines, no, unit=None):
    """번호를 마지막으로 말한 줄까지에서 마지막 가격, 없으면 그 뒤 첫 가격"""
    ps = lambda part: [v for _, x in part for v, _ in prices_said(x, unit)]
    idx = [i for i, (t, x) in enumerate(lines) if no in numbers_with_beon(x)]
    if not idx:
        allp = ps(lines)
        return allp[-1] if allp else None
    before = ps(lines[: idx[-1] + 1])
    if before:
        return before[-1]
    after = ps(lines[idx[-1] + 1:])
    return after[0] if after else None


def candidates(lines, unit=None):
    """그 상품 시간에 나온 가격 후보 [(값, 말한 모양)] — 값이 같은 건 하나로"""
    seen = {}
    for _, x in lines:
        for v, raw in prices_said(x, unit):
            seen.setdefault(v, raw)
    return list(seen.items())


PROMPT = """다육식물 라이브 판매 방송에서 판매자가 한 말을 받아쓴 글입니다. 받아쓰기라 오타와 숫자 실수가 있을 수 있습니다.
판매자는 지금 {no}번 상품을 팔고 있습니다. 앞뒤에 다른 상품 이야기가 섞여 있을 수 있습니다.

{lines}

이 말에서 나온 가격 후보입니다:
{cands}

{no}번 상품의 최종 판매 가격은 몇 번 후보입니까?
- 가격을 바꾸거나 깎아 주면(예: "3만원인데 2만5천원에 드릴게요") 마지막으로 정한 가격입니다.
- "원래 2만원인데 오늘 만오천원"이면 오늘 파는 가격입니다.
- 여러 개를 한 번에 파는 묶음(예: "2개 4천원")이면 묶음 전체 가격입니다.
- 다른 상품의 가격은 고르지 마세요. 맞는 후보가 없으면 0.
JSON 한 줄로만 답하세요: {{"choice": 후보 번호}}"""


def fmt(lines):
    return "\n".join(f"[{int(t) // 60}:{int(t) % 60:02d}] {x}" for t, x in lines)


# LLM 돌리는 방식: mlx = 애플 칩 전용(맥) / llamacpp = 같은 Gemma 3 12B를 GGUF로, 리눅스·엔비디아 GPU(AWS)에서도 돈다
LLM_BACKEND = os.environ.get("LLM_BACKEND", "mlx")
GGUF = ("ggml-org/gemma-3-12b-it-GGUF", "gemma-3-12b-it-Q4_K_M.gguf")


def _generator(model_name):
    """→ gen(글, 최대 토큰) — 답은 늘 같은 것(가장 그럴듯한 것만 고름)"""
    if LLM_BACKEND == "llamacpp":
        from huggingface_hub import hf_hub_download
        from llama_cpp import Llama

        llm = Llama(model_path=hf_hub_download(*GGUF), n_gpu_layers=-1, n_ctx=8192, verbose=False)

        def gen(text, max_tokens):
            r = llm.create_chat_completion([{"role": "user", "content": text}], max_tokens=max_tokens, temperature=0)
            return r["choices"][0]["message"]["content"]
        return gen
    import mlx.core as mx
    from mlx_lm import generate, load

    # MLX는 다 쓴 GPU 버퍼를 재사용하려고 쥐고 있어 모델 크기보다 몇 GB 더 먹는다.
    # 캐시 상한을 두고 매 호출 뒤 비워 다른 앱(브라우저 등)이 쓸 메모리를 남긴다. 결과는 같다.
    mx.set_cache_limit(int(float(os.environ.get("MLX_CACHE_GB", "1")) * 1024**3))
    model, tok = load(model_name)

    def gen(text, max_tokens):
        prompt = tok.apply_chat_template([{"role": "user", "content": text}], add_generation_prompt=True, tokenize=False)
        out = generate(model, tok, prompt=prompt, max_tokens=max_tokens, verbose=False)
        mx.clear_cache()
        return out
    return gen


def _llm_proc(model_name, jobs, results):
    """따로 된 프로세스: 받아쓰기와 GPU를 같은 프로세스에서 나눠 쓰지 않게"""
    gen = _generator(model_name)
    results.put(("ready", None, None))
    while True:
        job = jobs.get()
        if job is None:
            break
        if job[0] == "variety":
            _, key, no, lines = job
            from .variety import FREE
            out = gen(FREE.format(no=no, lines=fmt(lines)), 40)
            m = re.search(r'"variety"\s*:\s*"([^"]+)"', out)
            # "모르면 null" 지시를 글자 "null"로 답하는 경우가 있어 빈칸으로
            v = m.group(1).strip() if m else None
            results.put(("variety", key, None if not v or v.lower() in ("null", "none", "모름") else v, out))
            continue
        _, key, no, lines, cands = job
        listing = "\n".join(f"{i}) {v:,}원  (말: '{raw}')" for i, (v, raw) in enumerate(cands, 1))
        out = gen(PROMPT.format(no=no, lines=fmt(lines), cands=listing), 20)
        m = re.search(r'"choice"\s*:\s*(\d+)', out)
        k = int(m.group(1)) if m else 0
        # LLM은 후보 번호만 고른다 — 원 단위 계산은 규칙이 한 값 그대로(만 단위를 잘못 바꿔 0을 빠뜨리는 실수가 생길 수 없게)
        results.put(("price", key, cands[k - 1][0] if 1 <= k <= len(cands) else None, out))


class Llm:
    def __init__(self, model_name=LLM_MODEL):
        ctx = mp.get_context("spawn")
        self.jobs, self.results = ctx.Queue(), ctx.Queue()
        self.proc = ctx.Process(target=_llm_proc, args=(model_name, self.jobs, self.results), daemon=True)
        self.proc.start()
        self.raw = {}   # (종류, key) → LLM이 실제로 쓴 답 글(결과 기록용)

    def ask(self, key, no, lines, cands):
        """cands: [(값, 말한 모양)] — 이 중에서 고르게 한다"""
        self.jobs.put(("price", key, no, lines, cands))

    def ask_variety(self, key, no, lines):
        """품종 이름을 직접 뽑게 한다(사전 맞춤은 받는 쪽에서)"""
        self.jobs.put(("variety", key, no, lines))

    def poll(self):
        """끝난 답 [(종류 "price"|"variety", key, 값)]"""
        out = []
        while not self.results.empty():
            kind, key, val, *raw = self.results.get()
            if raw:
                self.raw[(kind, key)] = raw[0]
            if kind in ("price", "variety"):
                out.append((kind, key, val))
        return out

    def close(self):
        self.jobs.put(None)
