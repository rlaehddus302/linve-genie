// I2 최소 변경 시험 (dev-server — device 영역, harness/sprints/I2/dev-notes.md):
// AC-I2-12 전원 일괄 순서 = 찍힌 이름(TD-P2-004, D-I2-04), AC-I2-21 엑셀 글 칸 금지 글자 빼기(TD-P2-003, D-I2-03), AC-I2-33 판매대장 "배송" 칸 입력(D-I2-05).
import fc from 'fast-check'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { NO_NAME, buildLedger, buildReceipts, ledgerRowValues, ledgerToXlsx, loadDocumentFont, printedName, renderBatchPdf, stripXlsxForbidden, type LedgerRow } from '../src/index.ts'
import { fontBytes, pdfPageTexts, play, readXlsx, replayGolden, sale } from './helpers.ts'

const CREATED = Date.UTC(2026, 9, 18, 14, 30, 0)
const font = loadDocumentFont(fontBytes())

describe('AC-I2-12 전원 일괄 순서 = 확인서에 찍힌 이름 (코드 포인트 순, 같으면 구매자 ID 순)', () => {
  const state = play([...sale(1, 'UC_A', '가람'), ...sale(2, 'UC_B', '\u{1F335}가람'), ...sale(3, 'UC_C', '나비')])
  const scope = { state, date: '2026-10-18', rehearsal: false, createdAt: CREATED }

  it('가람(UC_A)·🌵가람(UC_B — 찍힌 이름이 같아 구매자 ID 순)·나비(UC_C) — 원문 순(가람·나비·🌵가람)이 아니다', async () => {
    const built = buildReceipts(scope, font)
    expect(built.ok && built.receipts.map((r) => r.lines[0]?.no)).toEqual([1, 2, 3])
    const result = await renderBatchPdf(scope, fontBytes())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipts.map((r) => r.buyerName)).toEqual(['가람', '\u{1F335}가람', '나비'])
    const pages = await pdfPageTexts(result.pdf)
    expect(pages.map((page) => page[page.indexOf('구매자') + 1])).toEqual(['가람', '가람', '나비'])
  })

  it('G-ENG-202 · 2026-10-19 순서는 AC-P2-24 그대로 (꽃님·문자찜·새싹·초록이·홍길동)', async () => {
    const result = await renderBatchPdf({ state: replayGolden('G-ENG-202'), date: '2026-10-19', rehearsal: false, createdAt: CREATED }, font)
    expect(result.ok && result.receipts.map((r) => r.buyerName)).toEqual(['꽃님', '문자찜', '새싹', '초록이', '홍길동'])
  })

  it('찍힌 이름: 그릴 수 없는 글자·제어 글자를 빼고 공백을 줄인 뒤, 비면 "(이름 없음)" — 이름 없음끼리는 구매자 ID 순', () => {
    const sanitize = (text: string) => font.sanitize(text)
    expect(printedName('\u{1F335}\u{1F335}', sanitize)).toBe(NO_NAME)
    expect(printedName(' 가\t나 ​', sanitize)).toBe('가나')
    expect(printedName('a  b', sanitize)).toBe('a b')
    const empties = play([...sale(1, 'UC_Z', '\u{1F335}'), ...sale(2, 'UC_Y', '\u{1F33F}'), ...sale(3, 'UC_X', '(이름')])
    const built = buildReceipts({ state: empties, date: '2026-10-18', rehearsal: false, createdAt: CREATED }, font)
    // '(이름 없음)' vs '(이름' — 같은 머리에서 짧은 쪽이 앞
    expect(built.ok && built.receipts.map((r) => r.lines[0]?.no)).toEqual([3, 2, 1])
  })
})

const ledgerRows = (events: Parameters<typeof play>[0], shipping?: (buyer: string, date: string) => string): LedgerRow[] => {
  const result = buildLedger({ scopes: [{ state: play(events), rehearsal: false }], from: '2026-10-18', to: '2026-10-18', ...(shipping === undefined ? {} : { shipping }) })
  if (!result.ok) throw new Error(result.error.message)
  return [...result.rows]
}

describe('AC-I2-21 엑셀 글 칸의 금지 글자 (TD-P2-003)', () => {
  it('닉네임·품종·방송 제목에 금지 글자가 있어도 파일이 만들어지고 그 글자만 빠진다 — 다시 읽으면 열리고 시트 XML에 그 글자가 없다', async () => {
    const forbidden = ['\u0001', '\u0008', '\u000B', '\u001F', '\t', '\n', '\r', '\u007F', '\u0085', '\uFFFE', '\uFFFF', '\uD800', '\uDC00']
    const events = forbidden.map((char, i) => sale(i + 1, `UC_${String(i)}`, `핑${char}크`, { name: `라${char}울` })).flat()
    const rows = ledgerRows([...events, { type: 'product.register', b: 'b1', no: 99, name: '핑\uFFFE크', price: 1000 }])
    const bytes = await ledgerToXlsx(rows)
    const sheet = (await readXlsx(bytes))[0]
    const values = (sheet?.rows.slice(1) ?? []).map((cells) => [cells[3]?.value, cells[5]?.value])
    expect(values).toEqual([...forbidden.map(() => ['라울', '핑크']), ['핑크', null]])
    const files = unzipSync(bytes)
    for (const [name, data] of Object.entries(files)) {
      if (!/^xl\/(worksheets\/sheet\d+|sharedStrings)\.xml$/.test(name)) continue
      const xml = strFromU8(data)
      // XML 1.0이 받지 않는 글자가 없다 (파일 구조의 줄바꿈 외에) — 글 칸에서 뺀 글자 전부
      const bad = [...xml].filter((char) => {
        const code = char.codePointAt(0) as number
        return (code <= 0x1f && code !== 0x0a && code !== 0x0d && code !== 0x09) || (code >= 0x7f && code <= 0x9f) || code === 0xfffe || code === 0xffff || (code >= 0xd800 && code <= 0xdfff)
      })
      expect(bad).toEqual([])
      expect(xml).not.toContain('핑\t크')
    }
  })

  it('그 밖의 글자(한글·이모지·=·+·@)는 그대로이고 글 칸이다, 수 칸(번호·가격)은 그대로', async () => {
    const rows = ledgerRows([...sale(1, 'UC_1', '=1+1 \u{1F335}', { name: '+@핑크' }), ...sale(2, 'UC_2', '@SUM(A1)', { price: 12345 })])
    const sheet = (await readXlsx(await ledgerToXlsx(rows)))[0]
    expect((sheet?.rows.slice(1) ?? []).map((cells) => [cells[2]?.value, cells[3]?.value, cells[4]?.value, cells[5]?.value, cells[5]?.type])).toEqual([
      [1, '+@핑크', 10000, '=1+1 \u{1F335}', 'String'],
      [2, '핑크프릴', 12345, '@SUM(A1)', 'String'],
    ])
  })

  it('속성: 임의 문자열(짝 없는 서로게이트·제어 글자 포함) → 파일 다시 읽기 성공, 읽은 값 = 금지 글자를 뺀 원문', async () => {
    const unit = fc.integer({ min: 0, max: 0xffff }).map((code) => String.fromCharCode(code))
    const samples = fc.sample(fc.array(fc.string({ unit, minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 8 }), { numRuns: 40, seed: 20261020 })
    for (const names of samples) {
      const rows = names.map((name, i): LedgerRow => ({ date: '2026-10-18', session: name, no: i + 1, name, price: 1000, buyer: name, channel: '유튜브', claimedAt: '', status: '1등', payment: '미입금', shipping: name }))
      const sheet = (await readXlsx(await ledgerToXlsx(rows)))[0]
      const back = (sheet?.rows.slice(1) ?? []).map((cells) => [cells[1]?.value ?? '', cells[3]?.value ?? '', cells[5]?.value ?? '', cells[10]?.value ?? ''])
      expect(back).toEqual(names.map((name) => Array.from({ length: 4 }, () => stripXlsxForbidden(name))))
    }
  })
})

describe('AC-I2-33 판매대장 "배송" 칸 = 부르는 쪽이 넘긴 그 묶음의 포장·배송 상태 말', () => {
  it('확정 행마다 (지금의 구매자, 방송 날짜)로 묻고, 확정 없는 행은 빈칸, 넘기지 않으면 빈칸', () => {
    const asked: string[] = []
    const events = [...sale(1, 'UC_A', '홍길동'), ...sale(2, 'UC_B', '꽃님'), ...sale(3, 'UC_A', '홍길동'), { type: 'product.register', b: 'b1', no: 4, name: '로라', price: 4000 }]
    const rows = ledgerRows(events, (buyer, date) => {
      asked.push(`${buyer}@${date}`)
      return buyer === 'UC_A' ? '배송 완료 · 송장 123456789012' : '포장 대기'
    })
    expect(rows.map((row) => ledgerRowValues(row)[10])).toEqual(['배송 완료 · 송장 123456789012', '포장 대기', '배송 완료 · 송장 123456789012', ''])
    // 같은 묶음은 한 번만 묻는다
    expect(asked).toEqual(['UC_A@2026-10-18', 'UC_B@2026-10-18'])
    expect(ledgerRows(events).map((row) => row.shipping)).toEqual(['', '', '', ''])
    // 문자열이 아닌 값은 빈칸
    expect(ledgerRows(events, () => 3 as unknown as string).map((row) => row.shipping)).toEqual(['', '', '', ''])
  })
})
