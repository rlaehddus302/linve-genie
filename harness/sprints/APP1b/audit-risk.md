# APP1b·APP2 통합 위험 감사

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
