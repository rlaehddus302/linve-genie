// O3 문서의 신뢰할 수 없는 글 (test-domain, AC-O3-30 (6), AC-O3-12·13, 절대 규칙 7): 닉네임·품종·옵션 글의 HTML·수식 모양 글
// (`=1+1`, `<b>`, `<script>`, `+82`, `@`)은 확인서 PDF·판매대장 엑셀에서 글 그대로다 — 엑셀은 글 칸(수식 아님), 옵션 열의 숫자 모양 옵션 글(`100`)도 글 칸.
import { listClaims } from '@livejjim/core'
import { buildLedger, buildReceipt, ledgerToXlsx, loadDocumentFont, renderReceiptPdf } from '@livejjim/documents'
import { describe, expect, it } from 'vitest'
import { fontBytes, pdfText, readXlsx } from '../../../packages/documents/test/helpers.ts'
import { CREATED_AT, D1, play } from './scenarios.ts'

const OPTS = [
  { name: '기종', choices: [{ label: '갤럭시 S26 울트라' }, { label: '100' }] },
  { name: '색상', choices: [{ label: '=2+3' }, { label: '<i>빨강' }] },
]
const { state } = play({
  broadcasts: [{ id: 'b1', date: D1, title: '<b>다육</b> 1부' }],
  settings: {},
  events: [
    { type: 'product.register', b: 'b1', no: 7, name: '<script>alert(1)</script>', price: 8000 },
    { type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '=1+1', text: '7' },
    { type: 'broadcast.start', b: 'b2', date: D1, title: '=HYPERLINK("http://x")', settings: { 'claim.parseMode': 'OPTIONS' } },
    { type: 'product.register', b: 'b2', no: 31, name: '=1+1 케이스', price: 15000, stock: 5, options: OPTS },
    { type: 'host.assign', b: 'b2', no: 31, buyer: 'UC_A', reason: '사유', qty: 2, options: { 기종: '갤럭시 S26 울트라', 색상: '=2+3' } },
    { type: 'chat', b: 'b2', id: 'm2', ch: 'UC_B', nick: '<b>다육</b>맘', text: '31 100 <i>빨강' },
  ],
})

describe('AC-O3-30 (6) HTML·수식 모양 글은 문서에서 글 그대로', () => {
  it('시나리오: 수식 모양 옵션 글 찜(수량 2)과 HTML 모양 옵션 글 찜이 확정이다', () => {
    const confirmed = listClaims(state).filter((c) => c.status === 'CONFIRMED')
    expect(confirmed.map((c) => [c.no, c.variant, c.qty]).sort()).toEqual([
      [31, '100/<i>빨강', 1],
      [31, '갤럭시 S26 울트라/=2+3', 2],
      [7, null, 1],
    ])
  })

  it('확인서 데이터·PDF 글: 품종 칸 `=1+1 케이스 갤럭시 S26 울트라/=2+3 (15,000원 × 2개)`, 닉네임 `<b>다육</b>맘` 그대로', async () => {
    const a = buildReceipt({ state, date: D1, buyer: 'UC_A', rehearsal: false, createdAt: CREATED_AT })
    const b = buildReceipt({ state, date: D1, buyer: 'UC_B', rehearsal: false, createdAt: CREATED_AT })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.receipt.lines.map((l) => [l.name, l.price])).toEqual([
      ['<script>alert(1)</script>', 8000],
      ['=1+1 케이스 갤럭시 S26 울트라/=2+3 (15,000원 × 2개)', 30000],
    ])
    expect(a.receipt.buyerName).toBe('=1+1')
    expect(b.receipt.lines.map((l) => l.name)).toEqual(['=1+1 케이스 100/<i>빨강'])
    const font = loadDocumentFont(fontBytes())
    const flatA = (await pdfText(await renderReceiptPdf(a.receipt, font))).replace(/\s+/g, '')
    expect(flatA).toContain('=1+1케이스갤럭시S26울트라/=2+3(15,000원×2개)')
    expect(flatA).toContain('<script>alert(1)</script>')
    const flatB = (await pdfText(await renderReceiptPdf(b.receipt, font))).replace(/\s+/g, '')
    expect(flatB).toContain('<b>다육</b>맘')
    expect(flatB).toContain('=1+1케이스100/<i>빨강')
  })

  it('판매대장 엑셀: 수식 모양 글은 글 칸(수식 아님), 옵션 열의 `100/<i>빨강`·`=2+3`도 글 칸, 수량·단가·가격은 수 칸', async () => {
    const ledger = buildLedger({ scopes: [{ state, rehearsal: false }], from: D1, to: D1 })
    expect(ledger.ok).toBe(true)
    if (!ledger.ok) return
    const [sheet] = await readXlsx(await ledgerToXlsx(ledger.rows, ledger.options))
    const rows = sheet?.rows ?? []
    const all = rows.flat()
    expect(all.some((cell) => cell.type === 'Formula' || cell.type === 'SharedString' || cell.type === 'Hyperlink')).toBe(false)
    const texts = rows.slice(1).map((row) => [row[1]?.value, row[3]?.value, row[4]?.value, row[5]?.value, row[6]?.value, row[7]?.value, row[8]?.value])
    expect(texts).toEqual([
      ['<b>다육</b> 1부', '<script>alert(1)</script>', null, 1, 8000, 8000, '=1+1'],
      ['=HYPERLINK("http://x")', '=1+1 케이스', '갤럭시 S26 울트라/=2+3', 2, 15000, 30000, '=1+1'],
      ['=HYPERLINK("http://x")', '=1+1 케이스', '100/<i>빨강', 1, 15000, 15000, '<b>다육</b>맘'],
    ])
    for (const row of rows.slice(1)) {
      for (const col of [1, 3, 4, 8]) if (row[col]?.value !== null) expect(row[col]?.type, String(row[col]?.value)).toBe('String')
      for (const col of [2, 5, 6, 7]) expect(row[col]?.type).toBe('Number')
    }
  })
})
