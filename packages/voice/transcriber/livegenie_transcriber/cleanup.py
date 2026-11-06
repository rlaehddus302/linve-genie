# 받아쓰기 헛소리 거르기 (D-V3-126, 실방송 2026-11-06 사용자 "갑자기 다다다다 거리고 저 일본어는 뭔데?"):
# 위스퍼는 음악·잡음을 "다-다-다-…"처럼 같은 말을 끝없이 되풀이하거나 일본어("うわ!")로 적는다. 판매 말이 아니므로 보내기 전에 뺀다.
# ① 짧은 덩이(1~6글자)가 붙임표·쉼표·공백을 끼고 4번 넘게 잇따르면 그 줄 전체, 긴 문장(7~40글자)이 3번 넘게 잇따르면 그 부분(D-V3-130) ② 일본 글자(히라가나·가타카나)·한자는 지운다.
# 지우고 남은 것이 글자·숫자 없는 문장부호뿐이면 빈 글(보내지 않음). 순수 함수.
from __future__ import annotations

import re

# 같은 덩이 되풀이: 덩이 + (구분자 + 같은 덩이) 4번 이상 = 5번 이상 잇따름
_REPEAT = re.compile(r"(\S{1,6}?)(?:[\s\-,.~·]*\1){4,}[\s\-,.~·]*")
# 같은 문장 되풀이 (D-V3-130): 힌트를 준 위스퍼가 소리 없는 조각에 "삼백육번 십이만 원. 삼백육번 십이만 원. …"을 수백 번 적는다 — 7~40글자 문장이 3번 넘게 잇따르면 그 부분
_REPEAT_LONG = re.compile(r"(\S[^.,\n]{5,38}?)(?:[\s\-,.~·]+\1){2,}[\s\-,.~·]*")
# 일본 글자·한자 (한글·영문·숫자는 그대로)
_FOREIGN = re.compile(r"[぀-ヿㇰ-ㇿ㐀-䶿一-鿿ｦ-ﾟ]+")
_MEANINGFUL = re.compile(r"[0-9A-Za-z가-힣ㄱ-ㆎ]")


def clean_text(text: str) -> str:
    if not isinstance(text, str):
        return ""
    out = _REPEAT_LONG.sub(" ", text)
    out = _REPEAT.sub(" ", out)
    out = _FOREIGN.sub(" ", out)
    out = re.sub(r"\s+", " ", out).strip()
    return out if _MEANINGFUL.search(out) else ""
