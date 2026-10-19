// P2 적대 테스트 (test-domain): 확인서 PDF 쪽 나눔 (AC-P2-23 "합계·최종 금액은 마지막 쪽에 한 번 나온다").
// TD-P2-001: 상품 줄이 한 쪽을 거의 채우면(가게 계좌 설정이 있는 보통 확인서, 28~30줄·73~75줄·118~120줄 …)
// 금액 블록은 앞 쪽 끝에 남고 입금 계좌 블록만 다음 쪽으로 넘어가, 마지막 쪽에 합계·최종 결제 금액이 없다.
// 구매자가 마지막 쪽(계좌 안내만 있는 쪽)만 보고 얼마를 보내야 하는지 모르게 되고, 금액과 입금 계좌가 다른 쪽으로 갈라진다.
import { describe, expect, it } from 'vitest'
import { buildReceipt, layoutReceipt, layoutTexts, loadDocumentFont, renderReceiptPdf, type ReceiptData } from '@livejjim/documents'
import { fontBytes, pdfPageTexts, play, sale, type EventInput } from '../../../packages/documents/test/helpers.ts'

const SHOP = { name: '초록다육', account: { bank: '농협', number: '302-9988-7766-11', holder: '김판매' }, accountNote: '입금자명은 닉네임으로 적어 주세요' }
const CREATED = Date.UTC(2026, 9, 18, 14, 30, 0)
const font = loadDocumentFont(fontBytes())

/** 한 구매자가 같은 날 상품 n개(각 1,000원)를 산 확인서 (기본 가게 설정 — 계좌 있음) */
function receiptWith(lines: number): ReceiptData {
  const events: EventInput[] = []
  for (let i = 1; i <= lines; i++) events.push(...sale(i, 'UC_A', '길동', { price: 1000 }))
  const result = buildReceipt({ state: play(events), buyer: 'UC_A', date: '2026-10-18', shop: SHOP, rehearsal: false, createdAt: CREATED })
  if (!result.ok) throw new Error(result.error.message)
  return result.receipt
}

describe('TD-P2-001 합계·최종 금액은 마지막 쪽에 (AC-P2-23)', () => {
  it('TD-P2-001: 상품 28줄 확인서 PDF — 마지막 쪽에 상품 합계·최종 결제 금액이 있다 (계좌 블록만 넘어간 쪽이 마지막이 되지 않는다)', async () => {
    const receipt = receiptWith(28)
    const pages = await pdfPageTexts(await renderReceiptPdf(receipt, font))
    expect(pages.length).toBeGreaterThanOrEqual(2)
    const last = (pages[pages.length - 1] as string[]).join(' ')
    expect(last).toContain('최종 결제 금액')
    expect(last).toContain('상품 합계')
    expect(last).toContain(receipt.rows.find((row) => row.key === 'total')?.text as string)
    // 합계는 한 번만
    expect(pages.flat().filter((text) => text.includes('최종 결제 금액'))).toHaveLength(1)
  })

  it('TD-P2-001: 상품 1~130줄 모두 — 배치 모델의 마지막 쪽에 최종 결제 금액이 있다', () => {
    const missing: number[] = []
    for (let lines = 1; lines <= 130; lines++) {
      const layout = layoutReceipt(receiptWith(lines), font, 'pdf')
      const last = layout.pages[layout.pages.length - 1]
      if (last === undefined || !layoutTexts({ mode: 'pdf', pages: [last] }, ['content']).includes('최종 결제 금액')) missing.push(lines)
    }
    expect(missing, `마지막 쪽에 최종 결제 금액이 없는 줄 수: ${missing.join(', ')}`).toEqual([])
  })
})
