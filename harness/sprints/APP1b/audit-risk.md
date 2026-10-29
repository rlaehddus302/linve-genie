# APP1b·APP2 통합 위험 감사

## 최종 자동 검증 판정 (2026-10-30)

코드·시험 HEAD `b14815ea783b4616a1c8a4777381757bd516965d`에서 단일 전체 `pnpm verify` **7/7 PASS(exit0)**, E2E **1,677/1,677**(실패·skip·flaky·재시도·러너 오류0), 단위9,084·골든964·적대2,925 통과를 확인했다. 독립 spec-auditor가 실행 결과와 개별 E2E JSON을 대조했으며, 보호 경로 두 BASE도 각각 exit0였다. 오케스트레이터가 이후 단독 실행한 `pnpm perf`는25/48/2개 모두 통과(exit0)했다. 근거는 `work/verify-release.log`, `work/verify-release-e2e.json`, `work/verify-release-protected-*.log`, `work/perf-release.log`다.

열린 CONFIRMED blocker/major는 없다. TE-APP1-001~013·SA-APP2-001·TD-APP2-02·TD-APP1b-02와 관련 RA는 수정·독립 재검증·이번 전체 실행 근거로 해결된 상태다. 마지막 모의 VAD 말끝 보완은 원래 단언과 제품 안전 규칙을 유지했고 실제 PCM 시험도 재시도 없이 통과했다. 자동 구현·통합 범위는 완료로 기록할 수 있다. **HG-APP1·HG-APP2와 AC-APP1b-03은 미확인**이며 실제 ASR 지연1.5초·현장p95·실방송 정확도·네이티브/B1 실물 검증을 PASS로 대신하지 않는다.

아래는 당시 판단과 수정 근거를 보존한 이전 감사 기록이다. 아래의 게이트 대기·미커밋 실패·열린 지적 표기는 이 최종 자동 검증 판정으로 갱신되며, 당시 증거 자체는 삭제하지 않는다.

## 이전 감사 기록

2026-10-30. 독립 `risk-auditor`가 제품 코드를 읽기 전용으로 검토하고, 오케스트레이터가 전달받은 결과를 기록했다. 감사자는 시험 실행·제품 수정·커밋을 하지 않았다.

## 최종 판정

발견한 CONFIRMED 2건은 수정과 재검토를 거쳐 모두 RESOLVED다. 이번 감사에서 열린 blocker/major는 없다. 전체 게이트·실제 기기 검증의 완료 여부는 sprint report에서 따로 판정한다.

| ID | 최초 심각도·근거 | 재현 및 수정 | 재검증 |
|---|---|---|---|
| RA-APP1b-001 | blocker·개인정보, D-APP-05·AC-APP1b-16 | 브라우저 getUserMedia가 기다리는 중 끄면, 서버 종료 응답 전 늦게 도착한 스트림으로 캡처가 다시 시작될 수 있었다. `transport.ts`에서 사용자 중지·terminal 종료는 wanted를 취소하고, 캡처 세대로 gUM/worklet 완료·오류·PCM 콜백을 격리한다. 재연결과 offline도 이전 캡처를 정리한다. | `apps/web/test/voice-transport.test.ts` 7개: pause/AUTH/ENDED/OTHER_DEVICE 뒤 늦은 gUM, worklet 대기 중 중지, 재연결 뒤 옛 응답, offline. 트랙 stop·문맥 정리·노드/PCM 미생성 단언. RESOLVED |
| RA-APP1b-002 | major·스펙, D-APP-12·AC-APP1b-11·16 | 모바일 자동 효과를 받을 때만 10초를 검사해 scope/full 조회가 늦어지면 만료 후 쓰기가 가능했다. `VoiceSession`이 효과별 검사 함수를 넘기고 `createVoiceEffects`는 실제 POST 직전에 세션/연결 세대·on·ready·listening 및 최초 쓰기의 말 끝 시각을 다시 검사한다. 늦음/끊김은 수동 확인으로 남긴다. 이미 보낸 같은 요청 번호의 재시도는 시각만 면제하고 연결 유효성은 계속 확인한다. | `apps/mobile/test/remote-voice.node.test.ts`의 register/writeSms/fixRecent 조회 12초 지연과 register 조회 중 reconnecting 4개. POST 0·실패 설명·등록 카드 복원 단언. RESOLVED |

전송 7개 + 모바일 원격 16개 + 실제 서버 통합 1개 = **24/24 통과**를 개발 담당자가 실행했고, 감사자는 시험 소스·실행 결과 및 최종 POST 전 검사 조건을 확인했다. 첫 단위 재현에서 fixRecent 시험 상품 형식을 바로잡은 뒤 세 가지 쓰기 경로가 모두 검사 함수를 통과하는지 검증했다.

## 다른 검토 경계

- 인증·판매자 격리·보조자 차단, 복원표 서명/판매자·방송·기기 범위/크기/만료, 문자찜 요청 번호 보존, bitmap 소유권·현재 출력 시도 고정에서 추가 blocker/major를 발견하지 못했다.
- 기존 E2E 경계 이전은 AC 대응표와 결과 보존 단언으로 검토했다. 자동 시험 통과는 전체 verify 결과가 있어야 확정한다.
- 실제 휴대폰의 마이크/쿠키/백그라운드, B1 실물, 실방송 녹음 정확도·장시간 지연은 이 읽기 감사로 통과 처리하지 않는다.

참고: 보고서와 스펙 문서를 역할별 커밋으로 나누는 과정에서 최근 로컬 커밋 ID를 다시 만들었으나 최종 Git tree와 제품/시험 파일 내용은 동일하게 검증했다. 게이트 코드·기대값을 바꾸어 권한 검사를 우회하지 않았다.
## 실제 서버 AudioWorklet 추가 읽기 감사 (2026-10-30)

`dca0959b` 및 신규 served E2E를 독립 위험 감사자가 읽었다. PCM 계산은 기존과 같고 전역 참조만 명시화했다. Vite가 해시를 붙인 동일 출처 JS 자산으로 제공하며 해당 자산만 inline을 금지한다. D-I4-09의 켜기 전 다운로드/SW 선행 저장 제외를 유지하고 CSP 파일·허용 출처를 바꾸지 않았다. addModule await 전후의 captureGeneration/wanted/context 검사와 실패 시 트랙·문맥 종료도 그대로다. 새 blocker/major 없음. 최초 AbortError의 CSP 인과는 단정하지 않는다. 감사자는 시험을 실행하거나 파일을 수정하지 않았으며 실제 @served6/6·Cohere 브라우저 관통 증거는 APP1 시험 기록에 따로 있다.

## 마이크 기본값·모의 VAD 시각 추가 읽기 감사 (2026-10-30)

`2447e3a3`는 `getUserMedia`에서 모노만 요청해 D-APP1-10을 복원한다. 캡처 세대·취소·종료 방어는 유지하며 기존 단위에 정확한 인자 검사를 더했다. 시험 도우미의 정상 말끝에서 400ms를 빼는 것은 실제 segmenter의 최소 쉼과 뒤 쉼을 버리는 계약에 맞는다. 제품의 미래 시각·10초 초과 판정, `late:true`의 12초 진행·11초 오프셋, 수동 카드·자동 쓰기0 단언과 서버 late/missing/future 회귀는 바꾸지 않았다. 독립 위험 감사에서 새 blocker/major나 시험 약화 없음. 감사자는 파일·시험·빌드를 실행하지 않았으며, 1ms 미래 trace 자체는 test-e2e의 직접 판독 증거로 구분했다. 반복10/10·관련16/16과 최신 실제 Cohere 재검증은 APP1 시험 기록에 있다.

## TD-APP1b-02 품종 보존 수정 읽기 감사 (2026-10-30)

`bab85239`의 억제는 같은 덩어리에서 이미 등록한 번호·비어 있지 않은 품종·정정 표시 없음의 전체 덩어리 fallback에 한정된다. 분명한 후속 같은 번호 조각, 새 덩어리, 빈 품종, 명시 정정, 가격 처리와 안전 문턱은 보존한다. pending ACK에도 같은 값을 저장하여 즉시/지연 경로가 일치하며 인증·취소·폐쇄 처리도 변경하지 않았다. 기존 무작위 성질 시험은 유지하고 결정적 회귀와 ACK 전후6사례를 추가했다. 독립 위험 감사의 새 blocker/major 및 시험 약화 없음. 감사자는 시험·파일·빌드·커밋을 실행하지 않았다. 독립 도메인434/434·원래seed 전체120회·추가10seed 결과와 축소 경로 활동량 단언의 재생 제한은 `test-notes-domain.md`에 구분한다.
