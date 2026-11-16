# 틱톡 라이브 읽기 (D-SCR-TT-01): 서버가 지금 볼 라이브로 `@틱톡아이디`를 주면 일꾼이 그 라이브의 화면·소리를 받는다.
# yt-dlp(2026.10.26)의 틱톡 라이브 읽기는 흉내 내기 꾸러미(curl_cffi) 없이 "지금 라이브 아님"으로 잘못 답해서(2026-11-16 실제 라이브 중 확인),
# 틱톡 웹이 쓰는 공개 방 정보(api-live/user/room)를 읽어 HLS 주소를 바로 고른다. 읽기만 한다 — 틱톡에 아무것도 쓰지 않는다.
import json
import re
import urllib.parse
import urllib.request

ID_RE = re.compile(r"^[a-z0-9._]{2,24}$")                                  # 서버 tiktok/target.ts와 같은 아이디 모양
URL_RE = re.compile(r"^https?://(?:www\.|m\.)?tiktok\.com/@([A-Za-z0-9._]{2,24})/live/?(?:\?.*)?$")
ROOM_API = "https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId="
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
LIVE = 2                                                                   # 방 상태 2 = 방송 중
QUALITY = ("hd", "sd", "origin", "uhd", "ld")                              # 720p 안팎을 먼저(유튜브 쪽 height<=720과 같은 뜻), 없으면 있는 것


class NotLive(Exception):
    """라이브가 아니거나 방 정보를 읽지 못함 — 일꾼은 '아직 시작 전이거나 끝난 방송'으로 끝내고 관리자가 다시 띄운다"""


def url_of(key):
    """`@아이디` → 틱톡 라이브 주소"""
    return f"https://www.tiktok.com/{key}/live"


def key_of(src):
    """틱톡 라이브 주소 또는 `@아이디` → `@아이디`(소문자). 아니면 None"""
    if not src:
        return None
    if src.startswith("@") and ID_RE.match(src[1:].lower()):
        return src.lower()
    m = URL_RE.match(src)
    return "@" + m.group(1).lower() if m and ID_RE.match(m.group(1).lower()) else None


def pick(room):
    """방 정보(JSON) → 화면+소리 합본 스트림 주소. 라이브가 아니면 NotLive"""
    data = (room or {}).get("data") or {}
    status = ((data.get("user") or {}).get("status"), (data.get("liveRoom") or {}).get("status"))
    if LIVE not in status:
        raise NotLive(f"틱톡 라이브가 아니에요(상태 {status})")
    pull = ((data.get("liveRoom") or {}).get("streamData") or {}).get("pull_data") or {}
    try:
        streams = json.loads(pull.get("stream_data") or "{}").get("data") or {}
    except ValueError:
        streams = {}
    order = [q for q in QUALITY if q in streams] + [q for q in streams if q not in QUALITY and q != "ao"]   # ao = 소리만
    for q in order:
        main = (streams.get(q) or {}).get("main") or {}
        for kind in ("hls", "flv"):
            if str(main.get(kind) or "").startswith("https://"):
                return main[kind]
    raise NotLive("틱톡 라이브 스트림 주소가 없어요")


def resolve(key, timeout=20, opener=None):
    """`@아이디` → [스트림 주소]. 라이브가 아니거나 읽지 못하면 NotLive"""
    uid = key[1:]
    req = urllib.request.Request(ROOM_API + urllib.parse.quote(uid), headers={"User-Agent": UA, "Referer": "https://www.tiktok.com/"})
    try:
        with (opener or urllib.request.urlopen)(req, timeout=timeout) as r:
            room = json.loads(r.read().decode("utf-8"))
    except (OSError, ValueError) as e:
        raise NotLive(f"틱톡 방 정보를 읽지 못했어요({type(e).__name__})") from e
    return [pick(room)]
