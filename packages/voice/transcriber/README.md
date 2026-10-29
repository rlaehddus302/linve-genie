# 라이브지니 받아쓰기 일꾼

방송 중 사장님 휴대폰·PC 마이크 소리를 글로 바꾸는 따로 된 파이썬 프로그램이다(VOC-07).
처음엔 운영자 맥 미니에서 돈다. 일꾼이 **라이브지니 서버로 먼저 붙는다** — 맥 미니에 들어오는 포트·공개 주소·터널이 필요 없다.

```
②폰·PC 마이크 → 라이브지니 서버 /api/voice/stream → (이 일꾼이 먼저 붙은) /api/voice/worker → 받아쓴 글 → 그 기기
```

- 흐름마다 silero VAD로 말을 자른다: 쉼 0.4초에서 끊고, 쉬지 않아도 20초에서 끊는다. 조각을 이어 붙이지 않는다.
- 조각 하나를 한 번에 받아써 `{text, startMs, endMs, procMs}`를 서버로 돌려준다. 빈 글은 보내지 않는다. 언어는 한국어로 고정.
- 소리와 글은 메모리에서만 다룬다. 디스크·로그에 남기지 않는다. 로그에는 셈(흐름 수·조각 수·처리 시간)만 찍는다.
- 흐름이 닫히거나 서버 연결이 끊기면 그 흐름의 아직 받아쓰지 않은 소리를 버린다(음성을 끈 뒤 등록되지 않게).
- 서버에 닿지 않으면 1·2·4·8·16·30초(가장 길게 30초) 간격으로 다시 붙는다. 일꾼을 끄고 켜도 서버는 그대로다.

## 설치 (맥 미니에서 한 번)

파이썬 3.10 이상(확인한 판 3.12). 꾸러미 판은 `requirements.txt`에 고정했다.

```
cd packages/voice/transcriber
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

모델 내려받기:

- 기본 `cohere` = `CohereLabs/cohere-transcribe-03-2026`(Apache 2.0). 허깅페이스에서 모델 페이지의 동의를 누르고 읽기 토큰으로 한 번 내려받는다:
  `.venv/bin/hf auth login` → `.venv/bin/hf download CohereLabs/cohere-transcribe-03-2026`. 한 번 받은 뒤에는 인터넷 동의 확인 없이 내려받아 둔 파일을 쓴다. 허깅페이스 토큰은 일꾼이 쓰지 않는다(필요하면 받은 뒤 `hf auth logout`).
- 대안 `whisper` = `openai/whisper-large-v3-turbo`(MIT). 동의 없이 처음 켤 때 저절로 내려받는다.
- silero VAD는 `silero-vad` 꾸러미 안의 onnx 파일을 쓴다(다른 파일은 `--vad-model`).

## 일꾼 토큰

라이브지니 서버의 환경변수 `LIVEJJIM_TRANSCRIBE_WORKER_TOKEN`과 같은 값을 파일 하나에 넣는다(권한 600).
**토큰을 명령줄·주소에 적지 않는다**(명령줄·주소는 기록에 남는다). 일꾼은 토큰을 `Authorization: Bearer` 머리글로만 보낸다.

```
umask 077 && printf '%s' '<서버와 같은 토큰>' > ~/.livejjim-worker-token
```

연습 서버(`pnpm try`)는 토큰 파일을 연습 폴더 안에 저절로 만들고 붙이는 명령을 보여 준다(D-APP1-07).

## 켜기

```
.venv/bin/python -m livegenie_transcriber --server https://<라이브지니 주소> --token-file ~/.livejjim-worker-token
```

| 설정 | 뜻 | 기본 |
|---|---|---|
| `--server <주소>` | 라이브지니 서버 주소 (`https://…`, 연습 서버는 `http://localhost:7700`) | 꼭 적음 |
| `--token-file <파일>` | 일꾼 토큰 파일 (없으면 환경변수 `LIVEJJIM_TRANSCRIBE_WORKER_TOKEN`) | 꼭 적음 |
| `--model cohere\|whisper` | 받아쓰기 모델 | `cohere` |
| `--max-streams <수>` | 동시에 받아쓰는 흐름 수 한도(1~64). 서버에 알려 서버가 넘치지 않게 나눈다 | `4` |
| `--device auto\|mps\|cuda\|cpu` | 모델을 돌릴 장치 | `auto`(맥은 mps) |
| `--vad-model <파일>` | silero VAD onnx 파일 | 꾸러미 안 파일 |

모르는 값이면 시작하지 않고 쉬운 문장으로 끝낸다(끝 번호 2).
M3 Pro 기준 조각(평균 약 4초) 하나 받아쓰기 평균 약 0.26초·95% 약 0.53초 — 판매자 4명이 동시에 말해도 따라간다.

## 맥 미니에서 늘 켜 두기 (launchd)

`~/Library/LaunchAgents/com.livejjim.transcriber.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.livejjim.transcriber</string>
  <key>WorkingDirectory</key><string>/Users/<사용자>/livejjim/packages/voice/transcriber</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/<사용자>/livejjim/packages/voice/transcriber/.venv/bin/python</string>
    <string>-m</string><string>livegenie_transcriber</string>
    <string>--server</string><string>https://<라이브지니 주소></string>
    <string>--token-file</string><string>/Users/<사용자>/.livejjim-worker-token</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/Users/<사용자>/Library/Logs/livejjim-transcriber.log</string>
</dict>
</plist>
```

```
launchctl load ~/Library/LaunchAgents/com.livejjim.transcriber.plist
```

- 로그 파일에는 셈과 연결 상태만 남는다(받아쓴 글·소리·토큰 없음).
- 맥이 잠들면 일꾼도 멈춘다: 시스템 설정 > 에너지에서 "디스플레이가 꺼져 있을 때 자동으로 잠자기 방지"를 켜고, 전원에 꽂아 둔다.
- 일꾼이 꺼지면 판매자 화면은 "받아쓰기 서버가 꺼져 있어요. 상품은 빠른 입력으로 넣어 주세요."를 보이고, 운영 상태 `/ops/status`의 `transcribe.workers`가 0이 되며 경보 `TRANSCRIBE_NO_WORKER`가 남는다.

## 시험

모델·silero·websockets 없이 표준 라이브러리만으로 돈다(자르기·틀 묶기/풀기·설정·흐름 한도·로그에 남는 것).

```
cd packages/voice/transcriber && python3 -B -m unittest discover -s tests -t tests
```

`pnpm verify`(음성 패키지 vitest의 `transcriber.test.ts`)가 같은 시험을 부른다.
실방송 녹음으로 점수·지연을 재는 것은 `scripts/replay/stream.mjs`(게이트 밖).
