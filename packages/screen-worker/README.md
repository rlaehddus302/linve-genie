# 화면 일꾼 (라이브지니 상품 자동 등록 실험)

유튜브 다육 라이브 방송에서 **상품 번호·가격(·품종)**을 자동으로 뽑는다.
화면 번호표(OCR) + 판매자 말(STT) + 규칙으로 판정하고, 결과를 상품 목록으로 낸다.
결정과 근거는 [DECISIONS.md](DECISIONS.md), 커밋 기록은 결정 단위로 남아 있다.

## 1. 설치 (맥, Apple Silicon)
```
uv venv -p 3.12 .venv
VIRTUAL_ENV=$PWD/.venv uv pip install -r requirements.lock.txt      # 정확히 같은 버전
brew install ffmpeg
```
- 맥 전용 부품: Apple Vision OCR(ocrmac), MLX(Whisper·Gemma). 리눅스/GPU에서는 `STT_BACKEND=faster`(faster-whisper), `LLM_BACKEND=llamacpp`로 바꿀 수 있다. OCR은 아직 맥 전용.

## 2. 데이터
공유받은 데이터 묶음을 같은 곳에 풀고 위치를 알려 준다.
- `livegenie_bench_json.zip` (약 90MB) — 규칙·LLM 시험, `sw.bench base`. 화면 읽기·STT 결과·정답(JSON/CSV)
- `livegenie_bench_media.zip` (약 1.2GB) — STT·OCR **모델** 시험용 원본(방송 소리, OCR 시험지 사진). 모델을 바꿔 볼 때만 필요
```
export LG_DATA=/풀어둔/곳/data
```
(지정하지 않으면 `~/lg/data`를 쓴다.)

| 폴더 | 내용 |
|---|---|
| `regress/` | 관리자 정답이 있는 방송 5개(다른 판매자)의 화면 읽기 결과·팀원 방식 STT·정답, 보스다육 11/8 정답(`boss_flK4emzquko_truth.csv`, 사람이 영상으로 확인한 148상품) |
| `STT테스트용_공유/` | 정답 방송 5개의 소리(audio.m4a) |
| `image_for_stt_test/` | 정답 방송 3개의 관리자 글(번호·가격·품종) |
| `first_sellers/video/flK4emzquko.m4a` | 보스다육 11/8 소리 |
| `first_sellers/runs/bossfinal_flK4emzquko/` | 그 방송의 화면 읽기(screen.jsonl)·지금 STT(transcript.jsonl) |
| `ocr_test_690/` | OCR 시험지 690장 + 정답 + Apple Vision 결과 |

⚠️ `regress/num/*/chat.json`, `comments.csv`에는 손님 닉네임(개인정보)이 있다. 팀 밖으로 내보내지 않는다.

## 3. 모델 비교 시험 (`sw.bench`) — 모델만 바꿔 끼우면 같은 점수표
```
python -m sw.bench base                                   # 지금 쓰는 것의 점수(기준)
python -m sw.bench stt --backend mlx --model mlx-community/whisper-large-v3-mlx
python -m sw.bench stt --backend hf  --model BuzzASR/korean           # transformers 모델
python -m sw.bench stt --backend faster --model <CTranslate2 모델>    # 리눅스·GPU
python -m sw.bench stt --backend mlx --model <모델> --sets boss,five   # 다른 판매자 5개 방송까지(오래 걸림)
python -m sw.bench ocr --plugin 내모듈:함수     # 함수: PIL 이미지 → [번호표 숫자들]
python -m sw.bench ocr --vlm mlx-community/Qwen2.5-VL-7B-Instruct-4bit
```
- STT 시험은 소리를 **30초씩 10초 겹쳐** 잘라 받아쓰고(`sw/longstt.py`), 번호·가격은 지금 일꾼의 규칙 그대로 뽑아 채점한다. 화면 읽기는 고정(Apple Vision 결과).
- 점수와 받아쓰기는 `$LG_DATA/bench/<이름>/`에 남는다.

### 기준 점수 (2026-11-09)
| 시험 | 번호 | 가격 |
|---|---|---|
| 보스다육 11/8 (사람 확인 148상품) — 지금 일꾼 | 145/148 | 135/142 직접 찾음 (+흔한 값으로 채움 2) |
| 정답 방송 5개 (다른 판매자 407상품 / 금액 214건) — 팀원 방식 STT | 350/407 (86.0%) | 184/214 (86.0%) |
| OCR 시험지 690장 — Apple Vision | 정답 읽음 328 (47.5%), 틀린 번호만 읽음 81 (11.7%) | |

주의: 보스다육 11/8은 규칙을 고칠 때 들여다본 방송이라 점수가 실제보다 높다. 처음 보는 방송 기준은 정답 방송 5개 점수를 본다.

## 4. 운영: 서버로 보내기
라이브지니에 이어진(끝나지 않은) 방송의 유튜브 라이브마다 일꾼을 띄워 **확정 상품**을 바로 등록한다(서버 입구 `POST /internal/screen/register`, 결정 D-SCR-01).
```
echo '<일꾼 토큰>' > ~/.lg_screen_token && chmod 600 ~/.lg_screen_token     # 서버의 LIVEJJIM_SCREEN_WORKER_TOKEN과 같은 값
cd packages/screen-worker
.venv/bin/python -m sw.serve --server https://livegenie.kr --token-file ~/.lg_screen_token --out-root ~/lg/runs/live
```
- 관리자(`sw.serve`)가 30초마다 `GET /internal/screen/live`로 지금 이어진 영상 목록을 묻고, 새 영상은 일꾼을 띄우고(동시 최대 2개), 목록에서 빠지면 멈춘다(SIGTERM, 20초 뒤 강제). 일꾼이 스스로 끝나면 목록에 남아 있는 동안 60초 뒤 다시 띄운다.
- 일꾼 하나만 손으로: `.venv/bin/python -m sw "https://www.youtube.com/watch?v=<영상>" --post https://livegenie.kr --token-file ~/.lg_screen_token`
- **등록 방식(기본 `--register llm`, 2026-11-12)**: 새 받아쓰기 줄에 숫자·번·만·천·원이 있거나 화면에 크게 보인 번호표가 바뀌면 **바로** 최근 1분(`LLM_REG_WINDOW`)의 줄과 화면 번호표를 지식판2 프롬프트(`sw/prompts/sales_instruct_system_regstt8k2.txt`, `gpt-5.6-sol` 추론 low(`LLM_REG_EFFORT`), codex CLI)에 묻는다(동시에 4개까지 `LLM_REG_PAR`, 이벤트 없이 1분 지나면 한 번 — 안전망). 줄 모양·화면 표시는 끝난 방송 시험(`sw.llm_b6`)과 같다.
  - 언제 보내나(2026-11-13, D-SCR-12~16 — 근거는 `DECISIONS.md`): 첫 답으로 바로 보내지 않고 번호마다 답을 모아, **번호 근거**(판매자가 말한 번호이고 그 방송 번호대 안이거나, 화면에 온전히 3장 넘게 읽힌 번호표)와 **가격 근거**(판매자가 말한 금액과 LLM 금액이 같거나, 서로 다른 호출의 답이 두 번 같음)가 다 있을 때 한 번 보낸다. 받아쓴 수와 10배·100배 다른 금액, 그 방송 가격대를 벗어난 금액은 보내지 않고 20초 뒤 `LLM확인요청` 이벤트로 남긴다(뒤에 맞는 답이 오면 그때 보낸다). 품종은 LLM 이름과 품종 사전이 맞을 때만 넣고 아니면 비워 보낸다. 방송이 끝나면 남은 줄을 한 번 더 묻고, 그래도 정해지지 않은 것은 보내지 않는다. 금액 없는 상품은 안 보냄.
  - **임시 등록(확인 중, 2026-11-13, D-SCR-18~22 — 계약서 `docs/retro/tentative-contract.md`)**: 서버가 "확인 중" 상품을 받으면 다 모일 때까지 들고 기다리지 않고 먼저 임시로 올린다. 임시 상품은 손님 찜은 받지만 감사 채팅·라벨은 확정 뒤에만 나간다.
    - 서버 능력 묻기: 일꾼은 켜질 때와 5분마다(`LG_SCREEN_CAPS_EVERY`) `GET /internal/screen/capabilities`를 물어 서버가 받는 입구·항목만 쓴다. 등록의 `tentative` 항목과 `confirm`·`withdraw` 입구가 모두 있을 때만 임시 등록을 쓰고, 하나라도 없거나 그 입구가 없는 옛 서버(404)면 위 "언제 보내나" 그대로 돈다. 서버가 모르는 입구·항목은 보내지 않는다.
    - 올리기: ① 받아쓴 한 줄에 `N번`과 단위를 말한 금액이 하나씩 있으면 LLM 답을 기다리지 않고 바로(`LLM_TENTATIVE_RULE=0`으로 끔) ② LLM 답의 번호 근거는 섰는데 가격을 못 정했거나, 말한 번호와 화면 번호가 한 자리 달라 기다릴 때(두 번호를 후보로 싣는다). 번호 근거와 가격이 첫 답에서 다 맞으면 임시를 거치지 않고 지금처럼 바로 등록한다. 임시 등록에는 금액·품종·번호 후보와 까닭 낱말이 실린다(손님 닉네임·채팅 글은 싣지 않는다).
    - 확정: 위 "언제 보내나"의 조건이 맞으면 `POST /internal/screen/confirm`(번호가 화면 번호로 옮겨졌으면 `to`). 확정 전에는 임시로 보이는 금액·이름을 바로 고쳐 보낸다.
    - 거두기(`POST /internal/screen/withdraw`): 규칙으로 올렸는데 그 줄을 본 LLM 답 두 번(`LLM_TENTATIVE_RULE_MISS`)이 그 번호를 적지 않을 때, 숫자 쌍이 이미 보낸 번호로 정해졌을 때, 확정하려는 번호가 화면에 한 번도 안 보이고 내내 보인 다른 번호가 임시로 올라가 있을 때(잘못 들은 번호 — 답을 그 상품에 합치고 이 번호는 거둔다. 번호 바로잡기 D-SCR-06을 확정 전에 하는 것).
    - 두기: 번호 근거는 섰는데 `LLM_HOLD_MAX`(120초)까지 값을 못 정한 것과 방송 끝에 남은 것은 거두지 않는다 — 판매자가 앱에서 확정하거나 지운다(`LLM_TENTATIVE_KEEP=0`이면 거둔다). 뒤에 근거가 모이면 일꾼이 같은 등록을 확정한다.
    - 판매자가 먼저 확정·수정·거둔 상품은 서버가 그대로 두고(`skip`·`kept`) 일꾼도 그 칸을 더 고치지 않는다. 다시 켠 일꾼은 앞 실행의 `events.jsonl`에서 확정하지 못한 임시 등록을 이어받아 확정·거두기를 이어 한다.
    - 되돌리기: `LLM_TENTATIVE=0`이면 임시 등록·확정·거두기를 전혀 보내지 않고 위 "언제 보내나" 그대로 돈다(재현 수치가 임시 등록을 넣기 전과 모든 줄에서 같다).
  - 판매자 설정(환경변수): `LLM_PRICE_UNIT`=`만`(기본)·`천`·`없음` — 단위 없이 말한 "35"를 35만원·3만5천원으로 읽을지. 서버가 그 방송의 가격 단위를 알려 주면(`GET /internal/screen/live`의 `priceUnit`) 판매자가 분명히 고른 값(`TEN_THOUSAND` → 만, `WON` → 없음)만 이 값 대신 쓰고, `THOUSAND`("고르지 않음"과 구별되지 않는다)·`AUTO`·없음이면 환경변수 그대로다(D-SCR-21). 나머지 값(`LLM_TAG_FRAMES` 3, `LLM_OUT_FRAMES` 5, `LLM_PRICE_AGREE` 2, `LLM_PRICE_WAIT` 20 …)은 `sw/llm_live.py` 위쪽에 있다. `LLM_REG_SAFE=0`이면 2026-11-12 방송 때처럼 첫 답으로 바로 보낸다(되돌리기용 — 임시 등록도 꺼진다).
  - 재현 시험: `.venv/bin/python -m sw.replay_live <실행 폴더>... --truth <정답 products.json>` — 끝난 방송의 일꾼 기록에 남은 LLM 답을 다시 흘려(LLM을 부르지 않음) 고치기 전·후 로직이 무엇을 언제 보냈을지 견준다. 판정 로직을 바꿀 때마다 돌린다. `--mode flow`는 지금 방식(`LLM_TENTATIVE=0`)과 임시 등록 흐름을 견줘 "줄 도착 → 임시 등록·확정" 시간, 확정까지 간 틀린 값, 끝내 확정 못 한 임시 등록 수를 낸다(가짜 서버가 임시 등록·확정·거두기를 받는다). `--variant '이름:KEY=값'`으로 환경변수를 바꾼 판을 더 돌린다. 기록에는 손님 닉네임이 있으니 저장소에 넣지 않는다.
  - 단위 시험: `uv venv -p 3.12 .venv && uv pip install -p .venv/bin/python rapidfuzz requests pytest` 뒤 `TZ=Pacific/Honolulu .venv/bin/python -m pytest tests -q` (mlx·whisper 없이 돈다).
  - 필요: `codex` 설치 + `codex login`(gpt-5.6-sol을 쓸 수 있는 계정). 운영 맥에서 먼저 `.venv/bin/python -m sw.doctor --server https://livegenie.kr --token-file ~/.lg_screen_token` 로 점검(서버에 등록하지 않음).
  - 기록: `llm_live.jsonl`(물을 때마다 글·답·걸린 초·까닭), `llm_상품.csv`(상품별 보낸 값과 다수결 값·보내기까지 걸린 초), `events.jsonl`의 `LLM등록`(줄을 읽은 시각·보낸 시각·번호/가격/품종을 정한 까닭 — 임시 등록을 확정한 것은 `via: "확정"`)·`LLM확인요청`·`LLM번호보류`·`LLM앞번호표보류`·`LLM번호쌍판정`, 임시 등록의 `LLM임시등록`(올린 값·까닭 낱말·후보)·`LLM임시결과`(서버 답)·`LLM임시맞음`·`LLM임시고치기`·`LLM확정결과`·`LLM거두기`·`LLM거두기결과`(방송마다의 `changed`·`skip`·`kept`)·`LLM임시남김`·`LLM번호화면판정`, `LLM가격단위`.
  - 예전 규칙을 비교할 때는 `--post` 없이 `--register rule`로 실행한다. 서버에는 지식판2 결과만 보낸다.
- 다시 보내기: 방송이 아직 안 이어짐(404)·이어진 방송이 여럿(409)·서버 저장 실패(5xx)·네트워크 오류는 10분까지. requestId가 `screen-<영상>-<번호>`라 몇 번 보내도 한 번만 등록된다.
- 기록: 관리자 화면(시각 붙음), 영상마다 `<out-root>/<영상>-<시각>/worker.log`·`post.jsonl`(보낸 결과). 토큰은 어디에도 찍지 않는다. 토큰 파일 대신 환경변수 `LG_SCREEN_TOKEN_FILE`도 된다.
- 일꾼에 옵션을 더 넘기려면 `--worker-arg=--no-llm`처럼.

## 5. 그 밖의 명령
| 명령 | 하는 일 |
|---|---|
| `python -m sw <유튜브 주소 또는 영상> [--speed 6 --chat 채팅.json]` | 실시간 일꾼(라이브면 실시간, 파일이면 배속) |
| `python -m sw.rejudge <결과폴더> <새폴더> [--llm]` | 저장한 화면 읽기·STT로 판정만 다시 |
| `python -m sw.listing <결과폴더>` | 번호·가격·품종 목록 CSV |
| `python -m sw.explain <결과폴더> 번호…` | 번호마다 화면 사진·STT·판정 근거 한 장(HTML) |
| `python -m sw.regress --chat` · `sw.price_regress` · `sw.run_regress` | 회귀 채점(정답 방송 5개 번호 · 금액 214건 · 보스다육) |
| `.venv/bin/python review/serve.py` | 영상과 결과를 같이 보는 확인 화면(127.0.0.1:8765) |
