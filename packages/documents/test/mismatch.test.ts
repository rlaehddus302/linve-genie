// AC-P2-21: 줄 가격의 합이 코어 상품 합계와 다르면(일부러 어긋난 가짜 상태) 확인서를 만들지 않고 쉬운 오류 — PDF·이미지도 만들지 않는다.
// 실제 코어에서는 둘이 늘 같으므로(INV-5) 코어의 getSettlement만 바꿔 끼운 가짜로 어긋난 상태를 만든다.
import type * as Core from '@livejjim/core'
import { describe, expect, it, vi } from 'vitest'

const corrupt = vi.hoisted(() => ({ subtotal: 0, extraItem: false }))

vi.mock('@livejjim/core', async (importOriginal) => {
  const actual = await importOriginal<typeof Core>()
  return {
    ...actual,
    getSettlement: (...args: Parameters<typeof actual.getSettlement>) => {
      const real = actual.getSettlement(...args)
      return { ...real, subtotal: real.subtotal + corrupt.subtotal, items: corrupt.extraItem ? [...real.items, 'b9/99'] : real.items }
    },
  }
})

const { buildReceipt, buildReceipts, renderBatchPdf } = await import('../src/index.ts')
const { fontBytes, replayGolden } = await import('./helpers.ts')

const state = replayGolden('G-ENG-201')
const input = { state, buyer: 'UC_A', date: '2026-10-18', rehearsal: false, createdAt: Date.UTC(2026, 9, 18, 14, 30) }
const MISMATCH = { code: 'AMOUNT_MISMATCH', message: '확인서 금액이 정산 금액과 맞지 않아 확인서를 만들지 않았어요. 정산 화면의 금액을 확인하고 고객센터에 알려 주세요.' }

describe('AC-P2-21 어긋난 금액이면 만들지 않는다', () => {
  it('어긋나지 않으면 만든다 (가짜를 끈 상태)', () => {
    corrupt.subtotal = 0
    corrupt.extraItem = false
    expect(buildReceipt(input).ok).toBe(true)
  })

  it.each([1, -1, 1000])('상품 합계가 줄 합과 %s원 다르면 오류', async (delta) => {
    corrupt.subtotal = delta
    corrupt.extraItem = false
    expect(buildReceipt(input)).toEqual({ ok: false, error: MISMATCH })
    // 전원 일괄도 전체를 만들지 않는다 — PDF 없음
    expect(buildReceipts(input)).toEqual({ ok: false, error: MISMATCH })
    const pdf = await renderBatchPdf(input, fontBytes())
    expect(pdf).toEqual({ ok: false, error: MISMATCH })
  })

  it('품목 수가 줄 수와 다르면 오류', () => {
    corrupt.subtotal = 0
    corrupt.extraItem = true
    expect(buildReceipt(input)).toEqual({ ok: false, error: MISMATCH })
    corrupt.extraItem = false
  })

  it('오류 문장에 영어·개발 용어가 없다', () => {
    expect(MISMATCH.message).not.toMatch(/[A-Za-z]/)
  })
})
