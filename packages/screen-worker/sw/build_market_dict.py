# 넓은 시장 품종 사전(data/varieties_market.json, D-RECOG-43) 만들기.
#   python -m sw.build_market_dict <varieties_market_wide_clean.json>
# 입력은 유튜브 다육 라이브 판매 채널들의 관리자 채팅(번호·품종·가격 글)에서 거둔 품종 이름 정리본(사용자 맥북에서 만든 것, 저장소 밖).
# 저장소에는 이름·횟수·붙어 팔린 꼴·철자 변형만 넣는다 — 채팅 글·채널·예시 줄은 손님 닉네임이 섞일 수 있어 넣지 않는다.
import json
import os
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "varieties_market.json")


def written(name, suffixes):
    out = []
    for s in suffixes:
        full = (s.split("+")[0] + name + s.split("+")[-1]) if "+" in s else name + s
        if full != name and full not in out:
            out.append(full)
    return out


def build(src):
    d = json.load(open(src, encoding="utf-8"))
    rows = []
    for r in d["names"]:
        row = {"name": r["name"], "count": r["count"]}
        w = written(r["name"], r.get("suffixes") or {})
        if w:
            row["written"] = w
        if r.get("variant_of"):
            row["of"] = r["variant_of"]
        rows.append(row)
    note = ("넓은 시장 품종 사전(D-RECOG-43). 유튜브 다육 라이브 판매 채널들의 관리자 채팅 상품 글에서 두 번 넘게 나온 품종 이름. "
            "count = 나온 횟수, written = 무늬 말·앞말이 붙어 팔린 꼴, of = 더 흔한 이름의 철자 변형(별칭). sw/build_market_dict.py가 만든다 — 손으로 고치지 않는다.")
    return {"note": note, "built": d.get("built"), "names": rows}


if __name__ == "__main__":
    out = build(sys.argv[1])
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(len(out["names"]), "names →", OUT)
