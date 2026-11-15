# 품종 사전 정리(D-SCR-38): 품종과 옵션을 따로 본다(사용자 2026-11-15 "품종과 거기에 붙는 옵션은 별개로 봐야 한다").
#   기본 사전(varieties.ko.json)·지난 방송에서 거둔 이름(varieties_harvest.json)·판매자가 고친 이름(varieties_seller.json)은
#   "몰디브색금", "SP색금", "수입색금", "아리엘_분채", "블루엘프특가"처럼 옵션·파는 꼴·행사 말이 붙은 이름이 섞여 있다.
#   이름마다 품종 / 옵션 / 형태 / 갈래(SP·수입·실생·창)로 떼어 품종별로 모은 것이 data/varieties_clean.json이다.
#   품종이 남지 않는 이름("SP색금", "녹금무지")과 품종이 아닌 말은 품종 목록에 넣지 않고 "removed"에 까닭과 함께 적는다.
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

# 옵션(무늬·종류) — 이름 끝에 붙는다. 긴 것부터 뗀다
OPTIONS = ("복륜금", "녹색금", "창녹금", "창색금", "수박금", "변이금", "창금", "색금", "녹금", "백금", "찐녹", "철화", "산반", "복륜", "수박", "힘줄", "핏줄",
           "종자", "무지", "변이종", "변이", "금")
FORMS = ("군생", "자구", "분채", "대품", "중품", "소품", "통째", "통채", "쌍두", "외두", "커팅")     # 형태·파는 꼴
KIND_TAIL = ("교배종", "특이종", "실생", "SP")                                                       # 갈래를 이르는 말(끝)
KIND_HEAD = ("SP", "수입", "실생")                                                                   # 갈래를 이르는 말(앞). SP = 품종 없음 표시
EVENT = ("꿀이벵", "이벵", "특가", "툭가")                                                           # 행사·값을 이르는 말
# 옵션만으로 된 말(품종이 아니다)
OPTION_ONLY = set(OPTIONS) | set(FORMS) | set(KIND_TAIL) | set(KIND_HEAD) | {"창", "녹색", "창녹", "창색", "환엽", "골드"}
# 품종이 아닌 말(영수증·쇼핑몰 이름에서 눈으로 고른 것). 거둔 이름의 품종 아닌 말은 varieties_harvest.json에서 지웠다
#   "보스"는 영수증의 "보스실생"(그 가게가 씨로 키운 것)에서 실생을 떼면 남는 가게 이름이다 — 품종으로 두면 판매자를 부른 말이 품종이 된다(11-13 방송 4번)
NOT_VARIETY = {"선인장", "다육", "다육이", "다육식물", "화분", "세트", "랜덤", "모음", "보스"}
SOURCE = {"hand": "손으로 만든 기본 사전", "receipt": "지난 판매 영수증", "xplant": "쇼핑몰 엑스플랜트", "simpol": "쇼핑몰 심폴",
          "harvest": "지난 방송 채팅·제목에서 거둠", "seller": "판매자가 고쳐 적음"}


def split(name):
    """사전에 적힌 이름 → (품종, [옵션…], [형태…], [갈래…]). 품종이 남지 않으면 품종은 ""
    "몰디브색금무지" → (몰디브, [색금, 무지]), "SP창녹금" → ("", [창녹금], [], [SP]), "아리엘 분채" → (아리엘, [], [분채]), "블루엘프특가" → (블루엘프)"""
    s = V.norm(V._SAEK_LIVE.sub("색금", name or ""))
    options, forms, kinds = [], [], []
    for head in KIND_HEAD:
        if s.upper().startswith(head) and len(s) > len(head):
            kinds.append(head)
            s = s[len(head):]
            break
    changed = True
    while changed and s:
        changed = False
        for words, bucket in ((EVENT, None), (FORMS, forms), (KIND_TAIL, kinds), (OPTIONS, options)):
            for w in words:
                # 품종이 한 글자만 남게는 떼지 않는다("황금" → 황 + 금 아님). 남는 것이 없으면 옵션뿐인 말이다
                if s.upper().endswith(w) and (len(s) - len(w) >= 2 or len(s) == len(w) or s[:-len(w)] in OPTION_ONLY):
                    if bucket is not None:
                        bucket.insert(0, w)
                    s = s[:-len(w)]
                    changed = True
                    break
            if changed:
                break
    if s.upper() in OPTION_ONLY or s in OPTION_ONLY:
        if s.upper() in KIND_HEAD:
            kinds.insert(0, s.upper())
        elif s:
            options.insert(0, s)
        s = ""
    return s, options, forms, kinds


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
    """→ (품종 목록, 뺀 이름 목록). 품종 = {name, aliases, options, forms, kinds, sources, written}"""
    found = collections.OrderedDict()
    removed = []
    for name, src, aliases in entries():
        base, options, forms, kinds = split(name)
        if "님" in name:
            continue                                                      # 손님을 부른 말(○○님)은 어디에도 적지 않는다
        if not base:
            why = "품종 없이 옵션·갈래뿐" if options or forms or kinds else "품종이 아닌 말"
            removed.append({"name": name, "source": SOURCE[src], "why": why, "options": options, "forms": forms, "kinds": kinds})
            continue
        if base in NOT_VARIETY or V.not_a_name(base) or re.fullmatch(r"\d+", base):
            removed.append({"name": name, "source": SOURCE[src], "why": "품종이 아닌 말", "options": options, "forms": forms, "kinds": kinds})
            continue
        v = found.setdefault(base, {"name": base, "aliases": [], "options": [], "forms": [], "kinds": [], "sources": [], "written": []})
        if V.norm(name) == base and " " in name.strip() and " " not in v["name"]:
            v["name"] = " ".join(name.split())                            # 띄어 적은 이름("환엽 지젤", "녹금의 제왕")은 띄어 적은 대로 보인다
        for key, values in (("options", ["".join(options)] if options else []), ("forms", forms), ("kinds", kinds), ("sources", [SOURCE[src]]),
                            ("written", [name] if V.norm(name) != base else [])):
            for x in values:
                if x and x not in v[key]:
                    v[key].append(x)
        for a in aliases:
            heard = split(a)[0]
            if len(heard) >= 2 and heard != base and heard not in v["aliases"]:
                v["aliases"].append(heard)
    # "창맥라이징"·"창간츠": 앞의 "창"이 옵션이고 뒤가 이미 있는 품종이면 그 품종에 붙인다
    for base in [b for b in found if b.startswith("창") and len(b) >= 3 and b[1:] in found]:
        v, to = found.pop(base), found[base[1:]]
        for key in ("aliases", "options", "forms", "sources"):
            for x in v[key]:
                if x not in to[key]:
                    to[key].append(x)
        for x in ["창"] + v["kinds"]:
            if x not in to["kinds"]:
                to["kinds"].append(x)
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
            "options = 그 품종에 붙어 적혀 있던 옵션, kinds = SP·수입·실생·창 같은 갈래, written = 사전에 적혀 있던 그대로의 이름.")
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"note": note, "varieties": varieties, "removed": removed}, f, ensure_ascii=False, indent=0)
        f.write("\n")
    print(f"품종 {len(varieties)}개 · 뺀 이름 {len(removed)}개 → {os.path.relpath(a.out)}")
    if a.csv:
        with open(os.path.join(a.csv, "2026-11-15-clean-varieties.csv"), "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["품종", "붙어 적혀 있던 옵션", "형태·파는 꼴", "갈래", "틀리게 들리는 모양(별칭)", "출처", "사전에 적혀 있던 그대로"])
            for v in sorted(varieties, key=lambda v: V.norm(v["name"])):
                w.writerow([v["name"]] + [" · ".join(v[k]) for k in ("options", "forms", "kinds", "aliases", "sources", "written")])
        with open(os.path.join(a.csv, "2026-11-15-clean-removed.csv"), "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["사전에 적혀 있던 이름", "뺀 까닭", "옵션", "형태·파는 꼴", "갈래", "출처"])
            for r in sorted(removed, key=lambda r: (r["why"], r["name"])):
                w.writerow([r["name"], r["why"], " · ".join(r["options"]), " · ".join(r["forms"]), " · ".join(r["kinds"]), r["source"]])


if __name__ == "__main__":
    main()
