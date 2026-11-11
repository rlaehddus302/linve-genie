# 데이터 위치: 환경변수 LG_DATA가 있으면 그곳, 없으면 ~/lg/data. 영상·채팅·시험 데이터는 개인정보가 섞이고 커서 저장소에 넣지 않는다(D-SCR-03).
# 팀원은 공유받은 데이터 묶음을 풀고 LG_DATA=<풀어 둔 data 폴더> 로 지정하면 같은 시험을 그대로 돌릴 수 있다.
import os

DATA = os.path.abspath(os.path.expanduser(os.environ.get("LG_DATA") or "~/lg/data"))
REGRESS = os.path.join(DATA, "regress")                       # 정답 방송 5개(화면 읽기·팀원 방식 STT·관리자 정답) + 보스다육 정답
PKG = os.path.join(DATA, "image_for_stt_test")                # 정답 방송 3개의 관리자 글(번호·가격·품종)
STT_AUDIO = os.path.join(DATA, "STT테스트용_공유")              # 정답 방송 5개 소리
FIRST = os.path.join(DATA, "first_sellers")                   # 첫 판매자 방송(영상·결과)
OCR_SHEET = os.path.join(DATA, "ocr_test_690")                # OCR 시험지 690장
