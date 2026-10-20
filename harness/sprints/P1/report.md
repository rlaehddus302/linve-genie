# P1 리포트 — 라벨·프린터 패키지

**결과: FAIL** — P1 코드 결함은 없다. 마지막 게이트 측정에서 S00 골든 CLI 결정성 시험 1건이 시간 초과(5097ms)로 실패했다(GATE-P1-VERIFY). 개발자가 부하가 낮을 때 단독으로 돌린 verify(라운드 2, 커밋 495696f)는 7단계 모두 통과했다.

- 브랜치: `track/p1-label-printer` (BASE dd163d7, spec 2b47f43)
- 개발 영역: device · 시험 영역: domain · 수정 라운드: 2

## 영역별로 만든 것 (device)

### packages/label (`@livejjim/label`)
- 순수 텍스트 계산 `computeProductText`·`computePackingText`. 라벨 골든 83사례(상품 50·포장 29·크기 4)가 모두 통과하고, 합계가 고정되어 있다.
- 글 다듬기(L-2: NFC, 제어문자는 공백으로, Cf 제거, 공백 합치기). 표 밖 필드는 `INVALID_DATA`로 거절하고, 오류에 필드 값을 싣지 않는다.
- JSON 템플릿(`format: 1`)과 `validateTemplate`. 기본 템플릿은 50×30·50×20·50×40 크기마다 있다.
- 주입된 캔버스로 렌더한다. 내장 Pretendard Bold(OFL)만 쓰고, 글꼴에 없는 글자는 빈 상자로 그린다. 1비트 변환은 임계값 128을 쓴다.
- 맞추기 순서는 축소 → 품종만 두 줄 → `…`. 숫자 필드는 자르지 않고 `DOES_NOT_FIT`을 낸다. 테스트 라벨에는 2도트 테두리가 있다.
- 1비트 PNG, 라벨 크기 PDF, A4 모아찍기 PDF를 내보낸다(바이트 결정적, PrintScaling None). `toPreviewRgba`, `labelContentKey`도 있다.
- 속도: 라벨 30장 약 0.02초, 1만 자 필드 라벨 약 0.04초.

### packages/printer (`@livejjim/printer`)
- `PrinterAdapter` 계약(연결 상태 4개와 변경 알림).
- B1 프로필과 niimbluelib 0.47.1(정확한 버전) 어댑터. Bluetooth를 먼저, Serial을 다음으로 쓴다. 지원 여부는 호출할 때 감지한다. B1이 아닌 프린터는 `WRONG_MODEL`로 거절하고, 384×241(빈 줄 1행 추가)·농도 3으로 보내며, 시간 초과는 20초다. 오류 문장은 L-7 표와 같다.
- 가짜 프린터: n번째 출력에서 끊김·실패·지연을 일으킬 수 있다. B1 어댑터와 같은 계약 시험 묶음을 통과한다.
- 순수 출력 대기열: 같은 작업 ID는 한 번만 찍는다. 오류가 나면 작업을 맨 앞에 둔 채 멈춘다. 폐기·재출력·기록·"재출력 필요"를 지원하고, JSON 왕복 속성 시험이 있다.
- 실행기: 30장 연속 출력 중 12번째에 끊겨도 다시 연결된 뒤 이어서 찍는다. 30장이 순서대로, 렌더와 바이트까지 같게 나온다.
- 라운드 1에서 SA-P1-001~004를 고쳤다. 끝 알림 뒤 끊김을 ok로 처리하고, 실행기 재진입 경합을 막고, 테스트 라벨이 목록 밖 크기를 받으면 `INVALID_TEMPLATE`을 돌려준다.

### 시험 (domain)
- `tests/adversarial/p1/` 적대 시험 115개가 모두 통과한다(AC-P1-70~72).
- 공용 루트 파일: 루트 devDependencies에 `@livejjim/label`·`@livejjim/printer`를 추가했다.

## 남은 blocker/major

| ID | 심각도 | 내용 | 조치 |
|---|---|---|---|
| GATE-P1-VERIFY | major | `pnpm verify` 결과는 통과 6·실패 1이다. 실패는 `tests/adversarial/s00/golden-runner.test.ts:588` 결정성 시험의 시간 초과(5097ms)이고, adversarial 단계 안 typecheck 시험과의 CPU 경합이 원인이다. 이 파일만 돌리면 통과한다. P1 소스에는 고칠 곳이 없다. P1이 typecheck 설정을 7개에서 11개로 늘린 탓에 경합이 조금 커졌을 가능성은 있다(PLAUSIBLE, 측정하지 않음). | SA-P1-005를 처리한 뒤 게이트를 다시 잰다. |

blocker는 없다.

## 자율 결정·사용자 확인 필요 사항

자율 결정(모두 비차단, DECISIONS에 AUTO로 기록):

| ID | 결정 |
|---|---|
| D-P1-01 | 라벨 규칙은 새 `docs/spec/LABEL_RULES.md`에 둔다. 골든은 `tests/golden/label/*.json`에 두고 packages/label 단위 시험이 읽는다. 코어 러너는 바꾸지 않는다. |
| D-P1-02 | B1 크기는 50×30(기본)·50×20·50×40이다. 도트 = mm×8, 폭 상한 384, 밝기 128 미만이면 검정. |
| D-P1-03 | 가격이 1000의 양의 배수일 때만 'N 천원'으로 쓴다. 날짜는 방송일 YY.MM.DD이다. 문자 구매자는 '문자찜'으로 쓰고 메모·전화번호는 싣지 않는다. 번호와 닉네임은 끌 수 없다. |
| D-P1-04 | 글 다듬기는 NFC → 제어문자를 공백으로 → Cf 제거 → 공백 정리 순서다. 내장 글꼴만 쓰고, 없는 글자는 빈 상자로 그린다. |
| D-P1-05 | 포장 라벨은 '상품 합계'에 코어 소계를 그대로 쓴다. 방송마다 페이지를 나누고, 기본 10개씩 담으며, 1/1도 k/n으로 표시한다. |
| D-P1-06 | 맞추기는 축소 → 품종 두 줄 → `…` 순서다. 숫자는 자르지 않고 DOES_NOT_FIT을 낸다. 글자 크기 범위는 16~120이다. |
| D-P1-07 | PNG와 PDF는 같은 1비트 이미지를 실제 크기로 쓴다. A4 여백은 10mm, 간격은 2mm다. 바이트는 결정적이다. |
| D-P1-08 | B1만 켠다. 다른 기종은 WRONG_MODEL이다. 아래쪽에 빈 줄 1행을 더한다. 테스트 라벨에는 테두리가 있다. |
| D-P1-09 | 오류가 나면 멈춘다. 끊김은 다시 연결되면 이어서 찍고, 프린터 오류는 손으로 다시 시작해야 한다. 같은 작업 ID는 한 번만 찍는다. 폐기는 라벨 키 단위다. |
| D-P1-10 | 가격은 claim 가격 스냅샷에서 가져온다. 작업 ID는 effect ID, 라벨 키는 (claim, confirmVersion)이다. 내용 키가 바뀔 때만 재출력이 필요하다. |

사용자(또는 spec-keeper) 확인 필요:
- **SA-P1-006**: 스펙에 없는 동작 여섯 가지를 확정해야 한다. 그중 G-LBL-013(1억 원)이 AC-P1-06 문장과 어긋나는 점은 가격 상한 결정이 필요하다.
- **TD-P1-004**: 출력 전 거절(BUSY 등)도 대기열을 멈추게 할지 정해야 한다.
- **TD-P1-005**: 투명 채움 문자로만 된 닉네임을 '이름 없음'으로 처리할지 정해야 한다.
- **HG-2**: 실제 B1으로 출력해 확인해야 한다(사람 게이트).
- 라벨 골든을 golden 단계에서 돌릴지는 오케스트레이터가 정한다(D-027).

## minor/nit 백로그 (backlog.yaml techDebt에 추가)

| ID | 심각도 | 제목 |
|---|---|---|
| SA-P1-005 | minor | S00 골든 CLI 결정성 시험(5000ms)이 adversarial 단계 경합만으로 시간 초과. 시험에 시간 여유를 주고(예: 30_000) verify 잠금을 둔다. 담당은 test-domain과 오케스트레이터다. |
| SA-P1-006 | minor | LABEL_RULES에 없는 동작 여섯 가지. spec-keeper가 확정한다. |
| TD-P1-004 | minor | 출력 전 거절이 "프린터 오류로 멈췄어요."로 멈추고 시도 횟수를 +1 한다. |
| TD-P1-005 | nit | 투명 닉네임(U+3164·U+115F·U+1160·U+FFA0·U+2800)이 빈 칸으로 찍힌다. |

## 추적성 표

| AC | 구현 | 시험 |
|---|---|---|
| AC-P1-01 | label/src/compute.ts, label.ts | label/test/golden.test.ts (83사례) |
| AC-P1-02 | label/src/compute.ts | label/test/text.test.ts |
| AC-P1-03 | label/src/text.ts | text.test.ts, font-and-source.test.ts, adversarial/p1/label-attacks.test.ts |
| AC-P1-04 | label/src/data.ts | text.test.ts |
| AC-P1-05 | label/src/compute.ts | text.test.ts |
| AC-P1-06 | label/src/render.ts, compute.ts | golden.test.ts, render.test.ts, label-attacks.test.ts (G-LBL-013 — SA-P1-006) |
| AC-P1-10 | render.ts, bitmap.ts, sizes.ts | render.test.ts, font-and-source.test.ts |
| AC-P1-11 | font.ts | font-and-source.test.ts, render.test.ts |
| AC-P1-12 | render.ts | render.test.ts, label-attacks.test.ts |
| AC-P1-13~16 | render.ts | render.test.ts (14는 golden.test.ts 포함) |
| AC-P1-17 | render.ts (renderTestLabel) | render.test.ts, label-attacks.test.ts (TD-P1-003) |
| AC-P1-20 | template.ts | template.test.ts |
| AC-P1-21 | render.ts, template.ts | render.test.ts |
| AC-P1-30 | png.ts | export.test.ts, adversarial/p1/export-printer.test.ts |
| AC-P1-31·32 | pdf.ts | export.test.ts |
| AC-P1-33 | bitmap.ts | export.test.ts |
| AC-P1-40 | printer/src/adapter.ts | contract.test.ts, b1.test.ts |
| AC-P1-41·42 | niimbot.ts | b1.test.ts (42는 export-printer.test.ts 포함) |
| AC-P1-43 | niimbot.ts, errors.ts | b1.test.ts, export-printer.test.ts (TD-P1-001) |
| AC-P1-44 | fake.ts | contract.test.ts, export-printer.test.ts (TD-P1-002) |
| AC-P1-50·52·53·54 | queue.ts | queue.test.ts |
| AC-P1-51 | queue.ts, runner.ts | queue.test.ts, runner.test.ts |
| AC-P1-55 | queue.ts, label/src/compute.ts | queue.test.ts, text.test.ts |
| AC-P1-56 | runner.ts | runner.test.ts |
| AC-P1-57 | queue.ts | queue.test.ts, source.test.ts |
| AC-P1-60 | label·printer package.json, 루트 devDependencies | font-and-source.test.ts, source.test.ts, b1.test.ts |
| AC-P1-61 | verify 파이프라인 | **미충족** — adversarial 1건 시간 초과(GATE-P1-VERIFY). 코어 골든 21파일·498건, 커버리지 100%/99.65%는 그대로다. |
| AC-P1-62 | printer/src/errors.ts, label/src/errors.ts, template.ts | b1.test.ts:272, template.test.ts |
| AC-P1-63 | dev-notes.md §'I1에게' | 문서 검사 |
| AC-P1-70 | — | adversarial/p1/label-attacks.test.ts |
| AC-P1-71 | — | adversarial/p1/queue-random.test.ts |
| AC-P1-72 | — | adversarial/p1/export-printer.test.ts |

## 다음 스프린트 제안

1. **게이트 재측정(가장 먼저)**: test-domain이 SA-P1-005를 처리한다(S00 자식 프로세스 시험에 시간 여유를 준다). 오케스트레이터는 병렬 트랙 verify에 잠금 파일을 둬서 겹치지 않게 한다. 그 뒤 P1 게이트를 다시 재고, 통과하면 done으로 바꾼다. P1 코드는 고치지 않아도 된다.
2. **spec-keeper 정리**: SA-P1-006, TD-P1-004, TD-P1-005를 한 번에 확정한다. 투명 닉네임을 지우기로 하면 골든 한 줄을 더한다.
3. **I1(통합)**: L-9 규칙대로 화면·서버 작업 기록·엔진 effect 자동 출력을 연결한다. 공개 API는 dev-notes의 'I1에게' 절에 있다.
4. **HG-2**: 실제 B1으로 테스트 라벨과 30장 연속 출력을 확인한다.
5. **병합 주의**: SPEC 버전 줄과 DECISIONS 사용자 확인 표는 다른 트랙과 글자 단위로 충돌할 수 있다.
