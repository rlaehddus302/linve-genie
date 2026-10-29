# APP1 통합 보고

2026-10-30 · 상태: 최종 자동 검증 진행 중. HG-APP1은 미확인.

## 결과

기존 APP1·APP1b·APP2 구현을 `codex/livegenie-resume-20261029`에 통합했다. 인증된 기기 WebSocket, 판매자 한 흐름, 일꾼 인증·한도·끊김, 실제 PCM 캡처와 Python 받아쓰기 실행을 연결했다. 기본 Cohere와 기존 대안 Whisper를 각각 실제로 실행하고 상품 등록까지 확인했다. 사용자 실행 도우미의 기본값도 Cohere다.

사용자는 기존 받아쓰기 서버가 없다고 답했다. 이 맥에 격리한 Python 3.12와 고정 requirements, Cohere Transcribe·Whisper large-v3-turbo·silero VAD를 설치했다. Whisper 캐시 우선 로딩의 Transformers 5 호환 오류와 Cohere 필수 전처리 의존성 `librosa` 누락을 수정했다. Cohere는 사용자가 로그인한 브라우저의 모델 접근 승인을 확인하고 공개 승인 모델 읽기 권한만 사용해 내려받았다. 토큰은 파일로 저장하지 않았다. 원격 운영 배포 또는 기존 맥 미니에 설치한 것으로 보고하지 않는다.

## 실제 연결 증거

합성 한국어 `15번 핑크프릴 이만 원` → 16kHz mono PCM16 51틀(각3,200바이트) → 실제 일꾼 → Node WebSocket 중계 → 기존 읽기 → 기존 HTTP 등록 → PGlite에 **15번·핑크프릴·20,000원 1건**을 두 모델 각각 확인했다.

| 모델 | 결과 글 | 단일 조각 처리 | 전체 입력/등록 확인 |
|---|---|---|---|
| 기본 Cohere Transcribe | `15번 핑크 프릴 2만 원.` | 409ms | 5,165ms |
| 대안 Whisper large-v3-turbo | `15번 핑크프릴 2만원` | 707ms | 5,213ms |

각각 한 표본이다. 다수 표본 p95·실제 판매자 음성 정확도·모델 성능 우열을 판단하지 않는다. 전체 시간에는 실시간 음성 전송이 포함된다. 고객 자료·사용자 마이크를 쓰지 않았고 두 검증의 서버·일꾼은 종료했다.

## 로컬 브라우저 확인

동일 출처 `localhost:9790`에서 로그인 → 리허설 생성 → 15번 핑크프릴 20,000원 등록 → 합성 시청자 채팅으로 1등 판정 → 새로고침 후 보존 → 종료 후 음성/빠른입력 제거 → 영수증 합계(기본 배송비 포함24,000원)를 직접 확인했다. 브라우저 warning/error0. 별도로 사용자 실행용 Cohere 일꾼과 서버를 열어 두었으며, 실제 마이크/유튜브/B1을 검증한 것으로 보지 않는다.

## 추적성

- Python VAD·20초 분할·프로토콜·흐름 종료·한도·로그/파일 흔적: `packages/voice/transcriber/tests` 50개 및 `packages/voice/test/transcriber.test.ts`.
- PCM·ready 이전/재연결 중 버림·1/2/4/8초 재연결·여섯 번째 중단: `packages/voice/test/pcm16.test.ts`, `livegenie.test.ts`.
- 기기 세션·Origin·판매자/방송·다른 기기 거절·일꾼 인증: `apps/server/test/app1-*`와 전체 적대 시험.
- 375px 실제 AudioContext/AudioWorklet PCM→서버 읽기→HTTP, 일꾼 없음→빠른 입력 유지: `tests/e2e/app1/server-voice.spec.ts`.
- 기존 Chrome·Safari·문자찜·이력·설정·모바일 회귀: `test-notes-e2e.md`의 AC 대응표. 시험자가 보고한 TE-APP1-001~012는 모두 해결 후 재확인했다.
- 최종 캡처 취소 위험은 APP1b `audit-risk.md`의 RA-APP1b-001로 추적한다. 늦은 getUserMedia/worklet 완료·offline·인증 종료 뒤 마이크가 살아나지 않는다.

## 게이트

최종 `pnpm verify` 결과를 확정 후 기록한다. 이전 보호 경로 검사는 APP1 BASE와 APP1b/APP2 BASE 각각 통과했고 최종 커밋 뒤 다시 검사한다. 코어·골든 기대값 변경은 없다. 중간 실패/중단 실행은 최종 통과 수에 합산하지 않는다.

## 남은 사람 확인

- 경성·금화 재생 자료가 이 컴퓨터와 기존 worktree에 없어 이번 전후 정확도·바로 등록 수·실방송 지연을 측정하지 못했다. 개발 노트의 예전 Cohere 측정은 인계 기록이다.
- 실제 판매 공간·휴대폰 마이크·망 환경·다중 흐름·장시간 안정성과 상시 운영 장치/호스팅은 미확인이다. 합성 한 문장 성공과 구별한다.
