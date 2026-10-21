// O3 확인서·판매대장의 옵션 글·수량 (AC-O3-11~13 — SPEC STL-04·STL-06 옵션, R-19 "표시", D-O3-05~08).
// 상태는 엔진 골든 G-ENG-O3-01(engine/24-o3-labels-documents.yaml)을 실제 코어에 재생한 것.
import { getSettlement, listBuyers } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import {
  LEDGER_COLUMNS,
  LEDGER_OPTION_COLUMNS,
  buildLedger,
  buildReceipt,
  hasOptionColumns,
  itemText,
  layoutReceipt,
  ledgerRowValues,
  ledgerRowValuesWith,
  ledgerToXlsx,
  linesMatchSettlement,
  loadDocumentFont,
  renderBatchPdf,
  renderReceiptPdf,
  renderReceiptPng,
  type LayoutText,
  type ReceiptData,
} from '../src/index.ts'
import { decodePng, fontBytes, pdfText, readXlsx, replayGolden } from './helpers.ts'

const O3 = replayGolden('G-ENG-O3-01', 'engine/24-o3-labels-documents.yaml')
const DATE = '2026-10-25'
const CREATED = Date.UTC(2026, 9, 25, 14, 0, 0)
const font = loadDocumentFont(fontBytes())

function receipt(buyer: string): ReceiptData {
  const result = buildReceipt({ state: O3, buyer, date: DATE, rehearsal: false, createdAt: CREATED })
  if (!result.ok) throw new Error(result.error.message)
  return result.receipt
}
const smsBuyer = (): string => listBuyers(O3).find((b) => b.kind === 'sms')?.id ?? 'sms:s1'

describe('AC-O3-11 확인서 품목 줄', () => {
  it('홍길동: 옵션 글은 품종 뒤, 수량 2 이상이면 (단가 × 수량), 가격 칸은 찜 금액, 상품 수 = 수량 합', () => {
    const r = receipt('UC_A')
    expect(r.lines.map((l) => [l.name, l.priceText])).toEqual([
      ['핑크프릴', '8,000원'],
      ['초코 과자 (2,000원 × 3개)', '6,000원'],
      ['반바지 M', '10,000원'],
      ['반바지 L', '10,000원'],
      ['반팔티 105/검정색 (17,000원 × 2개)', '34,000원'],
    ])
    expect(r.itemCount).toBe(8)
    expect(r.rows.find((row) => row.key === 'itemCount')?.text).toBe('8개')
    expect(r.rows.find((row) => row.key === 'subtotal')?.text).toBe('68,000원')
    expect(r.rows.find((row) => row.key === 'total')?.text).toBe('72,000원')
  })

  it('김철수: 옵션 없는 수량 1은 지금 줄 모양 그대로 · 문자찜: 옵션 글과 끝자리', () => {
    const b = receipt('UC_B')
    expect(b.lines.map((l) => [l.name, l.priceText])).toEqual([['초코 과자', '2,000원']])
    expect(b.itemCount).toBe(1)
    const s = receipt(smsBuyer())
    expect(s.lines.map((l) => [l.name, l.priceText])).toEqual([['반팔티 100/흰색', '15,000원']])
    expect(s.phoneLast4).toBe('5678')
  })

  it('줄 금액(찜 금액) 합이 코어 상품 합계와 다르면 만들지 않는다 — 단가만 더하면 맞지 않는다', () => {
    const r = receipt('UC_A')
    const settlement = getSettlement(O3, 'UC_A', DATE)
    expect(linesMatchSettlement(r.lines, settlement)).toBe(true)
    // 단가(찜 금액이 아닌 값)로 적은 줄이면 합이 다르다 (34,000 → 17,000, 6,000 → 2,000)
    const unitLines = r.lines.map((l, i) => (i === 1 ? { ...l, price: 2000 } : i === 4 ? { ...l, price: 17000 } : l))
    expect(linesMatchSettlement(unitLines, settlement)).toBe(false)
    expect(linesMatchSettlement(r.lines, { ...settlement, subtotal: settlement.subtotal + 1 })).toBe(false)
  })

  it('품종 칸 글 규칙: itemText', () => {
    expect(itemText('반팔티', '105/검정색', 17000, 2)).toBe('반팔티 105/검정색 (17,000원 × 2개)')
    expect(itemText('반팔티', '105/검정색', 17000, 1)).toBe('반팔티 105/검정색')
    expect(itemText('초코 과자', null, 2000, 3)).toBe('초코 과자 (2,000원 × 3개)')
    expect(itemText('핑크프릴', null, 8000, 1)).toBe('핑크프릴')
    expect(itemText('품종 미입력', 'M', 0, 1)).toBe('품종 미입력 M')
  })
})

describe('AC-O3-12 확인서 PDF·공유 이미지·전원 PDF에 옵션 줄', () => {
  it('한 사람 PDF 글에 옵션 줄과 찜 금액이 있다', async () => {
    const text = await pdfText(await renderReceiptPdf(receipt('UC_A'), font))
    const flat = text.replace(/\s+/g, '')
    expect(flat).toContain('반팔티105/검정색(17,000원×2개)')
    expect(flat).toContain('초코과자(2,000원×3개)')
    expect(text).toContain('34,000원')
    expect(text).not.toContain('…')
  })

  it('전원 PDF에도 옵션 줄이 있다', async () => {
    const result = await renderBatchPdf({ state: O3, date: DATE, rehearsal: false, createdAt: CREATED }, font)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const flat = (await pdfText(result.pdf)).replace(/\s+/g, '')
    expect(flat).toContain('반팔티105/검정색(17,000원×2개)')
    expect(flat).toContain('반팔티100/흰색')
  })

  it('품종 칸을 넘는 옵션 줄은 줄을 바꿔 다 찍힌다 (잘린 글·… 없음)', async () => {
    const base = receipt('UC_A')
    const long = '아주 긴 품종 이름 오버핏 반팔 티셔츠 여름 신상 특가 한정 수량 아이폰 17 프로 맥스/투명 (17,000원 × 2개)'
    const data: ReceiptData = { ...base, lines: base.lines.map((l, i) => (i === 4 ? { ...l, name: long } : l)) }
    const layout = layoutReceipt(data, font, 'pdf')
    const texts = layout.pages.flatMap((p) => p.items.filter((item): item is LayoutText => item.kind === 'text').map((item) => item.text))
    const wrapped = texts.filter((t) => long.includes(t) && t.length > 2)
    expect(wrapped.length).toBeGreaterThan(1)
    expect(texts.join('').replace(/\s+/g, '')).toContain(long.replace(/\s+/g, ''))
    expect(texts.some((t) => t.includes('…'))).toBe(false)
    const flat = (await pdfText(await renderReceiptPdf(data, font))).replace(/\s+/g, '')
    expect(flat).toContain(long.replace(/\s+/g, ''))
  })

  it('공유 PNG는 폭 1080px 한 장', () => {
    const image = decodePng(renderReceiptPng(receipt('UC_A'), font))
    expect(image.width).toBe(1080)
    expect(image.height).toBeGreaterThan(0)
  })
})

describe('AC-O3-13 판매대장 열과 행', () => {
  const ledger = (broadcasts?: string[]) => {
    const result = buildLedger({ scopes: [{ state: O3, rehearsal: false }], from: DATE, to: DATE, ...(broadcasts === undefined ? {} : { broadcasts }) })
    if (!result.ok) throw new Error(result.error.message)
    return result
  }

  it('방송을 고르지 않으면·b2만이면 14열, b1만이면 O3 전 11열 그대로(행 객체에 옵션 칸 없음)', () => {
    expect(ledger().options).toBe(true)
    expect(ledger(['b2']).options).toBe(true)
    const b1 = ledger(['b1'])
    expect(b1.options).toBe(false)
    expect(b1.rows.every((row) => !hasOptionColumns(row))).toBe(true)
    expect(Object.keys(b1.rows[0] ?? {}).sort()).toEqual(['buyer', 'channel', 'claimedAt', 'date', 'name', 'no', 'payment', 'price', 'session', 'shipping', 'status'])
    expect(ledgerRowValues(b1.rows[0]!)).toHaveLength(11)
  })

  it('옵션 상품(21·22)의 확정 찜이 "판매 중" 빈 행으로 빠지지 않는다', () => {
    const rows = ledger().rows
    const of = (no: number) => rows.filter((row) => row.no === no)
    expect(of(21).map((r) => [r.variant, r.status])).toEqual([
      ['M', '1등'],
      ['L', '1등'],
    ])
    expect(of(22).map((r) => [r.variant, r.qty, r.unitPrice, r.price])).toEqual([
      ['105/검정색', 2, 17000, 34000],
      ['100/흰색', 1, 15000, 15000],
    ])
    expect(of(23).map((r) => [r.status, r.variant, r.qty, r.unitPrice, r.price])).toEqual([['판매 중', '', '', '', 3000]])
  })

  it('엑셀로 쓰고 다시 읽으면 14열 첫 줄, 수량·단가·가격은 수 칸, 빈칸은 빈 셀', async () => {
    const result = ledger()
    const sheet = (await readXlsx(await ledgerToXlsx(result.rows, result.options)))[0]
    expect(sheet?.rows[0]?.map((c) => c.value)).toEqual([...LEDGER_OPTION_COLUMNS])
    const back = (sheet?.rows.slice(1) ?? []).map((cells) => cells.map((c) => (c.value === null ? '' : c.value)))
    expect(back).toEqual(result.rows.map((row) => ledgerRowValuesWith(row, true)))
    const shirt = sheet?.rows.find((cells) => cells[4]?.value === '105/검정색')
    expect(shirt?.slice(5, 8).map((c) => [c.type, c.value])).toEqual([
      ['Number', 2],
      ['Number', 17000],
      ['Number', 34000],
    ])
    expect(shirt?.[6]?.numFmt).toBe('#,##0')
    expect(shirt?.[7]?.numFmt).toBe('#,##0')
    const socks = sheet?.rows.find((cells) => cells[3]?.value === '양말')
    expect(socks?.slice(4, 7).map((c) => c.type)).toEqual(['Null', 'Null', 'Null'])
  })

  it('b1만 고른 엑셀은 O3 전 11열', async () => {
    const result = ledger(['b1'])
    const sheet = (await readXlsx(await ledgerToXlsx(result.rows, result.options)))[0]
    expect(sheet?.rows[0]?.map((c) => c.value)).toEqual([...LEDGER_COLUMNS])
    // 옵션을 넘기지 않아도 행으로 정한다
    const again = (await readXlsx(await ledgerToXlsx(result.rows)))[0]
    expect(again?.rows[0]?.map((c) => c.value)).toEqual([...LEDGER_COLUMNS])
  })

  it('옵션 칸이 없는 날짜의 행을 옵션 대장에 이어 붙이면: 확정 행은 옵션 "" · 수량 1 · 단가 = 가격, 확정 없는 행은 빈칸', async () => {
    const plain = ledger(['b1']).rows
    const withOptions = ledger(['b2']).rows
    const rows = [...plain, ...withOptions]
    expect(ledgerRowValuesWith(plain[0]!, true)).toEqual(['2026-10-25', '다육 1부', 7, '핑크프릴', '', 1, 8000, 8000, '홍길동', '유튜브', '2026-10-25 20:00:05', '1등', '미입금', ''])
    const sheet = (await readXlsx(await ledgerToXlsx(rows)))[0]
    expect(sheet?.rows[0]?.map((c) => c.value)).toEqual([...LEDGER_OPTION_COLUMNS])
    expect(sheet?.rows[1]?.map((c) => (c.value === null ? '' : c.value))).toEqual(ledgerRowValuesWith(plain[0]!, true))
  })

  it('글 값은 수식이 되지 않는다 (옵션 칸 포함)', async () => {
    const result = ledger()
    const rows = result.rows.map((row) => (row.variant === 'M' ? { ...row, variant: '=1+1', name: '<b>반바지</b>' } : row))
    const sheet = (await readXlsx(await ledgerToXlsx(rows, true)))[0]
    const cells = sheet?.rows.find((c) => c[4]?.value === '=1+1')
    expect(cells?.[4]?.type).toBe('String')
    expect(cells?.[3]?.value).toBe('<b>반바지</b>')
    expect(sheet?.rows.flat().some((c) => c.type === 'Formula')).toBe(false)
  })
})
