# S06 test-e2e 노트 (라운드 0)

## 바꾼 기존 시험 (교체 — 스펙이 바뀌었다, 약화 아님)
| 시험 | 바뀐 뒤 | 근거 |
|---|---|---|
| `tests/e2e/s05/rehearsal-full.spec.ts` 생성기 칸 `getByLabel('시드(선택)')` | "더 보기"를 연 뒤 `getByLabel('채팅 순서 번호')` | AC-S06-66(013) |
| `tests/e2e/s05/attacks.spec.ts` 직접 배정(교체 있음) 보내기 `{ name: /배정/ }` | `{ name: '1등 바꾸기' }` | AC-S06-60 |

## 새 시험 (`tests/e2e/s06/`)
- `sms.spec.ts` 문자찜 입력 AC-S06-10~15·81, `buyers.spec.ts` AC-S06-20~24, `settlements.spec.ts` AC-S06-30~36,
  `navigation.spec.ts` AC-S06-01·41, `devices.spec.ts` AC-S06-02·40·80·81, `layout.spec.ts` AC-S06-61·62·64,
  `fixes.spec.ts` AC-S06-60·63·65·66·67·70·71, `pwa.spec.ts` AC-S06-50~52, `phase1.spec.ts` AC-S06-90(코어 재생 비교).
- 시험 방법 메모
  - 문자찜 화면에서 방송을 고른 직후에는 한 번 그 전 방송 자료로 그려졌다가 새 범위를 불러오며 다시 그려진다. `openSms`는 고른 방송 범위의 전체 조회 응답을 기다린 뒤 칸을 쓴다.
  - 서비스 워커 스크립트 요청은 Playwright `context.route`로 가로채지지 않는다. 새 버전 흉내는 같은 범위에 `/sw.js?v=…`로 다시 등록한다.
  - standalone 흉내는 CDP `Emulation.setEmulatedMedia`가 Playwright 자체 미디어 흉내에 덮여 init script로 `matchMedia`를 바꾼다.
  - AC-S06-90 재생의 `phoneKey`는 코어 형식(16~128자)이라 `test-phonekey-<뒤 4자리>`를 쓴다(dev-notes 예 `test-<뒤 4자리>`는 짧아 코어가 거절).

## 일부러 실패하는 시험 (지적)
- TE-S06-001 `sms.spec.ts` 전화번호로 이은 구매자가 이미 찜한 번호 → "이미 찜한 구매자라…" 문장이 아님
- TE-S06-002 `buyers.spec.ts` 막힌 합치기 미리 보기 "합친 뒤 합계"가 이미 합쳐진 금액을 한 번 더 더함
- TE-S06-003 `navigation.spec.ts` 구매자 화면 안 이동에서 "보내지 않고 떠나기"를 골라도 대기 중 차단이 보내짐
- TE-S06-004 `layout.spec.ts` 1440×900 리허설 콘솔 채팅 칸에 흔한 길이의 언급이 8개 미만(두 줄로 접힘)

전체 E2E(`CI=1 pnpm --filter @livejjim/web e2e`): 위 4개만 실패, 나머지 108 통과(S05 포함, 재시도 없음).
