# 품종 사전 정리(D-SCR-38): 품종과 옵션을 따로 본다(사용자 2026-11-15 "품종과 거기에 붙는 옵션은 별개로 봐야 한다").
#   기본 사전(varieties.ko.json)·지난 방송에서 거둔 이름(varieties_harvest.json)·판매자가 고친 이름(varieties_seller.json)은
#   "몰디브색금", "SP색금", "수입색금", "아리엘_분채", "블루엘프특가"처럼 옵션·행사 말이 붙은 이름이 섞여 있다.
#   이름마다 품종과 옵션으로 떼어 품종별로 모은 것이 data/varieties_clean.json이다.
#   떼는 규칙과 옵션 목록은 방송 중 이름을 읽을 때와 같은 것 하나다(variety.parts, D-DICT-OPT-01) — 무늬·형태·갈래를 나누지 않고 모두 옵션이다.
#   SP·종자는 옵션이 아니라 품종이다(D-DICT-SP-02, 사용자 2026-11-17 "sp(종자 모름), 종자(고급 SP)는 옵션이 아니라 품종에 넣어라"):
#   "SP색금"·"색금종자"는 품종 SP·종자에 옵션 색금이 붙은 이름이다. 행사 말(이벵·특가)은 옵션이 아니어서 지운다.
#   품종이 남지 않는 이름("녹금무지")과 품종이 아닌 말은 품종 목록에 넣지 않고 "removed"에 까닭과 함께 적는다.
# 사용: python -m sw.clean_dict            → data/varieties_clean.json을 다시 만든다
#       python -m sw.clean_dict --csv 폴더  → 사람이 볼 CSV 두 개(정리한 품종 / 뺀 이름)도 쓴다
import argparse
import collections
import csv
import json
import os
import re

from . import variety as V

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")

# 품종 이름을 모르는 것을 부르는 품종(D-DICT-SP-02)과 그 뜻. 둘 다 있으면 종자("SP 종자")
UNNAMED = {"종자": "고급 SP", "SP": "종자를 모르는 것"}
# 품종이 아닌 말(영수증·쇼핑몰 이름에서 눈으로 고른 것). 거둔 이름의 품종 아닌 말은 varieties_harvest.json에서 지웠다
#   "보스"는 영수증의 "보스실생"(그 가게가 씨로 키운 것)에서 실생을 떼면 남는 가게 이름이다 — 품종으로 두면 판매자를 부른 말이 품종이 된다(11-13 방송 4번)
NOT_VARIETY = {"선인장", "다육", "다육이", "다육식물", "화분", "세트", "랜덤", "모음", "보스"}
SOURCE = {"hand": "손으로 만든 기본 사전", "receipt": "지난 판매 영수증", "xplant": "쇼핑몰 엑스플랜트", "simpol": "쇼핑몰 심폴",
          "harvest": "지난 방송 채팅·제목에서 거둠", "seller": "판매자가 고쳐 적음"}


def split(name):
    """사전에 적힌 이름 → (품종, [옵션…]). 품종이 남지 않으면 품종은 "". 방송 중과 같은 규칙(variety.parts)
    "몰디브색금무지" → (몰디브, [색금, 무지]), "SP창녹금" → (SP, [창, 녹금]), "색금종자" → (종자, [색금]), "아리엘 분채" → (아리엘, [분채]),
    "블루엘프특가" → (블루엘프, []), "수입몰디브" → (몰디브, [수입]), "SP아리아골드" → (SP아리아골드, [])"""
    base, heads, opts, _ = V.parts(name, heard=False)
    un = [u for u in UNNAMED if u in opts]
    if not base and un:
        base = un[0]
    return base, heads + [o for o in opts if o not in UNNAMED]


def entries():
    """세 파일의 이름을 (적힌 이름, 출처, 별칭들)로"""
    with open(os.path.join(DATA, "varieties.ko.json"), encoding="utf-8") as f:
        for v in json.load(f)["varieties"]:
            yield v["name"], (v.get("source") or ("receipt" if v.get("receipt") else "hand")), v.get("aliases") or []
    with open(os.path.join(DATA, "varieties_harvest.json"), encoding="utf-8") as f:
        for name in json.load(f):
            yield name, "harvest", []
    with open(os.path.join(DATA, "varieties_seller.json"), encoding="utf-8") as f:
        for v in json.load(f)["names"]:
            yield v["name"], "seller", v.get("aliases") or []


def build():
    """→ (품종 목록, 뺀 이름 목록). 품종 = {name, aliases, options, sources, written} (+ SP·종자는 unnamed = 그 말의 뜻)"""
    found = collections.OrderedDict()
    removed = []
    for name, src, aliases in entries():
        base, options = split(name)
        if "님" in name:
            continue                                                      # 손님을 부른 말(○○님)은 어디에도 적지 않는다
        if not base:
            why = "품종 없이 옵션뿐" if options else "품종이 아닌 말"
            removed.append({"name": name, "source": SOURCE[src], "why": why, "options": options})
            continue
        bare = base[2:] if base.upper().startswith("SP") else base           # "SP선인장"도 품종이 아닌 말
        if base not in UNNAMED and (bare in NOT_VARIETY or V.not_a_name(base) or re.fullmatch(r"\d+", base)):
            removed.append({"name": name, "source": SOURCE[src], "why": "품종이 아닌 말", "options": options})
            continue
        v = found.setdefault(base, {"name": base, "aliases": [], "options": [], "sources": [], "written": []})
        if base in UNNAMED:
            v["unnamed"] = UNNAMED[base]
        if V.norm(name) == base and " " in name.strip() and " " not in v["name"]:
            v["name"] = " ".join(name.split())                            # 띄어 적은 이름("환엽 지젤", "녹금의 제왕")은 띄어 적은 대로 보인다
        # 함께 팔린 옵션 묶음은 보내는 이름처럼 띄어 적는다("창 녹금")
        for key, values in (("options", [" ".join(options)] if options else []), ("sources", [SOURCE[src]]),
                            ("written", [name] if V.norm(name) != base else [])):
            for x in values:
                if x and x not in v[key]:
                    v[key].append(x)
        for a in () if base in UNNAMED else aliases:                         # "에스피녹음" 같은 모양은 품종 SP의 다른 이름이 아니다
            heard = split(a)[0]
            if len(heard) >= 2 and heard != base and heard not in v["aliases"]:
                v["aliases"].append(heard)
    # "창맥라이징"·"창간츠": 앞의 "창"이 옵션이고 뒤가 이미 있는 품종이면 그 품종에 붙인다
    for base in [b for b in found if b.startswith("창") and len(b) >= 3 and b[1:] in found]:
        v, to = found.pop(base), found[base[1:]]
        for key in ("aliases", "options", "sources"):
            for x in v[key]:
                if x not in to[key]:
                    to[key].append(x)
        for x in ["창"] + v["options"]:                                     # "창맥라이징" → 맥라이징 + 옵션 창(창과 무늬는 따로, D-DICT-OPT-04)
            if x not in to["options"]:
                to["options"].append(x)
        for x in v["written"] + [base]:
            if x not in to["written"]:
                to["written"].append(x)
    for v in found.values():                                              # 다른 품종의 이름과 같은 별칭은 뺀다
        v["aliases"] = [a for a in v["aliases"] if a not in found]
    return list(found.values()), removed


def main():
    ap = argparse.ArgumentParser(prog="python -m sw.clean_dict")
    ap.add_argument("--out", default=os.path.join(DATA, "varieties_clean.json"))
    ap.add_argument("--csv")
    a = ap.parse_args()
    varieties, removed = build()
    note = ("품종과 옵션을 따로 본 품종 사전(D-SCR-38). sw/clean_dict.py가 varieties.ko.json·varieties_harvest.json·varieties_seller.json에서 만든다 — 손으로 고치지 않는다. "
            "options = 그 품종에 붙어 적혀 있던 옵션, written = 사전에 적혀 있던 그대로의 이름, "
            "unnamed = 품종 이름을 모르는 것을 부르는 품종(SP·종자)의 뜻.")
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"note": note, "varieties": varieties, "removed": removed}, f, ensure_ascii=False, indent=0)
        f.write("\n")
    print(f"품종 {len(varieties)}개 · 뺀 이름 {len(removed)}개 → {os.path.relpath(a.out)}")
    if a.csv:
        with open(os.path.join(a.csv, "2026-11-15-clean-varieties.csv"), "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["품종", "붙어 적혀 있던 옵션", "틀리게 들리는 모양(별칭)", "출처", "사전에 적혀 있던 그대로"])
            for v in sorted(varieties, key=lambda v: V.norm(v["name"])):
                w.writerow([v["name"]] + [" · ".join(v[k]) for k in ("options", "aliases", "sources", "written")])
        with open(os.path.join(a.csv, "2026-11-15-clean-removed.csv"), "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["사전에 적혀 있던 이름", "뺀 까닭", "옵션", "출처"])
            for r in sorted(removed, key=lambda r: (r["why"], r["name"])):
                w.writerow([r["name"], r["why"], " · ".join(r["options"]), r["source"]])


if __name__ == "__main__":
    main()
