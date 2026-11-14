# 라이브 LLM 등록(사용자 2026-11-11: "라이브에서 지식판2로 등록", 2026-11-12: "정확도는 좋은데 3~5분은 너무 늦다 — 말하고 10초 안팎").
# 일꾼이 쓰는 transcript.jsonl·screen.jsonl을 1초마다 이어 읽어, 새 받아쓰기 줄이 들어올 때 묻는다(이벤트):
#   - 그 줄에 숫자·'번'·'만'·'천'·'원'이 있거나, 그 줄 동안 화면에 크게 보인 번호표가 앞 줄과 다르면 → 바로 최근 WINDOW초(기본 60초)의 줄을 묻는다
#   - 아무 이벤트 없이 SAFETY초(60초) 지나면 한 번 묻는다(안전망). 같은 줄로 두 번 묻지 않는다.
# 묻는 글은 끝난 방송 시험(sw.llm_b6, SCREEN=span)과 같은 줄 모양·화면 표시·닉네임 가림, 프롬프트 지식판2(regstt8k2), gpt-5.6-sol, 추론 low(LLM_REG_EFFORT).
# 동시에 묻는 것은 PAR개(기본 4)까지 — 다 차 있으면 들어온 줄을 들고 기다렸다가 자리가 나면 가장 새 줄로 묻는다.
#
# 보내기 (D-SCR-12~16, 2026-11-12 방송 복기 뒤): 첫 답으로 바로 보내지 않는다. 번호마다 답을 모아 두었다가(self.pend) 아래가 다 맞을 때 한 번 보낸다.
#   번호 — 판매자가 말했고 그 방송 번호대 안이거나, 화면에 온전히 TAG_FRAMES장(번호대 밖이면 OUT_FRAMES장) 넘게 읽힌 번호 (sw.reg_rules.number_evidence)
#          말한 번호와 화면 번호가 한 자리만 다르면 숫자 쌍으로 정한다(pair_verdict). 이미 보낸 번호에 다른 금액·품종이 나오면 번호표가 다시 보일 때까지 보류.
#   가격 — 판매자가 말한 금액과 LLM 금액이 같거나, 서로 다른 호출의 답이 PRICE_AGREE번 같을 때. 10배·100배 어긋나거나 가격대를 벗어나면 보내지 않는다(price_choice).
#          PRICE_WAIT초가 지나도 정해지지 않으면 "LLM확인요청"(번호 근거가 없으면 "LLM번호보류") 이벤트를 남기고, 뒤에 맞는 답이 오면 그때 보낸다.
#   품종 — LLM 이름과 품종 사전(sw.variety.pick_name)이 같거나, LLM 이름이 사전에 있거나, 사전 이름이 받아쓰기에 여러 번 나올 때만. 아니면 빈 이름.
#   서버는 같은 번호를 다시 받아도 바꾸지 않는다(R-2). LLM_REG_SAFE=0 이면 2026-11-12 방송 때처럼 첫 답으로 바로 보낸다(재현 비교·되돌리기용).
#
# 임시 등록 (D-SCR-18~22, 계약서 docs/retro/tentative-contract.md): 서버가 "확인 중" 상품을 받으면(sw.post의 tentative_ok — 켜질 때와 5분마다 묻는다)
#   다 모일 때까지 들고 기다리지 않고 먼저 임시로 올린다. 임시 상품은 손님 찜은 받지만 감사 채팅·라벨은 확정 뒤에만 나간다.
#   올리기 — ① 받아쓴 한 줄에 'N번'과 단위를 말한 금액이 하나씩 있으면 LLM 답을 기다리지 않고(규칙, LLM_TENTATIVE_RULE)
#            ② LLM 답의 번호 근거는 섰는데 가격을 아직 못 정했거나, 숫자 쌍이 어긋나 기다릴 때(두 번호 후보를 실어 판매자가 고르게)
#            번호 근거와 가격이 첫 답에서 다 맞으면 임시를 거치지 않고 지금처럼 바로 등록한다.
#   확정 — 위 "보내기"의 조건(번호 근거 + 가격)이 맞으면 /internal/screen/confirm (번호가 화면 번호로 옮겨졌으면 to). 확정 전에는 금액·이름을 바로 고쳐 보낸다.
#   거두기 — 규칙으로 올렸는데 그 줄을 본 LLM 답이 그 번호를 적지 않을 때, 숫자 쌍의 화면 번호가 이미 보낸 상품일 때,
#            확정하려는 번호가 화면에 한 번도 안 보이고 내내 보인 다른 번호가 임시로 올라가 있을 때(잘못 들은 번호 — 답을 그 상품에 합친다).
#   두기 — 번호 근거는 섰는데 HOLD_MAX까지 못 정한 것과 방송 끝에 남은 것은 거두지 않는다(판매자가 앱에서 확정). 뒤에 근거가 모이면 일꾼이 확정한다.
#   판매자가 먼저 확정·수정·거둔 상품은 서버가 그대로 두고(skip·kept) 일꾼도 그 칸을 더 고치지 않는다. 다시 켠 일꾼은 앞 실행의 임시 등록을 이어받는다.
#   LLM_TENTATIVE=0 이거나 서버가 받지 않으면(옛 서버) 위 "보내기" 그대로 돈다.
# 기록(결과 폴더): llm_live.jsonl(물을 때마다 글·답·걸린 초·까닭), llm_상품.csv(끝날 때: 보낸 값과 다수결 값), events.jsonl에 "LLM등록" 등
import collections
import concurrent.futures as cf
import csv
import glob
import json
import os
import re
import threading
import time

from . import llm_b4 as B
from . import llm_b6
from . import reg_rules as R
from .screen import EXPIRE, STABLE, Screen

HERE = os.path.dirname(os.path.abspath(__file__))
SYS = os.path.join(HERE, "prompts", os.environ.get("LLM_REG_PROMPT", "sales_instruct_system_regstt8k2.txt"))
MODEL = os.environ.get("LLM_REG_MODEL", "gpt-5.6-sol")
EFFORT = os.environ.get("LLM_REG_EFFORT", "low")
WINDOW = float(os.environ.get("LLM_REG_WINDOW", 60))   # 물을 때 넣는 최근 줄의 길이(방송 초)
SAFETY = float(os.environ.get("LLM_REG_SAFETY", 60))   # 이벤트 없이 이만큼(방송 초) 지나면 한 번 묻는다
PAR = int(os.environ.get("LLM_REG_PAR", 4))            # 동시에 묻는 수(사용자 2026-11-12: 사용량보다 지연)
SCREEN_WAIT = 3.0                                      # 화면 읽기가 그 줄 끝까지 오기를 이만큼(실제 초)만 기다린다
CUE = re.compile(r"[0-9번만천원십]")
CONF = {"high": 0.9, "medium": 0.7, "low": 0.5}
# 잘못 들은 번호 바로잡기 (D-SCR-06, 사용자 2026-11-12 "391을 392로 잘못 알아먹고 등록 … 화면 인식 통해서 392는 잘못된거라고 판정"):
# 보낸 번호 N이 그 말 5초 앞부터 화면에 한 번도 안 읽혔는데, 그동안 다른 번호표 M이 크게 FIX_FRAMES장 이상 보였고(화면은 1초에 1장 —
# 사용자 2026-11-12 "한 상품 진짜 몇초밖에 안 보여준다. 같은 프레임이 몇번 보였나로": 15장 → 3장, 이어서가 아니어도 센다)
# M을 아직 보내지 않았으면 서버에 N → M 번호 바꾸기를 묻는다(서버가 찜·M 상품 유무를 다시 보고 안전할 때만 바꾼다).
# 말한 뒤 FIX_MIN초까지는 기다리고(번호표를 늦게 드는 판매자), FIX_MAX초가 지나면 그 번호는 더 보지 않는다.
# 품종 이름 고치기 (D-SCR-07): 보낸 뒤 NAME_WINDOW초 안의 LLM 답 중 "확실(high)"한 이름만 센다. 가장 많이 나온 이름(같으면 나중 것)이
# 지금 서버에 보낸 이름과 다르면 고쳐 보낸다(번호마다 NAME_MAX_FIX번까지). 확실한 답이 NAME_VOTES번 이상이고 다른 이름보다 많아야 한다
# (끝난 방송 재현 2026-11-12: 한 번만으로 바꾸면 재고·베개처럼 품종 아닌 말로 바뀌거나 이름이 오락가락했다).
NAME_WINDOW = float(os.environ.get("LLM_NAME_WINDOW", 180))
NAME_MAX_FIX = int(os.environ.get("LLM_NAME_MAX_FIX", 1))
NAME_VOTES = int(os.environ.get("LLM_NAME_VOTES", 2))
NOT_NAMES = {"재고", "제고", "재구", "베개", "서비스", "특가", "제곱"}         # 품종이 아닌데 LLM이 이름 칸에 적은 말
# 금액 고치기 (D-SCR-09): 보낸 번호를 나중에 다른 금액으로 다시 내놓으면(393 손톱 2만원 → 30분 뒤 만원) 그 번호가 화면에 보이는 줄의
# "확실(high)"한 금액 답을 PRICE_WINDOW초 안에서 센다. 지금 금액과 다른 금액이 PRICE_VOTES번 이상이고 다른 금액보다 많으면 고쳐 보낸다
# (번호마다 PRICE_MAX_FIX번까지). 서버는 판매자가 금액을 고친 번호·손으로 등록한 번호는 건드리지 않고, 이미 찜한 사람 금액은 그대로 둔다.
PRICE_WINDOW = float(os.environ.get("LLM_PRICE_WINDOW", 120))
PRICE_VOTES = int(os.environ.get("LLM_PRICE_VOTES", 2))
PRICE_MAX_FIX = int(os.environ.get("LLM_PRICE_MAX_FIX", 3))
FIX_FRAMES = int(os.environ.get("LLM_FIX_FRAMES", 3))
FIX_MIN = float(os.environ.get("LLM_FIX_MIN", 10))
FIX_MAX = float(os.environ.get("LLM_FIX_MAX", 180))

# ---------- 안전 규칙 (D-SCR-12~16) ----------
SAFE = os.environ.get("LLM_REG_SAFE", "1") != "0"              # 0 = 2026-11-12 방송 때 로직(첫 답으로 바로 보냄)
TAG_FRAMES = int(os.environ.get("LLM_TAG_FRAMES", 3))          # 말하지 않은 번호: 화면에 온전히 이만큼(장) 읽혀야 번호로 인정
OUT_FRAMES = int(os.environ.get("LLM_OUT_FRAMES", 5))          # 그 방송 번호대를 벗어난 번호: 이만큼(장)
BAND_SEG_FRAMES = 5                                            # 번호대를 정할 때: 화면에 이만큼(장) 넘게 읽힌 번호표도 넣는다(방송 처음·다시 켠 직후)
PRICE_UNIT = R.unit_of(os.environ.get("LLM_PRICE_UNIT"))       # 판매자의 가격 단위: 만(기본)·천·없음 — 단위 없이 말한 "35"를 무엇으로 읽나
PRICE_AGREE = int(os.environ.get("LLM_PRICE_AGREE", 2))        # 말한 금액과 못 맞출 때: 같은 금액의 답이 이만큼(서로 다른 호출)
PRICE_WAIT = float(os.environ.get("LLM_PRICE_WAIT", 20))       # 첫 답 뒤 이만큼(실제 초) 기다려도 못 정하면 확인요청을 남긴다
HOLD_MAX = float(os.environ.get("LLM_HOLD_MAX", 120))          # 마지막 답 뒤 이만큼(실제 초) 지나면 그 번호의 기다림을 접는다
CONFIRM_AFTER = float(os.environ.get("LLM_CONFIRM_AFTER", 4))  # 답이 한 번뿐인데 이만큼(실제 초) 다른 물음이 없으면 같은 창을 한 번 더 묻는다
SKIP_SETTLED = os.environ.get("LLM_SKIP_SETTLED", "1") != "0"  # 화면의 번호가 이미 보낸 번호이고 새 번호·금액 말이 없는 줄은 묻지 않는다(B-2의 L2)
NAME_DICT = os.environ.get("LLM_NAME_DICT", "1") != "0"        # 품종을 사전과 견줘 고른다(0 = LLM 이름 그대로)
REPRICE_STRICT = os.environ.get("LLM_REPRICE_STRICT", "1") != "0"  # 금액 고치기는 판매자가 그 번호를 다시 내놓았을 때만(번호를 다시 불렀거나 번호표가 다시 보임)
NAME_SELLER = os.environ.get("LLM_NAME_SELLER", "1") != "0"    # 판매자가 고쳐 적은 이름·별칭(data/varieties_seller.json)도 사전으로 쓴다
NAME_FOLLOW = float(os.environ.get("LLM_NAME_FOLLOW", 60))     # 품종 없이 보낸 번호는 이만큼(방송 초) 더 물어 이름을 채운다(묻기 줄이기에서 뺌)
NAME_PRE, NAME_POST = 30, 20                                   # 품종 사전이 보는 받아쓰기: 그 상품 첫 줄 앞 30초 ~ 뒤 20초(다른 번호를 말한 줄에서 끊는다)
CODEX_LEAN = os.environ.get("LLM_CODEX_LEAN", "1") != "0"      # codex exec에 --ephemeral --ignore-user-config --ignore-rules
CODEX_SCHEMA = os.environ.get("LLM_CODEX_SCHEMA", "1") != "0"  # codex exec에 --output-schema(답 JSON 모양 고정)

# ---------- 임시 등록 (D-SCR-18~22) ----------
TENTATIVE = os.environ.get("LLM_TENTATIVE", "1") != "0"        # 0 = 임시 등록을 쓰지 않는다(다 모일 때까지 들고 기다렸다 바로 등록 — D-SCR-12~16 그대로)
TENT_RULE = os.environ.get("LLM_TENTATIVE_RULE", "1") != "0"   # 받아쓴 한 줄에 'N번'과 단위를 말한 금액이 하나씩 있으면 LLM 답을 기다리지 않고 임시 등록(B2·L1)
TENT_KEEP = os.environ.get("LLM_TENTATIVE_KEEP", "1") != "0"   # HOLD_MAX가 지나도 못 정한 임시 등록: 번호 근거가 선 것은 두고 판매자가 확정(0 = 모두 거둔다)
RULE_MISS = int(os.environ.get("LLM_TENTATIVE_RULE_MISS", 2))  # 규칙 임시 등록: 그 줄을 본 LLM 답이 이만큼(번) 그 번호를 적지 않으면 거둔다
TENT_FIX_MAX = 5                                               # 확정 전 금액·이름 고쳐 보내기: 칸마다 이만큼(번)까지
TENT_FIX_BASE = 100                                            # 확정 전 고치기의 요청 번호는 여기서부터 센다(확정 뒤 고치기 1, 2, 3…과 겹치지 않게)
# ---------- 2026-11-13 방송 복기 뒤 (D-SCR-23~28, 개선 단계표 A단계) ----------
REPRICE_FACTOR = float(os.environ.get("LLM_REPRICE_FACTOR", 5))    # 금액 고치기: 지금 값과 이만큼(배) 넘게 다르거나 가격대 밖이면 고치지 않고 확인 카드로(0 = 끔) — 189번 500만 → 5,500원
REPRICE_LATEST = os.environ.get("LLM_REPRICE_LATEST", "1") != "0"  # 금액 고치기: 그 번호 뒤에 다른 상품이 올라왔으면 고치지 않고 확인 카드로 — 36번에 다음 상품(50번) 값 10만
PRICE_CARD = os.environ.get("LLM_PRICE_CARD", "1") != "0"          # 이미 있는 번호에 다른 금액을 한 번만 말해도 확인 카드를 남긴다 — 83번 6만 → 5만을 놓침
TEN_GUARD = os.environ.get("LLM_TEN_GUARD", "1") != "0"            # 같은 상품에 꼭 열 배·백 배 다른 금액이 같이 들리면 확정하지 않는다 — 241번 "2씩 … 20"을 2만으로
KEEP_SPOKEN = int(os.environ.get("LLM_KEEP_SPOKEN", 2))            # 번호 바로잡기: 판매자가 그 번호와 금액을 이만큼(줄) 넘게 말했으면 옮기지 않는다(0 = 끔) — 6번을 17번으로
NOPRICE_RULE = os.environ.get("LLM_NOPRICE_RULE", "1") != "0"      # LLM이 번호만 적고 가격을 비웠는데 그 줄들에 말한 금액이 하나뿐이면 임시로 올린다 — 272번 "500 272 … 자 500"
TAG_RULE = int(os.environ.get("LLM_TAG_RULE", 20))                 # 말하지 않은 번호표가 이만큼(장) 넘게 크게 보이고 그동안 말한 금액이 하나뿐이면 임시로 올린다(0 = 끔) — 124번
NAME_MODE = os.environ.get("LLM_NAME_MODE", "shop")                 # shop = LLM 이름을 가게 장부에 맞추고 장부에 없으면 확인 중 품종으로(D-SCR-29~32) · dict = 전국 사전으로 거르기(D-SCR-15)
SHOP_LEDGER = os.environ.get("LLM_SHOP_LEDGER")                     # 가게 품종 장부 파일(없으면 빈 장부 — 처음 오는 가게)
WITHDRAW_CUE = re.compile(r"번호\s?(?:떼|때|빼)")                    # 판매자가 상품을 거둔다는 말("번호 떼") — 153번
SERVER_UNITS = {"TEN_THOUSAND": 10000, "WON": None}            # 서버 priceUnit 가운데 판매자가 분명히 고른 값만 따른다(D-SCR-21) — THOUSAND는 "고르지 않음"과 같아 따르지 않는다


def unit_from_server(value, default):
    """서버가 알려 준 이 방송의 가격 단위(priceUnit) → (일꾼이 쓸 단위, 서버 값을 따랐나).
    TEN_THOUSAND(만 원)·WON(원 — 단위 없이 말한 수를 금액으로 읽지 않는다)만 따르고, THOUSAND·AUTO·없음은 default(환경변수 LLM_PRICE_UNIT) 그대로"""
    if isinstance(value, str) and value in SERVER_UNITS:
        return SERVER_UNITS[value], True
    return default, False


def ask_llm(user, sys_path=None):
    """라이브 등록이 LLM에 한 번 묻기(sw.doctor도 같은 길로 시험한다)"""
    return llm_b6.ask(user, sys_path or SYS, MODEL, EFFORT, lean=CODEX_LEAN, schema=llm_b6.SCHEMA_FILE if CODEX_SCHEMA else None)


def prompt_for_unit(unit, out):
    """판매자 단위가 만원이 아니면 지시문 10번(단위 없는 판매가)을 그 단위로 바꾼 파일을 결과 폴더에 만들어 그 경로를 준다"""
    if unit == 10000:
        return SYS
    text = open(SYS, encoding="utf-8").read()
    if unit == 1000 and "만원 단위다" in text and "350000원이다" in text:
        text = text.replace("만원 단위다", "천원 단위다").replace("350000원이다", "35000원이다").replace('"삼만 오천 원", "3만 5천", "35,000원"은 35000원이다. ', "")
    elif unit is None and "\n10. " in text:
        head, _, rest = text.partition("\n10. ")
        text = head + "\n10. 단위 없이 말한 수는 판매가로 적지 않는다(price는 null). 번호·수량·크기·호수와 구분한다. price_short와 price_line은 null로 둔다." + rest[rest.index("\n"):]
    else:
        print("           지시문에서 단위 규칙(10번)을 찾지 못해 그대로 써요", flush=True)
        return SYS
    path = os.path.join(out, "prompt_unit.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return path


def prior_sent(out, video_id):
    """같은 방송의 앞선 실행(다시 켜기 전)이 서버로 보낸 번호 [{no, price, name, fixes}] — 결과 폴더 옆의 <영상>-* 폴더 events.jsonl에서.
    다시 켠 일꾼이 앞 번호표를 보고 이미 있는 번호를 다른 값으로 또 보내지 않게(2026-11-12 방송: 325·328·334번)"""
    return prior_from_events(prior_events(out, video_id))


def prior_events(out, video_id):
    """같은 방송의 앞선 실행들이 남긴 일꾼 이벤트(시간순) — 결과 폴더 옆의 <영상>-* 폴더 events.jsonl"""
    if not video_id:
        return []
    here = os.path.abspath(out)
    events = []
    for run in sorted(glob.glob(os.path.join(os.path.dirname(here), f"{glob.escape(video_id)}-*"))):
        path = os.path.join(run, "events.jsonl")
        if os.path.abspath(run) == here or not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    events.append(json.loads(line))
                except ValueError:
                    pass
    return events


def prior_from_events(events):
    """일꾼 이벤트(시간순) → 서버에 남아 있을 번호 [{no, price, name, fixes}]: 등록 뒤의 금액·이름 고치기와 번호 바로잡기를 따라간다"""
    by = {}
    for e in events:
        kind, no = e.get("kind"), e.get("no")
        if kind == "LLM등록" and e.get("sent") and e.get("price"):
            by.setdefault(no, {"no": no, "price": e["price"], "name": e.get("name"), "fixes": 0})
        elif kind == "LLM금액고치기" and no in by:
            by[no]["price"], by[no]["fixes"] = e.get("to"), by[no]["fixes"] + 1
        elif kind == "LLM이름고치기" and no in by:
            by[no]["name"] = e.get("to")
        elif kind == "LLM번호바로잡기" and e.get("from") in by:
            src = by.pop(e["from"])
            if not e.get("drop"):
                by.setdefault(e.get("to"), dict(src, no=e.get("to")))
    return list(by.values())


def prior_tentative(events):
    """일꾼 이벤트(시간순) → 앞선 실행이 임시로 올려 두고 끝내지 못한 등록 [{no, rid, price, name, ok, pair, rule, nprice, nname, confirm?, withdraw?}] (D-SCR-22).
    서버가 받았다고 답한 것("LLM임시결과" up)만 센다. 확정·거두기를 보냈지만 답을 못 받은 것은 confirm·withdraw에 그 값을 실어 준다(다시 켠 일꾼이 같은 요청 번호로 다시 보낸다)"""
    by = {}
    for e in events:
        kind, rid = e.get("kind"), e.get("rid")
        if not rid:
            continue
        t = by.get(rid)
        if kind == "LLM임시등록" and e.get("sent") and isinstance(e.get("no"), int):
            by[rid] = {"no": e["no"], "rid": rid, "price": e.get("price"), "name": e.get("name"), "state": "sending", "ok": bool(e.get("ok_no")),
                       "pair": e.get("pair"), "rule": bool(e.get("rule")) and not e.get("agreed"), "nprice": 0, "nname": 0, "start_sec": e.get("start_sec")}
        elif t is None:
            continue
        elif kind == "LLM임시결과":
            if e.get("state") == "up":
                t["state"] = "up"
            else:
                del by[rid]
        elif kind == "LLM임시고치기":
            field = "price" if e.get("field") == "price" else "name"
            t[field], t["n" + field] = e.get("to"), t["n" + field] + 1
        elif kind == "LLM임시맞음":
            t["rule"], t["ok"] = False, t["ok"] or bool(e.get("ok_no"))
        elif kind == "LLM등록" and e.get("via") == "확정":
            t["confirm"] = {"to": e.get("no"), "price": e.get("price"), "name": e.get("name")}
        elif kind == "LLM거두기":
            t["withdraw"] = e.get("why") or "앞선 실행이 거두려던 것"
        elif kind in ("LLM확정결과", "LLM거두기결과") and not e.get("error"):
            del by[rid]
    return [t for t in by.values() if t["state"] == "up"]


def read_nicks(out):
    """손님 닉네임 목록(있으면): 결과 폴더의 nicknames.txt 또는 LLM_NICK_FILE — 한 줄에 하나. 품종으로 고르지 않는다"""
    out_set = set()
    for path in (os.environ.get("LLM_NICK_FILE"), os.path.join(out, "nicknames.txt")):
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                out_set.update(x.strip() for x in f if x.strip())
    return out_set


def span_note(i, t, ends, cand, mains):
    """llm_b6 SCREEN=span과 같음: 줄 시작~끝 동안 크게 읽힌 번호(처음 나온 순서, 초 수) / 그다음 보인 번호 3개"""
    secs = range(int(t) - 1, int(ends[i]) + 2)
    big = collections.Counter(mains[x] for x in secs if mains.get(x) is not None)
    order = list(dict.fromkeys(mains[x] for x in secs if mains.get(x) is not None))
    other = collections.Counter(n for x in secs for n in set(cand.get(x, ())) if n not in big)
    parts = [f"{n} 크게 {big[n]}초" for n in order]
    rest = [str(n) for n, _ in other.most_common(3)]
    return (", ".join(parts) + (" / " + ", ".join(rest) if rest else "")) if parts or rest else "없음"


def main_tag(i, t, ends, mains):
    """그 줄 동안 가장 오래 크게 보인 번호표(없으면 None)"""
    c = collections.Counter(mains[x] for x in range(int(t) - 1, int(ends[i]) + 2) if mains.get(x) is not None)
    return c.most_common(1)[0][0] if c else None


def conflicting_tag(number, start, end, candidates, mains):
    """해당 발화 동안 후보 번호는 한 번도 안 보이고 다른 큰 표가 과반 시간 유지됐는가."""
    seconds = range(int(start), int(end) + 1)
    if any(number in candidates.get(sec, ()) for sec in seconds):
        return None
    counts = collections.Counter(mains[sec] for sec in seconds if mains.get(sec) is not None)
    if not counts:
        return None
    tag, frames = counts.most_common(1)[0]
    return tag if frames >= STABLE and frames * 2 > len(seconds) else None


class LlmRegister:
    def __init__(self, out, poster=None, video_id=None, emit=None, par=PAR, prior=None, safe=None, prior_tent=None):
        self.out = out
        self.poster, self.video_id = poster, video_id
        self.emit = emit or (lambda d: None)                 # events.jsonl에 쓰는 함수(일꾼 것)
        self.ex = cf.ThreadPoolExecutor(par)
        self.par = par
        self.flying = []                                     # [(마지막 줄 번호, L, 글, 물은 시각, 까닭, Future)]
        self.tr = []                                         # 받아쓰기 줄 [(시작, 끝, 글)] — 파일을 이어 읽음
        self.tr_pos = 0
        self.sc, self.sc_pos, self.screen_top = Screen(), 0, -1
        self.segs = []                                       # 화면 구간(Screen.build) — 번호대 계산용
        self.seen = {}                                       # 줄 번호 → 처음 읽은 시각(벽시계) — 늦음 재기
        self.checked = 0                                     # 이벤트를 본 줄 수
        self.want = None                                     # (줄 번호, 까닭) — 물어야 하는데 자리가 없어 기다리는 것
        self.asked_line = -1                                 # 마지막으로 물은 창의 끝 줄
        self.asked_t = None                                  # 마지막으로 물은 창의 끝(방송 초)
        self.prev_tag = None
        self.found = []                                      # LLM 줄 [{t, line, no, price, variety, confidence, why}]
        self.sent = {}                                       # 번호 → 보낸 상품(또는 안 보낸 까닭)
        self.last_evidence = {}
        self.names = {}                                      # 보낸 번호 → {"t": 처음 말한 방송 초, "now": 지금 서버 이름, "sure": 그 이름이 확실했나, "votes": Counter, "last": {이름: 시각}, "fixes": 횟수}
        self.prices = {}                                     # 보낸 번호 → {"now": 지금 서버 금액, "votes": [(방송 초, 금액)], "fixes": 횟수} (D-SCR-09)
        self.watch = {}                                      # 보낸 번호 → 말한 줄 시작(방송 초) — 화면으로 맞는지 볼 것 (D-SCR-06)
        self.calls = 0
        # ---- 안전 규칙 (D-SCR-12~16) ----
        self.safe = SAFE if safe is None else safe
        self.unit = PRICE_UNIT
        self.server_unit = None                              # 서버가 알려 준 가격 단위(마지막으로 본 값)
        if self.safe:
            self._follow_unit(first=True)
        self.sys = prompt_for_unit(self.unit, out) if self.safe else SYS
        self.pend = {}                                       # 번호 → 답을 모으는 중인 상품(아직 안 보냄)
        self.skipped = set()                                 # 묻지 않기로 한 줄 번호(이벤트 없음 + 이미 정해진 번호의 줄) — 재현 도구가 줄인 호출을 센다
        self.confirm_calls = 0                               # 답이 한 번뿐이라 같은 창을 한 번 더 물은(묻고 싶었던) 횟수
        self.order = []                                      # 보낸 번호(보낸 순서) — 번호대
        self.sent_prices = []                                # 보낸 금액 — 가격대
        self.held = set()                                    # (번호, 줄) — 앞 번호표 보류를 한 번만 적으려고
        self.dic = None                                      # 품종 사전(처음 쓸 때 읽음)
        self.ledger = None                                   # 가게 품종 장부(처음 쓸 때 읽음)
        self.nicks = read_nicks(out)                         # 손님 닉네임(있으면)
        self.log = open(os.path.join(out, "llm_live.jsonl"), "a", encoding="utf-8")
        self.lock = threading.Lock()
        # ---- 임시 등록 (D-SCR-18~22) ----
        self.tents = {}                                      # 서버에 임시로 올린 번호 → 그 임시 등록 {rid, no, price, name, state, …} (끝나면 뺀다)
        self.left = {}                                       # 번호 → 기다림을 접었지만 서버에 둔 임시 등록(판매자가 확정하거나, 근거가 다시 모이면 일꾼이 확정)
        self.inbox = collections.deque()                     # 서버 응답 [(종류, 임시 등록, 응답)] — 보내는 뒤 스레드가 넣고 tick이 꺼낸다
        self.resume = []                                     # 앞선 실행이 확정·거두기를 보내다 만 임시 등록(첫 tick에 다시 보낸다)
        self.tent_rids = set()                               # 임시 등록에 쓴 요청 번호(같은 번호로 바로 등록을 또 보내면 서버가 "이미 받은 것"으로 넘긴다)
        self.waiting = 0                                     # 서버 답을 기다리는 임시 등록·확정·거두기 수
        self.name_info = {}                                  # 번호 → 고른 품종의 {unsure: 확인 중 품종인가, pattern, form, qty}(D-SCR-30·31)
        self.latest = None                                   # 가장 나중에 처음 올라온 상품 번호 — 그 뒤의 금액 고치기는 이 번호일 때만 저절로 한다(D-SCR-24)
        self.cards = set()                                   # 남긴 확인 카드 (종류, 번호, 값) — 같은 것을 두 번 남기지 않는다
        self.noprice = {}                                    # 번호 → LLM이 가격 없이 적은 답 {t, line, calls}(D-SCR-27)
        self.tag_tried = set()                               # 번호표 규칙으로 한 번 본 번호(D-SCR-27)
        self.rule_dropped = set()                            # 규칙으로 올렸다가 LLM이 적지 않아 거둔 번호 — 같은 말이 되풀이돼도 규칙으로는 다시 올리지 않는다
        if self.safe:
            events = prior_events(out, video_id) if prior is None or prior_tent is None else []
            self.adopt(prior_from_events(events) if prior is None else prior)
            if TENTATIVE:
                self.adopt_tentative(prior_tentative(events) if prior_tent is None else prior_tent)

    def adopt(self, prior):
        """같은 방송의 앞선 실행이 보낸 번호를 이미 보낸 것으로 이어받는다(D-SCR-12c) — 번호표가 다시 보이고 확실한 새 소개일 때만 다시 보낸다"""
        for d in prior:
            no = d.get("no")
            if not isinstance(no, int) or no in self.sent:
                continue
            self.sent[no] = {"no": no, "price": d.get("price"), "name": d.get("name"), "prior": True, "sent": False}
            self.last_evidence[no] = -1e9
            if d.get("price"):
                self.prices.setdefault(no, {"now": d["price"], "votes": [], "fixes": int(d.get("fixes") or 0)})
                self.sent_prices.append(d["price"])
            self.order.append(no)

    def adopt_tentative(self, prior):
        """같은 방송의 앞선 실행이 임시로 올려 두고 끝내지 못한 등록을 이어받는다(D-SCR-22): 그 번호의 답이 다시 모이면 같은 요청 번호로 확정하고,
        번호 근거 없이 올라간 것은 HOLD_MAX 뒤 거둔다. 확정·거두기를 보내다 만 것은 첫 tick에 같은 요청 번호로 다시 보낸다"""
        for d in prior:
            no, rid = d.get("no"), d.get("rid")
            if not isinstance(no, int) or not rid:
                continue
            t = {"no": no, "rid": rid, "n": str(rid).rsplit("-", 1)[-1], "price": d.get("price"), "name": d.get("name") or "", "state": "up", "ok": bool(d.get("ok")),
                 "pair": tuple(d["pair"]) if d.get("pair") else None, "rule": bool(d.get("rule")), "nprice": int(d.get("nprice") or 0), "nname": int(d.get("nname") or 0),
                 "prior": True, "until": None, "tries": 0}
            self.tent_rids.add(rid)
            if d.get("confirm") or d.get("withdraw"):
                self.resume.append((t, d.get("confirm"), d.get("withdraw")))
            elif no not in self.tents and no not in self.sent:
                self.tents[no] = self.left[no] = t

    # ---------- 가격 단위 (D-SCR-21) ----------
    def _follow_unit(self, first=False):
        """서버가 알려 준 이 방송의 가격 단위를 따른다: 판매자가 분명히 고른 값(만 원·원)만 LLM_PRICE_UNIT 대신 쓰고, 그 밖에는 환경변수 그대로"""
        value = getattr(self.poster, "price_unit", None)
        value = value if isinstance(value, str) else None
        if value == self.server_unit:
            return
        self.server_unit = value
        unit, used = unit_from_server(value, PRICE_UNIT)
        changed = unit != self.unit
        self.unit = unit
        if changed and not first:
            self.sys = prompt_for_unit(unit, self.out)
        self.emit({"kind": "LLM가격단위", "server": value, "unit": unit, "from_server": used, "changed": changed})
        name = {10000: "만 원", 1000: "천 원", None: "없음(말한 금액만)"}.get(unit, unit)
        print(f"           가격 단위: 서버 {value or '모름'} → {name}" + ("" if used else " (환경변수 그대로)"), flush=True)

    # ---------- 입력: 일꾼이 쓰는 파일을 이어 읽는다 ----------
    def _read_more(self, name, pos):
        p = os.path.join(self.out, name)
        if not os.path.exists(p):
            return [], pos
        with open(p, "rb") as f:
            f.seek(pos)
            data = f.read()
        out, used = [], 0
        for line in data.splitlines(keepends=True):
            if not line.endswith(b"\n"):
                break                                        # 쓰는 중인 마지막 줄
            used += len(line)
            try:
                out.append(json.loads(line.decode("utf-8")))
            except ValueError:
                pass
        return out, pos + used

    def _load(self):
        rows, self.tr_pos = self._read_more("transcript.jsonl", self.tr_pos)
        now = time.time()
        for d in rows:
            self.seen[len(self.tr)] = now
            self.tr.append((d["start_sec"], d["end_sec"], d["text"]))
        rows, self.sc_pos = self._read_more("screen.jsonl", self.sc_pos)
        for d in rows:
            self.sc.add(d["sec"], [tuple(z) for z in d["t"]])
            self.screen_top = max(self.screen_top, d["sec"])
        self.segs, cand, mains = self.sc.build()
        return cand, mains

    def _ask(self, upto, cand, mains, why):
        """줄 upto까지, 그 줄 시작 앞 WINDOW초의 줄을 묻는다"""
        tr = self.tr
        ends = [e for _, e, _ in tr]
        end_t = tr[upto][0]
        L = [(i, t, x) for i, (t, _, x) in enumerate(tr[:upto + 1]) if end_t - WINDOW <= t]
        self.asked_line, self.asked_t = upto, end_t
        user = "\n".join(f"L{i} [{B.hms(t)}] (화면: {span_note(i, t, ends, cand, mains)}) {B.mask(x)}" for i, t, x in L)
        self.calls += 1
        fut = self.ex.submit(ask_llm, user, self.sys) if self.safe else self.ex.submit(llm_b6.ask, user, SYS, MODEL, EFFORT)
        self.flying.append((upto, L, user, time.time(), why, fut))

    # ---------- 일꾼이 1초마다 부른다 ----------
    def tick(self, final=False):
        cand, mains = self._load()
        tr = self.tr
        ends = [e for _, e, _ in tr]
        if self.safe:
            self._follow_unit()
            self._drain()
        tent = self._tent_on()
        # 1) 새 줄에서 이벤트 찾기 — 화면 읽기가 그 줄 끝까지 왔거나 SCREEN_WAIT초 지난 줄만 본다
        while self.checked < len(tr):
            i = self.checked
            t, e, x = tr[i]
            if not final and self.screen_top < e and time.time() - self.seen.get(i, 0) < SCREEN_WAIT:
                break
            if tent and TENT_RULE:
                self._rule(i, cand, mains)                   # 번호와 금액을 한 줄에 또렷이 말했으면 LLM 답을 기다리지 않고 임시로 올린다
            tag = main_tag(i, t, ends, mains)
            if self.safe and WITHDRAW_CUE.search(x):
                self._withdraw_cue(i, t, tag)
            why = "숫자" if CUE.search(x) else ("번호표 바뀜" if tag is not None and tag != self.prev_tag else None)
            if tag is not None:
                self.prev_tag = tag
            if self.safe and SKIP_SETTLED and why and self._quiet(tag, x, why, t):
                why = None                                   # 새로 알 것이 없는 줄 — 이미 정해진 번호만을 위해 다시 묻지 않는다
            if why is None and (self.asked_t is None or t - self.asked_t >= SAFETY):
                why = "안전망"
            if why and i > self.asked_line:
                self.want = (i, why)
            elif why is None:
                self.skipped.add(i)
            self.checked += 1
        if final and tr and self.asked_line < len(tr) - 1:
            self.want = (len(tr) - 1, "끝")
        # 2) 물을 것이 있고 자리가 있으면 가장 새 줄로 묻는다
        busy = len([f for f in self.flying if not f[5].done()])
        if self.want and busy < self.par:
            i, why = self.want
            self.want = None
            if i > self.asked_line or why == "가격 확인":
                self._ask(i, cand, mains, why)
        # 3) 답이 온 것을 받아 번호+가격이 나온 상품을 보낸다(안전 규칙: 모아서 / 옛 로직: 첫 답으로 바로)
        for item in [f for f in self.flying if f[5].done() or final]:
            upto, L, user, asked_at, why, fut = item
            failed = False
            try:
                out = fut.result()
            except Exception as err:                         # codex 4번 실패: 이 창은 빈 답으로 두고 기록
                out, failed = "", True
                self.emit({"kind": "LLM등록오류", "upto": upto, "error": str(err)[:300]})
            self.flying.remove(item)
            rows = llm_b6.rows_of(out, L, self.unit, wide=True) if self.safe else llm_b6.rows_of(out, L)
            self.log.write(json.dumps({"upto": upto, "why": why, "user": user, "answer": out, "at": time.strftime("%H:%M:%S"),
                                       "sec": round(time.time() - asked_at, 1)}, ensure_ascii=False) + "\n")
            self.log.flush()
            named = set()                                    # 이 답이 적은 번호(숫자 쌍으로 바꾸기 전·후 모두)
            for r in sorted(rows, key=lambda r: r["t"]):
                if r["no"] is None:
                    continue
                start, end, _ = self.tr[r["line"]]
                named.add(r["no"])
                if self.safe:
                    r = self._pair(r, start, end, cand, mains)
                    named.add(r["no"])
                tag = conflicting_tag(r["no"], start, end, cand, mains) if r["confidence"] == "low" and not r.get("pair_wait") else None
                if tag is not None:
                    self.emit({"kind": "LLM번호충돌보류", "no": r["no"], "screen_no": tag,
                               "line": r["line"], "start_sec": start, "price": r["price"]})
                    continue
                # 이미 보낸 번호에 다른 값이 붙은 답(D-SCR-12c): 금액·품종이 둘 다 다르고 판매자가 그 번호를 다시 내놓은 것이 아니면
                # 앞 상품 번호표가 남아 있는 것 — 고치기 투표에도, 다시 보내기에도 쓰지 않는다
                diff = self._differs(r) if self.safe and r["no"] in self.sent else None
                again = bool(diff) and self._reoffered(r, start, mains)
                leftover = diff == "둘 다" and not again
                if leftover:
                    r["leftover"] = True
                    self._note_leftover(r, start)
                self.found.append(r)
                if not leftover:
                    self._vote_name(r)
                if self.safe and NOPRICE_RULE and not r["price"] and not leftover and r["no"] not in self.sent:
                    g = self.noprice.setdefault(r["no"], {"t": r["t"], "line": r["line"], "calls": set(), "upto": upto})
                    g["calls"].add((upto, asked_at))
                    g["upto"] = max(g["upto"], upto)
                if r["price"]:
                    no = r["no"]
                    if not leftover and not (self.safe and no in self.sent and self._reprice_blocked(r, upto, start, cand, mains)):
                        self._vote_price(r, start, end, mains)
                    previous = self.last_evidence.get(no)
                    if not leftover:                         # 앞 번호표로 보류한 답은 그 번호의 근거로 치지 않는다
                        self.last_evidence[no] = max(r["t"], previous if previous is not None else r["t"])
                    new_scene = previous is not None and r["t"] - previous > WINDOW and r.get("confidence") == "high" and any(
                        mains.get(sec) == no for sec in range(int(start), int(end) + 1))
                    if no not in self.sent or new_scene:
                        if not self.safe:
                            self._send(r)
                        elif not diff or again:              # 값이 다른데 다시 내놓은 것이 아니면 다시 보내지 않는다(금액·품종 고치기 투표로만 따라간다)
                            self._pend_add(r, upto, cand, (upto, asked_at))
            if self.safe and not failed:
                self._rule_seen(L, named)
        if self.safe:
            if tent:
                self._rule_noprice(cand, mains)
                self._rule_tag(cand, mains)
            self._settle(cand, mains, final and not self.flying and not self.want)
            if self.left:
                self._sweep(final and not self.flying and not self.want)
            if not final and not self.want and not self.flying and tr:
                self._want_confirm(len(tr) - 1)              # 다음 번 돌 때 묻는다
        self._check_numbers(cand, mains)

    # ---------- 안전 규칙: 묻기 줄이기 (B-2의 L2) ----------
    def _quiet(self, tag, text, why, t=None):
        """이 줄 때문에 물을 필요가 없나(기다리는 상품이 없을 때만):
        - 화면의 번호가 이미 보낸 번호이고, 이 줄에 다른 번호도 그 상품 값과 다른 금액도 없다(번호표가 그 번호로 바뀐 것뿐인 줄도).
          단 품종 없이 보낸 번호는 NAME_FOLLOW초 동안은 계속 묻는다(뒤 답으로 이름을 채우려고)
        - 숫자가 하나도 없고 번호·금액으로 읽히는 말도 없다('만족'·'원래'·'이번'처럼 글자만 걸린 줄)"""
        if self.pend:
            return False
        g = self.names.get(tag) if tag is not None else None
        if g is not None and not g["now"] and t is not None and t - g["t"] <= NAME_FOLLOW:
            return False
        numbers = R.spoken_numbers([text])
        explicit, short = R.spoken_amounts(text, self.unit, exclude={tag} if tag is not None else ())
        amounts = explicit | short
        rec = self.sent.get(tag) if tag is not None else None
        if rec and (rec.get("sent") or rec.get("prior")):
            price = (self.prices.get(tag) or {}).get("now") or rec.get("price")
            return not (numbers - {tag}) and not (amounts - {price})
        return why == "숫자" and not numbers and not amounts and not re.search(r"\d", text)

    def _want_confirm(self, last):
        """답이 한 번뿐인 상품이 있는데 날아가 있는 물음이 없으면 같은 창을 한 번 더 묻는다(상품마다 한 번)"""
        now = time.time()
        for p in self.pend.values():
            if p["confirm"] or not p.get("ok_no") or len(set().union(*p["votes"].values())) != 1 or now - p["last"] < CONFIRM_AFTER:
                continue                                     # 번호 근거가 없는 것(일부만 읽힌 번호표)을 위해서는 다시 묻지 않는다
            p["confirm"] = True
            self.confirm_calls += 1
            self.want = (last, "가격 확인")
            return

    # ---------- 안전 규칙: 번호 ----------
    def _pair(self, r, start, end, cand, mains, by=None):
        """말한 번호와 화면의 큰 번호표가 한 자리만 다를 때 숫자 쌍으로 어느 쪽인지 정한다(D-SCR-14). 번호를 바꾼 줄(또는 기다릴 줄)을 돌려준다.
        by = LLM 답이 아닌 줄(규칙 임시 등록)일 때 그 이름 — 이벤트에 적는다"""
        no, li = r["no"], r["line"]
        texts = [self.tr[j][2] for j in range(max(0, li - 1), min(len(self.tr), li + 2))]
        secs = range(int(start) - 5, int(min(self.screen_top, end + 10)) + 1)
        big = collections.Counter(mains[x] for x in secs if mains.get(x) is not None)
        visible = lambda n: any(n in cand.get(x, ()) for x in secs)
        said = screen = None
        if no in R.spoken_numbers(texts) and not visible(no):
            # LLM이 말한 번호를 골랐는데 화면에는 한 자리 다른 번호표만 보인다
            screen = next((tag for tag, k in big.most_common() if k >= STABLE and R.digit_pair(no, tag)), None)
            said = no if screen is not None else None
        elif big.get(no, 0) >= STABLE:
            # LLM이 화면 번호를 골랐는데 판매자는 한 자리 다른 번호를 'N번'으로 말했다
            beon = {v for x in texts for v in R.numbers_with_beon(x)}
            said = next((s for s in sorted(beon) if R.digit_pair(s, no) and not visible(s)), None)
            screen = no if said is not None else None
        if said is None:
            return r
        frames = big[screen]
        verdict = R.pair_verdict(said, screen, frames, FIX_FRAMES)
        pair = "↔".join(R.digit_pair(said, screen))
        if verdict != "말" and no == said and r["price"] is not None and screen in self.sent:
            # 화면 번호는 이미 다른 금액으로 보낸 상품이다 — 번호를 차례로 파는 판매자(421 다음 422)가 앞 번호표를 든 채 다음 번호를 부른 것으로 보고
            # 말한 번호를 그대로 둔다. 같은 금액이면 같은 상품을 잘못 들은 것(334를 333으로)이라 화면을 따른다
            sent_price = (self.prices.get(screen) or {}).get("now") or self.sent[screen].get("price")
            if sent_price is not None and sent_price != r["price"]:
                return r
        if verdict == "기다림":
            return dict(r, pair_wait=(said, screen))
        to = said if verdict == "말" else screen
        if to != no:
            if by is None:                                   # 규칙 줄의 판정은 뒤따르는 LLM 답에서 한 번 더 나오므로 따로 적지 않는다
                self.emit({"kind": "LLM번호쌍판정", "said": said, "screen": screen, "pair": pair, "to": to, "frames": frames, "line": li, "start_sec": start})
                print(f"           번호 쌍 판정 말 {said}번 / 화면 {screen}번({frames}장) → {to}번 ({pair})", flush=True)
            return dict(r, no=to, pair_from=no)
        return r

    def _same_name(self, a, b):
        """두 품종 이름이 같은가(받아쓰기 모양은 사전 이름으로 맞춰 견준다). 한쪽이 비었으면 다르다고 할 수 없다"""
        key = lambda x: "".join((x or "").split())
        if not key(a) or not key(b) or key(a) == key(b):
            return True
        if not NAME_DICT:
            return False
        from . import variety
        if NAME_MODE == "shop":                              # 가게 장부에 맞춘 품종끼리 견준다. 한쪽이 무늬 말뿐이면 다르다고 할 수 없다
            x, y = (variety.shop_name(v, self._ledger(), self._dic())[0] for v in (a, b))
            return not x or not y or variety.norm(x) == variety.norm(y)
        return variety.norm(variety.canon(variety.tidy(a), self._dic())[0]) == variety.norm(variety.canon(variety.tidy(b), self._dic())[0])

    def _reoffered(self, r, start, mains):
        """이미 보낸 번호를 판매자가 실제로 다시 내놓았나: 그 번호를 다시 불렀거나, 번호표가 한동안(EXPIRE초) 안 보였다가 다시 보였다"""
        no, li = r["no"], r["line"]
        if no in R.spoken_numbers(self.tr[j][2] for j in range(max(0, li - 1), min(len(self.tr), li + 2))):
            return True
        previous = self.last_evidence.get(no)
        lo = int(max(previous if previous is not None else start - 600, start - 600))
        return sum(1 for x in range(lo, int(start)) if x in self.sc.tokens and mains.get(x) != no) >= EXPIRE

    def _differs(self, r):
        """이미 보낸 번호의 값과 이 답이 어떻게 다른가 → None(같음) / "금액" / "품종" / "둘 다" """
        no = r["no"]
        rec = self.sent[no]
        name = (self.names.get(no) or {}).get("now") or rec.get("name")
        price = (self.prices.get(no) or {}).get("now") or rec.get("price")
        p = r["price"] is not None and price is not None and r["price"] != price
        n = not self._same_name(name, r.get("variety"))
        return "둘 다" if p and n else "금액" if p else "품종" if n else None

    def _note_leftover(self, r, start):
        no = r["no"]
        if (no, r["line"]) in self.held:
            return
        self.held.add((no, r["line"]))
        rec = self.sent[no]
        self.emit({"kind": "LLM앞번호표보류", "no": no, "line": r["line"], "start_sec": start, "price": r["price"], "name": r.get("variety"),
                   "sent_price": (self.prices.get(no) or {}).get("now") or rec.get("price"), "sent_name": (self.names.get(no) or {}).get("now") or rec.get("name")})

    def _said_amounts(self, r, upto, cand):
        """그 답이 본 줄(그 줄 15초 앞 ~ 물은 창의 끝)에서 판매자가 말한 금액 → (단위를 말한 것, 단위를 뺀 것). 화면에 보인 번호와 상품 번호는 금액으로 읽지 않는다"""
        li = r["line"]
        start, end, _ = self.tr[li]
        shown = {n for x in range(int(start) - 5, int(end) + 6) for n in cand.get(x, ())} | {r["no"]}
        explicit, short = set(), set()
        for j in range(max(0, li - 12), min(len(self.tr), max(upto, li) + 1)):
            if r["t"] - 15 <= self.tr[j][0] <= r["t"] + 30:
                e, s = R.spoken_amounts(self.tr[j][2], self.unit, exclude=shown)
                explicit |= e
                short |= s
        return explicit, short

    def _reprice_blocked(self, r, upto, start, cand, mains):
        """이미 보낸 번호의 금액 고치기(D-SCR-09)에 이 답을 세면 안 되는 까닭이 있나(D-SCR-13):
        - 판매자가 그 번호를 다시 내놓은 것이 아니다(번호를 다시 부르지도, 번호표가 치워졌다 다시 보이지도 않음) — 앞 번호표를 든 채 다음 상품 값을 말한 것일 수 있다
        - 판매자가 말한 금액이 아니거나, 지금 금액·받아쓴 금액과 꼭 10배·100배 다른데 단위까지 말한 금액이 아니다(350,000을 35,000으로 되돌리지 않게)"""
        no, price = r["no"], r["price"]
        now_price = (self.prices.get(no) or {}).get("now")
        if now_price is None or price == now_price:
            return False
        if REPRICE_STRICT and not self._reoffered(r, start, mains):
            return True
        explicit, short = self._said_amounts(r, upto, cand)
        if price in explicit:
            return False
        tenfold = R.magnitude_conflict(price, {now_price}) is not None
        if price in short and tenfold:                       # 단위 없이 말한 수가 지금 값과 꼭 열 배·백 배 다르다("2씩 … 20") — 고치지 않고 판매자에게 묻는다(D-SCR-26)
            self._price_card(no, now_price, price, "지금 값과 꼭 열 배·백 배 다른 금액을 말함", r)
        return price not in short or tenfold

    def _pend_add(self, r, upto, cand, call):
        """보낼 수도 있는 답 하나를 그 번호의 모음에 더한다. call = 그 답이 나온 호출(같은 호출의 답은 한 번으로 센다)"""
        no, li, now = r["no"], r["line"], time.time()
        p = self.pend.get(no)
        if p is None:
            p = self._pend_new(no, r)
        elif p.get("rule") and not p["rows"]:
            # 규칙이 먼저 올린 상품에 LLM의 첫 답이 왔다 — 줄·시각은 LLM이 고른 줄로 맞춘다(번호 근거·품종·지연 계산이 임시 등록 없는 흐름과 같게)
            p["t"], p["line"], p["t0"] = r["t"], li, now
        t = p.get("tent")
        if t and t.get("rule"):                              # 규칙만으로 올린 임시 등록을 LLM도 그 번호로 읽었다
            t["rule"] = False
            self.emit({"kind": "LLM임시맞음", "no": t["no"], "rid": t["rid"], "line": li, "price": r["price"]})
        p["rows"].append(r)
        p["last"] = now
        p["dirty"] = True
        p["votes"].setdefault(r["price"], set()).add(call)
        if r.get("pair_wait"):
            p["pair"] = r["pair_wait"]
        p["spoken"] = p["spoken"] or no in R.spoken_numbers(self.tr[j][2] for j in range(max(0, li - 1), min(len(self.tr), li + 2)))
        explicit, short = self._said_amounts(r, upto, cand)
        p["explicit"] |= explicit
        p["short"] |= short

    def _pend_new(self, no, r):
        """그 번호의 모음을 새로 만든다. 서버에 남겨 둔 임시 등록(기다림을 접었거나 앞선 실행이 올린 것)이 그 번호(또는 그 숫자 쌍의 다른 번호)에 있으면 이어 붙인다"""
        now = time.time()
        p = self.pend[no] = {"no": no, "t0": now, "last": now, "t": r["t"], "line": r["line"], "rows": [], "votes": {}, "explicit": set(), "short": set(),
                             "spoken": False, "pair": None, "flag": False, "confirm": False, "tent": None, "rule": False, "miss": 0, "agree": 0, "dirty": True}
        t = self.left.get(no) or next((x for x in self.left.values() if no in (x.get("pair") or ())), None)
        if t is not None and t["state"] in ("sending", "up"):
            del self.left[t["no"]]
            t.pop("until", None)
            p["tent"] = t
        return p

    def _band(self):
        return R.band_of(self.order[-R.BAND_RECENT:] + [g["img"] for g in self.segs if g["reads"].get(g["img"], 0) >= BAND_SEG_FRAMES][-R.BAND_RECENT:])

    def _settle(self, cand, mains, final=False):
        """모아 둔 상품마다 번호 근거와 가격이 정해졌는지 보고, 정해졌으면 보낸다. 상한을 넘기면 확인요청·번호보류를 한 번 남긴다"""
        if not self.pend:
            return
        now, band, tent_on = time.time(), self._band(), self._tent_on()
        for no, p in list(self.pend.items()):
            if self.pend.get(no) is not p:
                continue                                     # 이번 돌기에서 다른 번호의 숫자 쌍 옮기기가 이 모음을 합쳤다
            secs = range(int(p["t"]) - 5, int(min(self.screen_top, p["t"] + 60)) + 1)
            if p["pair"]:
                said, screen = p["pair"]
                if any(said in cand.get(x, ()) for x in secs):
                    p["pair"] = None                         # 말한 번호도 화면에 보인다 — 번호표가 따로 있다
                elif sum(1 for x in secs if mains.get(x) == screen) >= FIX_FRAMES:
                    self._pair_move(p, said, screen)
                    continue
            ok, why_no = (False, f"한 자리 다른 번호표({p['pair'][1]}번)를 더 봐야 함") if p["pair"] else R.number_evidence(
                no, p["spoken"], secs, cand, band, TAG_FRAMES, OUT_FRAMES)
            p["ok_no"] = ok
            votes = {price: len(calls) for price, calls in p["votes"].items()}
            price, why_price, blocked = R.price_choice(votes, p["explicit"], p["short"], self.sent_prices, PRICE_AGREE)
            if TEN_GUARD and price is not None and price not in p["explicit"]:
                other = R.magnitude_conflict(price, (p["explicit"] | p["short"]) - {price})
                if other is not None:                        # "2씩 … 20"처럼 열 배 다른 수가 같이 들렸다 — 어느 쪽인지 판매자가 고른다(D-SCR-26)
                    why_price = f"열 배·백 배 다른 금액 {other:,}원이 같이 들림"
                    blocked = {**blocked, price: why_price}
                    price = None
            t = p.get("tent")
            if ok and price is not None:
                twin = self._screen_twin(p, cand, mains) if tent_on else None
                if twin is not None:
                    self._twin_merge(p, *twin)               # 화면에 내내 보인 다른 번호가 임시로 올라가 있다 — 잘못 들은 번호로 보고 그 상품에 합친다
                    continue
                if t is not None and t["state"] == "sending":
                    continue                                 # 임시 등록의 서버 답을 기다린다(곧 온다) — 답을 본 뒤 확정한다
                del self.pend[no]
                if t is not None and t["state"] == "up":
                    self._confirm(p, price, why_no, why_price)
                else:                                        # 임시 등록이 없거나 서버에 올라가지 못했다(이미 있는 번호·판매자가 지운 번호·서버가 받지 않음) — 지금 방식으로
                    self._send_pending(p, price, why_no, why_price)
                continue
            if t is None:
                # 번호 근거가 섰거나(가격만 못 정함) 숫자 쌍을 기다리는 중이면 먼저 임시로 올린다. 이미 보낸 번호(다시 내놓은 상품)는 올리지 않는다
                if tent_on and (ok or p["pair"]) and no not in self.sent and no not in self.tents:
                    self._tent_send(p, ok, why_no, price, votes, blocked, band, secs, cand)
            elif t["state"] == "up":
                if t.get("rule") and not p.get("keep") and not p["votes"] and not p["agree"] and p["miss"] >= RULE_MISS:
                    del self.pend[no]                        # 규칙이 읽은 번호를 그 줄을 본 LLM이 거듭 적지 않았다 — 잘못 읽은 것으로 보고 거둔다
                    self.rule_dropped.add(t["no"])
                    self._withdraw(t, f"그 줄을 본 LLM 답 {p['miss']}번이 이 번호를 적지 않음")
                    continue
                self._tent_follow(p, price, votes, blocked)
            if not p["votes"]:
                if final or now - p["last"] >= HOLD_MAX:
                    del self.pend[no]
                    self._tent_expire(p, final)
                continue                                     # 규칙만으로 올린 것(LLM 답 없음)은 확인요청을 남기지 않는다
            if not p["flag"] and (final or now - p["t0"] >= PRICE_WAIT):
                p["flag"] = True
                rec = {"kind": "LLM확인요청" if ok else "LLM번호보류", "no": no, "why": why_price if ok else why_no, "line": p["line"], "start_sec": p["t"],
                       "start_hms": B.hms(p["t"]), "prices": {str(k): v for k, v in votes.items()}, "said": sorted(p["explicit"] | p["short"]),
                       "wait_sec": round(now - p["t0"], 1), "again": no in self.sent}   # again = 이미 보낸 번호를 다시 내놓은 답(새 등록이 아님)
                self.emit(rec)
                print(f"           {'확인요청' if ok else '번호 보류'} {no:>4}번  {rec['why']}  (답: {', '.join(f'{k:,}원 {v}번' for k, v in votes.items())})", flush=True)
            if final or now - p["last"] >= HOLD_MAX:
                del self.pend[no]
                self._tent_expire(p, final)

    def _pair_move(self, p, said, screen):
        """기다리던 숫자 쌍: 화면 번호표가 충분히 보였다 — 화면 번호로 옮긴다.
        말한 번호로 임시 등록을 올려 두었으면 새로 등록하지 않고 확정할 때 화면 번호로 옮긴다(to). 화면 번호가 이미 보낸 상품이면 임시 등록을 거둔다"""
        del self.pend[p["no"]]
        to = screen
        pair = "↔".join(R.digit_pair(said, screen))
        self.emit({"kind": "LLM번호쌍판정", "said": said, "screen": screen, "pair": pair, "to": to, "line": p["line"], "start_sec": p["t"], "waited": True})
        p["pair"] = None
        t = p.get("tent")
        if to in self.sent:
            if t is not None:
                self._withdraw(t, f"화면 번호 {to}번은 이미 보낸 상품")
            return                                           # 화면 번호는 이미 보낸 상품이다
        q = self.pend.get(to)
        for r in p["rows"]:
            r.update(no=to, pair_from=said)                  # self.found의 같은 줄도 바뀐다 — 품종·들은 말 찾기가 따라온다
        if q is None:
            p["no"], p["spoken"] = to, False
            self.pend[to] = p
            return
        for price, calls in p["votes"].items():
            q["votes"].setdefault(price, set()).update(calls)
        q["rows"] += p["rows"]
        q["explicit"] |= p["explicit"]
        q["short"] |= p["short"]
        q["dirty"] = True
        if t is not None:
            if q.get("tent") is None and to not in self.tents:
                q["tent"] = t                                # 화면 번호 쪽에는 임시 등록이 없다 — 이 임시 등록을 확정할 때 옮긴다
            else:
                self._withdraw(t, f"같은 상품의 임시 등록이 화면 번호 {to}번에 따로 있음")

    def _screen_twin(self, p, cand, mains):
        """확정하려는 번호가 화면에 한 번도 안 보이고 다른 번호표가 내내 크게 보였는데, 그 번호가 이 일꾼이 임시로 올려 두고 아직 모으는 중인 상품이면
        → (그 상품의 모음, 장수). 번호 바로잡기(D-SCR-06)와 같은 조건(말한 뒤 FIX_MIN초, FIX_FRAMES장)을 확정 전에 본다 —
        임시 등록이 그 번호를 차지하고 있어 확정 뒤의 번호 바꾸기는 서버가 받지 않는다(TARGET_EXISTS)"""
        no, start, now = p["no"], p["t"], self.screen_top
        if now - start < FIX_MIN or no in self.sent:         # 이미 보낸 번호(다시 내놓은 상품)는 여기서 다루지 않는다
            return None
        secs = range(int(start) - 5, int(now) + 1)
        if any(no in cand.get(x, ()) for x in secs):
            return None
        seen = collections.Counter(mains[x] for x in secs if mains.get(x) is not None and mains[x] != no)
        if not seen:
            return None
        tag, frames = seen.most_common(1)[0]
        q = self.pend.get(tag)
        if frames < FIX_FRAMES or q is None or q is p or (q.get("tent") or {}).get("state") not in ("sending", "up"):
            return None
        return q, frames

    def _twin_merge(self, p, q, frames):
        """잘못 들은 번호의 답을 화면 번호의 모음에 합치고, 잘못 들은 번호로 올린 임시 등록은 거둔다(그 번호는 판매 중이 된 적이 없다)"""
        no, to = p["no"], q["no"]
        del self.pend[no]
        self.emit({"kind": "LLM번호화면판정", "said": no, "screen": to, "frames": frames, "line": p["line"], "start_sec": p["t"]})
        print(f"           번호 화면 판정 말 {no}번 / 화면 {to}번({frames}장, {no}번은 안 보임) → {to}번에 합침", flush=True)
        for r in p["rows"]:
            r.update(no=to, pair_from=no)                    # self.found의 같은 줄도 바뀐다 — 품종·들은 말 찾기가 따라온다
        for price, calls in p["votes"].items():
            # 잘못 들은 번호의 줄은 판매자가 따로 한 말이다 — 같은 호출의 답이어도 화면 번호의 답과 따로 센다("306번 3만원"과 "313번 3만원입니다")
            q["votes"].setdefault(price, set()).update((call, no) for call in calls)
        q["rows"] += p["rows"]
        q["explicit"] |= p["explicit"]
        q["short"] |= p["short"]
        q["last"], q["dirty"] = time.time(), True
        if p.get("tent") is not None:
            self._withdraw(p["tent"], f"화면에는 {to}번만 보임 — 같은 상품을 잘못 들은 번호")
        # 잘못 들은 번호는 본 것으로 남겨 같은 말을 다시 받아도 또 올리지 않는다(화면에 그 번호가 보이면 새 장면으로만 — 번호 바로잡기 D-SCR-06과 같다)
        self.rule_dropped.add(no)
        self.sent[no] = {"no": no, "price": None, "name": None, "sent": False, "skip": f"화면 번호 {to}번에 합침", "fixed_to": to, "start_sec": p["t"]}

    # ---------- 임시 등록 (D-SCR-18~22) ----------
    def _tent_on(self):
        """임시 등록 흐름을 쓰나: 안전 규칙이 켜져 있고, LLM_TENTATIVE가 0이 아니고, 서버가 임시 등록·확정·거두기를 모두 받는다고 답했다(E11)"""
        if not (self.safe and TENTATIVE and self.poster):
            return False
        ok = getattr(self.poster, "tentative_ok", None)
        return callable(ok) and ok() is True

    def _rule(self, i, cand, mains):
        """받아쓴 줄 하나에 'N번'과 단위를 말한 금액이 하나씩이면(B2 "번호와 가격이 한 구절에 또렷") LLM 답을 기다리지 않고 그 번호의 모음을 만든다.
        번호 근거가 서면 이번 돌기의 _settle이 임시로 올리고, LLM 답이 같은 금액을 적으면 확정한다. 이미 보낸 번호·모으는 중인 번호·번호대 밖 번호는 하지 않는다"""
        start, end, text = self.tr[i]
        beon = set(R.numbers_with_beon(text))
        if len(beon) != 1:
            return
        explicit, _ = R.spoken_amounts(text, self.unit, exclude=beon)
        if len(explicit) != 1:
            return
        price = next(iter(explicit))
        if price < 1000 or price % 500:
            return                                           # "만오" → 10,005원처럼 받아쓰기가 흐린 금액은 규칙으로 올리지 않는다(LLM 답을 기다린다)
        r = self._pair({"t": start, "line": i, "no": next(iter(beon)), "price": price, "variety": None, "confidence": None}, start, end, cand, mains, by="규칙")
        no = r["no"]
        if no in self.sent or no in self.pend or no in self.tents or no in self.rule_dropped or not R.in_band(no, self._band()):
            return
        p = self._pend_new(no, r)
        p["rule"], p["rule_price"] = True, price
        p["spoken"] = no in R.spoken_numbers(self.tr[j][2] for j in range(max(0, i - 1), min(len(self.tr), i + 2)))
        if r.get("pair_wait"):
            p["pair"] = r["pair_wait"]
        if r.get("pair_from") is not None:
            p["pair_from"] = r["pair_from"]
        p["explicit"], p["short"] = self._said_amounts(r, i, cand)
        p["explicit"].add(price)

    def _rule_seen(self, L, named):
        """LLM 답 하나가 왔다: 규칙만으로 올린 상품의 줄을 그 답이 봤는데 그 번호를 적지 않았으면 센다(RULE_MISS번이면 거둔다)"""
        lines = {i for i, _, _ in L}
        for p in self.pend.values():
            if p.get("rule") and not p["votes"] and p["line"] in lines:
                t = p.get("tent")
                if p["no"] in named or (t is not None and t["no"] in named):
                    p["agree"] += 1
                else:
                    p["miss"] += 1

    def _tent_price(self, p, votes, blocked):
        """임시로 보일 금액(아직 정해지지 않았을 때 가장 그럴듯한 값 — 판매자가 그대로 [공개]하면 이 값으로 확정된다):
        판매자가 말한 금액과 같은 LLM 답(많은 쪽) → 규칙이 번호와 함께 읽은 금액 → LLM 답이 받아쓴 금액과 10배·100배 어긋나면 받아쓴 금액(판매자 단위)
        → 막히지 않은 LLM 답(많은 쪽) → 아무 답"""
        said = p["explicit"] | p["short"]
        ranked = sorted((x for x in votes if x is not None), key=lambda x: votes[x], reverse=True)
        heard = [x for x in ranked if x in said and x not in blocked]
        if heard:
            return heard[0]
        if p.get("rule_price") is not None:
            return p["rule_price"]
        for x in ranked:
            other = R.magnitude_conflict(x, said)
            if other is not None:
                return other
        free = [x for x in ranked if x not in blocked]
        return free[0] if free else (ranked[0] if ranked else None)

    def _name_candidates(self, no, p, name):
        """품종 후보: 고른 이름 + LLM이 그 번호에 적은 이름 가운데 사전에 있는 것(손님 닉네임·품종 아닌 말이 후보로 나가지 않게)"""
        out = [name] if name else []
        if not NAME_DICT:
            return out
        from . import variety
        for f in self.found:
            if f["no"] == no and abs(f["t"] - p["t"]) <= WINDOW and f["variety"] and not f.get("leftover"):
                tidy = variety.tidy(f["variety"])
                if not tidy or variety.not_a_name(tidy, self.nicks):
                    continue
                canon, known = variety.canon(tidy, self._dic())
                if known and canon not in out:
                    out.append(canon)
        return out

    def _tent_send(self, p, ok, why_no, price, votes, blocked, band, secs, cand):
        """그 번호를 임시로 올린다(계약서 2.1): 지금까지의 금액·품종·번호 후보와 까닭 낱말을 싣는다. 서버 답은 뒤 스레드가 inbox에 넣는다"""
        from . import post
        no, now = p["no"], time.time()
        shown = price if price is not None else self._tent_price(p, votes, blocked)
        if shown is None:
            return
        name, why_name, _ = self._name(no, p)
        said = p["explicit"] | p["short"]
        reasons, nos = [], [no]
        if p["pair"]:
            reasons.append("NUMBER_MISMATCH")
            nos += [x for x in p["pair"] if x != no]
        else:
            moved = [r["pair_from"] for r in p["rows"] if r.get("pair_from") is not None] + ([p["pair_from"]] if p.get("pair_from") is not None else [])
            if moved:
                reasons.append("NUMBER_MISMATCH")
                nos += moved
            elif not (p["spoken"] and R.full_frames(no, secs, cand, band) >= TAG_FRAMES):
                reasons.append("NUMBER_SINGLE_SOURCE")
        if not R.in_band(no, band):
            reasons.append("NUMBER_OUT_OF_RANGE")
        if price is None:
            if any(x not in p["explicit"] and R.out_of_range(x, self.sent_prices) for x in votes):
                reasons.append("PRICE_OUT_OF_RANGE")
            if len(votes) > 1 or any(R.magnitude_conflict(x, said) is not None for x in votes):
                reasons.append("PRICE_DISAGREE")
            elif "PRICE_OUT_OF_RANGE" not in reasons:
                reasons.append("PRICE_SINGLE_SOURCE")
        if not name:
            reasons.append("NAME_UNSURE")
        prices = [shown] + sorted(votes, key=lambda x: votes[x], reverse=True) + sorted(said)
        tentative = post.make_tentative(reasons or ["NUMBER_SINGLE_SOURCE"], nos, prices, self._name_candidates(no, p, name))
        line = p["line"]
        lines = [f["line"] for f in self.found if f["no"] == no and abs(f["t"] - p["t"]) <= WINDOW and not f.get("leftover")] or [line]
        rule = bool(p.get("rule")) and not p["votes"]
        ruled = shown in said
        first = next((r for r in p["rows"] if r["price"] == shown), None)
        conf = 0.9 if ruled and not rule else CONF.get(str((first or {}).get("confidence")).lower(), 0.6 if rule else 0.7)
        body = post.make_body(self.video_id, no, shown, name or "", self._heard(lines), conf, tentative=tentative)
        if body is None:
            return
        seen = self.seen.get(line, now)
        observed = int(seen * 1000)
        while f"screen-{self.video_id}-{no}-{observed}" in self.tent_rids:
            observed += 1                                    # 같은 줄에서 다시 올릴 때(거둔 뒤)도 요청 번호가 겹치지 않게
        rid = f"screen-{self.video_id}-{no}-{observed}"
        body.update(observedAt=observed, requestId=rid)
        self.tent_rids.add(rid)
        t = {"no": no, "rid": rid, "n": str(observed), "price": shown, "name": name or "", "state": "sending", "ok": bool(ok), "pair": p["pair"], "rule": rule,
             "nprice": 0, "nname": 0, "sent_wall": now, "tries": 0, "t": p["t"]}
        p["tent"] = self.tents[no] = t
        p["dirty"] = False
        self.latest = no
        self.emit({"kind": "LLM임시등록", "no": no, "start_sec": p["t"], "start_hms": B.hms(p["t"]), "price": shown, "name": name, "rid": rid,
                   "reasons": tentative["reasons"], "candidates": tentative["candidates"], "line": line, "line_seen_wall": round(seen, 2), "sent_wall": round(now, 2),
                   "wait_sec": round(now - seen, 1), "ok_no": bool(ok), "why_no": why_no, "why_name": why_name, "pair": list(p["pair"]) if p["pair"] else None,
                   "rule": rule, "answers": sum(votes.values()), "sent": True})
        print(f"           임시 등록 {no:>4}번  {shown:,}원  {name or '품종 모름'}  (줄을 읽고 {round(now - seen, 1)}초, {'규칙' if rule else 'LLM'}: {', '.join(tentative['reasons'])})", flush=True)
        self.waiting += 1
        self.poster.send(body, on_result=lambda res, t=t: self.inbox.append(("임시", t, res)))

    def _tent_follow(self, p, price, votes, blocked):
        """확정 전: 임시로 보이는 금액·이름이 지금 가장 그럴듯한 값과 다르면 바로 고쳐 보낸다(확인 중 상품도 금액·이름 고치기 입구가 받는다 — 계약서 5절).
        판매자가 그 상품을 [공개]로 확정하면 그때의 값이 나가므로, 확인 중에도 가장 그럴듯한 값을 보여 둔다"""
        t, no = p["tent"], p["no"]
        best = price if price is not None else self._tent_price(p, votes, blocked)
        if best is not None and best != t["price"] and t["nprice"] < TENT_FIX_MAX and not t.get("kept_price"):
            t["nprice"] += 1
            old, t["price"] = t["price"], best
            self.emit({"kind": "LLM임시고치기", "no": t["no"], "rid": t["rid"], "field": "price", "from": old, "to": best, "n": TENT_FIX_BASE + t["nprice"]})
            print(f"           임시 등록 금액 고치기 {t['no']}번 {old:,}원 → {best:,}원", flush=True)
            self.poster.reprice(self.video_id, t["no"], best, TENT_FIX_BASE + t["nprice"])
        if p.get("dirty"):
            p["dirty"] = False
            name = self._name(no, p)[0]
            if name and name != t["name"] and t["nname"] < TENT_FIX_MAX:
                t["nname"] += 1
                old, t["name"] = t["name"], name
                self.emit({"kind": "LLM임시고치기", "no": t["no"], "rid": t["rid"], "field": "name", "from": old, "to": name, "n": TENT_FIX_BASE + t["nname"]})
                print(f"           임시 등록 이름 고치기 {t['no']}번 {old or '(없음)'} → {name}", flush=True)
                self.poster.rename(self.video_id, t["no"], name, TENT_FIX_BASE + t["nname"])

    def _confirm(self, p, price, why_no, why_price):
        """임시로 올린 상품의 번호 근거와 가격이 정해졌다 — 확정한다(계약서 2.2). 그 뒤의 금액·이름·번호 고치기는 지금 입구 그대로"""
        self._send_pending(p, price, why_no, why_price, tent=p["tent"])

    def _post_confirm(self, t):
        t["tries"] += 1
        self.waiting += 1
        self.poster.confirm(self.video_id, t["no"], t["rid"], to=t.get("to"), price=t.get("final_price"), name=t.get("final_name"), n=t["n"],
                            on_result=lambda res, t=t: self.inbox.append(("확정", t, res)))

    def _withdraw(self, t, why):
        """임시 등록을 거둔다(계약서 2.3). 서버 답을 아직 못 받았으면 답을 본 뒤에. 판매자가 손댄 상품은 서버가 거두지 않는다"""
        if t["state"] == "sending":
            t["then"] = why
            return
        if t["state"] != "up":
            return
        t["state"] = "withdrawing"
        t["tries"] += 1
        if self.tents.get(t["no"]) is t:
            del self.tents[t["no"]]
        if self.left.get(t["no"]) is t:
            del self.left[t["no"]]
        self.emit({"kind": "LLM거두기", "no": t["no"], "rid": t["rid"], "why": why, "sent": True})
        print(f"           임시 등록 거두기 {t['no']}번 ({why})", flush=True)
        self.waiting += 1
        self.poster.withdraw(self.video_id, t["no"], t["rid"], n=t["n"], on_result=lambda res, t=t: self.inbox.append(("거두기", t, res)))

    def _leave(self, t, why):
        """임시 등록을 서버에 둔다 — 판매자가 앱에서 확정하거나 지운다. 그 번호의 답이 다시 모이면 일꾼이 이어서 확정한다"""
        t.pop("until", None)
        self.left[t["no"]] = t
        if not t.get("noted"):
            t["noted"] = True
            self.emit({"kind": "LLM임시남김", "no": t["no"], "rid": t["rid"], "why": why, "price": t["price"], "name": t["name"]})
            print(f"           임시 등록 {t['no']}번은 그대로 둬요 — 판매자가 확정 ({why})", flush=True)

    def _tent_expire(self, p, final):
        """기다림을 접는 자리(HOLD_MAX·방송 끝): 올려 둔 임시 등록을 거둘지 둘지 정한다.
        방송 끝 → 둔다(계약서 2.5). 규칙만으로 올렸는데 LLM이 보고도 그 번호를 적지 않았다 → 거둔다. 번호 근거가 섰거나 숫자 쌍을 기다리던 것 → 둔다(LLM_TENTATIVE_KEEP=0이면 거둔다)"""
        t = p.get("tent")
        if t is None or t["state"] not in ("sending", "up"):
            return
        if final:
            self._leave(t, "방송 끝")
        elif t.get("rule") and not p.get("keep") and not p["votes"] and not p["agree"] and p["miss"]:
            self.rule_dropped.add(t["no"])
            self._withdraw(t, "그 줄을 본 LLM 답이 이 번호를 적지 않음")
        elif TENT_KEEP and (p.get("ok_no") or p["pair"] or t.get("ok") or t.get("pair")):
            self._leave(t, "가격을 정하지 못함" if p.get("ok_no") else "번호를 정하지 못함")
        else:
            self._withdraw(t, "번호 근거를 끝내 얻지 못함")

    def _sweep(self, final):
        """앞선 실행에서 이어받은 임시 등록 가운데 이번 실행에서 답이 다시 모이지 않은 것: HOLD_MAX 뒤 번호 근거가 섰던 것은 두고(판매자가 확정) 아니면 거둔다.
        규칙만으로 올리고 LLM 답을 받지 못한 것도 둔다 — 이번 실행의 LLM은 그 줄을 볼 수 없으니 "LLM이 보고도 적지 않은 것"이 아니다"""
        now = time.time()
        for t in list(self.left.values()):
            if "until" not in t:
                continue
            if t["until"] is None:
                t["until"] = now + HOLD_MAX                  # 이번 실행이 돌기 시작한 때부터 잰다
            if not final and now < t["until"]:
                continue
            if final or (TENT_KEEP and (t.get("ok") or t.get("pair"))):
                self._leave(t, "방송 끝" if final else "앞선 실행이 올린 것 — 이번 실행에서 근거가 더 모이지 않음")
            else:
                self._withdraw(t, "앞선 실행이 올린 것 — 번호 근거가 없거나 두지 않기로 함")

    def _hands_off(self, no, fields):
        """판매자가 먼저 손댄 칸은 일꾼이 더 고치지 않는다: price → 금액 고치기, name → 이름 고치기, no → 번호 바로잡기"""
        if "price" in fields and no in self.prices:
            self.prices[no]["fixes"] = PRICE_MAX_FIX
        if "name" in fields and no in self.names:
            self.names[no]["fixes"] = NAME_MAX_FIX
        if "no" in fields:
            self.watch.pop(no, None)

    def _drain(self):
        """서버 응답(임시 등록·확정·거두기)을 받아 적는다. 방송마다의 changed·skip·kept를 그대로 이벤트로 남기고 따른다"""
        if self.resume and self._tent_on():
            todo, self.resume = self.resume, []
            for t, confirm, withdraw in todo:                # 앞선 실행이 보내다 만 확정·거두기를 같은 요청 번호로 다시(서버는 한 번만 받는다)
                if confirm:
                    t.update(to=confirm.get("to") if confirm.get("to") != t["no"] else None, final_price=confirm.get("price"), final_name=confirm.get("name"),
                             final_no=confirm.get("to") or t["no"], state="confirming")
                    self.emit({"kind": "LLM확정다시", "no": t["no"], "rid": t["rid"], "to": t["final_no"]})
                    self._post_confirm(t)
                else:
                    self._withdraw(t, withdraw)
        while self.inbox:
            kind, t, res = self.inbox.popleft()
            self.waiting -= 1
            res = res if isinstance(res, dict) else {}
            rows = [r for r in res.get("broadcasts") or [] if isinstance(r, dict)]
            brief = [{k: r[k] for k in ("changed", "duplicate", "tentative", "skip", "kept") if k in r} for r in rows]
            skips = {r["skip"] for r in rows if r.get("skip")}
            kept = sorted({k for r in rows for k in (r.get("kept") or ())})
            error = None if res.get("ok") else str(res.get("error") or "응답 없음")
            if kind == "임시":
                if error:
                    state = "failed"
                elif res.get("changed") or any(r.get("changed") for r in rows):
                    state = "up"
                else:
                    state = "closed" if "CLOSED" in skips else "exists"   # 판매자가 지운 번호 / 이미 있는 번호(판매자 손 등록·다른 등록)
                self.emit({"kind": "LLM임시결과", "no": t["no"], "rid": t["rid"], "state": state, "broadcasts": brief, **({"error": error} if error else {})})
                if t["state"] != "sending":
                    continue
                t["state"] = state
                if state != "up":
                    if self.tents.get(t["no"]) is t:
                        del self.tents[t["no"]]
                    if self.left.get(t["no"]) is t:
                        del self.left[t["no"]]
                elif t.get("then"):
                    self._withdraw(t, t.pop("then"))
            elif kind == "확정":
                no = t.get("final_no", t["no"])
                if error and error != "UNSUPPORTED" and t["tries"] < 3:
                    self._post_confirm(t)                    # 서버에 닿지 못했다 — 같은 요청 번호로 다시
                    continue
                self.emit({"kind": "LLM확정결과", "no": t["no"], "to": no, "rid": t["rid"], "changed": bool(res.get("changed")), "broadcasts": brief,
                           "skips": sorted(skips), "kept": kept, **({"error": error} if error else {})})
                t["state"] = "done"
                if "TARGET_EXISTS" in skips and not res.get("changed"):
                    # 옮길 번호에 상품이 이미 있다(판매자가 먼저 넣었다) — 잘못 들은 번호의 임시 등록이므로 거둔다
                    t["state"] = "up"
                    self._withdraw(t, f"옮길 번호 {no}번에 상품이 이미 있음")
                # 판매자가 먼저 확정·수정·거둔 상품(skip)과 판매자 값으로 남은 칸(kept)은 일꾼이 더 건드리지 않는다
                self._hands_off(no, set(kept) if res.get("changed") else {"price", "name", "no"} if skips or error else set())
            elif kind == "거두기":
                if error and error != "UNSUPPORTED" and t["tries"] < 3:
                    t["state"] = "up"
                    self._withdraw(t, "다시 보냄")
                    continue
                self.emit({"kind": "LLM거두기결과", "no": t["no"], "rid": t["rid"], "changed": bool(res.get("changed")), "broadcasts": brief,
                           "skips": sorted(skips), **({"error": error} if error else {})})
                t["state"] = "done"

    # ---------- 안전 규칙: 품종 ----------
    def _product_lines(self, no, p):
        """그 상품의 받아쓰기 [(초, 글)]: 첫 줄 앞 NAME_PRE초 ~ 뒤 NAME_POST초, 다른 번호를 말한 줄에서 끊는다"""
        from .decide import numbers_bare
        known = {g["img"] for g in self.segs} | set(self.sent) | {no}
        other = lambda x: any(v != no for v in R.numbers_with_beon(x) + [v for v in numbers_bare(x) if v >= 100 and v in known])
        first = p["line"]
        lo = first
        while lo > 0 and self.tr[lo - 1][0] >= p["t"] - NAME_PRE and not other(self.tr[lo - 1][2]):
            lo -= 1
        hi = first
        while hi + 1 < len(self.tr) and self.tr[hi + 1][0] <= p["t"] + NAME_POST and not other(self.tr[hi + 1][2]):
            hi += 1
        return [(s, x) for s, _, x in self.tr[lo:hi + 1]]

    def _dic(self):
        if self.dic is None:
            from . import variety
            self.dic = variety.Dictionary(seller=NAME_SELLER)
        return self.dic

    def _ledger(self):
        if self.ledger is None:
            from . import variety
            self.ledger = variety.Ledger(SHOP_LEDGER)
        return self.ledger

    def _name(self, no, p):
        """보낼 품종 이름 → (이름 또는 None, 까닭, 굳은 이름인가).
        shop(D-SCR-29~32): LLM이 그 번호에 적은 이름을 가게 장부에 맞춘다. 장부에 없으면 버리지 않고 확인 중 품종으로(self.unsure에 적는다).
        dict(D-SCR-15): LLM 이름과 전국 사전 규칙을 견줘 사전에 있을 때만"""
        names = [f["variety"] for f in self.found if f["no"] == no and abs(f["t"] - p["t"]) <= WINDOW and f["variety"] and not f.get("leftover")]
        if not NAME_DICT:
            return (collections.Counter(names).most_common(1)[0][0] if names else None), "LLM 이름", False
        from . import variety
        if NAME_MODE == "shop":
            name, why, strong, unsure, extra = variety.pick_shop(names, self._product_lines(no, p), self._dic(), self._ledger(), self.nicks)
            self.name_info[no] = dict(extra, unsure=bool(name) and unsure)
            return name or None, why, strong
        name, why, strong = variety.pick_name(names, self._product_lines(no, p), self._dic(), self.nicks, detail=True)
        return name or None, why, strong

    def _send_pending(self, p, price, why_no, why_price, tent=None):
        """번호 근거와 가격이 정해진 상품을 보낸다. tent = 그 상품의 임시 등록(서버에 올라가 있음) — 새로 등록하지 않고 확정한다"""
        no = p["no"]
        first = next(r for r in p["rows"] if r["price"] == price)
        name, why_name, locked = self._name(no, p)
        ruled = price in p["explicit"] or price in p["short"]
        conf = 0.9 if ruled else CONF.get(str(first.get("confidence")).lower(), 0.7)
        r = dict(first, no=no, t=p["t"], line=p["line"], variety=name)
        self._send(r, picked=True, conf=conf, tent=tent, note={"why_no": why_no, "why_price": why_price, "why_name": why_name, "name_locked": locked,
                                                               "answers": sum(len(c) for c in p["votes"].values()), "flagged": p["flag"]})

    # ---------- 고치기 (D-SCR-06·07·09) ----------
    def _vote_name(self, r):
        """D-SCR-07: 보낸 번호에 대한 확실한 품종 답을 세고, 지금 이름과 다르면 고쳐 보낸다"""
        g = self.names.get(r["no"])
        name = (r.get("variety") or "").strip()
        if g is None or not name or str(r.get("confidence")).lower() != "high" or r["t"] - g["t"] > NAME_WINDOW:
            return
        key = "".join(name.split())
        if key in NOT_NAMES:
            return
        if self.safe and NAME_DICT and NAME_MODE == "shop":
            # 품종이 아닌 말·손님 닉네임을 거르고 가게 장부에 맞춘 뒤 센다. 장부에 있는 이름은 지금 이름을 바꿀 수 있고,
            # 장부에 없는 이름은 빈칸을 채울 때만 쓴다(확인 중 품종) — 맞는 이름을 모르는 말로 바꾸지 않는다(D-SCR-30)
            from . import variety
            near = [(s, x) for s, _, x in self.tr[max(0, r["line"] - 12):r["line"] + 3]]
            nicks = self.nicks | variety.nicknames(near)
            tidy = variety.tidy(name)
            if not tidy or variety.not_a_name(tidy, nicks):
                return
            base, pat, _, _, in_ledger, in_dic = variety.shop_name(name, self._ledger(), self._dic())
            if not base and pat and not g["now"]:            # 이름 없이 무늬 말만 거듭 들린 상품: 빈칸을 그 말(가게 말버릇이 있으면 그 말)로 채운다
                base, pat, in_dic = self._ledger().habits.get(pat) or pat, "", True
            if not base or variety.not_a_name(base, nicks) or (g["now"] and not in_ledger):
                return
            name = variety.join_parts(base, pat)
            key = "".join(name.split())
            g.setdefault("unsure_of", {})[key] = not (in_ledger or in_dic)
        elif self.safe and NAME_DICT:
            # 품종이 아닌 말·손님 닉네임을 거르고, 받아쓰기 모양(세검·상광)을 사전 이름으로 맞춘 뒤 센다(D-SCR-15)
            from . import variety
            name = variety.tidy(name)
            near = [(s, x) for s, _, x in self.tr[max(0, r["line"] - 12):r["line"] + 3]]
            if not name or variety.not_a_name(name, self.nicks | variety.nicknames(near)):
                return
            name, known = variety.canon(name, self._dic())
            if not known:
                return                                       # 사전에 없는 이름으로는 고치지 않는다(틀린 이름보다 빈 이름)
            key = "".join(name.split())
        g["votes"][key] += 1
        g["last"][key] = r["t"]
        g["shown"][key] = name
        ranked = sorted(g["votes"], key=lambda k: (g["votes"][k], g["last"][k]), reverse=True)
        best = ranked[0]
        if best == "".join((g["now"] or "").split()) or g["fixes"] >= NAME_MAX_FIX:
            return
        # 처음 이름이 확실(high)했으면 한 표 더 (재현: 청개구리 → 청수처럼 맞던 이름을 바꾸는 일을 줄인다)
        need = NAME_VOTES + (1 if g["now"] and g["sure"] else 0)
        if g["votes"][best] < need or (len(ranked) > 1 and g["votes"][ranked[1]] >= g["votes"][best]):
            return
        g["fixes"] += 1
        old, g["now"], g["sure"] = g["now"], g["shown"][best], True
        rec = {"kind": "LLM이름고치기", "no": r["no"], "from": old, "to": g["now"], "votes": g["votes"][best], "sent": bool(self.poster),
               **({"name_unsure": True} if (g.get("unsure_of") or {}).get(best) else {})}
        self.emit(rec)
        print(f"           이름 고치기 {r['no']}번 {old or '(없음)'} → {g['now']}", flush=True)
        if self.poster:
            self.poster.rename(self.video_id, r["no"], g["now"], g["fixes"])

    def _vote_price(self, r, start, end, mains):
        """D-SCR-09: 보낸 번호가 화면에 보이는 줄의 확실한 금액을 세고, 지금 금액과 다르면 고쳐 보낸다.
        D-SCR-24·25: 크게 다른 값·다음 상품으로 넘어간 뒤의 값은 고치지 않고, 한 번만 들린 다른 값과 함께 확인 카드로 남긴다"""
        no = r["no"]
        g = self.prices.get(no)
        if g is None or str(r.get("confidence")).lower() != "high" or g["fixes"] >= PRICE_MAX_FIX:
            return
        if not any(mains.get(sec) == no for sec in range(int(start), int(end) + 1)):
            if self.safe and r["price"] != g["now"]:
                self._price_card(no, g["now"], r["price"], "번호와 함께 다른 금액을 말함(번호표는 안 보임)", r)
            return
        g["votes"] = [v for v in g["votes"] if r["t"] - v[0] <= PRICE_WINDOW] + [(r["t"], r["price"])]
        count = collections.Counter(p for _, p in g["votes"])
        last = {p: t for t, p in g["votes"]}
        ranked = sorted(count, key=lambda p: (count[p], last[p]), reverse=True)
        best = ranked[0]
        if best == g["now"]:
            return
        enough = count[best] >= PRICE_VOTES and not (len(ranked) > 1 and count[ranked[1]] >= count[best])
        risky = self._reprice_risky(no, g["now"], best) if self.safe else None
        if not enough or risky:
            if self.safe and r["price"] != g["now"]:
                self._price_card(no, g["now"], r["price"], (self._reprice_risky(no, g["now"], r["price"]) or "다른 금액을 한 번 말함"), r)
            return
        g["fixes"] += 1
        old, g["now"], g["votes"] = g["now"], best, []
        self.emit({"kind": "LLM금액고치기", "no": no, "from": old, "to": best, "votes": count[best], "start_sec": r["t"], "sent": bool(self.poster)})
        print(f"           금액 고치기 {no}번 {old:,}원 → {best:,}원", flush=True)
        if self.poster:
            self.poster.reprice(self.video_id, no, best, g["fixes"])

    def _reprice_risky(self, no, now, to):
        """이 금액 고치기를 저절로 하면 안 되는 까닭(없으면 None) — D-SCR-24"""
        if REPRICE_FACTOR and now and to and max(now, to) > min(now, to) * REPRICE_FACTOR:
            return f"지금 값과 {REPRICE_FACTOR:g}배 넘게 다름"
        if REPRICE_FACTOR and R.out_of_range(to, self.sent_prices):
            return "이 방송 가격대를 벗어남"
        if REPRICE_LATEST and self.latest is not None and self.latest != no:
            return f"그 뒤에 다른 상품({self.latest}번)이 올라옴"
        return None

    def _price_card(self, no, now, to, why, r):
        """금액을 저절로 고치지 않고 판매자에게 물을 것을 남긴다(D-SCR-25): "N번 6만 원 → 5만 원으로 바꿀까요?" — 같은 값은 한 번만"""
        if not PRICE_CARD or to is None or to == now or ("price", no, to) in self.cards:
            return
        li = r.get("line")
        first = (self.sent.get(no) or {}).get("line")        # 그 상품을 등록한 줄(그 줄에서 말한 번호는 세지 않는다)
        lo = max(0, li - 1, (first if isinstance(first, int) else -1) + 1) if li is not None else 0
        if li is None or no not in R.spoken_numbers(self.tr[j][2] for j in range(lo, min(len(self.tr), li + 2))):
            return                                           # 번호를 말하지 않은 줄의 금액은 다음 상품 값일 때가 많다(2026-11-12 재현: 그런 카드 7장이 모두 틀린 제안) — 묻지 않는다
        self.cards.add(("price", no, to))
        self.emit({"kind": "LLM가격확인카드", "no": no, "from": now, "to": to, "why": why, "line": r.get("line"), "start_sec": r.get("t")})
        print(f"           가격 확인 카드 {no}번 {now:,}원 → {to:,}원? ({why})", flush=True)

    def _withdraw_cue(self, i, t, tag):
        """판매자가 "번호 떼"처럼 상품을 거둔다고 말했다(D-SCR-28) — 지우지 않고 물을 것을 남긴다. 화면의 번호가 이미 올라간 상품이면 그 번호, 아니면 가장 나중 상품"""
        no = tag if tag is not None and (tag in self.tents or (self.sent.get(tag) or {}).get("sent")) else self.latest
        if no is None or ("withdraw", no) in self.cards:
            return
        self.cards.add(("withdraw", no))
        self.emit({"kind": "LLM거두기확인카드", "no": no, "line": i, "start_sec": t})
        print(f"           거두기 확인 카드 {no}번 (판매자가 번호를 뗀다고 말함)", flush=True)

    # ---------- 근거가 모자란 상품도 임시로 (D-SCR-27) ----------
    def _amounts_between(self, lo, hi, cand, no):
        """방송 초 lo~hi의 줄에서 판매자가 말한 금액(단위를 말한 것 | 단위를 뺀 것). 화면에 보인 번호와 그 번호는 금액으로 읽지 않는다"""
        shown = {n for x in range(int(lo) - 5, int(hi) + 6) for n in cand.get(x, ())} | {no}
        explicit, short = set(), set()
        for s0, e0, x in self.tr:
            if e0 >= lo and s0 <= hi:
                e, sh = R.spoken_amounts(x, self.unit, exclude=shown)
                explicit |= e
                short |= sh
        return explicit, short

    def _nearest_amount(self, line, lo, hi, cand, no):
        """방송 초 lo~hi에서 말한 금액 가운데 line 줄에서 가장 가까운 줄의 것(같으면 뒤 줄) — 금액이 여럿일 때 임시로 보일 값"""
        shown = {n for x in range(int(lo) - 5, int(hi) + 6) for n in cand.get(x, ())} | {no}
        best = None
        for j, (s0, e0, x) in enumerate(self.tr):
            if e0 >= lo and s0 <= hi:
                e, sh = R.spoken_amounts(x, self.unit, exclude=shown)
                for a in sorted(e | sh):
                    key = (abs(j - line), -j, 0 if a in e else 1)
                    if best is None or key < best[0]:
                        best = (key, a)
        return best[1] if best else None

    def _rule_pend(self, no, t, line, price, explicit, short, spoken, why):
        """LLM 금액 답 없이 올리는 임시 등록의 모음(판매자가 확정한다 — LLM이 그 번호를 적지 않아도 거두지 않는다)"""
        r = {"t": t, "line": line, "no": no, "price": price, "variety": None, "confidence": None}
        p = self._pend_new(no, r)
        p["rule"], p["rule_price"], p["keep"], p["spoken"] = True, price, why, spoken
        p["explicit"], p["short"] = set(explicit) | {price}, set(short)
        self.emit({"kind": "LLM규칙후보", "no": no, "price": price, "why": why, "line": line, "start_sec": t})

    def _rule_noprice(self, cand, mains):
        """LLM이 번호는 적었는데 가격을 거듭(서로 다른 호출 2번) 비웠다. 그 줄 앞뒤에서 판매자가 말한 금액이 하나뿐이면 그 값으로 임시 등록한다(272번)"""
        for no, g in list(self.noprice.items()):
            if no in self.sent or no in self.pend or no in self.tents or no in self.rule_dropped:
                del self.noprice[no]
                continue
            if len(g["calls"]) < 2 or not R.in_band(no, self._band()):
                continue
            explicit, short = self._amounts_between(g["t"] - 15, g["t"] + 30, cand, no)
            amounts = explicit | short
            del self.noprice[no]
            li = g["line"]
            if not amounts or len(amounts) > 3:
                self.emit({"kind": "LLM가격모름", "no": no, "line": li, "start_sec": g["t"], "said": sorted(amounts)})
                continue
            price = next(iter(amounts)) if len(amounts) == 1 else self._nearest_amount(li, g["t"] - 15, g["t"] + 30, cand, no)
            spoken = no in R.spoken_numbers(self.tr[j][2] for j in range(max(0, li - 1), min(len(self.tr), li + 2)))
            self._rule_pend(no, g["t"], li, price, explicit, short, spoken, "LLM이 가격을 비움" + ("" if len(amounts) == 1 else f"(말한 금액 {len(amounts)}가지)"))

    def _rule_tag(self, cand, mains):
        """판매자가 말하지 않은 번호표가 오래(TAG_RULE장) 크게 보였다. 그동안 말한 금액이 하나뿐이면 그 값으로 임시 등록한다(124번)"""
        if not TAG_RULE:
            return
        band = self._band()
        for g in self.segs[-3:]:
            no = g["img"]
            if no in self.tag_tried or no in self.sent or no in self.pend or no in self.tents or no in self.rule_dropped:
                continue
            if g["e"] - g["s"] + 1 < TAG_RULE or self.screen_top - g["e"] < EXPIRE:
                continue                                     # 아직 짧거나, 번호표가 치워진 것을 보기 전(그 상품 이야기가 끝난 뒤에 본다)
            self.tag_tried.add(no)
            frames = sum(1 for x in range(g["s"], g["e"] + 1) if mains.get(x) == no)
            if frames < TAG_RULE or not R.in_band(no, band):
                continue
            explicit, short = self._amounts_between(g["s"], g["e"], cand, no)
            amounts = explicit | short
            line = next((i for i, (s0, e0, _) in enumerate(self.tr) if e0 >= g["s"]), len(self.tr) - 1)
            if not amounts or len(amounts) > 3:
                self.emit({"kind": "LLM가격모름", "no": no, "start_sec": g["s"], "said": sorted(amounts), "frames": frames})
                continue
            price = next(iter(amounts)) if len(amounts) == 1 else self._nearest_amount(line, g["s"], g["e"], cand, no)
            self._rule_pend(no, max(g["s"], self.tr[line][0]) if self.tr else g["s"], line, price, explicit, short, False,
                            f"번호표만 {frames}장" + ("" if len(amounts) == 1 else f"(말한 금액 {len(amounts)}가지)"))

    def _check_numbers(self, cand, mains):
        """D-SCR-06: 보낸 번호가 화면에 안 보이고 다른 번호표만 오래 보이면 그 번호로 바꿔 달라고 서버에 묻는다"""
        now = self.screen_top
        for no, start in list(self.watch.items()):
            secs = range(int(start) - 5, int(now) + 1)
            if any(no in cand.get(x, ()) for x in secs) or now - start > FIX_MAX:
                del self.watch[no]                           # 화면에서 봤다(맞음) 또는 너무 오래됨
                continue
            if now - start < FIX_MIN:
                continue
            seen = collections.Counter(mains[x] for x in secs if mains.get(x) is not None and mains[x] != no)
            if not seen:
                continue
            tag, frames = seen.most_common(1)[0]
            if frames < FIX_FRAMES:
                continue
            # tag를 이미 보냈으면: 이 번호를 말한 뒤에 따로 등록한 것(같은 상품을 두 번호로 들음, 실방송 392 → 391)일 때만 이 번호를 지운다.
            # 앞서 등록한 상품의 번호표가 아직 보이는 것(다음 상품 번호를 먼저 말함)은 건드리지 않는다
            rid = self.sent.get(no, {}).get("rid")
            if rid is None:                                  # 이 일꾼이 보낸 등록이 아니면 바꾸지 않는다
                del self.watch[no]
                continue
            if KEEP_SPOKEN and self._said_with_price(no, start) >= KEEP_SPOKEN:
                del self.watch[no]                           # 판매자가 그 번호와 금액을 거듭 말했다 — 화면의 다른 번호표는 다음 상품이다(6번 → 17번, D-SCR-23)
                self.emit({"kind": "LLM번호그대로", "no": no, "screen_no": tag, "frames": frames, "start_sec": start})
                continue
            other = self.sent.get(tag)
            if other is None and tag in self.tents:
                # 화면의 그 번호는 이 일꾼이 임시로 올려 둔 상품이다(D-SCR-20) — 이미 등록한 번호처럼 다룬다: 그 번호로 옮기지 않고(서버도 거절한다),
                # 이 번호를 말한 뒤에 올린 것일 때만 이 번호를 지운다
                other = {"sent": True, "start_sec": self.tents[tag].get("t", -1)}
            drop = other is not None
            if drop and not (other.get("sent") and "fixed_from" not in other and other.get("start_sec", -1) >= start - 5):
                continue
            del self.watch[no]
            rec = {"kind": "LLM번호바로잡기", "from": no, "to": tag, "drop": drop, "frames": frames, "start_sec": start, "sent": bool(self.poster)}
            self.emit(rec)
            print(f"           번호 바로잡기 {no}번 → {tag}번{' (지움)' if drop else ''} (화면에 {no}번은 안 보이고 {tag}번이 {frames}장)", flush=True)
            if self.poster:
                self.poster.renumber(self.video_id, no, tag, rid, drop=drop)
            # 잘못 들은 번호는 보낸 것으로 남겨 같은 말을 다시 받아도 또 등록하지 않는다(화면에 그 번호가 보이면 new_scene으로만)
            if not drop:
                self.sent[tag] = dict(self.sent.get(no, {}), no=tag, fixed_from=no)
            self.sent[no] = dict(self.sent.get(no, {}), fixed_to=tag)

    def _said_with_price(self, no, start):
        """그 번호를 'N번'으로 말하면서 금액도 말한 줄 수(말한 줄 10초 앞 ~ 60초 뒤)"""
        n = 0
        for s0, _, x in self.tr:
            if start - 10 <= s0 <= start + 60 and no in R.numbers_with_beon(x):
                e, sh = R.spoken_amounts(x, self.unit, exclude={no})
                n += bool(e or sh)
        return n

    def finish(self):
        """방송 끝: 남은 줄을 한 번 더 묻고 답을 다 받은 뒤 남은 상품을 정리한다.
        안전 규칙: 모아 둔 상품 가운데 번호·가격이 정해진 것만 보내고 나머지는 확인요청으로 남긴다. 옛 로직: 가격이 있는데 아직 안 보낸 번호를 다 보낸다"""
        self.tick(final=True)
        while self.flying or self.want:
            time.sleep(1)
            self.tick(final=True)
        self.ex.shutdown(wait=True)
        if self.safe and self.waiting > 0:
            # 방금 보낸 임시 등록·확정·거두기의 서버 답을 잠깐 기다려 기록에 남긴다(다시 켠 일꾼이 이어받을 때 본다)
            deadline = time.time() + 15
            while self.waiting > 0 and time.time() < deadline:
                time.sleep(0.2)
                self._drain()
        if not self.safe:
            for g in self.products():
                if g["no"] not in self.sent:
                    self._send({"no": g["no"], "price": g["price"], "variety": g["variety"], "t": g["t"], "line": g["lines"][0],
                                "confidence": (g["confs"] or [None])[0]})
        self._write_csv()

    # ---------- 묶기·보내기 ----------
    def products(self):
        """끝난 방송 시험과 같은 묶기(같은 번호 하나, 가격·품종 = 가장 많이 나온 것) — 기록·비교용"""
        by = {}
        for f in sorted(self.found, key=lambda f: f["t"]):
            if f["no"] is None:
                continue
            g = by.setdefault(f["no"], {"no": f["no"], "t": f["t"], "last": f["t"], "prices": [], "names": [], "confs": [], "lines": [], "n": 0})
            g["n"] += 1
            g["last"] = max(g["last"], f["t"])
            g["lines"].append(f["line"])
            if f["price"]:
                g["prices"].append(f["price"])
            if f["variety"]:
                g["names"].append(f["variety"])
            if f.get("confidence"):
                g["confs"].append(f["confidence"])
        for g in by.values():
            g["price"] = collections.Counter(g["prices"]).most_common(1)[0][0] if g["prices"] else None
            g["variety"] = collections.Counter(g["names"]).most_common(1)[0][0] if g["names"] else None
        return sorted(by.values(), key=lambda g: g["t"])

    def _heard(self, lines):
        want = set(lines)
        return " ".join(dict.fromkeys(B.mask(x) for i, (_, _, x) in enumerate(self.tr) if i in want))

    def _send(self, r, picked=False, conf=None, note=None, tent=None):
        """r = LLM 줄 하나(번호·가격이 있는 답). 옛 로직: 품종이 비었으면 이미 받은 줄에서 그 번호의 품종을 찾는다.
        picked = 안전 규칙이 품종까지 정했다(빈 이름이면 빈 채로 보낸다), conf·note = 그때의 확신과 까닭.
        tent = 서버에 올라가 있는 그 상품의 임시 등록 — 등록을 새로 보내지 않고 확정을 보낸다(번호가 옮겨졌으면 to). 뒷일(고치기·번호 바로잡기 준비)은 같다"""
        no, price, name = r["no"], r["price"], r["variety"]
        fresh = not ((self.sent.get(no) or {}).get("sent") or (self.sent.get(no) or {}).get("prior"))
        if not name and not picked:
            name = next((f["variety"] for f in reversed(self.found) if f["no"] == no and abs(f["t"] - r["t"]) <= WINDOW and f["variety"]), None)
        if tent is not None and not name and tent.get("name"):
            name = tent["name"]                              # 확정은 빈 이름으로 덮지 않는다 — 임시로 보인 이름이 서버에 남는다(기록도 그 이름으로)
        if conf is None:
            conf = CONF.get(str(r.get("confidence")).lower(), 0.7)
        lines = [f["line"] for f in self.found if f["no"] == no and abs(f["t"] - r["t"]) <= WINDOW and not f.get("leftover")] or [r["line"]]
        now = time.time()
        line = r["line"]
        rec = {"kind": "LLM등록", "no": no, "start_sec": r["t"], "start_hms": B.hms(r["t"]), "price": price, "name": name, "conf": conf,
               "line": line, "line_end_sec": self.tr[line][1] if line is not None and line < len(self.tr) else None,
               "line_seen_wall": round(self.seen.get(line, now), 2), "sent_wall": round(now, 2), "wait_sec": round(now - self.seen.get(line, now), 1)}
        if note:
            rec.update(note)
        ni = self.name_info.get(no) if picked else None
        if ni and name:
            rec.update(name_unsure=ni.get("unsure", False), **{k: ni[k] for k in ("pattern", "form", "qty") if ni.get(k)})
        why = None
        if price is None:
            why = "금액 모름"
        elif self.poster:
            from . import post
            body = post.make_body(self.video_id, no, price, name or "", self._heard(lines), conf)
            if body is not None and tent is None:
                observed = int(self.seen.get(line, now) * 1000)
                while f"screen-{self.video_id}-{no}-{observed}" in self.tent_rids:
                    observed += 1                            # 그 요청 번호는 (올라가지 못했거나 거둔) 임시 등록이 썼다 — 서버가 "이미 받은 것"으로 넘기지 않게
                body.update(observedAt=observed, requestId=f"screen-{self.video_id}-{no}-{observed}")
                rec["rid"] = body["requestId"]
            if body is None:
                why = "보낼 수 없는 값"
                if tent is not None:
                    self._leave(tent, "확정할 값을 보낼 수 없음")
            elif tent is not None:
                # 임시 등록을 확정한다(계약서 2.2). rid는 그 임시 등록의 요청 번호 — 번호 바로잡기(D-SCR-06)도 이 번호로 "이 일꾼의 등록"임을 보인다
                rec.update(rid=tent["rid"], via="확정", tent_no=tent["no"], tent_price=tent["price"],
                           tent_sec=round(now - tent["sent_wall"], 1) if tent.get("sent_wall") else None)
                tent.update(to=no if no != tent["no"] else None, final_no=no, final_price=price, final_name=name or None, state="confirming")
                if self.tents.get(tent["no"]) is tent:
                    del self.tents[tent["no"]]
                self._post_confirm(tent)
            else:
                self.poster.send(body)
        rec["sent"] = bool(self.poster) and why is None
        if rec["sent"] and tent is None and fresh:
            self.latest = no
        if rec["sent"]:
            self.watch[no] = r["t"]
            sure = bool(name) and str(r.get("confidence")).lower() == "high"
            # 다시 보낸 등록(새 장면)은 서버에 이미 있는 번호면 무시된다(R-2) — 서버 금액을 아는 처음 값을 두고 금액 고치기 투표로 맞춘다
            self.prices.setdefault(no, {"now": price, "votes": [], "fixes": 0})
            # LLM과 사전이 같았거나 사전 이름이 여러 번 나온 이름은 굳힌다 — 뒤 답으로 바꾸지 않는다(재현: 맞던 이름 7개가 틀리게 바뀜)
            locked = NAME_MAX_FIX if note and note.get("name_locked") else 0
            self.names[no] = {"t": r["t"], "now": name, "sure": sure, "votes": collections.Counter(), "last": {}, "shown": {}, "fixes": locked}
        if why is None:
            self.order.append(no)
            self.sent_prices.append(price)
        if why:
            rec["skip"] = why
        self.sent[no] = rec
        self.emit(rec)
        won = f"{price:,}원" if price else "금액 모름"
        print(f"           LLM등록 {no:>4}번  {won}  {name or '품종 모름'}  (줄을 읽고 {rec['wait_sec']}초)"
              + ("  → 서버로" if rec["sent"] else (f"  (보내지 않음: {why})" if why else "")), flush=True)

    def _write_csv(self):
        with open(os.path.join(self.out, "llm_상품.csv"), "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["번호", "처음 시각", "보낸 가격(첫 답)", "보낸 상품명", "다수결 가격", "다수결 상품명", "LLM이 적은 줄 수", "서버로 보냄", "안 보낸 까닭", "줄 읽고 보내기까지(초)"])
            for g in self.products():
                r = self.sent.get(g["no"], {})
                w.writerow([g["no"], B.hms(g["t"]), r.get("price"), r.get("name"), g["price"], g["variety"], g["n"],
                            "O" if r.get("sent") else "", r.get("skip", ""), r.get("wait_sec", "")])
        print(f"           LLM등록 끝: 물은 횟수 {self.calls}", flush=True)
