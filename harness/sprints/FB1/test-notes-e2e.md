# FB1 test-notes — e2e (test-e2e)

## 새 시험 (`tests/e2e/fb1/**`)
| 파일 | 수용 기준 | 묶음 |
|---|---|---|
| `settings.spec.ts` | AC-FB1-01·05~08·10·11·19·22~25·31(b)(c)(d)·90 낱말 — 1440·375 | chromium |
| `console.spec.ts` | AC-FB1-02·03(천원·원 방송, 미리 보기 가격 = 보낸 가격, 품종 HTML은 글로), UX-04 고정 영역 | chromium |
| `parcels.spec.ts` | AC-FB1-20(CJ·EPOST·OTHER 막힘, 접수 409·택배사로 나간 요청 0), AC-FB1-16(옛 낱말 `소` → `80`, 가짜 택배사가 받은 `box`는 새 코드) | chromium |
| `label-shop.spec.ts` | AC-FB1-29(1등 라벨·테스트 인쇄 그림에 "다육상회", 비우면 설정 가게 이름), AC-FB1-28 | chromium |
| `login.spec.ts` | AC-FB1-31(a)·32·33 | chromium-social (`@social`) |
| `printer-connect.spec.ts` | AC-FB1-40·38(해볼 일 차례, 맥 UA엔 ③ 없음, 라틴 낱말 없음) | chromium (`@printer`는 제목 표시일 뿐 — 기본 묶음) |

- 돌리기: `CI=1 E2E_PORT_OFFSET=200 pnpm exec playwright test --config apps/web/playwright.config.ts tests/e2e/fb1` — 35개 모두 통과(settings.spec는 마지막으로 더한 시험 뒤 따로 다시 돌림).
- Playwright "Desktop Chrome" 기기의 사용자 에이전트는 **윈도우**다 — 기본 묶음에서 해볼 일 ③(윈도우 줄)이 나오는 것이 맞다. 맥 줄은 따로 새 컨텍스트(맥 UA)로 본다.
- 라벨 그림 비교는 I1 probes와 같은 "더 가까운지" 방식(브라우저 캔버스와 Node 캔버스는 글자 가장자리 점이 조금 다름).

## 로그인 이동 막기 (AC-FB1-33)
- 승인 주소(가짜 OAuth `/<공급자>/authorize`)를 `page.route`로 잡아 **204(내용 없음)** 로 답한다. 브라우저는 이동을 마치지 않고 지금 페이지에 머문다(`pagehide` 없음) → 5초 뒤 되돌림이 보인다.
- 답하지 않고 붙잡아 두는 방법은 쓰지 않는다: Playwright가 그 이동이 끝나기를 기다리느라 화면을 읽지 못한다(시험이 멈춤 — 제품 문제 아님).

## 기존 E2E 맞추기 (AC-FB1-91) — 바꾼 줄마다 `// FB1 D-FB1-0x`
- `tests/e2e/i3/accounts.spec.ts` — "더 보기 (잘 모르면 그대로 두세요)" → "상세 설정", 판매 규칙·배송비 저장 → 막대 "저장", 막대 문장
- `tests/e2e/i3/settings-snapshot.spec.ts` — 판매 규칙 저장 → 막대
- `tests/e2e/i3/youtube.spec.ts` — 감사 저장 → 막대, 묶는 시간 칸은 감사 "상세 설정"을 편 뒤
- `tests/e2e/i3/youtube-flows.spec.ts` — 감사 저장 → 막대
- `tests/e2e/i2/ledger-settings.spec.ts` — 가게 저장 → 막대
- `tests/e2e/t1/flow.spec.ts` — 택배 저장 → 막대·"저장했어요.", 우체국택배 고를 수 있음, 기본 택배 크기 다섯 낱말·`80`·`100`
- `tests/e2e/t1/screens.spec.ts`·`t1/attacks.spec.ts` — 택배 화면 "상자 크기" → "택배 크기", 값 `소`·`대` → `80`·`120`
- `tests/e2e/o2/sale-mode.spec.ts` — "더 보기" → "상세 설정", 판매 규칙 저장 → 막대
- 찾아봤지만 바꿀 것 없음: `t1/detail.spec.ts`(배송지 창의 "저장"), `n5/billing.spec.ts`·`pl1b/receipt.spec.ts`(사업자 정보 칸 — 막대 밖), `n2b2/*`(틱톡 칸 — 막대 밖), `i1/*`·`o4/*`(라벨 설정 저장 — 막대 밖), `t1/support.ts`(API로 `box: '소'` — 서버가 옮기는 옛 낱말 길로 그대로 둠)
- 바뀐 파일만 돌려 봄: 위 파일 모두 통과.

## 맥북 쪽에 알릴 것 (i3 바꾼 줄)
- `tests/e2e/i3/accounts.spec.ts` 192·206·212·213·224·225·229
- `tests/e2e/i3/settings-snapshot.spec.ts` 20·21
- `tests/e2e/i3/youtube.spec.ts` 155·156·170(새 줄 — "상세 설정" 펴기)·172·176
- `tests/e2e/i3/youtube-flows.spec.ts` 35·36

## 찾은 문제
- **TE-FB1-001 (web)**: 휴대폰(375×812) 콘솔 고정 영역이 284px(35%)를 넘는다 — 기존 시험 5개가 실패: `s06/layout.spec.ts` AC-S06-61, `nav/phone-menu.spec.ts` AC-NAV-07, `i4/voice-layout.spec.ts` AC-I4-50(375), `n2b2/layout.spec.ts` TE-N2b-2-001, `i3/youtube.spec.ts` AC-I3-01·25. 세 시험 모두 `NAV.menu 55 / DIV.console-sticky 263` = 318.8px(34.8px 넘침). FB1이 `.console-sticky-quick` 안에 더한 `p.quick-unit`(휴대폰에서 `quick-help`는 숨기지만 단위 줄은 보임)이 한 줄을 더한다. 치는 동안에는 "등록하면: …" 줄도 더해진다. 
