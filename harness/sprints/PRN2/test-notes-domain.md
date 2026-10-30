# PRN2 test-domain 메모

## 결과 요약

- 찾은 제품 버그(실패 시험): **없음**. 아래 공격이 모두 스펙대로 통과해 회귀 시험으로 남겼다.
- 새 시험: `tests/adversarial/prn2/` 4개 파일, 시험 237개(golden-both 158 · table-row 11 · device-bounds 59 · server-print 9) — 모두 통과.
- 고친 기존 시험(스펙이 바뀐 곳만): n1 4개 파일·fb1 1개·qs1 도우미 1개 — 아래 "기존 시험 고침".

## 기존 시험 고침 (근거)

| 파일 | 바뀐 것 | 근거 | 그대로 지킨 성질 |
|---|---|---|---|
| `n1/job-bytes.test.ts` | 바우아토를 Luck Jingle 순서로 읽음, 농도 명령은 YXQ만 | D-PRN2-02, L-12 2 | 무작위 그림·돌림·남는 비트 0·결정성·넓으면 IMAGE_TOO_WIDE |
| `n1/names-browser.test.ts` | `EXPERIMENTAL_PROFILES` → 같은 내용 `[BAUATO_PPA2L]`. 기본 Marklife 어댑터 목록이 `LABEL_PROFILES`(바우아토 포함)라 기본 어댑터 거르기에 `PPA2`가 들고 `PPA2L_`를 고른다(전에는 WRONG_MODEL — 이 사례는 "Marklife 9종만 켠 어댑터"로 옮겨 계속 WRONG_MODEL 확인) | D-PRN2-01, L-12 1 "목록 (PRN2 개정)" | 비슷한 글자·앞 공백·대소문자 거절, 창 거르기 = 이름 판단 |
| `n1/timeout-progress.test.ts` | `EXPERIMENTAL_PROFILES` → `[BAUATO_PPA2L]`, 바우아토 384×400 작업 19,233 → 19,236바이트 | D-PRN2-02 (머리 4+12+3, 꼬리 2+3+4) | 962조각·28,830ms·48,830ms TIMEOUT 등 시간 수치 전부 |
| `n1/adapter-scenarios.test.ts` | 없어진 이름 대신 `[m.BAUATO_PPA2L]`, 한 목록 어댑터·`printerRequestOptions`도 navigator를 읽지 않는지 더함 | D-PRN2-01 | import·만들기만으로 navigator 0회 |
| `fb1/printer-detail.test.ts` | WRONG_MODEL 무작위 모델에서 D110·B21 제거, B1_PRO·B21_PRO·B21S·D110_M 더함 | D-PRN2-05 (D110·B21은 켠 실험 프로필), L-7 | detail은 "모델: …"뿐, 원문 없음 |
| `qs1/station-helpers.ts` | 가짜 서버가 `template: {}` 대신 `defaultTemplate('product')` | 실제 서버는 늘 템플릿 전체를 준다(L-11 13). PRN2부터 출력 기기가 `template.size`를 프로필 크기 목록과 견줌(D-PRN2-07) | 저절로 다시 잇기 60초 규칙(TD-QS1-001) |

## 통과한 공격 (회귀로 남김)

- **골든 전부를 두 길로** (`golden-both`): list 24건을 웹 한 목록 어댑터(브라우저 고르기 창을 filters로 흉내 — 안 보이면 NOT_SELECTED)와 앱 계열 표·찾기 거르기·목록 줄로. profile 14·name 27·browser 15는 웹 표와 앱 계열 표가 같은 줄. job 36건은 웹 어댑터와 앱 어댑터(가짜 BleManager)가 실제로 보낸 바이트 = 골든(문자 조각·rawRaster 그대로, yxqRaster 머리 + 창 10 풀기), 거절 사례는 한 조각도 안 보냄. end 14건은 두 어댑터 모두 끝/TIMEOUT. optionalServices = ff00·fd00·NIIMBOT 서비스(D-PRN2-20).
- **표 한 줄 추가** (`table-row`, AC-PRN2-11): 실제 `profiles.ts`를 임시로 복사해 표 배열 두 곳에 줄(`Q5_` Luck Jingle·NIIMBOT `B3S`)만 더한 판에서 판정·거르기·크기 목록·단계·실험 안내·알릴 ID가 따라오고 골든 list 답은 그대로. 켠 표를 인자로 받는 웹 한 목록·Marklife·NIIMBOT 어댑터·앱 계열·앱 목록 줄도 따라온다. 제품 코드에 프로필 ID 글자는 `profiles.ts`·`adapter.ts`에만.
- **끝 알림 경계** (`device-bounds`): 무작위 값 속성(끝 ⇔ `AA` 한 바이트, Luck Jingle만 `4F 4B`), 쪼개진 `4F`·`4B`, 출력 전 `OK`/`AA`, Marklife S2·P50·P12의 첫 조각 뒤 `OK` → 끝까지 보내고 `AA`에서만 끝.
- **ff03 없는 꾸러미 A**: 바우아토·S2·P12 모두 이어지고 30ms 간격·바이트 그대로·`AA`로 끝.
- **이름 경계**: 대소문자·앞 공백/탭·전각·폭 없는 공백·이어폰(Buds·Galaxy Buds·Bose·Beats)·Phomemo(P12·M110·D30)·B21S·D110_M 28건 + 속성 1,500회 — 웹 판정 = 앱 계열. D-PRN2-16 `p50_lower` + 서비스 → NIIMBOT 목록, 이은 뒤 WRONG_MODEL(기억·프로필 ID 없음).
- **WRONG_MODEL**: B1_PRO·B21_PRO·B21S·D110_M·D11 — 웹 B1 어댑터·한 목록(getAvailability false여도 WRONG_MODEL), 앱 네이티브 B1·앱 고르기. 문장에 그림 파일 경로. 켠 모델 B1 SE·B21·D110은 그 프로필로 이어 단계 실험. 앱 고르기는 이름 없는 서비스 기기·`B1 Pro-…`+서비스도 잇고 모델로 판단.
- **서버 profileId** (`server-print`): 표에 없는 글·소문자·앞 공백·줄바꿈·폭 없는 공백·빈 글·1만 자·HTML·null → 200 모름(B1 목록), DB에 그 글 없음. 숫자·배열·객체·참 → 400 `profileId`, 값 되돌리지 않음. 칸 빠짐·끊김·바꾸기·DISCONNECTED 결과·그만하기 → 지움. 다른 판매자 격리. 로그에 프로필 글 없음. 테이프 프로필에서 50×30 템플릿 → 서버는 막지 않고 INVALID_TEMPLATE(size) 결과면 LABEL_ERROR 멈춤.
- **PNG 입구**: 작업 PNG = `encodeLabelPng(비트맵)`, IHDR 1비트 흑백, pHYs 7992(203dpi), 점이 같음, `no-store`. 로그인 없음·다른 판매자·다른 기기·틀린/모양 틀린/없는 시도·없는 기기·다른/아주 긴 작업 ID·끝난 시도·바뀐 출력 기기 → 비트맵 입구와 같은 상태·같은 본문. test-png = encode(test-bitmap), size 경계(대문자·`×`·앞 공백·목록 밖·5천 자 → 422 INVALID_TEMPLATE, 값 되돌리지 않음).
- **D-PRN2-22**: 시험용 프린터가 바우아토·P12를 흉내 내면 받은 농도 3을 0으로 기록, P50은 범위 밖 5를 INVALID_DENSITY(1~3).

## 지적 (버그 아님)

- **TD-PRN2-001 (category: spec, minor) — 스펙 확인 필요: Luck Jingle 첫 명령이 `OK`로 답하면?** D-PRN2-03은 Marklife의 첫 명령이 `OK`로 답해 첫 조각 뒤 출력함이 될 수 있어 `OK`를 끝에서 뺐다. 바우아토에는 `OK`를 끝으로 허용하고 "이번 출력의 첫 조각을 쓴 뒤 받은 것"이면 센다(L-12 5). 바우아토가 켜기 `10 FF F1 03`이나 위치 맞춤 `1F 11 51`에 `OK`로 답하는 기기라면 같은 사고(안 찍힌 라벨을 출력함으로 기록)가 바우아토에서 난다. 검증 문서가 `OK`를 작업 끝 `10 FF F1 45`의 답으로만 적었는지 HG-5에서 확인 필요. 지금 구현은 스펙 그대로라 시험을 만들지 않았다. file: `packages/printer/src/job.ts`(EXTRA_END_NOTICES).
- 관찰: `/api/print/test-bitmap`·`/test-png`의 `?size=`(빈 값)은 "없음"이 아니라 422, `?size=` 여러 번이면 첫 값. 두 입구가 같은 답이라 시험은 "500이 아니고 두 입구가 같다"만 본다. 스펙(D-PRN2-11 "없으면 50×30")이 빈 값을 어떻게 볼지 정하지 않았다 — 화면은 늘 값을 넘기므로 영향 없음.
- 관찰: `labelSizesForProfileId`·`printerSupportStage`·`connectedProfileId`는 전역 표(`PRINTER_PROFILES`)만 본다. 줄을 더하는 곳은 그 표 하나여야 한다(어댑터에 켠 표만 넘기면 서버에 알릴 ID가 null). table-row ①이 그 절차를 그대로 시험한다.
- 범위 밖으로 둔 것: D-PRN2-10·15(실험 기종 "예" 전 받기 멈춤)·D-PRN2-23(범위 밖 농도는 보내지 않음)은 화면 출력 기기 동작이라 test-e2e 몫으로 두었다.

## D-PRN2-33 반영 (고르기 줄 실험 표시)

- 나중 결정 D-PRN2-33(SA-PRN2-003, 커밋 557ece7f)이 고르기 줄 `detail`에서 "실험" 글자를 빼고 꼬리표(`PickEntry.experimental`) 하나만 두기로 했다. 스펙이 바뀐 것이라 `golden-both`(G-PRT-PRN2-37~40)·`table-row`(앱 계열 표 "가짜 Q5")의 기대를 고쳤다.
- 새 기대: 실험 기종은 `experimental === true` 이고 `detail`에 '실험' 없음, B1(NIIMBOT)은 `experimental === false` 이고 '실험' 없음. 가짜 Q5 줄은 `['가짜 Q5 · 신호 강함', 'NIIMBOT · 신호 강함']` + 꼬리표 `[true, false]`.
- 약하게 한 것이 아니다: 실험 표시 확인은 꼬리표 true/false 정확 일치로 그대로 남았고, 글자가 없음을 오히려 더 확인한다.
