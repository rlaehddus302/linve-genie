# 팀원용 안내: 라이브지니 상품 자동 추출 — 모델 비교 실험

> 이 문서를 그대로 AI(코딩 도우미)에게 보여 주고 시작하면 된다. 맨 아래 "AI에게 줄 첫 메시지"를 복사해서 쓰면 된다.

## 1. 무엇을 하는 프로젝트인가
유튜브 다육이 라이브 판매 방송에서 판매자가 파는 **상품 번호와 가격**을 자동으로 뽑아 라이브지니 앱에 등록하려는 실험이다.
- 화면: 1초에 1장, 화분에 꽂힌 흰 번호표 숫자를 OCR로 읽는다(지금은 Apple Vision, 맥 전용).
- 소리: 판매자 말을 STT로 받아쓴다(지금은 Whisper large-v3-turbo).
- 판정: 파이썬 규칙이 화면 숫자와 판매자 말을 맞춰 번호를 확정하고, 그 상품 시간에 말한 가격을 고른다(`sw/decide.py`, `sw/price.py`). LLM(Gemma 3 12B)은 가격 확인 보조.
- 원칙: **속도보다 정확도**. 틀린 번호·가격으로 등록되는 것이 가장 나쁘다.

## 2. 받을 것
| 무엇 | 어디서 | 필요한 사람 |
|---|---|---|
| 코드 | GitHub 비공개 저장소 `Port-051/livegenie`의 `packages/screen-worker/` (11/12까지는 별도 저장소 `Port-051/livegenie-screen-worker`, D-SCR-03) | 모두 |
| `livegenie_bench_json.zip` (53MB) | 팀 공유 폴더 | 모두 — 정답·화면 읽기 결과·STT 결과 |
| `보스다육_20261108_flK4emzquko.m4a` (160MB) | 팀 공유 폴더 | STT 모델을 시험할 사람 |
| `STT테스트용_공유` 폴더(정답 방송 5개 소리) | 팀이 이미 가진 공유 폴더 | STT 모델을 5개 방송까지 시험할 사람 |
| `ocr_test_690.zip` (96MB) | 팀 공유 폴더 | OCR 모델을 시험할 사람 |

⚠️ 데이터에 손님 닉네임(채팅)이 들어 있다. **팀 밖으로 보내지 말고, 공개 저장소·외부 서비스에 올리지 말 것.**

## 3. 준비 (맥, Apple Silicon 기준)
```
git clone https://github.com/Port-051/livegenie.git && cd livegenie/packages/screen-worker
uv venv -p 3.12 .venv && VIRTUAL_ENV=$PWD/.venv uv pip install -r requirements.lock.txt
brew install ffmpeg
```
데이터 풀기 — 모두 **같은 `data` 폴더** 아래로:
```
mkdir -p ~/lg && cd ~/lg && unzip livegenie_bench_json.zip            # → ~/lg/data/...
mkdir -p data/first_sellers/video && cp 보스다육_20261108_flK4emzquko.m4a data/first_sellers/video/flK4emzquko.m4a
cp -R <팀 공유>/STT테스트용_공유 data/                                    # 5개 방송까지 STT 시험할 때만
unzip ocr_test_690.zip -d data/                                          # OCR 시험할 때만
export LG_DATA=~/lg/data
```
**먼저 기준 점수가 똑같이 나오는지 확인**(환경이 같다는 증거):
```
python -m sw.bench base
```
기대값:
```
[보스다육 …] 번호 145/148 | 없는 번호 1 | 가격(직접 찾음) 135/142 · 흔한 값으로 채움 2
[정답 방송 5개 …] 번호 350/407 (86.0%) 오류 4 | 금액 184/214 (86.0%)
```
다르게 나오면 실험을 시작하지 말고 환경부터 맞춘다(패키지 버전·데이터 위치).

## 4. 실험하는 법 (모델만 바꿔 끼운다)
### STT 모델
```
python -m sw.bench stt --backend mlx --model mlx-community/whisper-large-v3-turbo      # 맥 MLX 모델
python -m sw.bench stt --backend hf --model BuzzASR/korean                            # transformers 모델
python -m sw.bench stt --backend faster --model <CTranslate2 모델>                    # 리눅스·엔비디아 GPU
python -m sw.bench stt --backend mlx --model <모델> --sets boss,five                   # 다른 판매자 5개 방송까지(오래 걸림)
```
- 소리를 30초씩 10초 겹쳐 잘라 받아쓰고(`sw/longstt.py`), 번호·가격은 **지금 규칙 그대로** 뽑아 정답과 비교한다. 화면 읽기는 고정.
- 결과: `$LG_DATA/bench/<이름>/score.txt`와 받아쓴 글.
- 새 백엔드가 필요하면 `sw/longstt.py`의 `transcriber()`에 추가: 소리(float32 16kHz) → `[(시작초, 끝초, 글, avg_logprob 또는 None)]`.

### OCR 모델
```
python -m sw.bench ocr --plugin 내모듈:함수        # 함수: PIL 이미지 → [번호표 숫자들(int)]
python -m sw.bench ocr --vlm mlx-community/Qwen2.5-VL-7B-Instruct-4bit
```
- 690장 시험지(5개 방송 장면 + 그 시간 팔던 상품 번호)로 채점한다. 번호표가 안 보이는 장면도 섞여 있어 100%는 나올 수 없다 — **Apple Vision과 비교**하는 용도.
- 지표: 정답 읽음(높을수록 좋음), 틀린 번호만 읽음(낮을수록 좋음 — 다른 상품으로 잘못 등록될 위험).

## 5. 기준 점수 (2026-11-09, 지금 쓰는 것)
| 시험 | 번호 | 가격 |
|---|---|---|
| 보스다육 11/8 (사람이 영상으로 확인한 148상품) | 145/148 | 135/142 (직접 찾음) |
| 정답 방송 5개 (다른 판매자, 관리자 정답 407상품 / 금액 214건) | 350/407 (86.0%) | 184/214 (86.0%) |
| OCR 시험지 690장 — Apple Vision | 정답 읽음 47.5% · 틀린 번호만 11.7% | |

## 6. 지켜야 할 규칙 (공정한 비교)
1. **정답을 보고 규칙·코드를 그 번호에 맞춰 고치지 않는다.** 실수의 "종류"를 찾아 고친 것만 인정.
2. 보스다육 11/8은 규칙을 고칠 때 들여다본 방송이라 점수가 실제보다 높다. **판단은 "정답 방송 5개" 점수를 우선**한다.
3. 바꾼 건 하나씩(모델 하나, 설정 하나) — 무엇 때문에 좋아졌는지 알 수 있게.
4. 결과 보고 형식: `모델·설정 | 보스 번호 / 가격 | 5개 방송 번호 / 금액 | 걸린 시간 | 장비` + 눈에 띄게 틀린 예 2~3개.

## 7. 지금 알려진 문제와 실험 아이디어
- **STT를 짧게 끊음**: 실시간 일꾼은 판매자가 0.4초 멈출 때마다 끊어 받아쓴다(라이브지니 앱과 같은 방식). 끊긴 곳에서 숫자가 틀린다 — "101번 만원" → "101번 1010원". 같은 Whisper에 12초로 넣으면 맞게 나온다.
- **30초 겹쳐 받아쓰기의 이어 붙이기**: 지금 `sw/longstt.py`는 조각 가운데에 온 문장만 남기는데, 조각마다 STT 시각이 달라 경계 문장이 양쪽에서 다 버려지는 문제가 보인다(large-v3로 해 보니 "263 요거는", "275 요거 2만원"이 빠져 점수가 떨어짐: 번호 142/148, 가격 124/142). 겹친 부분을 다 남기고 같은 문장 중복만 지우는 방식으로 고쳐 볼 것.
- **OCR**: 기울어진 번호표(311을 312·322로), 1↔7 혼동(237을 231로). Qwen2.5-VL 7B는 핵심 장면 10장을 모두 맞혔지만 장당 3~4초. PaddleOCR 대형은 맥 CPU에서 장당 98초(엔비디아 GPU라면 다를 것).
- **문맥**: 판매자가 다음 상품 가격을 번호보다 먼저 말하는 경우(303/311) 규칙으로는 구분이 안 된다.
- **LLM만으로 판정**(규칙 없이 대본 → 상품 목록, `sw/llm_first.py`): Gemma 27B로도 규칙보다 낮았다(보스 번호 128/148, 가격 106/142).

## 8. AI에게 줄 첫 메시지 (복사해서 쓰기)
```
이 저장소는 유튜브 다육이 라이브 판매 방송에서 상품 번호·가격을 자동으로 뽑는 실험 코드야.
먼저 packages/screen-worker/HANDOFF.md, README.md, DECISIONS.md를 읽어 줘.
데이터는 LG_DATA=<내 data 폴더>에 풀어 뒀어. `python -m sw.bench base`를 돌려서
기준 점수(보스 145/148·135/142, 5개 방송 350/407·184/214)가 똑같이 나오는지부터 확인해 줘.
그다음 내가 시험할 것: <예: STT 모델 BuzzASR/korean / OCR 모델 ○○ / longstt 이어 붙이기 개선>.
규칙: 정답을 보고 특정 번호에 맞춰 고치지 말고, 바꾼 건 하나씩, 결과는 HANDOFF.md 6번 형식으로 정리해 줘.
손님 닉네임이 든 데이터는 외부에 올리지 마.
```
