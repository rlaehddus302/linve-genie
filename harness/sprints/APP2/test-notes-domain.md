# APP2 독립 도메인 검증

- 실행일: 2026-10-30. 역할: test-domain. 제품 수정은 오케스트레이터가 수행했다.
- 검증 명령: `pnpm exec vitest run --config vitest.adversarial.config.ts tests/adversarial/app1b-reading-parity.test.ts tests/adversarial/app2-resume-rejection.test.ts tests/adversarial/app2-server-ble.test.ts` — 422/422 통과.

## TD-APP2-02 / SA-APP2-001 — RESOLVED

- 심각도: major. 분류: domain. 영역: web(모바일). 관련: AC-APP2-10·11·22, AC-APP1b-16, 복원 거절 계약.
- 원인: `apps/mobile/src/lib/voice-session.ts`의 `voice.error`가 `RESUME_INVALID`도 오류 문장만 설정했다. 서버는 controller를 이미 dispose했으므로 이후 발화는 처리되지 않지만 앱의 on/마이크/context 타이머는 살아 있어 판매자가 상품 누락을 알아차리기 어려웠다. 거절된 토큰도 다음 hello에 남았다.
- 재현: `tests/adversarial/app2-resume-rejection.test.ts`. 실제 모바일 VoiceSession을 켜고 카드/복원 토큰을 받은 뒤 ready → sessionReady:false → RESUME_INVALID를 보낸다. 수정 전 `getView().on === false` 기대가 true로 실패했다.
- 수정 확인: 캡처 중단(audio state off/stop 호출), 앱 on=false 및 다시 켜기 가능한 stopped 상태, 안내 문장, 기존 카드 보존, 다음 hello에서 거절된 토큰 없음이 모두 통과했다. 상태 표시의 stopped는 실제 캡처 off와 구분해 검사한다.
- 시험 로딩: Expo 소스는 앱 자체 bundler tsconfig로 검사하므로, NodeNext인 적대 시험에는 URL 기반 동적 import와 명시한 전송 경계 타입으로 실제 실행 모듈을 로드한다. 제품 읽기를 시험 구현으로 바꾸지 않았다. root 타입/ESLint도 통과한다.

## 서버 라벨 → B1 전송

기존 추가 적대 시험 `tests/adversarial/app2-server-ble.test.ts`를 함께 재실행했다. 실제 HTTP 서버의 bitmap을 native B1 어댑터로 보내 모의 B1이 해석한 점과 비교하고, 흰 마지막 줄·완료 한 번·완료한 시도의 그림 재조회404를 검사해 통과했다. `jobBitmap`은 판매자 범위·현재 출력 기기·미완료 시도·해당 PRINTING 작업을 트랜잭션 안에서 검사하고 claim 시점의 데이터/템플릿을 사용한다. 다른 판매자·기기·지난 시도 차단은 서버 단위시험에도 있다.

실제 휴대폰 백그라운드 캡처, native 쿠키 저장소, 실물 B1 연속30장 인쇄는 이 검증의 증거가 아니다. HG-APP2 항목은 실제 기기에서 별도로 확인해야 한다.

열린 major/blocker 도메인 지적: 없음. 전체 게이트·스펙 감사·실기기 HG 완료를 이 부분 검증만으로 선언하지 않는다.
