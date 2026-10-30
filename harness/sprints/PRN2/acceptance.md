# PRN2 수용 기준 — 프린터 지원 단계

- 근거: D-PRN2-01~08(AUTO), LABEL_RULES v0.3.0 L-1·L-7·L-11 10·13·17·L-12, SPEC PRT-01·PRT-02 세부(PRN2), 골든 `tests/golden/printer/{profile,job,end,list}.json`(G-PRT-N1-28~30·34 갱신, G-PRT-PRN2-01·02·21~44·51~64 + 프로필 사례).
- 범위: 기본 B1(확인됨), NIIMBOT B1 SE·B21·D110·Marklife 9종·바우아토는 실험, 그 밖은 그림 파일로만. 앱·웹 같은 프로필 표·단계·고르기 목록. 바우아토 Luck Jingle 바이트·`OK` 끝 알림. 출력 기기 프로필·크기 목록. 서버 PNG 입구.
- 바뀌지 않는 것: B1 바이트·판정·정산·Marklife 작업 바이트(골든 N1 그대로). 실물 확인(HG-5)은 하지 않는다 — 실험 표시로 둔다.
- 영역: devs [device, server, web], tests [domain, e2e]. 순서 device → server → web.

## 수용 기준

- AC-PRN2-01 (device) 프로필 표가 L-7·L-12 표와 같다: 단계(`experimental`) B1만 false, 나머지 켠 프로필 모두 true, 프로필 사례 전부 통과. Marklife 9종이 `experimental: true`.
- AC-PRN2-02 (device) 바우아토 작업 바이트가 Luck Jingle 순서이고 골든 job(N1-28~30·34, PRN2-01·02)과 바이트까지 같다. 농도를 받아도 농도 명령은 없다. 조각을 이어 붙이면 가짜 기기가 받은 것과 같다.
- AC-PRN2-03 (device) 끝 알림이 골든 end(PRN2-51~64)와 같다: Marklife는 `AA` 하나만, 바우아토만 `4F 4B` 정확히 두 바이트도 끝. `ff03` 없는 꾸러미 A 기기는 크레딧 없이 끝까지 보낸다.
- AC-PRN2-04 (device) 고르기 목록 판정이 골든 list(PRN2-21~44)와 같고 앱·웹이 같은 함수/표를 쓴다(웹 `requestDevice` 하나, 앱 고르기 목록). 이름 첫 글자 거르기가 없다.
- AC-PRN2-05 (device) NIIMBOT 연결 뒤 모델이 켠 프로필과 같을 때만 쓰고 아니면 끊고 `WRONG_MODEL`. B1 Pro·B21 Pro는 `WRONG_MODEL`이고 문장이 그림 파일 경로를 알린다.
- AC-PRN2-06 (web) 실험 기종은 고르기 목록에 "실험", 연결 뒤 프린터 이름 뒤 "(실험)"과 안내 한 줄(L-7 문장 그대로). 확인됨(B1)에는 없다. 실험 기종이 연결된 기기의 "이 기기에서 출력"은 테스트 인쇄 "예" 뒤에만 보인다.
- AC-PRN2-07 (web) 앱의 `EXPO_PUBLIC_PRINTER_EXPERIMENTAL` 숨김 스위치가 없고(D-PRN2-08) 모든 켠 프로필이 고르기 목록에 보인다. 앱·웹 같은 기준.
- AC-PRN2-08 (server·web) 출력 기기가 프린터를 이을 때 프로필 ID를 알리고 서버가 기록에 그 값만 둔다(이름·기기 ID 없음, 로그에도 없음). 라벨 설정 크기 목록이 그 프로필의 크기이고, 모르면 B1 목록. 목록에 없는 크기의 저장된 템플릿은 출력 기기에서 `LABEL_ERROR` 멈춤 + 문장.
- AC-PRN2-09 (server) `GET /api/print/jobs/:id/png`·`/api/print/test-png`가 203dpi 1비트 PNG를 내준다. 인증·시도·출력 기기 검사는 비트맵 입구와 같고, PNG 바이트는 웹 LBL-07과 같다. 틀린 시도는 비트맵 입구와 같은 오류.
- AC-PRN2-10 (web) 실험·그림 파일로만 기종의 기본 대체: 웹은 PNG 저장·공유, 앱은 이 기기가 받은 작업의 서버 PNG를 기기 공유 창으로 보낸다(D-PRN2-28). 공유 창을 열어도 작업 상태는 그대로이고 결과를 보내지 않는다. 앱이 다시 그리지 않는다. 받은 시도가 없으면 단추가 없다.
- AC-PRN2-11 (tests) 도메인: 골든 전부 + 표 한 줄 추가가 코드 분기 없이 되는지. E2E: 실험 표시·테스트 인쇄 "예" 뒤 출력·크기 목록·PNG 받기·가짜 프린터 출력.
- AC-PRN2-12 (web) 감사 판정(D-PRN2-27·29·31·34): 테스트 인쇄 크기 = 저장된 크기가 프로필 목록에 있으면 그 크기, 없으면 프로필 기본 크기. 앱도 테스트 중에는 작업을 받지 않고, 범위 밖 농도는 보내지 않으며, 템플릿에 크기가 없으면 INVALID_TEMPLATE로 멈춘다. (device) 고르기 줄에 "실험"은 한 번, `enabledFamilies` 없음, ff03은 "특성 없음"만 없음으로 본다, 바우아토 OK는 모든 조각을 쓴 뒤 받은 것만 센다.

## 사람이 확인할 것 (HG-5, 이 스프린트 밖)

- 실제 Marklife·바우아토·NIIMBOT 다른 모델 한 장씩 출력해 단계를 확인됨으로 옮길지 정한다. 그때까지 모두 실험.
