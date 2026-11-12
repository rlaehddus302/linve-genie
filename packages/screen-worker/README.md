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
  - 언제 보내나: 어느 답이든 번호와 가격을 함께 적으면 그 번호를 **바로 한 번** 보낸다(첫 답의 가격·품종, 서버는 같은 번호를 바꾸지 않음). 9방송에서 첫 답으로 보내도 가격 95.8% → 95.5%. 방송이 끝나면 남은 줄을 한 번 더 묻고 아직 안 보낸 번호를 보낸다. 금액 없는 상품은 안 보냄.
  - 필요: `codex` 설치 + `codex login`(gpt-5.6-sol을 쓸 수 있는 계정). 운영 맥에서 먼저 `.venv/bin/python -m sw.doctor --server https://livegenie.kr --token-file ~/.lg_screen_token` 로 점검(서버에 등록하지 않음).
  - 기록: `llm_live.jsonl`(물을 때마다 글·답·걸린 초·까닭), `llm_상품.csv`(상품별 보낸 첫 답 값과 다수결 값·보내기까지 걸린 초), `events.jsonl`의 `LLM등록`(줄을 읽은 시각·보낸 시각).
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
