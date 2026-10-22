# T1 dev-notes

## [device] 운송장 (packages/documents, PC-7)

- 새 파일 `packages/documents/src/waybill.ts`, 공개 이름은 `@livejjim/documents`에서 내보낸다.
  - 순수 함수(골든 `tests/golden/waybill`): `code128Codes(invoice)` → `{ codes }` | `{ error: 'FORMAT' }`, `maskPhone(phone)`, `formatInvoiceNumber(invoice)`, `isInvoiceNumber(value)`.
  - `layoutWaybill(data, font)` → `{ ok: true, layout }` | `{ ok: false, error: { code: 'TOO_LONG' | 'FORMAT', message } }`. PDF는 이 배치를 그대로 그린다.
  - `renderWaybillsPdf(list, font)` → `{ pdf: Uint8Array | null, outcomes: [{ index, invoice, ok, error? }] }`. 준 순서대로 쪽마다 하나. 넘치는 것(TOO_LONG)·모양이 틀린 것(FORMAT)은 그것만 빠지고, 다 빠지면 `pdf: null`.
  - `WaybillData` = `{ carrier: 'FAKE' | 'EPOST', invoice, receiver: { name, phone, address, detail, zip, memo }, sender: { name, phone, address, detail? }, itemCount, box: '극소'|'소'|'중'|'대', bookedDate: 'YYYY-MM-DD' }`. 받는 분은 PC-2가 다듬은 값(연락처는 숫자만)을 넘긴다. 구매자 ID·닉네임·가격 자리는 없다.
  - 오류 문장 `WAYBILL_TOO_LONG_MESSAGE` = "주소가 길어 운송장에 다 들어가지 않아요."
- 배치: 막대 한 칸 1.2pt(≈0.423mm, 300dpi에서 5화소), 높이 17mm, 앞뒤 빈칸 10칸. 받는 분·보내는 사람 글은 12pt부터 0.5pt씩 7pt까지 줄인다.
- 시험: `packages/documents/test/waybill.test.ts`. PDF를 pdfjs + `@napi-rs/canvas`(문서 패키지 devDependency로 추가, 라벨 패키지와 같은 1.0.11)로 300dpi 그림으로 바꾸고, 시험 안의 해독기가 가로줄을 읽어 송장번호·검사값·한 칸·높이·빈칸을 확인한다.
- Code 128 무늬 표는 기억으로 적은 표준 표다. 시험은 표 전체의 성질(107개가 서로 다름, 11칸/끝 13칸, 막대 칸 합 짝수)과 잘 알려진 무늬 7개만 확인한다. 실제 바코드 스캐너·택배 기사 단말기로 읽히는지는 HG-T1(사용자 실물 확인) 몫이다.
- AC-T1-44 문서·라벨 쪽: 문서 패키지는 라벨·프린터 패키지에 기대지 않는다(시험), 라벨 크기 목록은 그대로다(`packages/label/test/t1.test.ts`). 서버 쪽(출력 기록 표에 운송장 행 없음)은 dev-server 몫이다.
