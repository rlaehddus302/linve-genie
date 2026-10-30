# 맥 미니 메인 세션 넘겨받기 (2026-10-31)

이 문서를 읽은 세션이 **메인(지휘)**이다. 맥 미니(12코어·24GB)가 본진, 맥북(11코어)은 보조.
개인정보는 이 문서에 없다. `.live-replay/`는 맥 미니 `~/dev/livejjim/.live-replay`에 복사돼 있다(git 무시, 밖으로 내보내기 금지, 보고엔 숫자만).

## 사용자 고정 규칙
- 한국어로, 짧게. 묻지 말고 판매자에게 안전한 쪽으로 정하고 `DECISIONS.md`에 AUTO로 남긴다.
- **유튜브에 아무것도 쓰지 않는다**(감사 댓글 포함, 시험 중에도). 연습 비밀번호를 되풀이하지 않는다. HF 토큰은 환경 변수로만.
- 권한·보안 설정을 바꾸지 않는다. 테스트 약화 금지. 보호 경로는 CLAUDE.md 그대로.
- 커밋 접두어 `[spec]` `[dev:core|server|web|device]` `[test:domain|e2e]` `[ux]` `[harness]` `[orch]` + 끝줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 속도 최우선, 토큰 아끼기: 기계적인 일은 Sonnet, 보고는 5줄, **개발 중엔 전체 `pnpm verify` 금지**(typecheck·lint·바뀐 곳 시험만). 전체 검사는 다 끝난 뒤 출시 전에 한 번.
- 기계가 멈추지 않을 만큼 최대한 병렬. **부하(loadavg 1분)를 코어 수 아래로** 유지. 갈래마다 시험 스레드를 묶는다: `pnpm vitest run --pool=threads --poolOptions.threads.maxThreads=3` 식으로.

## 제품 결정(바꾸지 않는다)
- 휴대폰만으로 운영(NFR-09): ① 폰 = 방송 촬영, ② 폰 = 우리 앱(Expo/React Native). 초대받은 유튜버는 우리 서비스와 무관(NFR-10).
- 음성 인식·찜 읽기는 **서버**에서. ② 폰 마이크 → `/api/voice/stream` → 받아쓰기 일꾼(Cohere Transcribe, 맥 미니).
- 채팅 읽기는 공식 API 안 씀: 서버가 innertube로 직접 수집(끄기 `LIVEJJIM_YT_WEB_CHAT=off`). **감사 채팅 올리기만** 공식 `liveChatMessages.insert`, 판매자 계정으로. 판매자는 채팅을 치지 않는다.
- 결제는 웹에서만, 앱은 로그인 전용. 마이데이터 안 씀. 입금 자동 확인은 은행 앱 알림·은행 대표번호 문자만.
- 프린터 기본 NIIMBOT B1, Marklife·바우아토(Luck Jingle)는 '실험'. 실물 없음 → `tools/fake-printer`.
- 모바일 디자인: 나이 든 판매자, 토스 원칙, 글자 18+, 누르는 칸 52~64, 대비 4.5:1.

## 브랜치 상태
| 브랜치 | 상태 | 다음 |
|---|---|---|
| `int/next` | INV1 + int/app-devices + dev/yt-innertube 합침, typecheck·lint 통과 | 아래 끝난 갈래를 계속 여기로 합친다 |
| `sprint/SRV1-server` | 끝(서버 읽기 입구) | int/next로 |
| `sprint/SRV1-web` | 맥북에서 진행 중 | 끝나면 int/next |
| `dev/yt-innertube-web` | 끝(서버 수집 화면, 웹·앱) | int/next |
| `spec/yt-thanks-official` → 감사 서버 | 맥북에서 진행 중 | 끝나면 int/next |
| `sprint/PAY2-server`·`-web` | 맥북에서 진행 중 | 끝나면 int/next |
| `dev/mobile-design-base` | 끝(공통 부품 + 전 화면 적용 f617ccb3) | int/next |
| `dev/printer-app` | 끝(5d13e4fc) | int/next |
| `spec/sms-deposit-intake` → `spec/retention-1` | 맥 미니 세션 "맥 미니 개발 환경 준비"가 진행 중 | 끝나면 SMS3·KP1 개발 |
| `spec/printer-stages` → `dev/mobile-notice` | 맥 미니 세션 "프린터 앱 연결 마무리"가 진행 중 | 끝나면 PRN2 개발 |
| `dev/voice-accuracy` | 멈춤 | 아래 참고 |

보호 경로 게이트에 예전 `[dev:web]` 커밋 2건(74ff8727·0f45bf2a, dev-notes-web.md)이 걸린다. 이력을 다시 쓰지 않으면 못 지우므로 **받아들임(AUTO)** — main 올릴 때 DECISIONS에 기록.

## 맥 미니에서 띄울 갈래 (동시 7~8개까지, 각자 worktree)
1. **합치기(메인 몫)**: 끝난 브랜치를 차례로 `int/next`에 합치고 typecheck·lint·바뀐 곳 시험.
2. **음성 정확도** `dev/voice-accuracy`: 새 조각 매개변수 시험, `scratchpad/sim.py` 대신 저장소 안 도구로 매개변수 탐색, 재측정(경성 /79·금화 /24, 기준 진짜 일꾼 47·17, 크롬 57·17), `stream.mjs` `drained` 검사를 `>= mainEndMs`로. 5점 차이 = 중간 결과 채점 약 1 + 20초 강제 자르기·조각 약 4.
3. **SMS3 개발**(스펙 끝난 뒤): 서버 `/api/inbox/messages`, 판정 규칙 R-26, 가짜 입금 방지.
4. **PRN2 개발**(스펙 끝난 뒤).
5. **KP1 개발**(스펙 끝난 뒤): 단골 장부·방송 알림·리포트.
6. **채팅 남은 것**: CH-08/12/17/18/20, CH-26 시험 옮기기.
7. **SRV1·PAY2 후속 고침**(감사 결과가 나오면).
8. 안드로이드 SDK가 깔리면 `dev/mobile-notice` Kotlin 빌드 확인.

## 맥북(보조)이 맡는 것
- 이미 돌던 4갈래 마무리.
- 안드로이드 에뮬레이터(`livejjim35`)·아이폰 시뮬레이터로 앱을 띄워 직접 확인, 디자인 사용성 점검(ux-reviewer).
- 동시 2~3갈래 이하.

## 사람만 할 수 있는 일(최종 보고에 모은다)
실제 휴대폰·B1 등 프린터 실물, 판매자 인터뷰, 법률·세무 검토, PG 계약·스토어 계정, 받아쓰기 모델 내려받기 동의(HF).

## 맥북이 꺼져도 끊기지 않게 (2026-10-31 추가)
사용자는 맥북을 닫고 이동하는 동안에도 개발이 계속되길 원한다. 그래서 **메인은 맥 미니 자체의 Claude 앱(또는 맥 미니 안 tmux의 `claude`)에서 돈다.** 맥북 앱이 SSH로 띄운 세션은 맥북이 잠들면 멈출 수 있으니 믿지 않는다.
- 시작하면 원격 브랜치부터 본다(`git fetch origin`). 맥북이나 SSH 세션이 하다 만 일은 원격 브랜치의 마지막 커밋(제목에 WIP가 있을 수 있음)에서 이어받는다.
  - 맥북 갈래: `sprint/SRV1-web`, 감사 채팅 서버(`spec/yt-thanks-official` 또는 `dev/yt-thanks-official`), `sprint/PAY2-server`, `sprint/PAY2-web`
  - SSH 세션 갈래: `spec/sms-deposit-intake` → `spec/retention-1`, `spec/printer-stages` → `dev/mobile-notice`, `int/next` 합치기
  - 각 브랜치의 `harness/sprints/*/dev-notes.md`와 커밋 메시지로 어디까지 했는지 판단한다.
- `.live-replay`는 모델 파일(whisper·safetensors·onnx·bin)을 빼고 복사했다. 받아쓰기는 맥 미니의 기존 일꾼(Cohere)을 쓴다.
- 사용자는 휴대폰으로 볼 수 있다(Remote Control). 보고는 짧게.
