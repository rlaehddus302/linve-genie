// AC-P2-23 한 명 PDF · AC-P2-24 전원 일괄 PDF · AC-P2-26 그릴 수 없는 글자·긴 글 · AC-P2-27 개인정보 (PDF)
import type { EngineState } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import {
  LEGAL_NOTICE,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  buildReceipt,
  buildReceipts,
  layoutReceipt,
  layoutTexts,
  loadDocumentFont,
  renderBatchPdf,
  renderReceiptPdf,
  type LayoutText,
  type ReceiptData,
  type ReceiptLayout,
} from '../src/index.ts'
import { fontBytes, pdfFonts, pdfGlyphProblems, pdfPageSizes, pdfPageTexts, pdfText, play, replayGolden, sale, type EventInput } from './helpers.ts'

const SHOP = { name: '초록다육', account: { bank: '농협', number: '302-9988-7766-11', holder: '김판매' }, accountNote: '입금자명은 닉네임으로 적어 주세요' }
const CREATED = Date.UTC(2026, 9, 18, 14, 30, 0)
const font = loadDocumentFont(fontBytes())
const G201 = replayGolden('G-ENG-201')
const G202 = replayGolden('G-ENG-202')

function receipt(state: EngineState, buyer: string, date = '2026-10-18'): ReceiptData {
  const result = buildReceipt({ state, buyer, date, shop: SHOP, rehearsal: false, createdAt: CREATED })
  if (!result.ok) throw new Error(result.error.message)
  return result.receipt
}

/** 한 쪽 안의 글자 상자가 겹치지 않고 쪽 안에 있는지 */
export function overlapProblems(layout: ReceiptLayout): string[] {
  const problems: string[] = []
  layout.pages.forEach((page, p) => {
    const texts = page.items.filter((item): item is LayoutText => item.kind === 'text')
    for (const item of texts) {
      if (item.x < 0 || item.y < 0 || item.x + item.width > page.width + 0.01 || item.y + item.height > page.height + 0.01) problems.push(`쪽 ${String(p + 1)} 밖: ${item.text}`)
    }
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i] as LayoutText
        const b = texts[j] as LayoutText
        const overlapX = a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01
        const overlapY = a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01
        if (overlapX && overlapY) problems.push(`쪽 ${String(p + 1)} 겹침: "${a.text}" ↔ "${b.text}"`)
      }
    }
  })
  return problems
}

/** 한 구매자가 상품 n개를 산 상태 */
function manyLines(count: number, fields: (i: number) => { name?: string; price?: number } = () => ({})): EngineState {
  const events: EventInput[] = []
  for (let i = 1; i <= count; i++) events.push(...sale(i, 'UC_A', '길동', { name: fields(i).name ?? `품종${String(i)}호`, price: fields(i).price ?? 1000 * i }))
  return play(events)
}

describe('AC-P2-23 한 명 PDF', () => {
  it('A4 세로, AC-P2-20의 글자가 모두 나오고 한글이 깨지지 않는다, 쪽 번호 1/1', async () => {
    const pdf = await renderReceiptPdf(receipt(G201, 'UC_A'), fontBytes())
    expect(await pdfPageSizes(pdf)).toEqual([{ width: PAGE_WIDTH, height: PAGE_HEIGHT }])
    const [page] = await pdfPageTexts(pdf)
    for (const text of [
      '구매 내역 확인서',
      '초록다육',
      '길동이',
      '2026년 10월 18일',
      '1부, 2부',
      '15',
      '핑크프릴',
      '10,000원',
      '28',
      '라울',
      '5,000원',
      '7',
      '블루엘프',
      '8,000원',
      '상품 합계',
      '23,000원',
      '배송비',
      '4,000원',
      '할인',
      '-2,000원',
      '최종 결제 금액',
      '25,000원',
      '받은 금액',
      '남은 금액',
      '15,000원',
      '농협 302-9988-7766-11 (예금주 김판매)',
      '입금자명은 닉네임으로 적어 주세요',
      '2026년 10월 18일 23:30',
      LEGAL_NOTICE,
      '1/1',
    ]) {
      expect(page, text).toContain(text)
    }
    // PDF 글자 순서 = 배치 모델 순서 (뽑은 글자가 그린 글자와 같다 — 깨진 글자 없음)
    expect(page).toEqual(layoutTexts(layoutReceipt(receipt(G201, 'UC_A'), font, 'pdf')))
  })

  it('문자 구매자: 휴대폰 끝자리, 직접 수령', async () => {
    const text = await pdfText(await renderReceiptPdf(receipt(G201, 'sms:s1'), font))
    expect(text).toContain('문자찜(김영희)')
    expect(text).toContain('휴대폰 끝자리 5678')
    expect(text).toContain('배송비 (직접 수령)')
    expect(text).toContain('방울복랑 금')
  })

  it('글꼴이 PDF 안에 들어 있다 — 기본 14 글꼴·시스템 글꼴 이름만 적은 참조가 없다', async () => {
    const fonts = await pdfFonts(await renderReceiptPdf(receipt(G201, 'UC_A'), font))
    expect(fonts.length).toBeGreaterThan(0)
    for (const info of fonts) {
      expect(info.embedded, JSON.stringify(info)).toBe(true)
      expect(info.baseFont).not.toMatch(/Helvetica|Times|Courier|Symbol|ZapfDingbats|Arial|Malgun|Gulim|Batang|AppleSDGothic/i)
    }
    expect(fonts.map((f) => f.subtype).sort()).toEqual(['/CIDFontType2', '/Type0'])
  })

  it('찍힌 글자마다 글꼴 모양과 폭이 PDF 안에 있다 — 한글이 빈칸으로, "23:30"·"302-9988"이 벌어져 보이지 않는다 (D-PDF-FONT-01)', async () => {
    const one = await renderReceiptPdf(receipt(G201, 'UC_A'), font)
    expect(await pdfGlyphProblems(one)).toEqual([])
    const batch = await renderBatchPdf({ state: G202, date: '2026-10-19', shop: SHOP, rehearsal: false, createdAt: CREATED }, font)
    expect(batch.ok).toBe(true)
    if (batch.ok) expect(await pdfGlyphProblems(batch.pdf)).toEqual([])
  })

  it('상품 줄 60개 → 여러 쪽, 줄이 빠지거나 겹치지 않고 합계·최종 금액은 마지막 쪽에 한 번, 모든 쪽에 고지와 n/전체', async () => {
    const data = receipt(manyLines(60), 'UC_A')
    const layout = layoutReceipt(data, font, 'pdf')
    expect(layout.pages.length).toBeGreaterThanOrEqual(2)
    expect(overlapProblems(layout)).toEqual([])
    const pages = await pdfPageTexts(await renderReceiptPdf(data, font))
    expect(pages).toHaveLength(layout.pages.length)
    const all = pages.flat()
    for (let i = 1; i <= 60; i++) expect(all.filter((text) => text === `품종${String(i)}호`), `${String(i)}번 줄`).toHaveLength(1)
    pages.forEach((page, i) => {
      expect(page, `${String(i + 1)}쪽 고지`).toContain(LEGAL_NOTICE)
      expect(page, `${String(i + 1)}쪽 번호`).toContain(`${String(i + 1)}/${String(pages.length)}`)
      const total = page.includes('최종 결제 금액') ? 1 : 0
      expect(total, `${String(i + 1)}쪽 최종 금액`).toBe(i === pages.length - 1 ? 1 : 0)
      expect(page.filter((text) => text === '상품 합계'), `${String(i + 1)}쪽 상품 합계`).toHaveLength(i === pages.length - 1 ? 1 : 0)
    })
    // 줄 순서는 번호 순 그대로 이어진다
    const order = all.filter((text) => /^품종\d+호$/.test(text)).map((text) => Number(text.slice(2, -1)))
    expect(order).toEqual(Array.from({ length: 60 }, (_, i) => i + 1))
  })

  it('상품 1~130줄 전부 — 마지막 쪽에 상품 합계·최종 결제 금액이 한 번, 입금 계좌도 그 쪽에 (계좌만 넘어간 쪽이 없다)', () => {
    const lastPageProblems = (shop: typeof SHOP | null): number[] => {
      const bad: number[] = []
      for (let lines = 1; lines <= 130; lines++) {
        const result = buildReceipt({ state: manyLines(lines, () => ({ price: 1000 })), buyer: 'UC_A', date: '2026-10-18', shop, rehearsal: false, createdAt: CREATED })
        if (!result.ok) throw new Error(result.error.message)
        const layout = layoutReceipt(result.receipt, font, 'pdf')
        const pages = layout.pages.map((page) => layoutTexts({ mode: 'pdf', pages: [page] }, ['content']))
        const last = pages.at(-1) ?? []
        const totals = pages.flat().filter((text) => text === '최종 결제 금액' || text === '상품 합계')
        const accountOk = shop === null ? !pages.flat().includes('입금 계좌') : last.includes('입금 계좌') && last.includes('입금자명은 닉네임으로 적어 주세요')
        if (!last.includes('최종 결제 금액') || !last.includes('상품 합계') || totals.length !== 2 || !accountOk) bad.push(lines)
        if (overlapProblems(layout).length > 0) bad.push(-lines)
      }
      return bad
    }
    expect(lastPageProblems(SHOP), '계좌 있음').toEqual([])
    expect(lastPageProblems(null), '계좌 없음').toEqual([])
  })

  it('입금 안내 문장이 한 쪽보다 길어도 마지막 쪽에 최종 결제 금액, 글자는 빠지지 않고 이미지와 같은 순서', () => {
    const longNote = Array.from({ length: 900 }, (_, i) => `안내${String(i)}`).join(' ')
    for (const lines of [1, 28, 60]) {
      const result = buildReceipt({ state: manyLines(lines), buyer: 'UC_A', date: '2026-10-18', shop: { ...SHOP, accountNote: longNote }, rehearsal: false, createdAt: CREATED })
      if (!result.ok) throw new Error(result.error.message)
      const pdf = layoutReceipt(result.receipt, font, 'pdf')
      const last = layoutTexts({ mode: 'pdf', pages: [pdf.pages.at(-1) as ReceiptLayout['pages'][number]] }, ['content'])
      expect(last, `${String(lines)}줄`).toContain('최종 결제 금액')
      const content = layoutTexts(pdf, ['content'])
      expect(content.filter((text) => text === '최종 결제 금액'), `${String(lines)}줄`).toHaveLength(1)
      expect(content.join(' ')).toContain('안내899')
      expect(overlapProblems(pdf)).toEqual([])
      expect(layoutTexts(layoutReceipt(result.receipt, font, 'image'), ['content'])).toEqual(content)
    }
  })

  it('같은 확인서·글꼴이면 같은 PDF (시계를 읽지 않는다)', async () => {
    const data = receipt(G201, 'UC_A')
    expect(await renderReceiptPdf(data, font)).toEqual(await renderReceiptPdf(data, fontBytes()))
  })
})

describe('AC-P2-24 전원 일괄 PDF', () => {
  it('G-ENG-202 · 2026-10-19 → 구매자마다 새 쪽, 순서 꽃님·문자찜·새싹·초록이·홍길동, 쪽마다 최종 금액 = 골든', async () => {
    const result = await renderBatchPdf({ state: G202, date: '2026-10-19', shop: SHOP, rehearsal: false, createdAt: CREATED }, fontBytes())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const pages = await pdfPageTexts(result.pdf)
    expect(pages.length).toBeGreaterThanOrEqual(5)
    const buyers = ['꽃님', '문자찜', '새싹', '초록이', '홍길동']
    const totals = ['18,000원', '16,000원', '10,000원', '9,000원', '14,000원']
    // 각 구매자의 첫 쪽: 구매자 이름 다음 칸, 쪽 번호 1/n부터
    const firstPages = pages.filter((page) => page.some((text) => /^1\/\d+$/.test(text)))
    expect(firstPages).toHaveLength(5)
    firstPages.forEach((page, i) => {
      expect(page[page.indexOf('구매자') + 1]).toBe(buyers[i])
      const at = page.indexOf('최종 결제 금액')
      expect(page[at + 1]).toBe(totals[i])
    })
    expect(pages.flat().join(' ')).not.toContain('다육맘')
    expect((await pdfPageSizes(result.pdf)).every((size) => size.width === PAGE_WIDTH && size.height === PAGE_HEIGHT)).toBe(true)
  })

  it('품목이 있는 묶음이 없으면 PDF 없이 쉬운 오류', async () => {
    const result = await renderBatchPdf({ state: G202, date: '2026-10-18', rehearsal: false, createdAt: CREATED }, font)
    expect(result).toEqual({ ok: false, error: { code: 'NO_ITEMS', message: '그 날짜에 구매 내역이 있는 구매자가 없어요.' } })
  })

  it('여러 쪽인 구매자의 쪽 번호는 그 구매자 안에서 1/n부터', async () => {
    const events: EventInput[] = []
    for (let i = 1; i <= 50; i++) events.push(...sale(i, 'UC_A', '가나다', { name: `긴목록${String(i)}` }))
    events.push(...sale(51, 'UC_B', '라마바'))
    const state = play(events)
    const built = buildReceipts({ state, date: '2026-10-18', rehearsal: false, createdAt: CREATED })
    if (!built.ok) throw new Error('일괄 실패')
    const pages = await pdfPageTexts(await renderBatchPdf({ state, date: '2026-10-18', rehearsal: false, createdAt: CREATED }, font).then((r) => (r.ok ? r.pdf : new Uint8Array())))
    const numbers = pages.map((page) => page.find((text) => /^\d+\/\d+$/.test(text)))
    const first = layoutReceipt(built.receipts[0] as ReceiptData, font, 'pdf').pages.length
    expect(first).toBeGreaterThanOrEqual(2)
    expect(numbers).toEqual([...Array.from({ length: first }, (_, i) => `${String(i + 1)}/${String(first)}`), '1/1'])
  })

  it('성능: 구매자 100명(품목 합 500개) 일괄 PDF를 30초 안에', async () => {
    const events: EventInput[] = []
    for (let buyer = 0; buyer < 100; buyer++) {
      for (let k = 0; k < 5; k++) {
        const no = buyer * 5 + k + 1
        events.push(...sale(no, `UC_${String(buyer).padStart(3, '0')}`, `구매자${String(buyer)}`, { name: `품종${String(no % 37)}`, price: 1000 + no * 10 }))
      }
    }
    const state = play(events)
    const started = performance.now()
    const result = await renderBatchPdf({ state, date: '2026-10-18', shop: SHOP, rehearsal: false, createdAt: CREATED }, fontBytes())
    const elapsed = performance.now() - started
    expect(result.ok).toBe(true)
    expect(result.ok && result.receipts).toHaveLength(100)
    expect(elapsed).toBeLessThan(30_000)
  })
})

describe('AC-P2-26 그릴 수 없는 글자·긴 글', () => {
  const nickState = (nick: string, extra: { name?: string; price?: number } = {}): EngineState => play(sale(1, 'UC_A', nick, extra))

  it.each([
    ['🌵다육맘', '다육맘'],
    ['다육\n맘\t님', '다육맘님'],
    ['‏다육‮맘​', '다육맘'],
    ['👩‍👩‍👧️다육맘', '다육맘'],
    ['다육맘สวัสดี', '다육맘'],
  ])('닉네임 %j → %s (그 글자만 빠진다)', async (nick, shown) => {
    const data = receipt(nickState(nick), 'UC_A')
    const pages = await pdfPageTexts(await renderReceiptPdf(data, font))
    expect(pages[0]?.[pages[0].indexOf('구매자') + 1]).toBe(shown)
  })

  it('빼서 구매자 이름이 비면 (이름 없음)', async () => {
    const text = await pdfText(await renderReceiptPdf(receipt(nickState('🌵🌵\n'), 'UC_A'), font))
    expect(text).toContain('구매자 (이름 없음)')
  })

  it('품종·가게 이름의 그릴 수 없는 글자도 빠진다, 문서는 만들어진다', async () => {
    const data = receipt(nickState('길동', { name: '핑크🌸프릴\t금' }), 'UC_A')
    const result = buildReceipt({ state: nickState('길동', { name: '핑크🌸프릴\t금' }), buyer: 'UC_A', date: '2026-10-18', shop: { name: '🌵초록\n다육' }, rehearsal: false, createdAt: CREATED })
    expect(result.ok).toBe(true)
    const text = await pdfText(await renderReceiptPdf(result.ok ? result.receipt : data, font))
    expect(text).toContain('핑크프릴금')
    expect(text).toContain('초록다육')
  })

  it('긴 품종(40글자)·긴 이름(60글자)은 줄을 바꿔 전부 보이고 옆 칸과 겹치지 않는다', async () => {
    const longName = '아주긴닉네임'.repeat(10) // 60글자
    const longVariety = '세상에서가장긴다육식물품종이름'.repeat(3).slice(0, 40)
    const data = receipt(play([...sale(1, 'UC_A', longName, { name: longVariety }), ...sale(2, 'UC_A', longName, { name: `${longVariety} 금`, price: 0 })]), 'UC_A')
    for (const mode of ['pdf', 'image'] as const) {
      const layout = layoutReceipt(data, font, mode)
      expect(overlapProblems(layout), mode).toEqual([])
      const texts = layoutTexts(layout, ['content'])
      // 줄 바꿈한 조각을 이으면 원래 글이 나온다 (잘라 숨기지 않는다)
      expect(texts.join('')).toContain(longName)
      expect(texts.join('')).toContain(longVariety)
      expect(texts.filter((t) => longName.startsWith(t) || longName.includes(t)).length).toBeGreaterThanOrEqual(2)
    }
    const text = (await pdfPageTexts(await renderReceiptPdf(data, font))).flat().join('')
    expect(text).toContain(longName)
    expect(text).toContain(longVariety)
  })

  it('0원 상품·1,000,000원 상품·=로 시작하는 닉네임도 글자 그대로', async () => {
    const data = receipt(play([...sale(1, 'UC_A', '=SUM(A1)+1', { price: 0 }), ...sale(2, 'UC_A', '=SUM(A1)+1', { price: 1_000_000 })]), 'UC_A')
    const pages = await pdfPageTexts(await renderReceiptPdf(data, font))
    const page = pages[0] as string[]
    expect(page).toContain('=SUM(A1)+1')
    expect(page).toContain('0원')
    expect(page).toContain('1,000,000원')
    expect(overlapProblems(layoutReceipt(data, font, 'pdf'))).toEqual([])
  })

  it('속성: 아무 닉네임·품종(제어 글자·이모지·다른 문자 체계·아주 긴 글)이어도 PDF가 만들어지고 배치가 겹치지 않는다', async () => {
    const samples = ['', ' ', '\u0000\u0001', '🌵'.repeat(50), 'ทดสอบ', 'مرحبا', '漢字テスト', 'Ⅻ①', `${'가'.repeat(300)}`, 'a b c '.repeat(40), '\uD800', '%PDF-1.7 (x) \\ )']
    for (const nick of samples) {
      for (const name of samples.slice(0, 6)) {
        const data = receipt(play(sale(1, 'UC_A', nick.trim() === '' ? '빈' : nick, { name })), 'UC_A')
        expect(overlapProblems(layoutReceipt(data, font, 'pdf')), `${nick}/${name}`).toEqual([])
      }
      const data = receipt(play(sale(1, 'UC_A', nick.trim() === '' ? '빈' : nick, { name: nick })), 'UC_A')
      const pdf = await renderReceiptPdf(data, font)
      expect(pdf.length).toBeGreaterThan(1000)
    }
  })
})

describe('AC-P2-27 개인정보 — PDF', () => {
  it('G-ENG-201·202 PDF에 전화번호 전체·ref·구매자 ID·채널 ID·조정 사유·입금 메모가 없다', async () => {
    const single = await Promise.all(['UC_A', 'sms:s1'].map((buyer) => renderReceiptPdf(receipt(G201, buyer), font)))
    const batch = await renderBatchPdf({ state: G202, date: '2026-10-19', shop: SHOP, rehearsal: false, createdAt: CREATED }, font)
    const pdfs = [...single, ...(batch.ok ? [batch.pdf] : [])]
    expect(pdfs).toHaveLength(3)
    for (const pdf of pdfs) {
      const text = await pdfText(pdf)
      for (const secret of ['010-1234-5678', '01012345678', '010-9876-5432', '01098765432', 'sms:', 'UC_', '단골 할인', '구매자 요청', '전화 주문']) expect(text).not.toContain(secret)
      // PDF 바이트(글자 외 메타데이터 포함)에도 없다
      const raw = new TextDecoder('latin1').decode(pdf)
      for (const secret of ['010-1234-5678', '01012345678', 'UC_A', 'sms:s1']) expect(raw).not.toContain(secret)
    }
  })
})
