# YT-SRV test-notes (test-e2e)

서버 웹 읽기 묶음(`chromium-ytweb`, 제목 `@ytweb`) 수집 시험: `tests/e2e/ytweb/collect.spec.ts`, 도우미 `tests/e2e/ytweb/support.ts`.
옛 공식 읽기 시험(@youtube)은 그대로 두고 위에 "같은 뜻 WEB 시험" 주석을 달았다. 감사 게시가 섞인 시험은 옮기지 않았다(D-YT-SRV-13).

## 옮긴 시험 (옛 → 새)
- youtube-edges `AC-I3-98·24` 스트림 503 끊김 → `AC-I3-98·24·YT-11 AC3` poll 503×2 (빠짐·중복 없음 + 순서 + 넣은 오류가 실제로 쓰였는지 poll 수 확인)
- youtube-edges `AC-I3-24` 잇기 전 채팅 → 같은 단언
- youtube-flows `AC-I3-25` 채팅 꺼짐(streamList 403) → 웹 영상 상태 chatOff → 같은 경고·다시 받기 + 다시 켠 뒤 채팅 한 번
- youtube `AC-I3-21·24`(수집 부분)·`TE-I3-001`·`AC-I3-27` → 같은 단언(목록 대신 주소로 잇기)
- youtube `AC-I3-01·25`(토큰 무효 → 다시 연결 경고) → 뜻이 뒤집힘: YT-11 AC9 "구글 연결 상태는 수집을 멈추지 않는다"
- youtube `AC-I3-33`(streamList hang, 감사) → 옮기지 않음. 수집 응답 없음만 새 시험 `YT-11 AC3: … 응답 없이 멈추면(15초)`

## 지적 (실패하는 시험으로 남김)
- TE-YT-SRV-001 (major, apps/web/src/lib/youtube.ts `collectorWarning`): 막힘(RETRYING·BLOCKED)을 "바로" 고정 영역 경고로 띄우지 않는다 — 10초 기다림(RETRYING_WARN_MS) 그대로, 대비 경로 버튼·"유튜브 채팅을 다시 받고 있어요…" 줄 없음 (YT-11 AC5·AC8). 서버는 RETRYING·BLOCKED를 바르게 낸다.
- TE-YT-SRV-002 (major, 같은 곳): 모르는 모양(RETRYING·FORMAT)도 같다.
- TE-YT-SRV-003 (major, apps/web/src/components/ConsoleYoutube.tsx `ReadyPanel`): 구글 연결이 없으면 잇기 칸이 없다("유튜브 채널을 먼저 연결해 주세요.") — YT-11 AC2·YT-02 서버 잇기는 주소만으로 잇고 처음 잇는 채널이면 "처음 잇는 채널이에요 (채널: …). 이 방송이 맞나요?". 확인 줄도 아직 INV1 문장("내 채널 방송이 아니에요 …").

## 하네스에 필요한 것
- 가짜 유튜브 웹 오류 지우기 경로(`/_fake/web/clear-faults`)가 없다 — `/_fake/clear-faults`는 가짜 구글 오류만 지운다. 지금은 정확한 횟수만 넣고 afterEach에서 `/_fake/end-chat`으로 그 시험의 수집기를 끝내 남은 수집기가 다음 시험의 오류를 먹지 않게 한다.
- `/_fake/web/state`의 부른 수가 영상별이 아니다(전체 합) — 넣은 오류가 그 영상에 쓰였는지 바로 볼 수 없다.
