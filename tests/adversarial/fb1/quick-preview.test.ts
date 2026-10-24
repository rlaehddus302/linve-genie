// FB1 적대 시험 (test-domain): 빠른 입력 "등록하면: …" 미리 보기 = Enter로 등록할 때의 해석 (AC-FB1-02·03, D-FB1-01, 절대 규칙 2).
// 무작위 줄 1,000개 × 세 가격 단위(천원·원·만원 — D-FB1-11, SA-FB1-03)에서
//  - 미리 보기가 있으면 그 줄은 등록(register)으로 읽히고, 등록으로 읽히면 미리 보기가 있다 (고칠까요·번호만·오류면 없다)
//  - 미리 보기 가격 = 코어 parseQuickInput 가격 = 등록 판단(decideQuickInput) 가격, 안전한 정수 원(100원 이상), 원 표기("10,000원")
//  - 고치기 칸 "= …원"은 parseAmount 결과와 같고, 읽지 못하면 없다
//  - 어떤 줄에도 예외로 새지 않는다(그리는 중 콘솔이 깨지지 않게)
// 화면 파일은 DOM 타입으로 검사하므로 경로를 값으로 불러온다(s05/quick-input-consistency.test.ts와 같은 까닭).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatWon, parseAmount, parseQuickInput, resolveSettings } from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const QUICK_MODULE = '../../../apps/web/src/lib/quick.ts'
const ROOT = join(import.meta.dirname, '..', '..', '..')

type Unit = 'THOUSAND' | 'WON' | 'TEN_THOUSAND'
const UNITS: readonly Unit[] = ['THOUSAND', 'WON', 'TEN_THOUSAND']
interface QuickSettings {
  readonly 'price.unit': Unit
  readonly 'claim.maxNumber': number
}
type Decision = { kind: 'register'; no: number; name: string; price: number } | { kind: string }
interface QuickModule {
  quickSettings(settings: ReturnType<typeof resolveSettings>): QuickSettings
  decideQuickInput(text: string, settings: QuickSettings, find: (no: number) => unknown): Decision
  registerPreview(text: string, settings: QuickSettings, find: (no: number) => unknown): string | null
  fixPricePreview(text: string, settings: QuickSettings): string | null
  unitLine(unit: Unit): string
}

const load = async (): Promise<QuickModule> => (await import(/* @vite-ignore */ QUICK_MODULE)) as QuickModule

// ── 실제 판매자가 칠 법한 줄 ─────────────────────────────
const toFull = (s: string): string => s.replace(/[0-9]/g, (d) => String.fromCharCode(0xff10 + Number(d)))
const numberTok = fc.oneof(
  fc.integer({ min: 0, max: 1_005 }).map(String),
  fc.integer({ min: 1, max: 99 }).map((n) => `${String(n)}번`),
  fc.integer({ min: 1, max: 99 }).map((n) => toFull(String(n))),
  fc.constantFrom('', '번', '-3', '1.5', '015'),
)
const nameTok = fc.constantFrom('엘레강스', '핑크프릴', '라울', '창', '블루 엘프', '<b>굵게</b>', '<script>alert(1)</script>', '🌵', '다육​이', 'Rose', '10cm', '2두', '3개', '만', '천', '원', '1번', '&amp;', '"따옴"', "'", '　')
const priceTok = fc.oneof(
  fc.constantFrom('10', '15', '14', '999', '1000', '5천', '15000', '2만', '1.5만', '1만5천', '10000', '1,000', '10원', '0.5', '천', '5천', '만원', '12000원', '3.5', '１０', '100', '99', '0', '-10', '1e3', '2만원', '1만 5천', '9999999', '99999999999999999999'),
  fc.integer({ min: 0, max: 2_000_000 }).map(String),
)
const sepTok = fc.constantFrom(' ', ' ', ' ', '  ', '\t', '/')
const lineArb = fc
  .tuple(numberTok, fc.array(nameTok, { maxLength: 3 }), fc.option(priceTok, { nil: undefined }), fc.array(sepTok, { minLength: 6, maxLength: 6 }), fc.constantFrom('', ' ', '  '))
  .map(([no, names, price, seps, pad]) => {
    const parts = [no, ...names, ...(price === undefined ? [] : [price])].filter((p) => p !== '')
    return pad + parts.map((p, i) => (i === 0 ? p : `${seps[i % seps.length] ?? ' '}${p}`)).join('') + pad
  })

const PREVIEW = /^등록하면: (\d+)번 (?:(.*) )?((?:\d{1,3})(?:,\d{3})*)원$/

describe('AC-FB1-03 미리 보기 가격 = 등록 판단 가격 (무작위 줄 1,000개 × 천원·원·만원)', () => {
  it('미리 보기는 등록으로 읽힐 때만, 가격은 코어 해석 그대로의 정수 원', async () => {
    const quick = await load()
    let registered = 0
    const registeredBy: Record<Unit, number> = { THOUSAND: 0, WON: 0, TEN_THOUSAND: 0 }
    await fc.assert(
      fc.asyncProperty(lineArb, fc.uniqueArray(fc.integer({ min: 1, max: 60 }), { maxLength: 8 }), async (line, existing) => {
        for (const unit of UNITS) {
          const settings = quick.quickSettings(resolveSettings({ 'price.unit': unit } as never))
          const products = new Map(existing.map((n) => [n, { id: `p${String(n)}`, no: n }]))
          const find = (n: number) => products.get(n)
          const decision = quick.decideQuickInput(line, settings, find)
          const preview = quick.registerPreview(line, settings, find)
          const core = parseQuickInput(line, settings as never)
          if (decision.kind !== 'register') {
            expect(preview, `${unit} ${JSON.stringify(line)} → ${decision.kind}`).toBeNull()
            continue
          }
          registered++
          registeredBy[unit]++
          const d = decision as Extract<Decision, { kind: 'register' }>
          expect('error' in core).toBe(false)
          if ('error' in core) return
          // 등록 판단 = 코어 해석 (화면이 따로 해석하지 않는다)
          expect([d.no, d.name, d.price]).toEqual([core.no, core.name, core.price])
          expect(products.has(d.no), '이미 있는 번호면 등록이 아니라 고칠까요').toBe(false)
          expect(Number.isSafeInteger(d.price) && d.price >= 100, `${String(d.price)}`).toBe(true)
          expect(preview, JSON.stringify(line)).toBe(`등록하면: ${String(d.no)}번 ${d.name === '' ? '' : `${d.name} `}${formatWon(d.price)}`)
          const m = PREVIEW.exec(preview ?? '')
          expect(m, preview ?? 'null').not.toBeNull()
          expect(Number(m?.[3]?.replaceAll(',', ''))).toBe(d.price)
          expect(Number(m?.[1])).toBe(d.no)
        }
      }),
      { numRuns: 1_000, seed: 20261024 },
    )
    // 생성기가 등록으로 읽히는 줄을 충분히 만든다 (빈 시험이 아니다)
    expect(registered).toBeGreaterThan(200)
    // 단위마다 등록 줄이 있다 — 만원 방송도 실제로 돌았다 (SA-FB1-03)
    for (const unit of UNITS) expect(registeredBy[unit], unit).toBeGreaterThan(50)
  })

  it('고치기 칸 "= …원"은 parseAmount 결과 그대로, 읽지 못하면 없다 — 어떤 글에도 예외 없음', async () => {
    const quick = await load()
    await fc.assert(
      fc.asyncProperty(fc.oneof(priceTok, fc.string({ maxLength: 20 }), fc.tuple(priceTok, nameTok).map(([a, b]) => `${a} ${b}`)), fc.constantFrom<Unit>(...UNITS), async (text, unit) => {
        const settings = quick.quickSettings(resolveSettings({ 'price.unit': unit } as never))
        const amount = parseAmount(text, settings as never)
        const shown = quick.fixPricePreview(text, settings)
        if (amount === null) expect(shown).toBeNull()
        else {
          expect(Number.isSafeInteger(amount)).toBe(true)
          expect(shown).toBe(`= ${formatWon(amount)}`)
        }
      }),
      { numRuns: 500, seed: 11 },
    )
  })

  it('예시 줄 (AC-FB1-02 글자 그대로) — 천원·원·만원', async () => {
    const quick = await load()
    const t = quick.quickSettings(resolveSettings({ 'price.unit': 'THOUSAND' } as never))
    const w = quick.quickSettings(resolveSettings({ 'price.unit': 'WON' } as never))
    const none = () => undefined
    expect(quick.unitLine('THOUSAND')).toBe('가격 단위: 천원 — 10은 10,000원, 2만은 20,000원')
    expect(quick.unitLine('WON')).toBe('가격 단위: 원 — 10000은 10,000원, 2만은 20,000원')
    expect(quick.registerPreview('15 엘레강스 10', t, none)).toBe('등록하면: 15번 엘레강스 10,000원')
    expect(quick.registerPreview('15 엘레강스 2만', t, none)).toBe('등록하면: 15번 엘레강스 20,000원')
    expect(quick.registerPreview('15 10', t, none)).toBe('등록하면: 15번 10,000원')
    expect(quick.registerPreview('15 엘레강스 10000', w, none)).toBe('등록하면: 15번 엘레강스 10,000원')
    // 원 방송에서 `10`은 100원보다 적다 → 오류(고치기 칸)라 미리 보기 없음
    expect(quick.registerPreview('15 엘레강스 10', w, none)).toBeNull()
    // 번호만·이미 있는 번호
    expect(quick.registerPreview('15', t, none)).toBeNull()
    expect(quick.registerPreview('15 엘레강스 10', t, (n) => (n === 15 ? { no: 15 } : undefined))).toBeNull()
    expect(quick.fixPricePreview('1.5만', t)).toBe('= 15,000원')
    expect(quick.fixPricePreview('1.5만', w)).toBe('= 15,000원')
    expect(quick.fixPricePreview('모름', t)).toBeNull()
    // 만원 방송 (AC-FB1-02 글자 그대로, D-FB1-11 — 단위 없는 1000 미만 숫자만 ×10000)
    const m = quick.quickSettings(resolveSettings({ 'price.unit': 'TEN_THOUSAND' } as never))
    expect(quick.unitLine('TEN_THOUSAND')).toBe('가격 단위: 만원 — 15는 150,000원, 5천은 5,000원')
    expect(quick.registerPreview('15 엘레강스 15', m, none)).toBe('등록하면: 15번 엘레강스 150,000원')
    expect(quick.registerPreview('15 엘레강스 15000', m, none)).toBe('등록하면: 15번 엘레강스 15,000원')
    expect(quick.registerPreview('15 엘레강스 5천', m, none)).toBe('등록하면: 15번 엘레강스 5,000원')
    expect(quick.registerPreview('15 엘레강스 2만', m, none)).toBe('등록하면: 15번 엘레강스 20,000원')
    expect(quick.registerPreview('15 15', m, none)).toBe('등록하면: 15번 150,000원')
    expect(quick.registerPreview('15', m, none)).toBeNull()
    expect(quick.registerPreview('15 엘레강스 15', m, (n) => (n === 15 ? { no: 15 } : undefined))).toBeNull()
    expect(quick.fixPricePreview('14', m)).toBe('= 140,000원')
    expect(quick.fixPricePreview('1.5만', m)).toBe('= 15,000원')
    expect(quick.fixPricePreview('모름', m)).toBeNull()
    // 같은 글이 단위마다 다르게 읽힌다 — 화면이 천원으로 추측하지 않는다
    expect(quick.registerPreview('15 엘레강스 15', t, none)).toBe('등록하면: 15번 엘레강스 15,000원')
  })

  it('미리 보기 글은 글로만 그린다 — 빠른 입력 화면에 HTML로 넣는 길이 없다 (품종 이스케이프)', () => {
    const source = readFileSync(join(ROOT, 'apps/web/src/components/QuickInput.tsx'), 'utf8')
    expect(source).not.toMatch(/dangerouslySetInnerHTML|innerHTML/)
    // {willRegister}·{fixPrice}를 글 자식으로 넣는다
    expect(source).toMatch(/\{willRegister\}/)
    expect(source).toMatch(/\{fixPrice\}/)
  })
})
