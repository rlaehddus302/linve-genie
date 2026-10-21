// AC-P2-20~22·27 확인서 데이터 (엔진 상태 → 순수 데이터). G-ENG-201·202의 이벤트를 골든 파일에서 읽어 실제 코어로 재생해 맞댄다.
import { getSettlement, listSettlements, type EngineState } from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { LEGAL_NOTICE, buildReceipt, buildReceipts, loadDocumentFont, type ReceiptData, type ShopSettings } from '../src/index.ts'
import { fontBytes, play, playLoosely, randomEvents, replayGolden, sale, type EventInput } from './helpers.ts'

const SHOP: ShopSettings = { name: '초록다육', account: { bank: '농협', number: '302-9988-7766-11', holder: '김판매' }, accountNote: '입금자명은 닉네임으로 적어 주세요' }
/** 2026-10-18T14:30:00Z = KST 23:30 */
const CREATED = Date.UTC(2026, 9, 18, 14, 30, 0)
const G201 = replayGolden('G-ENG-201')
const G202 = replayGolden('G-ENG-202')

const receiptOf = (state: EngineState, buyer: string, date = '2026-10-18', extra: { shop?: ShopSettings | null; rehearsal?: boolean } = {}): ReceiptData => {
  const result = buildReceipt({ state, buyer, date, shop: extra.shop === undefined ? SHOP : extra.shop, rehearsal: extra.rehearsal ?? false, createdAt: CREATED })
  if (!result.ok) throw new Error(result.error.message)
  return result.receipt
}

const lineText = (receipt: ReceiptData): string[] => receipt.lines.map((line) => `${line.session} · ${String(line.no)} · ${line.name} · ${line.priceText}`)
const rowText = (receipt: ReceiptData): string[] => receipt.rows.map((row) => `${row.label} ${row.text}`)

describe('AC-P2-20 확인서 데이터 — G-ENG-201', () => {
  it('UC_A · 2026-10-18 (같은 날 두 방송·닉네임 변경·확정 뒤 가격 변경·할인·부분 입금)', () => {
    const receipt = receiptOf(G201, 'UC_A')
    expect(receipt).toMatchObject({
      title: '구매 내역 확인서',
      rehearsalNote: null,
      shopName: '초록다육',
      buyerName: '길동이',
      phoneLast4: null,
      date: '2026-10-18',
      orderDate: '2026년 10월 18일',
      sessions: ['1부', '2부'],
      itemCount: 3,
      subtotal: 23000,
      shipping: 4000,
      shippingNote: null,
      adjustments: -2000,
      total: 25000,
      payment: 'PARTIAL',
      received: 10000,
      refundDue: 0,
      remaining: 15000,
      account: { text: '농협 302-9988-7766-11 (예금주 김판매)', note: '입금자명은 닉네임으로 적어 주세요' },
      createdAt: '2026년 10월 18일 23:30',
      notice: LEGAL_NOTICE,
    })
    // 2부 7번은 지금 가격 9,000원이 아니라 찜 시점 가격 8,000원 (R-10, D-013)
    expect(lineText(receipt)).toEqual(['1부 · 15 · 핑크프릴 · 10,000원', '1부 · 28 · 라울 · 5,000원', '2부 · 7 · 블루엘프 · 8,000원'])
    expect(rowText(receipt)).toEqual(['상품 수 3개', '상품 합계 23,000원', '배송비 4,000원', '할인 -2,000원', '최종 결제 금액 25,000원', '받은 금액 10,000원', '남은 금액 15,000원'])
  })

  it('sms:s1 · 2026-10-18 (문자찜·직접 수령·미입금)', () => {
    const receipt = receiptOf(G201, 'sms:s1')
    expect(receipt).toMatchObject({ buyerName: '문자찜(김영희)', phoneLast4: '5678', itemCount: 1, subtotal: 15000, shipping: 0, shippingNote: '직접 수령', adjustments: 0, total: 15000, payment: 'UNPAID', remaining: null })
    expect(lineText(receipt)).toEqual(['1부 · 31 · 방울복랑 금 · 15,000원'])
    // 조정 줄 없음, 입금 상태 줄 없음(미입금)
    expect(rowText(receipt)).toEqual(['상품 수 1개', '상품 합계 15,000원', '배송비 (직접 수령) 0원', '최종 결제 금액 15,000원'])
  })

  it('금액 칸은 코어 getSettlement 값을 그대로 옮긴다', () => {
    for (const buyer of ['UC_A', 'sms:s1']) {
      const settlement = getSettlement(G201, buyer, '2026-10-18')
      const receipt = receiptOf(G201, buyer)
      expect({ subtotal: receipt.subtotal, shipping: receipt.shipping, adjustments: receipt.adjustments, total: receipt.total, received: receipt.received, refundDue: receipt.refundDue, payment: receipt.payment }).toEqual({
        subtotal: settlement.subtotal,
        shipping: settlement.shipping,
        adjustments: settlement.adjustments,
        total: settlement.total,
        received: settlement.received,
        refundDue: settlement.refundDue,
        payment: settlement.payment,
      })
    }
  })

  it('JSON으로 그대로 옮길 수 있는 값만 담는다 (함수·Date 없음), 같은 입력이면 같은 데이터', () => {
    const receipt = receiptOf(G201, 'UC_A')
    expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt)
    expect(receiptOf(G201, 'UC_A')).toEqual(receipt)
  })

  it('넘긴 상태를 바꾸지 않는다', () => {
    const before = JSON.stringify(G201)
    receiptOf(G201, 'UC_A')
    buildReceipts({ state: G201, date: '2026-10-18', rehearsal: false, createdAt: CREATED })
    expect(JSON.stringify(G201)).toBe(before)
  })

  it('만든 시각은 실행 환경 시간대와 상관없이 KST (시험은 TZ=Pacific/Honolulu에서 돈다)', () => {
    expect(receiptOf(G201, 'UC_A').createdAt).toBe('2026년 10월 18일 23:30')
    const midnight = buildReceipt({ state: G201, buyer: 'UC_A', date: '2026-10-18', rehearsal: false, createdAt: Date.UTC(2026, 9, 18, 15, 0, 59) })
    expect(midnight.ok && midnight.receipt.createdAt).toBe('2026년 10월 19일 00:00')
  })

  it('합쳐진 구매자의 키로도 지금의 구매자 확인서를 만든다', () => {
    const state = play([...sale(15, 'UC_A', '홍길동'), ...sale(16, 'UC_B', '홍길동부캐', { price: 5000 }), { type: 'buyer.merge', from: 'UC_B', into: 'UC_A', reason: '같은 사람' }])
    const merged = receiptOf(state, 'UC_B')
    expect(merged.buyerName).toBe('홍길동')
    expect(lineText(merged)).toEqual(['1부 · 15 · 핑크프릴 · 10,000원', '1부 · 16 · 핑크프릴 · 5,000원'])
    expect(merged).toEqual(receiptOf(state, 'UC_A'))
  })
})

describe('AC-P2-21 문서는 금액을 다시 계산하지 않는다 — 품목이 없으면 만들지 않는다', () => {
  it('품목 없는 묶음(G-ENG-202 UC_C 과입금) → 쉬운 오류', () => {
    const result = buildReceipt({ state: G202, buyer: 'UC_C', date: '2026-10-19', rehearsal: false, createdAt: CREATED })
    expect(result).toEqual({ ok: false, error: { code: 'NO_ITEMS', message: '구매 내역이 없어 확인서를 만들 수 없어요.' } })
  })

  it('모르는 구매자·다른 날짜·빈 키 → 품목 없음', () => {
    for (const [buyer, date] of [
      ['UC_Z', '2026-10-18'],
      ['UC_A', '2026-10-19'],
      ['', '2026-10-18'],
    ] as const) {
      const result = buildReceipt({ state: G201, buyer, date, rehearsal: false, createdAt: CREATED })
      expect(result.ok === false && result.error.code).toBe('NO_ITEMS')
    }
  })

  it('입력이 틀리면 쉬운 오류 (날짜 형식·만든 시각)', () => {
    for (const date of ['2026-1-18', '2026-02-30', '', '20261018']) {
      const result = buildReceipt({ state: G201, buyer: 'UC_A', date, rehearsal: false, createdAt: CREATED })
      expect(result.ok === false && result.error.code).toBe('INVALID_INPUT')
    }
    for (const createdAt of [Number.NaN, 1.5, Number.MAX_VALUE]) {
      const result = buildReceipt({ state: G201, buyer: 'UC_A', date: '2026-10-18', rehearsal: false, createdAt })
      expect(result.ok === false && result.error.code).toBe('INVALID_INPUT')
    }
  })

  it('속성: 무작위 이벤트 열 → 품목이 있는 모든 묶음의 확인서 금액 칸이 getSettlement과 같고, 줄 가격 합 = 상품 합계', () => {
    fc.assert(
      fc.property(randomEvents(), (events) => {
        const state = playLoosely(events)
        for (const settlement of listSettlements(state)) {
          const result = buildReceipt({ state, buyer: settlement.buyer, date: settlement.date, rehearsal: false, createdAt: CREATED })
          if (settlement.items.length === 0) {
            expect(result.ok).toBe(false)
            continue
          }
          expect(result.ok).toBe(true)
          if (!result.ok) continue
          const receipt = result.receipt
          expect([receipt.subtotal, receipt.shipping, receipt.adjustments, receipt.total, receipt.received, receipt.refundDue, receipt.payment]).toEqual([
            settlement.subtotal,
            settlement.shipping,
            settlement.adjustments,
            settlement.total,
            settlement.received,
            settlement.refundDue,
            settlement.payment,
          ])
          expect(receipt.lines.reduce((sum, line) => sum + line.price, 0)).toBe(settlement.subtotal)
          expect(receipt.itemCount).toBe(settlement.items.length)
          expect(receipt.remaining).toBe(settlement.payment === 'PARTIAL' ? settlement.total - settlement.received : null)
        }
      }),
      { numRuns: 120 },
    )
  })
})

describe('AC-P2-22 표시 규칙', () => {
  const base = (extra: EventInput[], settings = {}): EngineState => play([...sale(15, 'UC_A', '길동'), ...extra], { settings })
  const shippingOf = (state: EngineState): [string | null, string] => {
    const receipt = receiptOf(state, 'UC_A')
    return [receipt.shippingNote, rowText(receipt)[2] as string]
  }
  const settlement = (type: string, fields: Record<string, unknown>): EventInput => ({ type, buyer: 'UC_A', date: '2026-10-18', ...fields })

  it('배송비 옆 표시: 직접 수령·합배송·따로 정함·무료 배송·그 밖은 없음', () => {
    expect(shippingOf(base([settlement('settlement.shippingOverride', { mode: 'PICKUP' })]))).toEqual(['직접 수령', '배송비 (직접 수령) 0원'])
    expect(shippingOf(base([settlement('settlement.shippingOverride', { mode: 'COMBINED' })]))).toEqual(['합배송', '배송비 (합배송) 0원'])
    expect(shippingOf(base([settlement('settlement.shippingOverride', { mode: 'FIXED', amount: 6000 })]))).toEqual(['따로 정함', '배송비 (따로 정함) 6,000원'])
    expect(shippingOf(base([settlement('settlement.shippingOverride', { mode: 'FIXED', amount: 0 })]))).toEqual(['따로 정함', '배송비 (따로 정함) 0원'])
    expect(shippingOf(base([], { 'shipping.freeThreshold': 10000 }))).toEqual(['무료 배송', '배송비 (무료 배송) 0원'])
    expect(shippingOf(base([], { 'shipping.baseFee': 0 }))).toEqual(['무료 배송', '배송비 (무료 배송) 0원'])
    expect(shippingOf(base([]))).toEqual([null, '배송비 4,000원'])
    // 예외를 지우면(기본 배송비로) 표시 없음
    expect(shippingOf(base([settlement('settlement.shippingOverride', { mode: 'PICKUP' }), settlement('settlement.shippingOverride', { mode: 'DEFAULT' })]))).toEqual([null, '배송비 4,000원'])
  })

  it('조정: 음수 할인, 양수 추가, 0이면 줄 없음 — 사유는 어디에도 없다', () => {
    const discount = receiptOf(base([settlement('settlement.adjust', { amount: -2000, reason: '단골 할인 비밀메모' })]), 'UC_A')
    expect(rowText(discount)).toContain('할인 -2,000원')
    const extra = receiptOf(base([settlement('settlement.adjust', { amount: 3000, reason: '도서산간 비밀메모' })]), 'UC_A')
    expect(rowText(extra)).toContain('추가 +3,000원')
    const zero = receiptOf(base([settlement('settlement.adjust', { amount: 3000, reason: 'a' }), settlement('settlement.adjust', { amount: -3000, reason: 'b' })]), 'UC_A')
    expect(zero.rows.map((row) => row.key)).not.toContain('adjustment')
    for (const receipt of [discount, extra]) expect(JSON.stringify(receipt)).not.toContain('비밀메모')
  })

  it('입금 상태: 미입금 줄 없음 · 부분 입금 받은/남은 · 입금 완료 받은/입금 완료 · 과입금 받은/환불할', () => {
    const paid = (amount: number): string[] => rowText(receiptOf(base(amount === 0 ? [] : [settlement('settlement.payment', { amount, memo: '입금메모비밀' })]), 'UC_A')).slice(3)
    expect(paid(0)).toEqual(['최종 결제 금액 14,000원'])
    expect(paid(4000)).toEqual(['최종 결제 금액 14,000원', '받은 금액 4,000원', '남은 금액 10,000원'])
    expect(paid(14000)).toEqual(['최종 결제 금액 14,000원', '받은 금액 14,000원', '입금 상태 입금 완료'])
    expect(paid(20000)).toEqual(['최종 결제 금액 14,000원', '받은 금액 20,000원', '환불할 금액 6,000원'])
    expect(JSON.stringify(receiptOf(base([settlement('settlement.payment', { amount: 1000, memo: '입금메모비밀' })]), 'UC_A'))).not.toContain('입금메모비밀')
  })

  it('최종 금액 0 하한도 코어 값 그대로 (큰 할인)', () => {
    const receipt = receiptOf(base([settlement('settlement.adjust', { amount: -50000, reason: '이벤트' })]), 'UC_A')
    expect(receipt.total).toBe(0)
    expect(rowText(receipt)).toContain('최종 결제 금액 0원')
  })

  it('상품 줄 순서는 방송 선언 순 → 번호 순, 빈 품종은 "품종 미입력", 회차는 품목이 있는 방송 제목들(선언 순)', () => {
    const state = play(
      [
        ...sale(30, 'UC_A', '길동', { b: 'b2', price: 3000 }),
        ...sale(20, 'UC_A', '길동'),
        ...sale(5, 'UC_A', '길동', { name: '' }),
        ...sale(1, 'UC_A', '길동', { b: 'b2', name: '   ', price: 2000 }),
        { type: 'product.register', b: 'b3', no: 1, name: '라울', price: 1000 },
      ],
      { broadcasts: [{ id: 'b1', date: '2026-10-18', title: '1부' }, { id: 'b2', date: '2026-10-18', title: '2부' }, { id: 'b3', date: '2026-10-18', title: '3부' }] },
    )
    const receipt = receiptOf(state, 'UC_A')
    expect(lineText(receipt)).toEqual(['1부 · 5 · 품종 미입력 · 10,000원', '1부 · 20 · 핑크프릴 · 10,000원', '2부 · 1 · 품종 미입력 · 2,000원', '2부 · 30 · 핑크프릴 · 3,000원'])
    expect(receipt.sessions).toEqual(['1부', '2부'])
  })

  it('가게 계좌 설정이 없으면 입금 계좌 칸이 없다, 가게 이름이 없으면 그 줄이 없다 (빈 칸·"없음"을 쓰지 않는다)', () => {
    const none = receiptOf(G201, 'UC_A', '2026-10-18', { shop: null })
    expect(none.account).toBe(null)
    expect(none.shopName).toBe(null)
    const blank = receiptOf(G201, 'UC_A', '2026-10-18', { shop: { name: '  ', account: { bank: '농협', number: ' ', holder: '김' } } })
    expect(blank.account).toBe(null)
    expect(blank.shopName).toBe(null)
    const noNote = receiptOf(G201, 'UC_A', '2026-10-18', { shop: { account: { bank: '농협', number: '123', holder: '' } } })
    expect(noNote.account).toEqual({ text: '농협 123', note: null })
    expect(JSON.stringify(none)).not.toContain('없음')
  })

  it('리허설 범위: 제목 "(리허설)"과 안내 줄', () => {
    const receipt = receiptOf(G201, 'UC_A', '2026-10-18', { rehearsal: true })
    expect(receipt.title).toBe('구매 내역 확인서 (리허설)')
    expect(receipt.rehearsalNote).toBe('리허설(연습)에서 만든 문서예요. 실제 거래가 아니에요.')
    expect(receipt.total).toBe(25000)
  })
})

describe('AC-P2-24 전원 일괄 데이터 — 순서와 빠지는 묶음', () => {
  it('G-ENG-202 · 2026-10-19 → 꽃님·문자찜·새싹·초록이·홍길동 (다육맘은 품목이 없어 빠진다), 최종 금액 = 골든', () => {
    const result = buildReceipts({ state: G202, date: '2026-10-19', rehearsal: false, createdAt: CREATED })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipts.map((r) => r.buyerName)).toEqual(['꽃님', '문자찜', '새싹', '초록이', '홍길동'])
    expect(result.receipts.map((r) => r.total)).toEqual([18000, 16000, 10000, 9000, 14000])
    expect(result.receipts[1]?.phoneLast4).toBe('5432')
  })

  // I2 (D-I2-04, TD-P2-004)에서 교체: 순서의 키가 원문 표시 이름에서 "찍힌 이름"으로 바뀌었다(harness/sprints/I2/dev-notes.md 교체 목록).
  // 글꼴을 넘기면 그 글꼴로 그릴 수 없는 🌵가 빠진 '선인장'으로 정렬되고(￠는 Pretendard에 있다), 넘기지 않으면 제어·서식 글자만 뺀 이름이다.
  it('순서는 찍힌 이름의 코드 포인트 순(보조 평면 글자 포함), 같으면 구매자 ID 순', () => {
    const state = play([...sale(1, 'UC_2', '같은이름'), ...sale(2, 'UC_1', '같은이름'), ...sale(3, 'UC_3', '\u{1F335}선인장'), ...sale(4, 'UC_4', '￠가'), ...sale(5, 'UC_5', 'Zed'), ...sale(6, 'UC_6', '가나')])
    const scope = { state, date: '2026-10-18', rehearsal: false, createdAt: CREATED }
    const withFont = buildReceipts(scope, loadDocumentFont(fontBytes()))
    expect(withFont.ok && withFont.receipts.map((r) => r.lines[0]?.no)).toEqual([5, 6, 2, 1, 3, 4])
    const withoutFont = buildReceipts(scope)
    expect(withoutFont.ok && withoutFont.receipts.map((r) => r.lines[0]?.no)).toEqual([5, 6, 2, 1, 4, 3])
  })

  it('품목이 있는 묶음이 없으면 쉬운 오류', () => {
    const result = buildReceipts({ state: G202, date: '2026-10-20', rehearsal: false, createdAt: CREATED })
    expect(result).toEqual({ ok: false, error: { code: 'NO_ITEMS', message: '그 날짜에 구매 내역이 있는 구매자가 없어요.' } })
  })
})

describe('AC-P2-27 개인정보 — 확인서 데이터', () => {
  it('전화번호 전체·전화번호 키·ref·구매자 ID·채널 ID·조정 사유·입금 메모가 없다', () => {
    const datas = [
      ...(['UC_A', 'sms:s1'] as const).map((buyer) => receiptOf(G201, buyer)),
      ...(() => {
        const result = buildReceipts({ state: G202, date: '2026-10-19', rehearsal: false, createdAt: CREATED })
        return result.ok ? result.receipts : []
      })(),
    ]
    expect(datas).toHaveLength(7)
    for (const data of datas) {
      const text = JSON.stringify(data)
      for (const secret of ['010-1234-5678', '01012345678', '010-9876-5432', '01098765432', 'sms:', 's1', 's2', 'UC_', '단골 할인', '구매자 요청', '전화 주문', 'phoneKey']) expect(text).not.toContain(secret)
      expect(text).not.toMatch(/[A-Za-z0-9_-]{24,}/) // 전화번호 키 모양 (시험 키는 HMAC base64url 43자)
    }
  })
})
