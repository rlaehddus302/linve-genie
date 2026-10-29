# APP1b 독립 도메인 검증

- 실행일: 2026-10-30. 역할: test-domain. 보호된 스펙·골든·제품 코드는 수정하지 않았다. 커밋은 오케스트레이터가 한다.
- 새 시험: `tests/adversarial/app1b-reading-parity.test.ts`.
- 실행: `pnpm exec vitest run --config vitest.adversarial.config.ts tests/adversarial/app1b-reading-parity.test.ts tests/adversarial/app2-resume-rejection.test.ts tests/adversarial/app2-server-ble.test.ts` — 3파일 422시험 통과(이 파일은 420시험).
- root `tsc --noEmit -p tsconfig.json`, 새 적대 시험 ESLint 및 `git diff --check` 통과. 전체 `pnpm verify` 결과는 오케스트레이터가 별도로 기록한다.

## TD-APP1b-01 / AC-APP1b-01·02·14: 골든 및 서버 이전 차등

1. 보호된 골든 전체를 파일 수·사례 수와 함께 읽는다: `parser/voice-extract.yaml` 228, `voice-register/*.json` 124(3파일), `voice/voice-sms.json` 67. 총419사례의 **원래 out**을 기존 순수 읽기 함수와 정확히 비교한다. 모르는 kind/문장 누락은 실패다.
2. 텍스트 입력361사례(추출228·품종추측42·번호이동24·문자찜67)는 실제 `createReadingSession.onResult()`와 기존 `VoiceController`에 같은 시각·상품/사전·설정으로 넣는다. 최종 wire snapshot 전체(카드·후보·폼·문자찜·로그·설정·시각) 및 등록 효과를 비교한다. HTTP 쓰기·인식 공급자를 가짜 읽기 구현으로 대체하지 않는다. 이 시험은 읽기 입구의 차등이며 실제 HTTP/WS는 기존 통합시험이 담당한다.
3. `same-number` 58사례는 구조화된 `heard/product/auto/recent/otherDevice` 입력이다. 원래 out을 직접 검사한 뒤, 각 상품 상태·가격·찜 수·최근 등록·다른 기기·설정을 주입하고 번호/이름/가격의 합성 발화를 서버와 기존 controller에 넣는다. 전체 snapshot 및 고침 효과(요청 번호·voiceLog 포함)가 같음을 검사한다.

입구 차이를 숨기지 않는다. 현재 서버 공개 입구는 상태를 가진 읽기 세션이며, 순수 추출기의 `dictionary`만 바꾸거나 `heard.nameFrom`을 직접 넣는 별도 API가 없다. 따라서 “서버 세션이 원래 순수 함수 out 419개를 그대로 반환했다”는 주장이 아니다. **원래 골든 out419개 보존 + 모든 골든 입력 계열의 서버/이전 controller 동등성**을 각각 확인한 것이다. `same-number` 합성 발화에서 실제 사전이 판정하는 nameFrom은 원래 구조화 입력과 다를 수 있으므로 이 둘을 동일한 검증으로 세지 않는다.

차등에서 발견한 제품 불일치는 없었다. 테스트 초기 실패는 기준 controller 호스트에 문자찜 쓰기/요청 번호 공급자를 빠뜨린 시험 설치 문제였으며, 서버와 동일한 포트를 주입한 뒤 **비교 항목을 줄이지 않고** 통과했다. 보호 골든 기대값은 바꾸지 않았다.

## 복원·종료 위험 검토

- 서버 복원 토큰은 프로세스 키로 HMAC 검증 후만 압축을 풀며 account/broadcast/device 범위, 3시간 만료, 12,000자 토큰·128KiB 해제 한도가 있다. `RESUME_INVALID`는 서버 controller를 폐기한다.
- 웹의 꺼진 상태 명령 세션은 `commandsOnly`에서 500ms context 타이머를 만들지 않는다. 개발자 회귀시험은 수동 명령 뒤 idle 종료를 확인하며, 여기서는 해당 주기 재연장 경로가 없음을 읽기 검토했다.
- 복원 거절 뒤 모바일이 계속 듣는다고 표시하던 **SA-APP2-001 / TD-APP2-02**는 별도 APP2 노트 및 실패 재현에 기록했다.
- 실제 경성/금화 입력 자료는 오케스트레이터 조사에서 없었다. AC-APP1b-03의 실방송 전후 점수/바로 등록 수는 이 골든 차등으로 대체하거나 PASS로 기록하지 않는다.
