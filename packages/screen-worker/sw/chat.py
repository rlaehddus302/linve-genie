# 손님 채팅에서 번호 뽑기: 손님이 찜하려고 친 번호("198", "198번")는 받아쓰기 실수가 없는 세 번째 근거다.
# 관리자·채널 주인 글은 쓰지 않는다(라이브지니가 대신하려는 역할이고, 회귀 시험의 정답지이기도 함).
import bisect
import json
import re

_NUM = re.compile(r"^\s*(\d{1,3})\s*번?\s*$")
# 이벤트 "댓글 달리기"(ㅣ ㄴ ㆍ 6 8 …을 마구 침) 중 손님 숫자는 찜이 아니다: 앞뒤 20초에 자모·기호 한두 글자 댓글이 8개 이상이면 버린다
_RACE = re.compile(r"^[ㄱ-ㅣㆍ.·,~!?ㅡ\-]{1,2}$")
RACE_WIN, RACE_MIN = 20, 8


def _numbers(msgs):
    """손님 댓글 [(초, 글)] → 댓글 달리기 구간을 뺀 [(초, 번호)]"""
    race = sorted(t for t, x in msgs if _RACE.match(x.strip()))
    out = []
    for t, x in msgs:
        m = _NUM.match(x)
        if not m or not 0 < int(m.group(1)) < 1000:
            continue
        if bisect.bisect_right(race, t + RACE_WIN) - bisect.bisect_left(race, t - RACE_WIN) >= RACE_MIN:
            continue
        out.append((t, int(m.group(1))))
    return sorted(out)


def buyer_numbers(path):
    """유튜브 채팅 다시보기(yt-dlp live_chat.json) → [(방송 초, 번호)]"""
    out = []
    for line in open(path, encoding="utf-8"):
        r = json.loads(line).get("replayChatItemAction", {})
        t = int(r.get("videoOffsetTimeMsec", 0)) / 1000
        for a in r.get("actions", []):
            it = a.get("addChatItemAction", {}).get("item", {}).get("liveChatTextMessageRenderer")
            if not it:
                continue
            badge = " ".join(b["liveChatAuthorBadgeRenderer"].get("tooltip", "") for b in it.get("authorBadges", []))
            if re.search("Moderator|Owner|운영자|소유자", badge):
                continue
            out.append((t, "".join(x.get("text", "") for x in it["message"]["runs"])))
    return _numbers(out)


def buyer_numbers_csv(path):
    """수집해 둔 댓글 CSV(시각(KST), 방송경과, 닉네임, 배지, 종류, 내용) → [(방송 초, 번호)]"""
    import csv

    out = []
    for r in csv.DictReader(open(path, encoding="utf-8-sig")):
        if re.search("Moderator|Owner", r.get("배지") or ""):
            continue
        h, mi, s = (int(x) for x in r["방송경과"].split(":"))
        out.append((h * 3600 + mi * 60 + s, r.get("내용") or ""))
    return _numbers(out)
