# S01 리포트 — 코어 I: 파서 (채팅·금액·빠른 입력)

**결과: FAIL** — 수정 라운드 2회 뒤에도 `pnpm verify`가 실패한다. golden 341/366(불일치 25), adversarial 실패 27. 원인은 하나다. D-035(LOOSE 끝 신호)가 라운드 2 개발 커밋 뒤에 정해져서 아직 구현되지 않았다.

## 영역별로 만든 것

### core (dev-core)
- `@livejjim/core` 파서 4종: `parseChat`(R-3, D-028), `parseAmount`(R-14), `parseKoreanNumber`(R-15), `parseQuickInput`(R-16, D-030). 모두 순수 함수이고, 어떤 문자열에도 예외를 던지지 않는다.
- 설정 기본값은 `packages/core/src/settings.ts`(`DEFAULT_SETTINGS`/`resolveSettings`) 한 곳에만 둔다.
- 역추적 정규식 없이 손으로 짠 스캐너다. 10,000자 적대 입력을 2.6ms에 처리한다.
- 라운드 1: U+FEFF 정규화, 빠른 입력 금액 조각 거부(`isSplitAmount`), LOOSE 범위를 메시지 전체로 판정.
- 라운드 2: D-032(단위 뒤 한글 일의 자리 → null), D-033(꼬리 이모지 허용 목록 83자), D-034(번호 개수 상한 5).
- 커버리지는 라인·분기 100%다. 라운드 2 시점에는 verify가 통과했다(golden 333/333, 적대 496/496).

### test (domain)
- `tests/adversarial/s01/`: chat-grammar, invisible-chars, tail-emoji-allowlist, number-cap, amount-quick-input, korean-digit-after-unit, parser-timing, loose-end-signal.
- 라운드 2(8884fbe)에서 `loose-end-signal.test.ts`를 추가했다(D-035 신호 글자 전체, 속성, ZWJ 조합). 27건 실패, 회귀 25건 통과.

### spec
- DOMAIN_RULES v0.1.4(R-3 세부·LOOSE '끝 신호', R-14·R-15·R-16).
- 골든은 103 → 265 → 333 → 366사례로 늘었다(마지막 33사례는 D-035).

## 남은 blocker / major

| ID | 심각도 | 내용 |
|---|---|---|
| GATE-S01-VERIFY | blocker | `pnpm verify` FAIL. golden 불일치 25(chat 'LOOSE 끝 신호'), adversarial 실패 27(loose-end-signal). AC-S01-04 미충족 |
| SA-S01-008 | blocker | `chat.ts:261`에 D-035 끝 신호 검사가 없다. LOOSE에서 '15 ❌'·'15번 😭'·'15 ❓ 남았나요'가 주문으로, '15 취소 번복할게요'가 취소로 처리된다 |
| TD-S01-005 | major | 원인이 같다. 구현할 때 걸리기 쉬운 부분 5가지: DI 전체, U+3164 먼저 건너뛰기, (나) 자리, 꼬리·취소 뒤의 `번`, 공백 없을 때만 붙은 숫자 |
| RA-S01-011 | major | 원인이 같다. `chat.test.ts:130`의 '판단 대기' 주석이 이제 맞지 않는다 |

**고칠 방향(위 넷을 한 번에 해결):** pickPart 뒤 LOOSE일 때만 두 자리에서 검사한다. 두 자리는 (가) 고른 부분의 end, (나) parts 중 가장 큰 end다. 각 자리에서 공백·피부색·`\p{Default_Ignorable_Code_Point}`를 건너뛴 첫 글자를 본다. 기준은 주문이면 CLAIM_TAIL, 취소면 CANCEL_TAIL이다. 상한·multiNumber보다 먼저 보고, 더 짧은 부분으로 물러나지 않는다. 참조 구현(약 25줄)은 golden 366/366과 적대 테스트 전부를 통과했다.

## 자율 결정 · 사용자 확인 필요 사항

결정은 모두 non-blocking이고, 에스컬레이션은 없다.

| ID | 질문 | 적용 |
|---|---|---|
| D-028 | R-3이 정하지 않은 채팅 사례 | 오인 주문을 막는 쪽으로 좁힘 |
| D-029 | 애매한 금액·수사 | 애매하면 null |
| D-030 | 빠른 입력 범위·가격 묶음·슬래시·하한 | 1..maxNumber, 끝에서 가장 긴 금액 묶음, 100원 하한 |
| D-031 | Host 없는 HTTP/1.0 /health | 400 JSON 유지. TD-S00-021 닫음(techDebt 제거는 오케스트레이터 몫) |
| D-018-timing | 방송자 본인 채팅 무시 | S02로 이동(G-ENG-005) |
| D-032 | 만오·천오·백오만 | null |
| D-033 | 꼬리 이모지 범위 | 허용 목록 83자 |
| D-034 | 번호 개수 상한 | 서로 다른 번호 6개 이상이면 언급 |
| D-035 | LOOSE 끝 신호 | 신호가 오면 언급 (**미구현**) |

**spec-keeper(사용자) 확인 필요:**
- 금액 조각 규칙(`isSplitAmount`)을 R-16 4와 골든에 넣을지(SA-S01-006, RA-S01-009, TD-S01-011).
- LOOSE 범위 판정에 5자리 이상 숫자를 넣을지(SA-S01-007, TD-S01-012).
- 끝 신호 목록을 넓힐지: 단위어 개·원(RA-S01-006), 목록 밖 물음표·반각 자모·문장부호(TD-S01-018).
- 번호 개수 상한을 (나) 부분 기준으로 셀지(TD-S01-017).
- 시청자별 확정 속도 상한을 R-4에 둘지(RA-S01-010, S02 전).
- AC-S01-04 합계를 366으로 고치고 추적 표에 D-035 행을 추가할 것(SA-S01-009).

## minor / nit 백로그 (backlog.yaml techDebt에 추가함)

- TD-S01-016 (minor): ZWJ 조합 '15❤️‍🩹'가 LOOSE 주문이 된다. D-035로 함께 해결된다
- TD-S01-017 (minor): '1 2 3 4 5 6,'이 LOOSE에서 [1..5] 주문이 된다
- SA-S01-009 (nit): AC-S01-04 합계와 추적 표가 오래된 값이다
- RA-S01-006 (minor): '3 개 남았나요?'·'15 100원이에요?'가 LOOSE 주문이 된다
- SA-S01-006 / RA-S01-009 / TD-S01-011 (minor): 금액 조각 규칙이 스펙에 없다
- SA-S01-007 / TD-S01-012 (minor): '15 10000원이에요'가 LOOSE 주문이 된다
- RA-S01-005 (minor): '010 1234 5678'이 큰 maxNumber에서 주문이 된다
- RA-S01-007 (minor): 알 수 없는 price.unit 값이 ×1000으로 처리된다
- RA-S01-008 (minor): U+200A 같은 좁은 공백이 숫자를 가른다
- TD-S01-004 (minor): NFD나 보이지 않는 글자가 낀 '취소'를 놓친다
- TD-S01-006 (minor): '15 블루 이천'이 2,000원으로 등록된다
- TD-S01-007 (minor): '150.000'이 WON에서 150원으로 등록된다
- TD-S01-008 (minor): 빠른 입력 가격에 상한이 없다
- TD-S01-009 (minor): '10/15'·'1,500,28'이 STRICT 주문이 된다
- TD-S01-010 (nit): R-16 1과 5가 충돌하고, AC-S01-44가 '번' 품종에서 R-16 3과 충돌한다
- RA-S01-010 (minor): 연속 메시지로 대량 확정이 가능하다(S02)
- TD-S01-018 (minor): 끝 신호 목록 밖의 같은 뜻 글자가 LOOSE 주문이 된다
- TD-S01-019 (nit): AC-S01-17 속성 문장이 규칙 문장과 어긋난다

## 추적성 표

| 참조 | 구현 | 테스트 · 상태 |
|---|---|---|
| ORD-01 | chat.ts, text.ts | golden chat 153/178, 단위·적대 5종. **D-035 25건 불일치** |
| PRD-01 | quick-input.ts, amount.ts | quick-input 46/46, amount 142/142 (통과) |
| AC-S01-01 | index.ts, settings.ts, parser.ts | core-api, settings (통과) |
| AC-S01-02 | parse/*.ts | parser-robustness (통과) |
| AC-S01-03 | chat.ts 스캐너 | robustness, parser-timing, 시간 9종 (통과) |
| AC-S01-04 | core-adapter.ts | golden 341/366 **FAIL** (AC 문장의 333은 오래된 값) |
| AC-S01-10~16 | chat.ts scanClaim·tail·range·multiNumber·cancel·언급 | 통과 |
| AC-S01-17 | pickPart (끝 신호 미구현) | 문서 14·15 불일치 25, 적대 27 실패 **FAIL** |
| AC-S01-18 | normalizeText | 통과 |
| AC-S01-19 | MAX_CLAIM_NUMBERS | 통과 |
| AC-S01-20~22 | amount.ts | 통과 |
| AC-S01-30 | korean-number.ts | 통과 |
| AC-S01-40~43 | quick-input.ts | 통과 |
| AC-S01-44 | quick-input.ts (isSplitAmount는 스펙에 없음) | 속성 통과(독립 검증 아님) |
| D-035 | 미구현 | golden 33사례, loose-end-signal.test.ts |

## 다음 스프린트 제안

1. **S01 재실행(수정 1라운드):** dev-core가 D-035를 구현하고(약 25줄), `chat.test.ts:130` 주석을 고치고, 새 분기를 단위 테스트로 덮는다. spec-keeper는 SA-S01-009를 고친다. 목표는 `pnpm verify` 6단계 통과다.
2. S02 전에 금액 조각 규칙(R-16 4)과 시청자별 확정 속도 상한(R-4)을 판정한다.
3. LOOSE 관련 minor(TD-S01-017·018, RA-S01-006, SA-S01-007)는 LOOSE가 기본 꺼짐이므로 S05 전에 한꺼번에 판정한다.
