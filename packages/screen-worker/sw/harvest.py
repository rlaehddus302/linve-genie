# 품종 이름 거두기: 다육 라이브 채팅의 관리자·주인·도우미 글과 방송 제목 해시태그에서 품종으로 보이는 이름을 모은다.
#  - "<셀레네> 1만5천원 319번", "[팔색조색금] 찜 감사합니다", "151번 허니핑크 3000원", "#컬러풀색금"
# 결과: data/varieties_harvest.json = {이름: {"n": 나온 횟수, "src": [방송 id …]}} — 시험할 때 그 방송에서 거둔 이름은 뺄 수 있게 출처를 남긴다
# 사용: python -m sw.harvest <채팅 파일들…> [--titles 목록.txt]
import argparse
import collections
import json
import os
import re

STOP = set("""다육 다육이 다육식물 다육화분 라이브 판매 판매방송 라방 방송 실방 감사 감사합니다 찜 찜주셨어요 문자 입금 택배 배송 주문 이벤트 특가 마감 오늘
분포 철화분포 식물만 한판 셋트 세트 각 개 원 만원 천원 입니다 이에요 사장님 언니 오빠 여러분 화분 종자 수입 수입종 국내 실생 모주 군생 대품 소품 중품 대형 소형
취미 힐링 식물 흙 반려식물 인테리어 가드닝 정원 농원 농장 하우스 금다육 색금 창금 녹금 금 철화 산반 복륜 복륜금 선물 덤 나눔 공구 경매 재고 품절 완판""".split())
_KO = re.compile(r"[가-힣]{2,12}")


def clean(s):
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"(입니다|이에요|에요|이고요|이구요|이요)$", "", s)
    return s


def from_text(t):
    out = []
    for m in re.finditer(r"[<\[【]\s*([^>\]】]{2,20}?)\s*[>\]】]", t):
        out.append(m.group(1))
    m = re.search(r"\d{1,3}\s*번\s*([가-힣][가-힣 ]{1,15}?)\s*\d", t)
    if m:
        out.append(m.group(1))
    m = re.search(r"^\s*([가-힣][가-힣 ]{1,15}?)\s*\d[\d,.]*\s*(만|천|원)", t)
    if m:
        out.append(m.group(1))
    for m in re.finditer(r"#([가-힣A-Za-z]{2,15})", t):
        out.append(m.group(1))
    return [c for c in (clean(x) for x in out) if _KO.fullmatch(c) and c not in STOP and not re.search(r"(님|번|원|개)$", c)]


def chat_lines(path):
    """관리자·주인 글과 '찜 감사' 같은 도우미 글만"""
    for line in open(path, encoding="utf-8"):
        r = json.loads(line).get("replayChatItemAction", {})
        for a in r.get("actions", []):
            it = a.get("addChatItemAction", {}).get("item", {}).get("liveChatTextMessageRenderer")
            if not it:
                continue
            txt = "".join(x.get("text", "") for x in it["message"]["runs"])
            badge = " ".join(b["liveChatAuthorBadgeRenderer"].get("tooltip", "") for b in it.get("authorBadges", []))
            if re.search("Moderator|Owner", badge) or re.search(r"찜\s*감사|찜\s*주셨", txt):
                yield txt


def main():
    ap = argparse.ArgumentParser(prog="python -m sw.harvest")
    ap.add_argument("chats", nargs="+")
    ap.add_argument("--titles")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data", "varieties_harvest.json"))
    a = ap.parse_args()
    found = collections.defaultdict(lambda: {"n": 0, "src": set()})
    for p in a.chats:
        vid = os.path.basename(p).split(".")[0]
        for t in chat_lines(p):
            for c in from_text(t):
                found[c]["n"] += 1
                found[c]["src"].add(vid)
    if a.titles:
        for line in open(a.titles, encoding="utf-8"):
            parts = line.rstrip("\n").split("|")
            if len(parts) >= 3:
                for c in from_text(parts[2]):
                    found[c]["n"] += 1
                    found[c]["src"].add(parts[1])
    out = {k: {"n": v["n"], "src": sorted(v["src"])} for k, v in sorted(found.items(), key=lambda kv: -kv[1]["n"])}
    json.dump(out, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"거둔 이름 {len(out)}개 → {a.out}")
    print("많이 나온 것:", list(out)[:40])


if __name__ == "__main__":
    main()
