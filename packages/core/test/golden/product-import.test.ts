// AC-I2-50 골든 러너 연결 (D-I2-09): 러너 계약이 suite product-import를 알고, 러너·어댑터가 서버(apps/server)의 해석 함수를 부른다.
// 일부러 틀린 해석기(머리글 둘째 줄까지·같은 번호 첫 줄 등록·칸 둘을 [번호, 가격]·늘 원 단위·큰따옴표 무시)가 실제 골든에서 각각 불일치로 실패하는지 본다.
// 코어 영역 시험 코드다(dev-server가 최소로 더함 — harness/sprints/I2/dev-notes.md). 코어 src는 서버에 기대지 않는다.
import { NotImplementedError, normalizeText, type SettingsOverride } from '@livejjim/core'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseProductList, parseProductRows, splitCells, splitImportLines, type ImportResult, type ImportRow } from '../../../../apps/server/src/product-import.ts'
import { realCore } from './core-adapter.ts'
import { createFakeCore } from './fake-core.ts'
import { runGoldenSources } from './runner.ts'
import { run, suiteDoc } from './test-helpers.ts'
import type { GoldenCore, ParserItemResult } from './types.ts'

const GOLDEN_DIR = fileURLToPath(new URL('../../../../tests/golden', import.meta.url))
const IMPORT_FILE = 'parser/product-import.yaml'

type Parser = (text: string, settings: SettingsOverride, existing: readonly number[]) => unknown
const settingsOf = (settings: SettingsOverride, existing: readonly number[]) => ({ unit: settings['price.unit'], maxNumber: settings['claim.maxNumber'], existing })
const real: Parser = (text, settings, existing) => parseProductList(text, settingsOf(settings, existing))
const withParser = (productImport: Parser): GoldenCore => ({ ...realCore, parser: { ...realCore.parser, productImport } })

/** 실제 골든의 product-import 파일만 돌린다 (전체 골든 합계는 core-adapter.test.ts가 본다) */
function importItems(core: GoldenCore): { readonly items: ParserItemResult[]; readonly readErrors: number } {
  const report = runGoldenSources({
    files: [{ path: IMPORT_FILE, text: readFileSync(`${GOLDEN_DIR}/${IMPORT_FILE}`, 'utf8') }],
    allowlist: { path: 'known-unimplemented.yaml', text: null },
    core,
    goldenLabel: 'tests/golden',
  })
  const items = report.items.filter((item): item is ParserItemResult => item.kind === 'parser' && item.suite === 'product-import')
  return { items, readErrors: report.readErrors.length }
}

/** 통과하지 못한 사례의 입력 */
const failing = (core: GoldenCore): string[] =>
  importItems(core)
    .items.filter((item) => item.status !== 'pass')
    .map((item) => item.input)

describe('AC-I2-50 러너가 product-import를 안다', () => {
  it('실제 해석 함수로 product-import 26사례(21 + I2 마지막 감사 5 — D-I2-17·21)가 모두 통과하고 파일은 parser/product-import.yaml', () => {
    const { items, readErrors } = importItems(realCore)
    expect(readErrors).toBe(0)
    expect(items).toHaveLength(26)
    expect(items.every((item) => item.status === 'pass' && item.file === IMPORT_FILE)).toBe(true)
  })

  it('러너는 사례마다 unit·maxNumber 설정과 이미 있는 번호의 사본을 넘긴다 — 해석기가 목록을 바꿔도 다음 사례에 번지지 않는다', () => {
    const calls: { text: string; settings: SettingsOverride; existing: readonly number[] }[] = []
    const core = createFakeCore({
      parser: {
        productImport: (text, settings, existing) => {
          calls.push({ text, settings, existing: [...existing] })
          ;(existing as number[]).push(99)
          return { error: 'EMPTY' }
        },
      },
    })
    const report = run(
      suiteDoc('product-import', [
        { in: 'a', out: { error: 'EMPTY' } },
        { in: 'b', out: { error: 'EMPTY' } },
      ], { unit: 'WON', maxNumber: 50, existing: [3, 30] }),
      { core },
    )
    expect(report.totals.pass).toBe(2)
    expect(calls).toEqual([
      { text: 'a', settings: { 'price.unit': 'WON', 'claim.maxNumber': 50 }, existing: [3, 30] },
      { text: 'b', settings: { 'price.unit': 'WON', 'claim.maxNumber': 50 }, existing: [3, 30] },
    ])
  })

  it('이미 있는 번호를 적지 않으면 빈 목록, 설정을 적지 않으면 설정 없음(해석 함수 기본 THOUSAND·999)', () => {
    const seen: unknown[] = []
    const core = createFakeCore({ parser: { productImport: (_t, settings, existing) => (seen.push([settings, existing]), { error: 'EMPTY' }) } })
    run(suiteDoc('product-import', [{ in: 'x', out: { error: 'EMPTY' } }]), { core })
    expect(seen).toEqual([[{}, []]])
  })

  it('비교: header(적지 않으면 null)·줄 순서·줄마다 키와 값이 모두 같아야 통과 — 다른 키가 있거나 키가 빠지면 불일치', () => {
    const results: Record<string, unknown> = {
      exact: { header: null, rows: [{ line: 1, no: 15, name: '핑크', price: 10000 }] },
      headed: { header: 1, rows: [{ line: 2, error: 'CELLS' }] },
      noHeaderKey: { rows: [{ line: 1, no: 15, name: '핑크', price: 10000 }] },
      extraTop: { header: null, rows: [], note: 1 },
      extraRow: { header: null, rows: [{ line: 1, no: 15, name: '핑크', price: 10000, ok: true }] },
      missingRow: { header: null, rows: [{ line: 1, no: 15, name: '핑크' }] },
      order: { header: null, rows: [{ line: 2, error: 'CELLS' }, { line: 1, error: 'CELLS' }] },
      errorOnly: { error: 'EMPTY' },
      errorPlus: { error: 'EMPTY', rows: [] },
      notObject: 'EMPTY',
    }
    const core = createFakeCore({ parser: { productImport: (text) => results[text] } })
    const cases = [
      { in: 'exact', out: { rows: [{ line: 1, no: 15, name: '핑크', price: 10000 }] } },
      { in: 'headed', out: { header: 1, rows: [{ line: 2, error: 'CELLS' }] } },
      { in: 'noHeaderKey', out: { rows: [{ line: 1, no: 15, name: '핑크', price: 10000 }] } },
      { in: 'extraTop', out: { rows: [] } },
      { in: 'extraRow', out: { rows: [{ line: 1, no: 15, name: '핑크', price: 10000 }] } },
      { in: 'missingRow', out: { rows: [{ line: 1, no: 15, name: '핑크', price: 10000 }] } },
      { in: 'order', out: { rows: [{ line: 1, error: 'CELLS' }, { line: 2, error: 'CELLS' }] } },
      { in: 'errorOnly', out: { error: 'EMPTY' } },
      { in: 'errorPlus', out: { error: 'EMPTY' } },
      { in: 'exact', out: { header: 1, rows: [{ line: 1, no: 15, name: '핑크', price: 10000 }] } },
      { in: 'notObject', out: { error: 'EMPTY' } },
    ]
    const report = run(suiteDoc('product-import', cases), { core })
    expect(report.items.map((item) => item.status)).toEqual(['pass', 'pass', 'mismatch', 'mismatch', 'mismatch', 'mismatch', 'mismatch', 'pass', 'mismatch', 'mismatch', 'mismatch'])
    const problemPaths = report.items.map((item) => item.problems.map((p) => p.path))
    expect(problemPaths[2]).toEqual(['out.header'])
    expect(problemPaths[3]).toEqual(['out.note'])
    expect(problemPaths[4]).toEqual(['out.rows[0]'])
    expect(problemPaths[5]).toEqual(['out.rows[0]'])
    expect(problemPaths[6]).toEqual(['out.rows[0]', 'out.rows[1]'])
    expect(problemPaths[8]).toEqual(['out'])
    expect(problemPaths[9]).toEqual(['out.header'])
  })

  it('미구현을 알리는 해석기는 미구현 — 허용 목록 suite 이름에 product-import를 쓸 수 있다(쓰지는 않는다)', () => {
    const core = createFakeCore({
      parser: {
        productImport: () => {
          throw new NotImplementedError('상품 목록 가져오기')
        },
      },
    })
    const text = suiteDoc('product-import', [{ in: '15,핑크,10000', out: { rows: [{ line: 1, no: 15, name: '핑크', price: 10000 }] } }])
    expect(run(text, { core }).totals.notImplementedDisallowed).toBe(1)
    const allowed = run(text, { core, allowlist: 'sprint: I2\nsuites: [product-import]\n' })
    expect(allowed.readErrors).toEqual([])
    expect(allowed.totals.notImplementedAllowed).toBe(1)
    expect(allowed.ok).toBe(true)
  })
})

// ── 일부러 틀린 해석기 ───────────────────────────────────────────────────

const isBlank = (text: string): boolean => normalizeText(text) === ''
const rowsOf = (result: ImportResult): ImportRow[] => ('rows' in result ? [...result.rows] : [])

/** 머리글을 둘째 줄까지 보는 해석기 (R-18 3 "머리글은 많아야 한 줄"을 어김) */
const headerTwoLines: Parser = (text, settings, existing) => {
  const result = real(text, settings, existing) as ImportResult
  if (!('rows' in result) || result.header === null) return result
  const second = splitImportLines(text).filter((source) => !isBlank(source.text))[1]
  const cells = second === undefined ? null : splitCells(second.text)
  if (second === undefined || cells === null || /[0-9]/.test(normalizeText(cells[0] ?? ''))) return result
  return { header: result.header, rows: result.rows.filter((row) => row.line !== second.line) }
}

/** 같은 번호 줄 가운데 첫 줄을 등록하는 해석기 (R-18 5 "그 줄 모두 DUPLICATE"를 어김) */
const firstDuplicateWins: Parser = (text, settings, existing) => {
  const result = real(text, settings, existing) as ImportResult
  if (!('rows' in result)) return result
  const lines = new Map(splitImportLines(text).map((source) => [source.line, source.text]))
  const seen = new Set<number>()
  return {
    header: result.header,
    rows: result.rows.map((row) => {
      if (!('error' in row) || row.error !== 'DUPLICATE') return row
      const alone = parseProductRows([{ line: row.line, cells: splitCells(lines.get(row.line) ?? '') ?? [] }], settingsOf(settings, existing))
      const value = rowsOf(alone)[0]
      if (value === undefined || 'error' in value || seen.has(value.no)) return row
      seen.add(value.no)
      return value
    }),
  }
}

/** 칸 둘인 줄을 [번호, 가격]으로 받는 해석기 (R-18 2 "셋이 아니면 CELLS"를 어김) */
const twoCellsAsNumberPrice: Parser = (text, settings, existing) => {
  const result = real(text, settings, existing) as ImportResult
  if (!('rows' in result)) return result
  const lines = new Map(splitImportLines(text).map((source) => [source.line, source.text]))
  return {
    header: result.header,
    rows: result.rows.map((row) => {
      if (!('error' in row) || row.error !== 'CELLS') return row
      const cells = splitCells(lines.get(row.line) ?? '')
      if (cells === null || cells.length !== 2) return row
      const value = rowsOf(parseProductRows([{ line: row.line, cells: [cells[0] as string, '', cells[1] as string] }], settingsOf(settings, existing)))[0]
      return value ?? row
    }),
  }
}

/** 가격을 늘 원 단위로 읽는 해석기 (R-18 8 "price.unit으로 읽는다"를 어김) */
const alwaysWon: Parser = (text, settings, existing) => real(text, { ...settings, 'price.unit': 'WON' }, existing)

/** 큰따옴표를 무시하는 해석기 (R-18 2 따옴표 규칙을 어김): 나누는 글자로만 자른다 */
const ignoreQuotes: Parser = (text, settings, existing) =>
  parseProductRows(
    splitImportLines(text).map((source) => ({ line: source.line, cells: source.text.split(source.text.includes('\t') ? '\t' : ',') })),
    settingsOf(settings, existing),
  )

describe('AC-I2-50 일부러 틀린 해석기는 골든에서 불일치로 실패한다', () => {
  it.each([
    ['머리글을 둘째 줄까지 보는 것', headerTwoLines, ['번호,품종,가격\n번호,품종,가격\n15,핑크,10000']],
    ['같은 번호 중 첫 줄을 등록하는 것', firstDuplicateWins, ['10\t핑크프릴\t10000\n11\t라울']],
    ['칸 둘을 [번호, 가격]으로 받는 것', twoCellsAsNumberPrice, ['25,로라\n']],
    ['가격을 늘 원 단위로 읽는 것', alwaysWon, ['16\t라울\t8\n']],
    ['큰따옴표를 무시하는 것', ignoreQuotes, ['16,라울,"8,000원"', '"15","핑크프릴","10000"']],
  ] as const)('%s', (_label, parser, needles) => {
    const failures = failing(withParser(parser))
    expect(failures.length).toBeGreaterThan(0)
    for (const needle of needles) expect(failures.some((input) => input.includes(needle)), needle).toBe(true)
  })

  it('실제 해석 함수는 불일치가 없다', () => {
    expect(failing(withParser(real))).toEqual([])
  })
})
