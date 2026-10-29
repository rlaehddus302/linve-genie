# APP1b·APP2 통합 스펙 재감사

2026-10-30. 검토 기준 HEAD `d047e8df`와 그 뒤 작업 중인 E2E 이행. 스펙 관리자로 아래 해석을 문서화한 뒤 제품 코드를 읽기 전용으로 재검토했다. 제품·코어·골든·시험 코드는 수정하지 않았다. 커밋과 전체 검증은 오케스트레이터가 담당한다.

**판정: 이번 재감사에서 추가로 확인된 제품 blocker/major 없음. 전체 완료 판정은 보류.** 전체 `pnpm verify`가 실행 중이고 보호 경로 게이트는 아직 커밋되지 않은 변경 때문에 실패했다. E2E 노트에 열린 제품 지적도 최신 재시험 결과가 필요하다. 이 문서는 해당 미완료 항목을 PASS로 바꾸지 않는다.

## 판정과 추적성

| 대상 | 판정·보존할 결과 | 구현·검증 근거 |
|---|---|---|
| D-APP1b-05, AC-APP1b-20·27, AC-V1-31 | **UPHOLD**. 한 판매자 한 읽기는 상품과 문자찜 모두에 적용한다. 둘째 OTHER_DEVICE·마이크 시작 없음, 첫째 입력별 문자찜/이벤트 하나·양쪽 SSE, 둘째의 새 요청 번호 `voice:true` HTTP는 409 VOICE_REPEATED. 끝자리 유무·구매자 수·대기 없음 단언 유지 | `apps/server/src/voice/relay.ts`, `apps/server/test/app1-relay.test.ts:94`, `tests/e2e/v1/attacks.spec.ts:30`, `harness/sprints/APP1/test-notes-e2e.md` 대응표 |
| D-APP1b-08, AC-APP1b-26 | **UPHOLD**. 효과 도착 전 WS 단절은 HTTP 0회가 정상. 남은 카드/실패 안내/수동 버튼·자동 기한 중단, 복귀 자동 HTTP 없음, 명시 넣기 뒤 최초 HTTP 한 번. 이미 보낸 HTTP의 응답 손실은 별도 시험에서 최초 요청 번호 재사용 | `apps/web/src/voice/remote.ts`의 `onConnectionLost`·`stopSms`·`smsCountdown`, `apps/web/test/voice-remote.test.ts:98`, `tests/e2e/v1/attacks.spec.ts` 끊김/응답 손실 두 사례. E2E 최종 결과는 부모 게이트에서 확인 |
| SA-APP2-001 / TD-APP2-02 | **RESOLVED**. RESUME_INVALID 뒤 마이크와 주기 전송 종료, on=false/stopped, 카드 보존, 실패 토큰/대기 명령 제거, 다음 hello에서 토큰 생략. 빈 토큰은 안내와 null 처리 | `apps/mobile/src/lib/voice-session.ts:433`, `tests/adversarial/app2-resume-rejection.test.ts:43`, `apps/mobile/test/remote-voice.node.test.ts:63`. 독립 test-domain 422/422 재실행 기록 |
| 모바일 바로 등록 설정 | 스펙 일치. 마이크 켜기 전 설정도 기기에 저장하고 다음 hello/새 앱에 적용. 저장 직렬화·최신 사용자의 선택 유지, 실패 안내. 설정만 바꿔도 마이크/읽기 소켓을 열지 않음 | `apps/mobile/src/lib/voice-session.ts:135`, `apps/mobile/src/lib/voice-preferences.ts:8`, `apps/mobile/test/remote-voice.node.test.ts:32` 및 늦은 저장 효과 시험. 모바일 최종 74/74 기록 |
| 모바일 꺼짐 countdown | 스펙 일치. 실제 listening일 때만 상품/문자찜 남은 초를 표시하고 꺼진 뒤에는 폼/수동 버튼을 보존 | `apps/mobile/src/screens/console/RemoteVoicePanel.tsx:17`, `apps/mobile/test/remote-voice-panel.test.tsx:9`. 화면 시험에서 끄기 뒤 두 countdown 없음과 수동 버튼 존재를 함께 확인 |
| TE-APP1-007, V3 R66 등록 직후 고침 | 수정 방향은 스펙 일치. DB 반영만으로 다음 고침을 보내지 않고 기존 noteVoiceRegistered의 상품 ID·번호·이름·가격이 맞을 때 진행. 실패/30초 만료는 확인 실패 안내, 고침 효과 없음. 종료 때 타이머/대기 정리 | `packages/voice-session/src/server.ts:128`·`:141`·`:247`, `packages/voice-session/test/server.test.ts:24`의 ack/failed/timeout 및 잘못된 ID. `tests/e2e/v3/audit.spec.ts:248`의 등록 10,000원→고침 15,000원 기대는 그대로. 브라우저 재시험 확정 전 TE-APP1-007을 닫지 않음 |

## APP1b 기준별 근거 연결

| AC | 구현·시험 | 증거의 범위 |
|---|---|---|
| 01·02·14 | `packages/voice-session/src/server.ts:33`, `tests/adversarial/app1b-reading-parity.test.ts:69`, `packages/voice-session/test/server.test.ts:126` | 보호 골든 원래 out 419개 보존과 서버/이전 controller 전체 snapshot·등록/고침 효과 차등. 독립 420시험 통과. 아래 입력 구분 적용 |
| 03 | `harness/sprints/APP1b/test-notes-domain.md` | 경성·금화 원본 재생 자료 없음. 전후 점수·바로 등록 수 미확인 |
| 04·15·16 | `apps/server/src/voice/reading.ts:58`, `apps/web/src/voice/remote.ts`, `tests/e2e/app1/server-voice.spec.ts:38` | 375px PCM→실제 relay/읽기→등록, 켜기 전 자원 없음·끄기/장애 정리. 전체 E2E 결과 대기 |
| 05 | `apps/web/src/voice/remote.ts`, `apps/mobile/test/thin-client.node.test.ts`, 웹 빌드/얇은 클라이언트 검사 | 서버 읽기/사전을 기기 실행 경로로 되돌리지 않음. 최종 빌드 게이트 결과와 함께 판정 |
| 06 | `apps/server/test/app1-relay.test.ts:271`, `tests/e2e/v3/audit.spec.ts` | Chrome 같은 인증 WS/서버 읽기, 기존 PC 발화 기대 보존 |
| 07·08·21 | `apps/server/src/voice/aliases.ts`, `apps/server/test/app1b-aliases.test.ts`, `tests/e2e/v2/chunks.spec.ts` | 계정 우선 병합·200개 LRU·흔한 말 제외·격리·명시 지우기. 최신 E2E 결과 대기 |
| 09·10·13 | `apps/server/src/voice/relay.ts:155`, `packages/voice-session/src/wire.ts:102`, `apps/server/test/app1-relay.test.ts:109`·`:193`·`:253` | 원문/결과 DB·로그 미보관, 인증·Origin·소유권/보조자, 바이트/명령 한도. 별칭만 명시 저장 |
| 11·12 | `apps/web/src/voice/remote.ts`, `apps/mobile/src/lib/voice-session.ts:453`, `apps/web/test/voice-remote.test.ts:149`·`:167`, `packages/voice-session/test/server.test.ts:176` | 효과 ID/세션 구분·늦거나 미래/누락 시각 자동쓰기 차단·수동 확인 허용 |
| 17·18 | `apps/server/src/voice/reading.ts:72`, `tests/e2e/i4/voice-history.spec.ts:26` | 서버 실제 이력 공급자에 10일/현재·리허설 제외·실패를 주입/관찰. 브라우저의 폐기된 이력 요청 실패로 대체하지 않음 |
| 19·20 | `harness/sprints/APP1/test-notes-e2e.md`, `tests/e2e/i4`·`i5`·`v1`·`v2`·`v3` | 옛 AC/새 AC·전제/단언/주입점 대응표 확인. PC Chrome과 모바일 LG 구분. 전체 E2E 및 열린 TE 지적 재시험 대기 |
| 22 | `apps/web/test/voice-remote.test.ts:157`, `tests/e2e/i4/voice-cards.spec.ts` | 서버 검증 DTO 수동 사용·최초 요청 번호·기존 HTTP/outbox 경로. 기기 추출 fallback 없음 |
| 23·24·25 | `packages/voice-session/src/resume.ts`, `packages/voice-session/test/server.test.ts:75`, `apps/web/test/voice-remote.test.ts:125`, 모바일 remote/server-integration 시험, TD-APP2-02 | 메모리 복원·자동 기한 제거·원래 SMS 요청 번호·마이크 없는 임시 명령 세션/idle 종료·복원 거절 정리 |
| 26·27 | 위 판정 표, `tests/e2e/v1/attacks.spec.ts` | 기능 추가가 아니라 기존 V1 중복/오프라인 안전 의미의 서버 이전 기준 명확화 |

골든 수를 과장하지 않는다. 원래 out은 추출228+등록124+문자찜67=419개다. 텍스트361개는 원래 문장을 실제 `onResult()`에 넣었다. 구조화된 same-number58개는 원래 out 직접 검증과 상품/찜/최근 등록/다른 기기/자동 설정을 주입한 합성 발화 차등을 각각 수행했다. `heard.nameFrom` 등 구조화 속성을 서버 공개 입력으로 직접 보낸 시험은 아니다. 골든 원문/기대값 또는 비교할 snapshot/효과를 줄이지 않았다. 실방송 자료 검증은 이 차등으로 대체하지 않는다.

## 게이트와 열린 지적

- `pnpm verify`: 부모가 `../verify-final.log`로 실행 중. 이 재감사에서 중복 실행하지 않았다. 완료 출력이 아직 없으므로 전체 PASS/최종 개수를 기재하지 않는다.
- 보호 경로: `node scripts/harness/check-protected.mjs d14ed3928f30033ec90d79ecd0bec497a4e9a5e4` 실행. `../spec-final-protected-round2.log`의 결과는 **실패 1건: 커밋 안 된 변경**. 이번 문서·E2E 이행 및 진행 중 웹 수정이 포함된다. 역할별 커밋/금지 패턴 추가 위반은 없었다. 하네스상 gate blocker이며 부모 커밋 뒤 재실행으로 해제해야 한다.
- `git diff --check` 통과. BASE 대비 `packages/core` 및 `tests/golden` 변경 없음.
- 독립 도메인 3파일 422시험 통과, 모바일 17파일 74시험 통과는 각 역할 노트에서 확인했다. 부분 실행 결과를 전체 게이트 결과로 대신하지 않는다.
- `resolvedIds`: `SA-APP2-001` (`TD-APP2-02`), UX의 `U-APP2-001`·`U-APP2-002`는 독립 UX 재검증 기록에서 해결 확인.
- E2E 기록상 `TE-APP1-001`~`005`, `007`~`010`은 수정 또는 재시험 중이며 최종 실행 결과가 필요하다. `TE-APP1-006`은 해당 사례 통과 기록. 같은 지적을 새 SA ID로 중복 생성하지 않는다. 특히 R66 순서 수정의 소스 검토만으로 `TE-APP1-007`을 해결 확정하지 않는다.

## 미확인 항목의 구분

- **실방송 재생 정확도:** 경성·금화 `.live-replay` 원본을 찾지 못했다. AC-APP1b-03 전후 점수/바로 등록 수 미확인. 실제 Whisper 합성 한국어 PCM 한 문장의 WS→서버→DB 성공은 연결 증거이며 판매 현장 정확도 증거가 아니다.
- **네이티브 기기:** iOS/Android Hermes export 및 모듈 연결 검사는 설치·권한·native 쿠키 저장소 공유·외부 브라우저 로그인·백그라운드 5분·화면 잠금/복귀 측정을 대신하지 않는다. HG-APP2, SDK/서명/EAS/실제 기기 관련 항목은 미확인.
- **B1 실물:** 실제 서버 bitmap→모의 B1 점/프로토콜·완료 한 번은 독립 검증했으나 실제 Android/iPhone 연결·네 변/한글·30장 연속·재연결은 미확인.
- **화면과 성능:** 독립 UX가 Expo web production 화면을 실제 로컬 서버에 연결해 375/1440px로 재검토했고 17개 최종 캡처에서 16px/44px/넘침 규칙을 확인했다. 이는 native 화면·접근성 도구의 실기기 검증을 대신하지 않는다. 실시간 1초/복귀 3초, 장시간·동시 흐름 처리 등 성능 목표는 이번 재감사에서 측정하지 않았고 `pnpm perf`/HG 결과가 필요하다.

## 추가 변경 읽기 감사 (2026-10-30, 609683bb..327c9fff)

독립 spec-auditor가 파일 수정/시험 실행 없이 소스·기존 결과 로그를 대조했다. 추가 CONFIRMED blocker/major 없음. 서버 라벨 preview/출력의 같은 renderer·저장된 perPage(선택3/3), 원본 카드·실제 상품을 확인하는 등록 ACK 대기 해제(충돌/R66/R7 3/3), ENDED·새페이지 동의 계약·PC8행/44px(관련9/9), 서버 실제 이력 hold/release(3/3)의 원래 단언을 유지했다. RA-APP2-003·TE-APP1-011·012 해결 확인. Cohere 의존성 보완과 실제 합성 PCM→DB1건은 실행 증거이며, 실방송 정확도·통계적p95·HG·전체verify/perf를 대신하지 않는다. 최종 전체 게이트 판정은 대기 상태다.

## Additional read-only audit: 327c9fff..fcf6ee62

The independent spec auditor confirmed RA-APP2-004 and TE-APP1-013 resolved: single-key label lookup preserves the original buyer, current product/claim amount and cancellation/succession contracts; one captured state prevents mixed snapshots. The same-origin AudioWorklet preserves PCM calculations, cancellation guards, strict CSP and D-I4-09 lazy loading. Existing label 4/4, served 6/6 and PCM/lazy 3/3 logs were inspected. The real Cohere browser evidence confirms POST1/DB1, ended tracks, closed sockets and zero CSP violations. No new confirmed blocker/major was found. The auditor changed no files and ran no tests. Final full verify/performance and human hardware/broadcast gates remain separate.

## TD-APP1b-02의 기존 규칙 판정 (2026-10-30)

최종 무작위 적대 시험에서 같은 음성 결과를 재읽으며 이미 등록한 삼광색금을 라울로 덮는 사례가 나왔다. test-domain은 현행과 APP1b BASE의 controller·상대 의존13개를 각각 실행해 같은 seed/축소 입력에서 동일 실패를 확인했다. 기존 잠재 버그이며 통합 회귀로 분류하지 않는다.

spec-keeper 판정은 **UPHOLD**다. D-V3-79·R-17 §8·AC-V3-60(d)는 등록 시점의 소비 경계를 고정하고 뒤 재읽기로 등록 값이 바뀌지 않도록 이미 요구한다. 이 입력은 새 15번 발화·명시 정정이 없고 품종도 비어 있지 않아 R-22 빈 품종 채우기가 아니다. `fixes=[]`를 유지하는 수정은 APP1b 동등성 요구와 양립하며 새 보호 문서·골든 변경은 필요 없다. 명시 정정·빈 품종 채우기·다른 번호 안내와 D-APP-21의 실제 재생 검증 의무는 보존한다. 판정자는 파일·시험·커밋을 수행하지 않았다. 제품 수정과 독립 재검증 결과는 후속 기록으로 확정한다.

수정 후 독립 spec-auditor가 `bab85239`와 `162def5e`를 읽고 새 blocker/major·스펙 이탈·시험 약화 없음을 확인했다. 같은 덩어리의 등록 번호·품종 있음·정정 없음에만 이름 억제를 적용하고 pending ACK도 동일하며, 다음 덩어리·명시 정정·빈 품종·가격과 후속 조각은 보존했다. 원래 property의 생성기·전제·120회·단언은 그대로다. 직접434/434·원seed 전체12/12·최신 실제 Cohere JSON을 대조했다. 합쳐진 조사 로그의32통과/1실패와 추가10seed 파일21/21은 구분하며, 축소 경로의 활동량 실패를 전체PASS로 합치지 않는다. 파일·시험 실행은 하지 않았다. 최종 전체verify/perf/보호게이트는 별도 확정한다.

## 실제 PCM 시험의 모의 VAD 말끝 감사 (2026-10-30)

HEAD `4d0f510a` 전체 실행은 6/7단계 통과이며 E2E는 1,676통과/1실패(skip/flaky0)였다. `server-voice.spec.ts`의 별도 모의 일꾼이 받은 PCM 끝까지를 말끝으로 보내 실제 VAD의 400ms 쉼을 누락했다. trace의 `captureAt + endMs = 1793307366257`은 서버 읽기 시각 `1793307366247`보다 10ms 미래였다. 입력은 도착했고 제품은 기존 방어대로 자동 등록 없는 확인 카드를 남겼다. 이는 최종 PASS로 처리하지 않으며 원본 로그·JSON·trace를 보존한다.

독립 spec-auditor는 해당 시험의 `endMs = Math.max(0, frames * 100 - 400)` 한 줄 수정을 읽고 `segmenter.py`의 400ms 쉼·뒤 쉼 제외 계약과 일치함을 확인했다. 실제 getUserMedia/AudioWorklet/WS·PCM 크기·최소30틀·동의·15번/20,000원·POST 정확히1회·끄기 뒤 흐름 종료·늦은16번 쓰기0·17번 손입력과 기존 timeout/모든 단언을 보존한다. 제품의 미래/10초 초과 방어는 변경하지 않았다. 새 blocker/major·스펙 이탈·시험 약화는 없으며, 감사자는 파일 수정·시험 실행을 하지 않았다. test:e2e의 반복 결과와 새 전체 게이트 결과는 별도로 확정한다.
