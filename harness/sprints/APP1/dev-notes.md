# APP1 개발 노트

## dev-device

### 만든 것

| 수용 기준 | 어디 | 확인 |
|---|---|---|
| AC-APP1-01·02 쉼 0.4초·최대 20초 자르기 | `packages/voice/transcriber/livegenie_transcriber/segmenter.py` | `tests/test_segmenter.py` |
| AC-APP1-03 틀 묶기·풀기·hello | `.../protocol.py` | `tests/test_protocol.py` |
| AC-APP1-04 흐름 한도·닫은 흐름 | `.../session.py` | `tests/test_session.py` |
| AC-APP1-05 저장·로그 없음 | `.../session.py`·`runner.py`(로그는 셈만) | `tests/test_no_traces.py`(하위 프로세스로 진짜 연결 고리·진짜 로그를 돌려 출력·임시 폴더·HOME·작업 폴더·꾸러미 폴더 비교) |
| AC-APP1-06 모델 설정·README | `.../config.py`·`runtime.py`·`README.md`·`requirements.txt` | `tests/test_config.py` |
| AC-APP1-53 일꾼 적대 입력 | `session.py`·`protocol.py` | `tests/test_session.py` BadInputTest |
| (게이트) 파이썬 시험을 vitest로 | `packages/voice/test/transcriber.test.ts` | `python3 -B -m unittest discover -s tests -t tests` (49개, 바이트코드 안 남김) |
| AC-APP1-10 16kHz 바꾸기 | `packages/voice/src/pcm16.ts`(가져오는 것 없음 — 하위 경로 `@livejjim/voice/pcm16`) | `test/pcm16.test.ts` |
| AC-APP1-11~14·54 엔진 | `packages/voice/src/livegenie.ts` | `test/livegenie.test.ts` |
| AC-APP1-15 재생 측정 | `scripts/replay/stream.mjs`, `scripts/replay/lib/ws-mini.mjs` | 아래 "실측" |

### 정한 세부 (스펙이 정하지 않은 것 — 판매자에게 안전한 쪽)

- **쉼 0.4초를 틀 단위로 재는 법**: VAD 틀은 30ms(시험)·32ms(silero) 단위라 0.4초가 딱 떨어지지 않는다. "쉼 + 틀 반 개 ≥ 0.4초"면 끊는다(틀 반 개 안에서 0.4초에 가장 가깝게). 30ms 틀이면 13틀(390ms)에서 끊고 12틀(360ms)은 잇는다 — AC-APP1-01의 0.4초는 끊고 0.37초는 잇는다.
- **문턱**: silero 기본과 같이 말 시작 0.5 이상, 말하는 중 쉼은 0.35 미만(흔들림 막기). 0.25초보다 짧은 조각(딸깍 소리)은 받아쓰지 않는다(지난 비교 실험의 silero 설정 `min_speech_duration 0.25`와 같음).
- **20초 자르기**: 정확히 320,000표본에서 자르고 나머지는 바로 다음 조각의 처음(빈틈·겹침 없음). 조각을 이어 붙이지 않는다.
- **홀수 바이트 PCM 틀**은 통째로 버린다(시각에도 넣지 않는다). 기기는 늘 3,200바이트라 정상에선 일어나지 않는다.
- **일꾼 다시 붙기**: 1·2·4·8·16·30초. 10초 넘게 붙어 있다 끊기면 1초부터 다시 센다(서버가 받자마자 끊는 경우 1초마다 두드리지 않게).
- **일꾼 로그**: 붙음·끊김·다시 붙기 초·5분마다 셈 한 줄(흐름·조각·결과·버린 조각·처리 시간 중앙/95%). 예외 글은 찍지 않는다(주소·머리글이 들어 있을 수 있다). 설정 오류 문장에 받은 값을 되풀이하지 않는다(토큰을 잘못 붙여 넣었을 수 있다).
- **모델 불러오기**: 내려받아 둔 모델이 있으면 인터넷 없이 그것을 쓴다(`local_files_only` 먼저). Cohere는 동의가 필요한 모델이라 처음 한 번만 허깅페이스 로그인이 필요하고 일꾼은 그 토큰을 쓰지 않는다.
- **기기 엔진 상태**: 켜면 바로 `LISTENING`(첫 `ready` 전에도) — 거절이 오면 곧바로 `HALTED`. 다시 잇는 동안 `RESTARTING`(상태 이름 `LIVEGENIE_STATE_LABELS.RESTARTING` = "다시 잇는 중"), 다시 `ready`면 `LISTENING`.
- **다시 잇기 간격**은 "마지막 최종 결과 뒤 끊긴 횟수"로 고른다(ready만으로는 비우지 않는다 — 받자마자 끊기는 서버를 1초마다 두드리지 않게). 한도는 cloud.ts·Web Speech와 같은 `RestartLimiter`(60초 안 여섯 번째).
- **ready 전 소리·ready 전에 잡은 소리**: 보내지 않는다(`capturedAt < ready 시각`이면 버림). 조각 시각을 주지 않으면 "지금 − 100ms"(단 ready 시각보다 앞서지 않음).
- **말 끝 시각**: 결과의 시각이 틀리면(정수 아님·음수·start > end) NaN, 말 끝이 처리 시각보다 2초 넘게 미래면(매우 큰 수 등) 셈할 수 없음 — 둘 다 늦은 글(카드). 다른 엔진 결과(말 끝 시각 없음)는 늦은 글이 아니다.
- **모르는 closing 까닭**은 `ready` 전이든 뒤든 다시 잇기 셈(멈추는 까닭은 BUSY·NO_WORKER(ready 전)·OTHER_DEVICE·AUTH·ENDED뿐).
- **ENDED**는 오류 없이 `OFF`(새 문장 없음) + `onClosing('ENDED')` 알림.
- **오류 문장 표**: 공용 표 `SPEECH_ERROR_MESSAGES`(VOC-01 문장, 기존 시험이 표 전체를 본다)는 그대로 두고, 라이브지니 문장은 `LIVEGENIE_ERROR_MESSAGES`(OTHER_DEVICE·TRANSCRIBE_BUSY·TRANSCRIBE_OFF·LOGIN_ENDED)에 따로 두었다. 다시 잇기 한도 멈춤은 까닭 종류 `CONNECTION_FAILED` + 문장 `LIVEGENIE_CONNECTION_FAILED_MESSAGE`("듣기 멈춤 · …" 전체), 음성이 안 되는 기기는 `UNSUPPORTED` + `LIVEGENIE_UNSUPPORTED_MESSAGE`.

### 남의 영역을 고친 것

- 루트 `eslint.config.mjs`(공용): 무시 범위에 `.live-replay/` 한 줄. 이 맥에는 재생 시험 작업 사본(`.live-replay/work/*-wt`, git worktree)이 있어 린트가 그 안의 수만 개 파일을 보고 실패했다(내 변경 전부터).

### 오케스트레이터에게 요청 (검증 게이트 — 개발자가 고칠 수 없음)

- `scripts/verify/stages.mjs`의 `ESLINT_SCAN_SKIP`에 `.live-replay`를 더해 주세요. 이 맥에서는 `.live-replay/work/{case,dict,int,int2}-wt/eslint.config.mjs`(재생 시험용 저장소 사본) 때문에 lint 단계가 "다른 ESLint 설정 파일 4개"로 실패한다. eslint 자체는 위 무시 한 줄로 통과한다.

### 실측 (AC-APP1-15, 게이트 밖)

M3 Pro 18GB, Cohere(`CohereLabs/cohere-transcribe-03-2026`, mps), `node scripts/replay/stream.mjs <방송> …`. 서버 중계·망 지연은 들지 않음(측정용 서버가 서버 자리, HG-APP1에서 실기기로).

| 무엇 | 조건 | 값 |
|---|---|---|
| 말 끝 → 글 도착 지연 | 경성 1,800초부터 600초, `--speed 1`, 결과 85개 | p50 738ms · p95 1,202ms · 최대 1,431ms |
| 조각 하나 받아쓰기 처리 시간 | 같은 실행 | p50 286ms · p95 786ms · 최대 996ms |

- p95 1.2초 ≤ 1.5초 — 기준 안. 지연에는 기기가 100ms 조각을 모으는 기다림과 쉼 0.4초 판단이 들어 있다(말 끝 뒤 최소 약 0.4~0.5초).
- 측정 중 같은 맥에서 vitest(꾸러미 시험)를 함께 돌려 처리 시간이 조금 부풀었을 수 있다(판매자에게 불리한 쪽으로 잰 것).

## 2026-10-30 Codex 통합 실행 확인

- 위 Cohere 경성 측정은 인계받은 기존 기록이다. 이번 컴퓨터에는 기존 일꾼/모델/재생 자료가 없다는 사용자 답변에 따라 격리된 Python 3.12 환경에 고정 requirements를 설치했다.
- 기존 지원 선택인 Whisper large-v3-turbo와 silero VAD를 실제로 불러왔다. Transformers 5.21의 pipeline에 `local_files_only`가 전달되어 generate 오류가 나는 결함을 고쳤다. AutoProcessor/AutoModel에서 캐시 우선 로딩한 객체만 pipeline에 전달하며 기본 모델 선택(Cohere)은 바꾸지 않았다.
- 표준 라이브러리 단위 시험 50/50: 새 runtime 회귀는 로딩 옵션이 inference로 새지 않음, 캐시 실패 뒤 다운로드 재시도, 한국어/16kHz 설정과 워밍업을 검사한다.
- 합성 Yuna 음성 `15번 핑크프릴 이만 원`만 사용해 실제 PCM 51틀(틀당3,200바이트)을 실시간으로 전송했다. 실제 일꾼→서버 중계→기존 읽기→HTTP 이벤트→PGlite DB에서 번호15·품종핑크프릴·가격20,000원 정확히1건을 확인했다. 이 한 조각의 모델 처리707ms, 전체 입력/등록 확인5,213ms. 실제 판매자 목소리 정확도·다중 흐름 p95/HG를 대신하지 않는다.
- 이번 실측에 개인 마이크·고객 음성은 쓰지 않았다. 시험용 계정/인메모리 DB·일꾼은 검증 뒤 종료했다. 전체 실방송 재생 자료가 없어 경성/금화 전후 점수는 이번 실행에서 미확인이다.

### 기본 Cohere 실제 실행 보완

- 사용자가 로그인한 Hugging Face 브라우저에서 모델 접근 승인을 확인했다. 공개 승인 모델 읽기(`gated-repos`)만 요청한 공식 Device Code OAuth로 모델 파일 9개를 내려받았고, 토큰은 다운로드 프로세스의 메모리에만 두었다. 모델 revision: `d552dadc2922ba6f6c1f994f8db904d52dcaf942`.
- 실제 Cohere 시작에서 기존 requirements에 빠진 `librosa` 때문에 `CohereAsrFeatureExtractor`가 실패했다. `librosa==1.0.0`을 고정해 설치하고 설치 안내를 해당 꾸러미가 지원하는 Python 3.12 이상으로 맞췄다. 나머지 고정 의존성은 유지했다. 표준 라이브러리 시험 50/50 통과.
- 동일한 합성 음성/51틀을 **CohereLabs/cohere-transcribe-03-2026** 실제 일꾼으로 다시 시험했다. 결과 글 `15번 핑크 프릴 2만 원.` → 기존 읽기 → HTTP 쓰기 → DB의 **15번·핑크프릴·20,000원 1건**을 확인했다. 조각 처리 409ms, 전체 입력/등록 확인 5,165ms. 한 표본으로 통계적 p95·실방송 정확도/우열을 판단하지 않는다.
- 시험 명령 종료 코드 0, 서버·일꾼 종료 확인. 사용자 실행 도우미의 기본 모델도 Cohere다. Whisper는 명시한 대안 인자로만 실행한다.

## 2026-10-31 받아쓰기 조각 여유·틈 고르기 (dev-device, 갈래 dev/voice-accuracy)

- 도구: `packages/voice/transcriber/livegenie_transcriber/tune.py`(probs·sweep·transcribe, 시험 `tests/test_tune.py`). 일꾼과 같은 512표본 창으로 자른다 — 0·0·0의 조각 수(경성 3,099·금화 2,663)가 예전 진짜 일꾼 stream 실행과 같다. 예전 손 스크립트(`scratchpad/sim.py`)는 쓰지 않는다.
- 채점: 녹음 전체(경성 17,420초·금화 14,166초)를 맥 미니 Cohere(mps)로 받아써 `from-whisper --interim 0` → `cli.mjs replay`. 점수 = OK_FIRST + OK_AFTER_FIX. 같은 채점 코드(main 3b403c44 화면)로 모든 조합을 쟀다.
- 재생 화면이 PC 기본 엔진을 서버 받아쓰기로 바꾼 뒤 채점 재생이 이벤트를 하나도 내지 못했다 → `page-scripts.mjs`가 `livejjim.voiceEngine=chrome`을 고른다. 크롬 길을 없애면(D-APP-25) 이 채점도 서버 읽기 길로 옮겨야 한다.

| 앞·뒤 여유(ms)·틈(ms) | 경성 /79 | 금화 /24 | 합 | sweep 말 가운데 자르기(경성·금화) |
|---|---|---|---|---|
| 0·0·0 (예전 일꾼) | 44 | 16 | 60 | 44·18 |
| 0·0·5000 | 47 | 15 | 62 | 5·1 |
| 0·0·8000 | 46 | 16 | 62 | 1·0 |
| 200·200·5000 | 48 | 16 | 64 | |
| **200·200·8000 (고름)** | **49** | **16** | **65** | |
| 300·300·5000 | 46 | 15 | 61 | |

- 고른 값: 앞 200ms·뒤 200ms·틈 8초 — 합이 가장 높고 경성 MISSING이 가장 적다(6→4, 놓치는 찜이 적은 쪽). 300ms는 다시 떨어진다(앞뒤 말 조각이 섞이는 듯). 1점 차는 흔들림 안일 수 있다(같은 조각이라도 mps fp16 결과가 조금 다를 수 있음).
- 20초 억지 자르기는 경성 46·금화 18곳뿐이라 틈 찾기만으로는 +2 정도. 나머지는 앞뒤 여유 몫.
- 예전 기준선(진짜 일꾼 47·17)은 다른 맥·다른 화면 코드(int2-wt)로 잰 값이다. 이 맥·지금 화면으로 같은 0·0·0을 다시 재면 44·16 — 전후 비교는 이 표 안에서만 한다.
- **스펙 관리자에게 요청**: AC-APP1-01·02는 자르기 함수 기본으로 "endMs 2,000·마지막 5초"(여유 없음)를 정한다. 그래서 `Segmenter()` 기본은 0으로 두고(그 시험 그대로), 일꾼이 쓰는 값만 `WORKER_*`(`worker_segmenter`, `run_worker` 기본)로 넣었다. 일꾼 결과의 startMs·endMs는 여유를 포함한 조각 끝이다(말 끝보다 최대 0.2초 뒤 — 끊는 때는 그대로 쉼 0.4초라 지연은 늘지 않는다). VOC-07 AC4·AC-APP1-01·02에 여유·틈을 적을지 DECISIONS에 올려 주세요.
- stream.mjs: 끝 표시 결과는 앞 여유만큼 일찍 시작할 수 있어 drained를 `startMs >= mainEndMs`로 본다.
