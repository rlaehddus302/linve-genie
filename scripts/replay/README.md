# 실방송 재생 시험 (음성 상품 등록)

실제 방송 소리를 진짜 라이브찜 화면에 들려 주고, 음성 바로 등록이 만든 상품을 영수증 정답(`truth.json`)과 맞춰 본다.
사람이 손댈 일이 없게 만들었다: 연습 서버를 켜고, 로그인·방송 만들기·값 단위 AUTO·음성 켜기를 스크립트가 한다.
확장 프로그램(채팅)은 쓰지 않는다 — 소리만 다시 튼다.

자료와 결과는 모두 `.live-replay/`(깃 무시, 개인정보) 아래에만 쓴다. 이 폴더의 코드에는 개인정보가 없다.

## 명령

```
pnpm replay record  <방송> [--from 초] [--duration 초] [--port 7700]   # 실제 소리로 녹음 (실시간)
pnpm replay compare <방송> [--run 실행폴더] [--result 다른 result.json]  # 녹음 결과 ↔ 정답
pnpm replay replay  <방송> [--run 실행폴더] [--port 7720] [--max-step 10000] [--headed]  # 빠른 재생 + 비교
pnpm replay all     <방송> [record 옵션]                                   # record → compare → replay
```

`<방송>`은 `.live-replay/` 아래 폴더 이름(예: `2026-10-26-금화다육`). `--run`을 빼면 가장 최근 녹음을 쓴다.

## 준비물 (이 맥에서 한 번)

- BlackHole 2ch, `SwitchAudioSource`(brew `switchaudio-osx`), 구글 크롬, `pnpm install`.
- 연습 서버(`scripts/try/try.mjs`)는 샌드박스가 아닌 보통 셸에서 띄워야 한다.

## record — 실제 소리로 한 번 (실시간, 4~5시간)

1. m4a → 16 kHz wav(`<방송>/cache/audio-16k.wav`, 처음 한 번).
2. 연습 서버를 켜고(비밀번호는 출력에서 읽어 메모리에만), 방송 "재생 <방송> <시각>"을 만들고 값 단위를 AUTO로.
3. 브랜드 크롬(프로필 `.live-replay/work/chrome-profile`)으로 로그인 → 콘솔 → 음성 켜기.
4. 기본 입력·출력을 BlackHole 2ch로 바꾸고 `afplay`로 구간을 튼다 (그동안 스피커는 조용하다).
5. init 스크립트가 진짜 SpeechRecognition을 감싸 모든 이벤트(start·audiostart·result(중간·최종, resultIndex, 결과 전체)·error·end…)와 start/stop/abort 호출을 시각·소리 위치(`a`, 초)와 함께 `transcript.jsonl`에 쓴다.
6. 60초마다와 끝에 상품·음성 기록을 API로 모아 `result.json`. 30초마다 `run.log`에 살아 있음 줄, `meta.json`에 구간·다시 시작 횟수.
7. 소리를 트는데 120초 동안 소리 받기 시작(audiostart)·결과가 하나도 없으면(크롬이 마이크를 못 잡음 — 첫 시험에서 한 번 있었다) 크롬을 다시 켠다.
8. 크롬·페이지가 죽거나 연습 서버가 죽으면 지금 소리 위치부터 새 구간(`seg`)으로 잇는다. 음성이 꺼져 있으면(자꾸 끊김 등) 다시 켜고 표시를 남긴다.
9. 끝·오류·Ctrl+C·SIGTERM 때 afplay·크롬·서버를 끄고 소리 장치를 처음 것으로 되돌린다.

결과: `.live-replay/<방송>/runs/<시각>/` — `transcript.jsonl`, `result.json`, `meta.json`, `run.log`.

## compare — 정답과 맞추기

`report.md` + `score.json`(실행 폴더에). 번호마다 음성 기록(등록·값·이름·번호 옮김·되돌리기)과 받아쓴 말로 이력을 만들고 나눈다.

| 나눔 | 뜻 |
|---|---|
| OK_FIRST | 처음 등록부터 맞고 끝까지 맞음 |
| OK_AFTER_FIX | 처음엔 틀렸다가 나중 고침으로 맞음 |
| BROKEN_BY_FIX | 맞았던 적이 있는데 나중 바뀜으로 틀림 (예: 35만→33만→30만) |
| WRONG | 한 번도 맞은 적 없음 (까닭: WRONG_PRICE / WRONG_VARIETY, 같은 품종·값이 다른 번호에 있으면 "번호 의심") |
| MISSING | 그 번호 상품이 없음 |

- 품종은 공백·대소문자를 무시하고 같아야 맞음. 값은 정수 원이 같아야 맞음.
- 정답에 없는 상품은 "정답에 없는 상품"으로 적기만 한다 (팔리지 않은 상품은 영수증이 없다).
- 단계마다 시각·소리 위치·전→후·들은 말, 그리고 그 번호를 처음 말한 때(숫자 또는 "이백오십일") ±20초 받아쓴 말. `*` 표시는 그 번호가 든 줄.
- "등록까지(초)": 그 번호를 처음 말한 때부터 등록까지.
- `truth.json`이 없으면 등록 목록과 이력만 낸다.
- 일부 구간만 녹음했으면(`meta.json`의 from·duration, 또는 끝까지 못 감) 그 구간에서 말하지도 등록하지도 않은 정답 번호는 OUT_OF_RANGE로 빼고 세지 않는다.
- `score.json`의 `counts`로 실행 사이 나빠짐을 본다.

## replay — 빠른 재생 (소리·크롬 음성 인식 없음)

녹음한 `transcript.jsonl`을 진짜 화면의 음성 컨트롤러에 그대로 넣는다. Playwright 기본 chromium(화면 없음) + 가짜 SpeechRecognition + `page.clock`.
시계를 멈춰 두고 이벤트 사이만큼만 당기므로 1,000 ms 안정 기다림·자동 등록 타이머가 실제처럼 돈다. 서버 요청은 끝날 때까지 기다린 뒤 다음 이벤트를 낸다.
결과는 `runs/<녹음>/replay-<시각>/` — `result.json`, `report.md`, `score.json`, `vs-record.json`(녹음 때 결과와 상품·음성 기록 줄 비교), `stats.json`, `timemap.json`(서버 시각 → 녹음 시각).

- 빠르기: 3분 녹음(이벤트 약 800개)이 약 15초(서버 켜기 포함). 이벤트 하나에 약 6 ms라 4시간(이벤트 약 6만 개)은 6~8분으로 어림한다.
- 이벤트 사이가 `--max-step`(기본 10초)보다 길면 10초는 그대로 돌리고 나머지는 한 번에 건너뛴다(그 사이 타이머는 한 번만 돈다).
- 녹음 중 크롬이 다시 켜진 자리에서는 앞 인식 객체에 끝(end)을 대신 내 화면이 새 객체를 열게 한다.

## 도는 차례 (loop)

1. 방송마다 **record를 한 번** (실제 소리, 실시간). 밤새 돌려도 된다 — 무인 실행용이다.
2. `compare`로 첫 점수를 본다. `report.md` 위쪽의 BROKEN_BY_FIX·WRONG부터 본다.
3. 코드를 고친다 (추출기·컨트롤러·서버).
4. `replay`로 같은 녹음을 몇 분 만에 다시 돌려 `score.json`의 `counts`를 전과 비교한다. 나빠지면 되돌린다.
5. 3~4를 되풀이한다.
6. 가끔(인식 엔진·화면이 많이 바뀌었을 때, 또는 replay와 record 결과가 벌어질 때) record를 다시 한다 — replay는 그때 받아쓴 말이 고정이라 인식 자체의 변화는 못 본다.

## 부하·안전

- 한 번에 크롬 하나·서버 하나만. 동시에 두 명령을 돌리지 않는다 (같은 포트·소리 장치를 다툰다).
- 소리 장치는 끝날 때 되돌린다. 비정상 종료로 BlackHole이 남았으면 다음 실행이 알리고 끝날 때 맥 기본 장치로 되돌린다. 손으로: `SwitchAudioSource -t input -s "MacBook Pro 마이크"`, `-t output -s "MacBook Pro 스피커"`.

## 알려진 한계

- 연습 서버는 메모리 DB다. 녹음 중 서버가 죽으면 그때까지의 상품은 마지막 `result.json` 모음(최대 60초 전)에만 남고, 새 서버·새 방송으로 잇는다(같은 번호는 뒤 서버 것이 이김).
- 크롬이 죽어 다시 켜는 10~20초 동안의 소리는 틀지 않고 그 위치부터 다시 튼다(빠지는 소리는 없지만 그 사이 말이 문장 중간에서 끊길 수 있다).
- replay의 서버 시각은 실제 시계다. 이력의 시각은 `timemap.json`으로 녹음 시각에 맞춘다(수백 ms 차이).
