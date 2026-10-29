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

## TD-APP1b-02 / 최종 게이트 후속: 같은 결과 재읽기로 이미 있는 품종 덮어쓰기

- 상태: **RESOLVED**, `blocker / domain / web / CONFIRMED` (기존 잠재 버그; 독립 재검증 완료, 아래 후속 결과).
- 기준: `DOMAIN_RULES R-17 8`, `D-V3-79`, `AC-V3-60 (d)` — 확정 순간의 글과 소비 경계를 유지하며, 뒤에 같은 번호가 다른 값으로 분명히 들린 경우만 R-22로 고친다. 빈 품종을 채우는 예외도 이미 품종이 있는 상품을 바꾸는 근거가 아니다.
- 최초 실패 HEAD: `1a8996eca7e5fdaf9cef19e4069ba69115607a66`. 전체 게이트의 기존 무작위 속성에서 seed `-1673070506`, path `6:9:11:17`로 9낱말 반례가 나왔다.
- 반례: `삼광색금 15번 7만 갑니다 라울 뿌리 뿌리 108번 라울`. 기존 틀 그대로 200ms마다 앞 낱말을 늘려 중간 결과로 보낸 뒤 같은 글을 최종 결과로 보낸다.
- 관찰: 8번째 중간 결과 뒤 `{no:15, name:'삼광색금', price:70000}` 등록 하나. 마지막 중간 결과까지 고침 0. 최종 결과와 3초 진행 뒤 `{id:'b1:15', changes:{name:'라울'}}`가 추가된다. 15번은 한 번뿐이며 등록 품종은 비어 있지 않다.
- 현행 고정 seed 재현: **10 통과 / 1 실패**, 로그 `../audit-controller-seed-current.log`. 고정 seed는 조사용 복제 시험에만 사용했고 원본 무작위 속성은 고치지 않았다.
- 통합 이전 비교: APP1b `BASE=d14ed3928f30033ec90d79ecd0bec497a4e9a5e4`의 controller 및 상대 import 의존 13파일을 `git show` 원문으로 테스트 임시 위치에 복원했다. 공유 `packages/core/src`, `packages/voice/src`는 BASE~실패 HEAD 변경이 없다. 똑같은 seed/path에서 **10 통과 / 1 실패**, 동일 반례와 품종 덮어쓰기를 확인했다(`../audit-controller-seed-baseline.log`). 따라서 **APP1b 통합이 만든 회귀가 아닌 기존 잠재 버그**다. 조사용 source/seed 복제 파일은 삭제했다.
- 영구 회귀: `tests/adversarial/v3/controller-stability.test.ts`에 TD-APP1b-02를 추가했다. 원래 property의 VOCAB·120회 무작위 실행·필터·단언은 그대로이며, 축소 반례를 그대로 넣어 등록 `15/삼광색금/70000` 하나·고침 0·되돌림 0을 고정한다. 추가 직후 **11 통과 / 새 회귀 1 실패**(`../audit-controller-deterministic-before.log`). 보호 골든·스펙·기대값·게이트 설정은 변경하지 않았다.
- 원인 영역/수정 요구: `apps/web/src/voice/controller.ts`의 `#runPicks` 및 굳은 앞말/최종 재읽기 소비 경계. 이미 소비한 동일 말이 다른 조각 시작 위치로 나타나도 새 R-22 고침으로 취급하지 않아야 한다. 실제 뒤에 새로 말한 같은 번호 정정·빈 품종 채우기는 계속 허용해야 한다. 추출 규칙을 바꾸거나 모든 품종 고침을 차단하는 수정은 요구하지 않는다.

### 수정 후 독립 재검증 (TD-APP1b-02)

- 수정 커밋: `bab85239` (`[dev:web] APP1b: 같은 음성 결과 재읽기에서 등록된 품종 보존`). `#instantChunk`의 전체 덩어리 재읽기에서 이미 품종이 있고 정정 표시가 없으면 이름을 변경하지 않는다. 등록 응답 전 `pending.after`에도 같은 규칙이 적용된다. 순수 추출기·보호 골든·기대값은 바꾸지 않았다.
- 고정 반례를 포함한 원본 `controller-stability.test.ts` 12시험 + 기존 APP1b/APP2 3파일 422시험: **4파일 434/434 통과** (`../audit-controller-fixed-domain.log`). 원래 무작위 property도 그대로 실행했다.
- 조사용 복제에 원래 실패 seed `-1673070506`만 주고 원래 `numRuns:120`과 모든 단언을 유지한 실행: **12/12 통과** (`../audit-controller-fixed-seed-full.log`).
- 추가 10 seed: `1`, `104729`, `20261030`, `314159265`, `1234567890`, `2147483647`, `-1`, `-104729`, `-987654321`, `-2147483648`. 원래 property 본문·VOCAB·120회·기대값을 그대로 복제하고 seed만 주입했다. **10개 모두 통과**, 함께 들어간 결정적 회귀 등11개를 포함해 복제 파일 **21/21 통과** (`../audit-controller-fixed-seeds.log`).
- 정확한 seed+축소 path `6:9:11:17` 재생의 제한: 등록 중복·되돌림·품종 덮어쓰기 단언은 모두 통과했으나, 복제 시험 끝의 활동량 단언 `total > 10`은 `total=9`라 실패했다. fast-check 4.10.2의 `pathWalk`는 축소 경로의 남은 stream을 재생하므로 원래 120회 무작위 전체 생성과 같지 않다. 이 실행을 전체 PASS로 세지 않았고 단언도 바꾸지 않았다. 실제 축소 입력은 영구 회귀로 따로 통과했고, 원래 seed의 전체 120회 실행 및 추가 10개 seed의 활동량 단언까지 통과한 것으로 구분한다.
- 개발자 증거(독립 실행 아님): 명시 품종 정정·빈 품종 보충 × 등록 응답 전/후를 포함한 관련 단위206/206 통과. 별도 spec-keeper의 기존 규칙 **UPHOLD** 확인.
- 조사용 seed 복제 및 BASE 의존 파일은 모두 삭제했다. 원본 무작위 trial/생성기/기대값·골든·검증 설정은 그대로다. 열린 도메인 blocker/major 없음. 전체 게이트·실방송 자료·실기기 HG 판정은 별도다.
