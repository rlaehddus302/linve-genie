// AC-P2-30~33 판매대장 행·엑셀 파일 (STL-06, D-208). 골든 G-ENG-201·202의 이벤트를 실제 코어로 재생해 맞댄다.
import { getBuyer, getSettlement, listBuyers, listClaims, listProducts, type EngineState } from '@livejjim/core'
import fc from 'fast-check'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { LEDGER_COLUMNS, PAYMENT_WORDS, buildLedger, formatKstLedgerTime, ledgerRowValues, ledgerToXlsx, type LedgerRow, type LedgerScope } from '../src/index.ts'
import { play, playLoosely, randomEvents, readXlsx, replayGolden, sale, type EventInput } from './helpers.ts'

const G201 = replayGolden('G-ENG-201')
const G202 = replayGolden('G-ENG-202')
const live = (state: EngineState): LedgerScope => ({ state, rehearsal: false })
const rowsOf = (input: Parameters<typeof buildLedger>[0]): LedgerRow[] => {
  const result = buildLedger(input)
  if (!result.ok) throw new Error(result.error.message)
  return [...result.rows]
}
const table = (rows: readonly LedgerRow[]): string[] => rows.map((row) => ledgerRowValues(row).join(' | '))

const G202_ROWS = [
  '2026-10-19 | 1부 | 1 | 핑크프릴 | 10000 | 홍길동 | 유튜브 | 2026-10-19 20:00:03 | 1등 | 미입금 | ',
  '2026-10-19 | 1부 | 1 | 핑크프릴 | 10000 | 꽃님 | 유튜브 | 2026-10-19 20:00:04 | 1등 | 미입금 | ',
  '2026-10-19 | 1부 | 2 | 라울 | 5000 | 초록이 | 유튜브 | 2026-10-19 20:01:03 | 1등 | 미입금 | ',
  '2026-10-19 | 1부 | 3 | 블루엘프 | 8000 |  |  |  | 판매 중 |  | ',
  '2026-10-19 | 1부 | 4 | 레티지아 | 7000 |  |  |  | 공개 전 |  | ',
  '2026-10-19 | 1부 | 5 | 황금사 | 6000 | 새싹 | 유튜브 | 2026-10-19 20:06:00 | 1등 | 미입금 | ',
  '2026-10-19 | 1부 | 6 | 블랙프린스 | 12000 | 문자찜 / 끝자리 5432 | 문자 | 2026-10-19 20:08 | 1등 | 미입금 | ',
  '2026-10-19 | 1부 | 7 | 로라 | 4000 | 꽃님 | 직접 배정 | 2026-10-19 20:09:30 | 1등 | 미입금 | ',
  '2026-10-19 | 1부 | 8 | 자보 | 3000 |  |  |  | 판매 종료 |  | ',
]
const G201_ROWS = [
  '2026-10-18 | 1부 | 15 | 핑크프릴 | 10000 | 길동이 | 유튜브 | 2026-10-18 20:00:05 | 1등 | 부분 입금 | ',
  '2026-10-18 | 1부 | 28 | 라울 | 5000 | 길동이 | 유튜브 | 2026-10-18 20:01:03 | 1등 | 부분 입금 | ',
  '2026-10-18 | 1부 | 31 | 방울복랑 금 | 15000 | 문자찜(김영희) / 끝자리 5678 | 문자 | 2026-10-18 20:02 | 1등 | 미입금 | ',
  '2026-10-18 | 2부 | 7 | 블루엘프 | 8000 | 길동이 | 유튜브 | 2026-10-18 22:00:04 | 1등 | 부분 입금 | ',
]

describe('AC-P2-30 대장 행 (엔진 상태 → 행)', () => {
  it('G-ENG-202 · 2026-10-19 — 재고 2·승계·안 팔린 상품·메시지 변환(원래 게시 시각)·문자찜(분까지)·직접 배정(조치 시각)', () => {
    expect(table(rowsOf({ scopes: [live(G202)], from: '2026-10-19', to: '2026-10-19' }))).toEqual(G202_ROWS)
  })

  it('G-ENG-201 · 2026-10-18 — 7번은 찜 시점 가격 8,000원(지금 9,000원 아님), 방송 b2만 고르면 마지막 행 하나', () => {
    expect(table(rowsOf({ scopes: [live(G201)], from: '2026-10-18', to: '2026-10-18' }))).toEqual(G201_ROWS)
    expect(table(rowsOf({ scopes: [live(G201)], from: '2026-10-18', to: '2026-10-18', broadcasts: ['b2'] }))).toEqual([G201_ROWS[3]])
  })

  it('행 값의 종류: 번호·가격은 수, 나머지는 글, 빈 값은 ""', () => {
    const [row] = rowsOf({ scopes: [live(G202)], from: '2026-10-19', to: '2026-10-19' })
    expect(typeof row?.no).toBe('number')
    expect(typeof row?.price).toBe('number')
    for (const value of ledgerRowValues(row as LedgerRow).filter((_, i) => i !== 2 && i !== 4)) expect(typeof value).toBe('string')
    expect(JSON.parse(JSON.stringify(row))).toEqual(row)
  })

  it('찜 시각 글자는 실행 환경 시간대와 상관없이 KST (시험은 TZ=Pacific/Honolulu)', () => {
    expect(formatKstLedgerTime(Date.UTC(2026, 9, 19, 11, 0, 3), false)).toBe('2026-10-19 20:00:03')
    expect(formatKstLedgerTime(Date.UTC(2026, 9, 18, 15, 0, 0), false)).toBe('2026-10-19 00:00:00')
    expect(formatKstLedgerTime(Date.UTC(2026, 9, 18, 14, 59, 59, 999), false)).toBe('2026-10-18 23:59:59')
    expect(formatKstLedgerTime(Date.UTC(2026, 9, 19, 11, 8, 0), true)).toBe('2026-10-19 20:08')
  })

  it('넘긴 상태를 바꾸지 않는다', () => {
    const before = JSON.stringify(G202)
    rowsOf({ scopes: [live(G202)], from: '2026-10-19', to: '2026-10-19' })
    expect(JSON.stringify(G202)).toBe(before)
  })
})

describe('AC-P2-31 기간·방송 고르기, 여러 범위, 리허설', () => {
  it('여러 범위(날짜가 다른 상태)를 함께 넘기면 방송 날짜 → 선언 순 → 번호 → 확정 순으로 한 목록', () => {
    expect(table(rowsOf({ scopes: [live(G202), live(G201)], from: '2026-10-18', to: '2026-10-19' }))).toEqual([...G201_ROWS, ...G202_ROWS])
  })

  it('기간 밖 방송·고르지 않은 방송은 빠진다', () => {
    expect(rowsOf({ scopes: [live(G202), live(G201)], from: '2026-10-19', to: '2026-10-31' })).toHaveLength(G202_ROWS.length)
    expect(rowsOf({ scopes: [live(G202), live(G201)], from: '2026-10-01', to: '2026-10-17' })).toEqual([])
    // 두 범위에 같은 방송 ID(b1)가 있으면 둘 다 고른다
    expect(table(rowsOf({ scopes: [live(G202), live(G201)], from: '2026-10-18', to: '2026-10-19', broadcasts: ['b1'] }))).toEqual([...G201_ROWS.slice(0, 3), ...G202_ROWS])
    expect(rowsOf({ scopes: [live(G201)], from: '2026-10-18', to: '2026-10-18', broadcasts: [] })).toEqual([])
  })

  it('고른 방송 ID가 넘긴 범위에 없으면 무시하지 않고 오류', () => {
    expect(buildLedger({ scopes: [live(G201)], from: '2026-10-18', to: '2026-10-18', broadcasts: ['b2', 'b9'] })).toEqual({
      ok: false,
      error: { code: 'UNKNOWN_BROADCAST', message: '고른 방송 중 판매 기록에 없는 방송이 있어요. 방송을 다시 골라 주세요.' },
    })
  })

  it('기간 시작 > 끝이면 오류, 날짜 형식이 틀리면 오류', () => {
    expect(buildLedger({ scopes: [live(G201)], from: '2026-10-19', to: '2026-10-18' })).toEqual({ ok: false, error: { code: 'PERIOD_INVALID', message: '기간의 시작 날짜가 끝 날짜보다 늦어요.' } })
    for (const [from, to] of [
      ['2026-10-1', '2026-10-18'],
      ['2026-10-18', '2026-13-01'],
      ['', ''],
    ]) {
      const result = buildLedger({ scopes: [live(G201)], from: from as string, to: to as string })
      expect(result.ok === false && result.error.code).toBe('INVALID_INPUT')
    }
  })

  it('리허설 범위를 넘기면 대장을 만들지 않고 오류', () => {
    expect(buildLedger({ scopes: [live(G201), { state: G202, rehearsal: true }], from: '2026-10-18', to: '2026-10-19' })).toEqual({
      ok: false,
      error: { code: 'REHEARSAL', message: '리허설 기록은 판매대장에 넣지 않아요.' },
    })
  })

  it('오류 문장에 영어·개발 용어가 없다', () => {
    const results = [
      buildLedger({ scopes: [{ state: G201, rehearsal: true }], from: '2026-10-18', to: '2026-10-18' }),
      buildLedger({ scopes: [live(G201)], from: '2026-10-19', to: '2026-10-18' }),
      buildLedger({ scopes: [live(G201)], from: '2026-10-18', to: '2026-10-18', broadcasts: ['x'] }),
      buildLedger({ scopes: [live(G201)], from: 'x', to: 'y' }),
    ]
    for (const result of results) expect(result.ok === false && result.error.message).toMatch(/^[^A-Za-z]+$/)
  })
})

/**
 * 무작위 이벤트 열 → 대장과 코어 맞대기. 확정 찜마다 대장 행 하나를 짝짓는다:
 * 방송 날짜·번호·가격·구매자(지금 표시 이름·끝자리)·찜 시각(R-6 실제 시각의 KST 글)이 같은 행 중 아직 짝이 없는 것.
 * (재고 2에 두 구매자가 같은 가격으로 확정되어도 남의 행을 고르지 않는다)
 */
function checkLedgerAgainstCore(events: readonly EventInput[]): void {
  const state = playLoosely(events)
  const rows = rowsOf({ scopes: [live(state)], from: '2026-10-01', to: '2026-10-31' })
  const confirmedRows = rows.filter((row) => row.status === '1등')
  const confirmed = listClaims(state).filter((claim) => claim.status === 'CONFIRMED')
  expect(confirmedRows).toHaveLength(confirmed.length)
  const subtotals = listBuyers(state)
    .filter((buyer) => buyer.current === buyer.id)
    .reduce((sum, buyer) => sum + buyer.subtotal, 0)
  expect(confirmedRows.reduce((sum, row) => sum + row.price, 0)).toBe(subtotals)
  const unsold = listProducts(state).filter((product) => product.winners.length === 0)
  expect(rows.filter((row) => row.status !== '1등')).toHaveLength(unsold.length)
  expect(rows).toHaveLength(confirmed.length + unsold.length)
  const unmatched = [...confirmedRows]
  for (const claim of confirmed) {
    const date = claim.broadcast === 'b1' ? '2026-10-18' : '2026-10-19'
    const buyer = getBuyer(state, claim.currentBuyer)
    const display = buyer?.phoneLast4 === null || buyer?.phoneLast4 === undefined ? (buyer?.display ?? '') : `${buyer.display} / 끝자리 ${buyer.phoneLast4}`
    const claimedAt = formatKstLedgerTime(claim.rankTime, claim.rankMinute)
    const at = unmatched.findIndex((r) => r.date === date && r.no === claim.no && r.price === claim.price && r.buyer === display && r.claimedAt === claimedAt)
    expect(at, `찜 ${claim.id}(${claim.currentBuyer}, ${String(claim.no)}번)의 행`).toBeGreaterThanOrEqual(0)
    const [row] = unmatched.splice(at, 1)
    expect(row?.payment, `찜 ${claim.id}(${claim.currentBuyer})의 입금`).toBe(PAYMENT_WORDS[getSettlement(state, claim.currentBuyer, date).payment])
  }
  expect(unmatched).toEqual([])
}

describe('AC-P2-33 대장의 금액·상태는 코어 그대로', () => {
  it('속성: 무작위 이벤트 열 → 확정 행 수 = 확정 찜 수, 확정 행 가격 합 = 모든 구매자 상품 합계의 합, 확정 없는 상품마다 한 행, 입금 = getSettlement', () => {
    fc.assert(
      fc.property(randomEvents(), (events) => {
        checkLedgerAgainstCore(events)
      }),
      { numRuns: 120 },
    )
  })

  it('회귀(seed 1300622960): 재고 2·같은 가격에 두 구매자 확정, 한 사람만 입금 → 행마다 그 구매자의 입금 상태', () => {
    const events: EventInput[] = [
      { type: 'chat', b: 'b2', id: 'c1', ch: 'UC_2', nick: '꽃님', text: '1' },
      { type: 'chat', b: 'b2', id: 'c2', ch: 'UC_1', nick: '홍길동', text: '1' },
      { type: 'product.register', b: 'b2', no: 1, name: '핑크프릴', price: 0, stock: 2 },
      { type: 'settlement.payment', buyer: 'UC_1', date: '2026-10-19', amount: 1000 },
      { type: 'chat', b: 'b1', id: 'c3', ch: 'UC_1', nick: '홍길동', text: '1' },
    ]
    checkLedgerAgainstCore(events)
    const rows = rowsOf({ scopes: [live(playLoosely(events))], from: '2026-10-01', to: '2026-10-31' }).filter((row) => row.status === '1등')
    expect(rows.map((row) => `${row.buyer} ${row.payment}`)).toEqual(['꽃님 미입금', '홍길동 부분 입금'])
  })
})

describe('AC-P2-32 엑셀 파일', () => {
  it('시트 하나 "판매대장", 첫 줄 = 열 이름 11개, 첫 줄 틀 고정, 다시 읽으면 행 값이 같다', async () => {
    const rows = rowsOf({ scopes: [live(G202)], from: '2026-10-19', to: '2026-10-19' })
    const sheets = await readXlsx(await ledgerToXlsx(rows))
    expect(sheets.map((sheet) => sheet.name)).toEqual(['판매대장'])
    const sheet = sheets[0]
    expect(sheet?.rows[0]?.map((cell) => cell.value)).toEqual([...LEDGER_COLUMNS])
    expect(LEDGER_COLUMNS).toEqual(['방송 날짜', '회차', '상품 번호', '품종', '가격', '구매자', '채널', '찜 시각', '상태', '입금', '배송'])
    expect(sheet?.views).toEqual([expect.objectContaining({ state: 'frozen', ySplit: 1 })])
    const back = (sheet?.rows.slice(1) ?? []).map((cells) => cells.map((cell) => (cell.value === null ? '' : cell.value)))
    expect(back).toEqual(rows.map(ledgerRowValues))
  })

  it('번호·가격은 수 칸(가격 서식 #,##0), 나머지는 글 칸, 빈 값은 빈 칸', async () => {
    const rows = rowsOf({ scopes: [live(G202)], from: '2026-10-19', to: '2026-10-19' })
    const sheet = (await readXlsx(await ledgerToXlsx(rows)))[0]
    for (const cells of sheet?.rows.slice(1) ?? []) {
      expect(cells[2]?.type).toBe('Number')
      expect(cells[4]?.type).toBe('Number')
      expect(cells[4]?.numFmt).toBe('#,##0')
      cells.forEach((cell, i) => {
        if (i === 2 || i === 4) return
        expect(['String', 'Null'], `${String(i)}열 ${JSON.stringify(cell)}`).toContain(cell.type)
      })
      expect(cells[10]?.type).toBe('Null') // 배송 = 빈칸
    }
    // 안 팔린 상품 행의 구매자·채널·찜 시각·입금은 빈 칸
    const unsold = sheet?.rows[4] ?? []
    expect([5, 6, 7, 9].map((i) => unsold[i]?.type)).toEqual(['Null', 'Null', 'Null', 'Null'])
  })

  it('닉네임·품종이 =·+·-·@로 시작해도 글 칸이다 (수식 칸이 하나도 없다)', async () => {
    const dangerous = ['=HYPERLINK("http://x","y")', '+1', '-1', '@SUM(A1)', '=1+1', '\t=cmd|calc', '=SUM(A1:A9)']
    const events: EventInput[] = dangerous.flatMap((text, i) => sale(i + 1, `UC_${String(i)}`, text, { name: text.trim() === '' ? 'x' : text }))
    const rows = rowsOf({ scopes: [live(play(events))], from: '2026-10-18', to: '2026-10-18' })
    const bytes = await ledgerToXlsx(rows)
    const sheet = (await readXlsx(bytes))[0]
    for (const cells of sheet?.rows ?? []) for (const cell of cells) expect(cell.type).not.toBe('Formula')
    const buyers = (sheet?.rows.slice(1) ?? []).map((cells) => cells[5]?.value)
    expect(buyers).toEqual(rows.map((row) => row.buyer))
    expect(buyers).toContain('=HYPERLINK("http://x","y")')
    // 파일 안 시트 XML에 수식 요소(<f>)가 없다
    const files = unzipSync(bytes)
    const sheetXml = Object.entries(files).filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    expect(sheetXml.length).toBe(1)
    for (const [, data] of sheetXml) expect(strFromU8(data)).not.toMatch(/<f[\s>]/)
  })

  it('성능: 상품 500개·확정 500개 대장을 10초 안에', async () => {
    const events: EventInput[] = []
    for (let i = 1; i <= 500; i++) events.push(...sale(i, `UC_${String(i % 120)}`, `구매자${String(i % 120)}`, { name: `품종${String(i % 40)}`, price: 1000 + i }))
    const state = play(events)
    const started = performance.now()
    const rows = rowsOf({ scopes: [live(state)], from: '2026-10-18', to: '2026-10-18' })
    const bytes = await ledgerToXlsx(rows)
    expect(performance.now() - started).toBeLessThan(10_000)
    expect(rows.filter((row) => row.status === '1등')).toHaveLength(500)
    expect(bytes.length).toBeGreaterThan(1000)
  })
})
