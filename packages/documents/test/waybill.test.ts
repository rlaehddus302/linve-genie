// T1 운송장 (PARCEL_RULES PC-7, D-T1-10): AC-T1-40 골든 · AC-T1-41 PDF 내용과 바코드 · AC-T1-42 줄이지 않는다 · AC-T1-44 B1으로 찍지 않는다(문서 쪽)
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BAR_HEIGHT,
  CODE128_PATTERNS,
  MIN_TEXT_SIZE,
  WAYBILL_HEIGHT,
  WAYBILL_TOO_LONG_MESSAGE,
  WAYBILL_WIDTH,
  code128Bars,
  code128Codes,
  formatInvoiceNumber,
  layoutWaybill,
  loadDocumentFont,
  maskPhone,
  renderWaybillsPdf,
  type WaybillData,
  type WaybillLayout,
  type WaybillText,
} from '../src/index.ts'
import { fontBytes, pdfFonts, pdfPageSizes, pdfPageTexts } from './helpers.ts'

const ROOT = new URL('../../../', import.meta.url)
const font = loadDocumentFont(fontBytes())

// ── AC-T1-40 운송장 골든 ─────────────────────────────────────────────────

interface WaybillCase {
  readonly id: string
  readonly title: string
  readonly refs: readonly string[]
  readonly note?: string
  readonly in: string
  readonly out: unknown
}

const FILE_KEYS = ['kind', 'about', 'cases']
const CASE_KEYS = ['id', 'title', 'refs', 'note', 'in', 'out']
const KINDS = ['code128', 'phone', 'invoice'] as const
type Kind = (typeof KINDS)[number]

/** README "운송장 골든" 형식 그대로 읽는다 — 모르는 키·kind·중복 ID는 읽기 오류 */
function readWaybillGolden(): { files: number; cases: { kind: Kind; c: WaybillCase }[] } {
  const dir = new URL('tests/golden/waybill/', ROOT)
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
  const seen = new Set<string>()
  const out: { kind: Kind; c: WaybillCase }[] = []
  for (const name of names) {
    const file = JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as Record<string, unknown>
    for (const key of Object.keys(file)) if (!FILE_KEYS.includes(key)) throw new Error(`${name}: 모르는 키 ${key}`)
    const kind = file.kind
    if (!(KINDS as readonly unknown[]).includes(kind)) throw new Error(`${name}: 모르는 kind ${String(kind)}`)
    if (typeof file.about !== 'string' || !Array.isArray(file.cases)) throw new Error(`${name}: 모양이 틀렸다`)
    for (const raw of file.cases as Record<string, unknown>[]) {
      for (const key of Object.keys(raw)) if (!CASE_KEYS.includes(key)) throw new Error(`${name}: 모르는 사례 키 ${key}`)
      const id = raw.id
      if (typeof id !== 'string' || !/^G-WAY-T1-\d{2}$/.test(id)) throw new Error(`${name}: id가 틀렸다 ${String(id)}`)
      if (seen.has(id)) throw new Error(`중복 ID ${id}`)
      seen.add(id)
      if (typeof raw.title !== 'string' || !Array.isArray(raw.refs) || raw.refs.length === 0 || typeof raw.in !== 'string' || !('out' in raw)) throw new Error(`${id}: 사례 모양이 틀렸다`)
      if ('note' in raw && typeof raw.note !== 'string') throw new Error(`${id}: note는 글`)
      out.push({ kind: kind as Kind, c: raw as unknown as WaybillCase })
    }
  }
  return { files: names.length, cases: out }
}

const GOLDEN = readWaybillGolden()

function run(kind: Kind, input: string): unknown {
  if (kind === 'code128') return code128Codes(input)
  if (kind === 'phone') return maskPhone(input)
  return formatInvoiceNumber(input)
}

describe('AC-T1-40 운송장 골든', () => {
  it('파일 3개·사례 18개 (code128 11 · phone 3 · invoice 4)', () => {
    expect(GOLDEN.files).toBe(3)
    expect(GOLDEN.cases.length).toBe(18)
    expect(GOLDEN.cases.filter((x) => x.kind === 'code128').length).toBe(11)
    expect(GOLDEN.cases.filter((x) => x.kind === 'phone').length).toBe(3)
    expect(GOLDEN.cases.filter((x) => x.kind === 'invoice').length).toBe(4)
  })
  for (const { kind, c } of GOLDEN.cases) {
    it(`${c.id} ${c.title}`, () => {
      expect(run(kind, c.in)).toEqual(c.out)
    })
  }
})

// ── Code 128 표 ──────────────────────────────────────────────────────────

/** 폭 무늬 → 막대 1·빈칸 0 */
function binary(pattern: string): string {
  let out = ''
  ;[...pattern].forEach((width, k) => {
    out += (k % 2 === 0 ? '1' : '0').repeat(Number(width))
  })
  return out
}

describe('Code 128 표준 무늬', () => {
  it('값 107개, 서로 다르고, 글자마다 11칸(끝 13칸), 막대 칸 합은 짝수, 폭은 1~4', () => {
    expect(CODE128_PATTERNS.length).toBe(107)
    expect(new Set(CODE128_PATTERNS).size).toBe(107)
    CODE128_PATTERNS.forEach((pattern, value) => {
      const widths = [...pattern].map(Number)
      expect(widths.length).toBe(value === 106 ? 7 : 6)
      expect(widths.reduce((a, b) => a + b, 0)).toBe(value === 106 ? 13 : 11)
      expect(widths.every((w) => w >= 1 && w <= 4)).toBe(true)
      const barSum = widths.filter((_, k) => k % 2 === 0).reduce((a, b) => a + b, 0)
      expect(barSum % 2).toBe(0)
    })
  })
  it('잘 알려진 무늬 (표준 표의 막대·빈칸 글)', () => {
    expect(binary(CODE128_PATTERNS[0] as string)).toBe('11011001100')
    expect(binary(CODE128_PATTERNS[100] as string)).toBe('10111101110')
    expect(binary(CODE128_PATTERNS[102] as string)).toBe('11110101110')
    expect(binary(CODE128_PATTERNS[103] as string)).toBe('11010000100')
    expect(binary(CODE128_PATTERNS[104] as string)).toBe('11010010000')
    expect(binary(CODE128_PATTERNS[105] as string)).toBe('11010011100')
    expect(binary(CODE128_PATTERNS[106] as string)).toBe('1100011101011')
  })
  it('막대는 칸 0부터 겹치지 않게 이어진다', () => {
    const result = code128Codes('900000000001')
    if (!('codes' in result)) throw new Error('부호값이 있어야 한다')
    const { bars, modules } = code128Bars(result.codes)
    expect(modules).toBe((result.codes.length - 1) * 11 + 13)
    for (let i = 1; i < bars.length; i++) expect((bars[i] as readonly number[])[0]).toBeGreaterThan(((bars[i - 1] as readonly number[])[0] as number) + ((bars[i - 1] as readonly number[])[1] as number) - 1)
  })
})

// ── 시험 전용 해독기 (300dpi 그림 → 송장번호) ───────────────────────────────

const DPI = 300
const PX_PER_PT = DPI / 72
const PX_PER_MM = DPI / 25.4

interface Raster {
  readonly width: number
  readonly height: number
  /** 밝기 0(검정)~255 */
  readonly gray: Uint8Array
}

/** PDF 쪽을 300dpi 그림으로 (pdfjs + 캔버스) */
async function rasterizePdf(bytes: Uint8Array): Promise<Raster[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createCanvas } = await import('@napi-rs/canvas')
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, verbosity: 0 })
  const loaded = await task.promise
  const out: Raster[] = []
  for (let n = 1; n <= loaded.numPages; n++) {
    const page = await loaded.getPage(n)
    const viewport = page.getViewport({ scale: PX_PER_PT })
    const width = Math.ceil(viewport.width)
    const height = Math.ceil(viewport.height)
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise
    const data = context.getImageData(0, 0, width, height).data
    const gray = new Uint8Array(width * height)
    for (let i = 0; i < gray.length; i++) gray[i] = Math.round(((data[i * 4] as number) + (data[i * 4 + 1] as number) + (data[i * 4 + 2] as number)) / 3)
    out.push({ width, height, gray })
  }
  await task.destroy()
  return out
}

const dark = (raster: Raster, x: number, y: number): boolean => (raster.gray[y * raster.width + x] as number) < 128

interface Decoded {
  readonly text: string
  /** 막대 한 칸 (mm) */
  readonly moduleMm: number
  /** 앞·뒤 빈칸 (칸 수) */
  readonly quietBefore: number
  readonly quietAfter: number
  /** 첫 막대 높이 (mm) */
  readonly heightMm: number
}

/** 가로줄 y를 읽어 Code 128(시작 C, 코드 B 전환)을 푼다. 표준 무늬는 위 "잘 알려진 무늬" 시험과 표 검사를 거친 것을 쓴다 */
function decodeRow(raster: Raster, y: number): Decoded {
  const runs: { dark: boolean; start: number; length: number }[] = []
  for (let x = 0; x < raster.width; x++) {
    const d = dark(raster, x, y)
    const last = runs[runs.length - 1]
    if (last !== undefined && last.dark === d) last.length++
    else runs.push({ dark: d, start: x, length: 1 })
  }
  const firstBar = runs.findIndex((run) => run.dark)
  let lastBar = -1
  for (let i = runs.length - 1; i >= 0; i--) if ((runs[i] as { dark: boolean }).dark) {
    lastBar = i
    break
  }
  if (firstBar < 1 || lastBar < 0) throw new Error('막대가 없다')
  const elements = runs.slice(firstBar, lastBar + 1)
  const startWidth = elements.slice(0, 6).reduce((sum, run) => sum + run.length, 0)
  const module = startWidth / 11
  const lookup = new Map(CODE128_PATTERNS.map((pattern, value) => [pattern, value]))
  const values: number[] = []
  let i = 0
  while (i < elements.length) {
    const take = elements.length - i === 7 ? 7 : 6
    const group = elements.slice(i, i + take)
    const total = group.reduce((sum, run) => sum + run.length, 0)
    const unit = total / (take === 7 ? 13 : 11)
    const pattern = group.map((run) => String(Math.max(1, Math.round(run.length / unit)))).join('')
    const value = lookup.get(pattern)
    if (value === undefined) throw new Error(`모르는 무늬 ${pattern}`)
    values.push(value)
    i += take
  }
  if (values[0] !== 105 || values[values.length - 1] !== 106) throw new Error('시작 C·끝이 아니다')
  const data = values.slice(1, -2)
  const check = values[values.length - 2] as number
  const sum = data.reduce((acc, value, index) => acc + (index + 1) * value, 105)
  if (sum % 103 !== check) throw new Error('검사값이 틀렸다')
  let text = ''
  let setB = false
  for (const value of data) {
    if (!setB && value === 100) {
      setB = true
      continue
    }
    text += setB ? String.fromCharCode(value + 32) : String(value).padStart(2, '0')
  }
  const quietBefore = (runs[firstBar - 1] as { length: number }).length / module
  const after = runs[lastBar + 1]
  const quietAfter = after === undefined ? 0 : after.length / module
  const barX = (elements[0] as { start: number }).start + 1
  let top = y
  while (top > 0 && dark(raster, barX, top - 1)) top--
  let bottom = y
  while (bottom < raster.height - 1 && dark(raster, barX, bottom + 1)) bottom++
  return { text, moduleMm: module / PX_PER_MM, quietBefore, quietAfter, heightMm: (bottom - top + 1) / PX_PER_MM }
}

// ── 데이터 ─────────────────────────────────────────────────────────────────

const BASE: WaybillData = {
  carrier: 'FAKE',
  invoice: '900000000001',
  receiver: { name: '홍길동', phone: '01012345678', address: '서울특별시 중구 세종대로 110', detail: '서울시청 3층', zip: '04524', memo: '문 앞에 놓아 주세요' },
  sender: { name: '다육이네', phone: '0311234567', address: '경기도 성남시 분당구 판교역로 1' },
  itemCount: 3,
  box: '소',
  bookedDate: '2026-10-22',
}

const squash = (text: string): string => text.replace(/\s+/gu, '')

function layoutOf(data: WaybillData): WaybillLayout {
  const result = layoutWaybill(data, font)
  if (!result.ok) throw new Error(result.error.message)
  return result.layout
}

const texts = (layout: WaybillLayout): WaybillText[] => layout.items.filter((item): item is WaybillText => item.kind === 'text')

/** 배치의 글자 상자가 쪽 안에 있고 서로·바코드 자리(빈칸 포함)와 겹치지 않는가 */
function layoutProblems(layout: WaybillLayout): string[] {
  const problems: string[] = []
  const boxes = texts(layout)
  for (const t of boxes) {
    if (t.x < 0 || t.y < 0 || t.x + t.width > layout.width + 0.01 || t.y + t.height > layout.height + 0.01) problems.push(`쪽 밖: ${t.text}`)
    const b = layout.barcode
    if (t.x < b.x + b.width && b.x < t.x + t.width && t.y < b.y + b.height && b.y < t.y + t.height) problems.push(`바코드와 겹침: ${t.text}`)
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i] as WaybillText
      const c = boxes[j] as WaybillText
      if (a.x < c.x + c.width - 0.01 && c.x < a.x + a.width - 0.01 && a.y < c.y + c.height - 0.01 && c.y < a.y + a.height - 0.01) problems.push(`겹침: ${a.text} ↔ ${c.text}`)
    }
  }
  return problems
}

async function onePdf(list: readonly WaybillData[]): Promise<Uint8Array> {
  const result = await renderWaybillsPdf(list, font)
  if (result.pdf === null) throw new Error('PDF가 없다')
  return result.pdf
}

// ── AC-T1-41 ───────────────────────────────────────────────────────────────

describe('AC-T1-41 운송장 PDF 내용과 바코드', () => {
  it('쪽 하나, 100×150mm 세로, 담는 글이 다 있고 원래 번호·가격·구매자 ID는 없다, 한글 글꼴이 들어 있다', async () => {
    const pdf = await onePdf([BASE])
    const sizes = await pdfPageSizes(pdf)
    expect(sizes.length).toBe(1)
    expect(Math.abs((sizes[0] as { width: number }).width - 283.46)).toBeLessThanOrEqual(0.5)
    expect(Math.abs((sizes[0] as { height: number }).height - 425.2)).toBeLessThanOrEqual(0.5)
    const [page] = await pdfPageTexts(pdf)
    const all = squash((page as string[]).join(''))
    for (const expected of [
      '가짜 택배 · 시험용 — 실제로 보낼 수 없어요',
      '9000-0000-0001',
      '홍길동',
      '010****5678',
      BASE.receiver.address,
      BASE.receiver.detail,
      '04524',
      BASE.receiver.memo,
      '다육이네',
      '0311234567',
      BASE.sender.address,
      '물품 3개',
      '소',
      '2026-10-22',
    ]) {
      expect(all, expected).toContain(squash(expected))
    }
    expect(all).not.toContain('01012345678')
    expect(all).not.toMatch(/원|UC_|buyer/u)
    const fonts = await pdfFonts(pdf)
    expect(fonts.some((f) => f.embedded && f.subtype === '/Type0')).toBe(true)
  })

  it('데이터 모양에 구매자 ID·닉네임·가격 자리가 없다 (넘겨도 찍지 않는다)', async () => {
    const extra = { ...BASE, buyer: 'UC_SECRET', nick: '비밀닉', price: 77777 } as unknown as WaybillData
    const [page] = await pdfPageTexts(await onePdf([extra]))
    const all = (page as string[]).join('')
    expect(all).not.toContain('UC_SECRET')
    expect(all).not.toContain('비밀닉')
    expect(all).not.toContain('77777')
    expect(all).not.toContain('77,777')
  })

  it('배치: 글자 상자가 쪽 안에 있고 서로·바코드와 겹치지 않는다', () => {
    const layout = layoutOf(BASE)
    expect(layout.width).toBeCloseTo(WAYBILL_WIDTH, 5)
    expect(layout.height).toBeCloseTo(WAYBILL_HEIGHT, 5)
    expect(layoutProblems(layout)).toEqual([])
  })

  it('300dpi 그림으로 바꿔 시험 해독기로 읽으면 송장번호다 — 한 칸 ≥ 0.33mm, 높이 ≥ 15mm, 앞뒤 빈칸 ≥ 10칸 (12·20·9자리)', async () => {
    const list: WaybillData[] = [BASE, { ...BASE, invoice: '98765432109876543210' }, { ...BASE, invoice: '123456789' }]
    const pdf = await onePdf(list)
    const rasters = await rasterizePdf(pdf)
    expect(rasters.length).toBe(3)
    list.forEach((data, n) => {
      const layout = layoutOf(data)
      const raster = rasters[n] as Raster
      const y = Math.round((layout.barcode.y + layout.barcode.height / 2) * PX_PER_PT)
      const decoded = decodeRow(raster, y)
      expect(decoded.text).toBe(data.invoice)
      expect(decoded.moduleMm).toBeGreaterThanOrEqual(0.33)
      expect(decoded.heightMm).toBeGreaterThanOrEqual(15)
      expect(decoded.quietBefore).toBeGreaterThanOrEqual(10)
      expect(decoded.quietAfter).toBeGreaterThanOrEqual(10)
    })
    expect(BAR_HEIGHT / (72 / 25.4)).toBeGreaterThanOrEqual(15)
  })

  it('여러 개를 주면 한 PDF에 준 순서대로 쪽마다 하나', async () => {
    const list = ['900000000003', '900000000001', '900000000002'].map((invoice, i) => ({ ...BASE, invoice, receiver: { ...BASE.receiver, name: `받는${String(i)}` } }))
    const result = await renderWaybillsPdf(list, font)
    expect(result.outcomes.map((o) => o.ok)).toEqual([true, true, true])
    const pages = await pdfPageTexts(result.pdf as Uint8Array)
    expect(pages.length).toBe(3)
    expect(pages.map((page) => page.join(''))).toEqual([
      expect.stringContaining('9000-0000-0003'),
      expect.stringContaining('9000-0000-0001'),
      expect.stringContaining('9000-0000-0002'),
    ])
  })

  it('송장번호가 숫자 8~20자리가 아니면 그 운송장만 FORMAT', async () => {
    const result = await renderWaybillsPdf([{ ...BASE, invoice: '1234-5678' }, BASE], font)
    expect(result.outcomes.map((o) => o.error?.code ?? 'OK')).toEqual(['FORMAT', 'OK'])
    expect((await pdfPageSizes(result.pdf as Uint8Array)).length).toBe(1)
  })

  it('같은 데이터·글꼴이면 같은 PDF (시계를 읽지 않는다)', async () => {
    expect(await onePdf([BASE])).toEqual(await onePdf([BASE]))
  })
})

// ── AC-T1-42 ───────────────────────────────────────────────────────────────

describe('AC-T1-42 줄이지 않는다', () => {
  const longAddress = '경상북도 울릉군 울릉읍 독도리 이사부길 아주아주긴도로명주소가이어지는곳 '.repeat(3).slice(0, 100)
  const longDetail = '가나다라마바사아자차카타파하 '.repeat(8).slice(0, 100)
  const longName = '홍🌵길동김수한무거북이와두루미漢字삼천갑'
  const LONG: WaybillData = { ...BASE, receiver: { ...BASE.receiver, name: longName, address: longAddress, detail: longDetail } }

  it('주소 100자·상세 100자·받는 분 20자(이모지·한자)가 빠짐없이 다 있고 글자는 7pt 이상, 이모지만 빠진다', async () => {
    expect([...longAddress].length).toBe(100)
    expect([...longDetail].length).toBe(100)
    expect([...longName].length).toBe(20)
    const layout = layoutOf(LONG)
    expect(layoutProblems(layout)).toEqual([])
    for (const t of texts(layout)) expect(t.size).toBeGreaterThanOrEqual(MIN_TEXT_SIZE)
    const [page] = await pdfPageTexts(await onePdf([LONG]))
    const all = squash((page as string[]).join(''))
    const drawnName = font.sanitize(longName)
    expect(drawnName).not.toContain('🌵')
    expect(all).toContain(squash(drawnName))
    expect(all).toContain(squash(longAddress))
    expect(all).toContain(squash(longDetail))
    expect(all).not.toContain('…')
    expect(all).not.toContain('...')
  })

  it('7pt에서도 넘치는 운송장은 그것만 TOO_LONG이고 같은 PDF의 다른 운송장은 만들어진다', async () => {
    const huge: WaybillData = { ...BASE, invoice: '900000000009', receiver: { ...BASE.receiver, address: '아주 긴 주소 '.repeat(400) } }
    expect(layoutWaybill(huge, font)).toEqual({ ok: false, error: { code: 'TOO_LONG', message: WAYBILL_TOO_LONG_MESSAGE } })
    const result = await renderWaybillsPdf([BASE, huge, { ...BASE, invoice: '900000000002' }], font)
    expect(result.outcomes.map((o) => o.error?.code ?? 'OK')).toEqual(['OK', 'TOO_LONG', 'OK'])
    const pages = await pdfPageTexts(result.pdf as Uint8Array)
    expect(pages.map((page) => page.join(''))).toEqual([expect.stringContaining('9000-0000-0001'), expect.stringContaining('9000-0000-0002')])
  })

  it('모두 넘치면 PDF 없이 결과만', async () => {
    const huge: WaybillData = { ...BASE, receiver: { ...BASE.receiver, detail: '상세'.repeat(3000) } }
    const result = await renderWaybillsPdf([huge], font)
    expect(result.pdf).toBeNull()
    expect(result.outcomes[0]?.error?.code).toBe('TOO_LONG')
  })

  it('조금 넘치면 7pt까지 줄여 다 넣는다 (글자 크기가 기본보다 작다)', () => {
    const base = layoutOf(BASE)
    const long = layoutOf({ ...BASE, receiver: { ...BASE.receiver, address: '서울특별시 강남구 테헤란로 '.repeat(20), detail: '상세 주소 '.repeat(40) } })
    expect(long.textSize).toBeLessThan(base.textSize)
    expect(long.textSize).toBeGreaterThanOrEqual(MIN_TEXT_SIZE)
    expect(layoutProblems(long)).toEqual([])
  })

  it('그릴 수 없는 글자(이모지·제어 글자)만 있는 칸도 PDF 전체가 실패하지 않는다', async () => {
    const odd: WaybillData = { ...BASE, receiver: { ...BASE.receiver, name: '🌵🌵', memo: '\u0000‮🎁' }, sender: { ...BASE.sender, name: '다육이네🌱' } }
    const result = await renderWaybillsPdf([odd], font)
    expect(result.outcomes[0]?.ok).toBe(true)
    const [page] = await pdfPageTexts(result.pdf as Uint8Array)
    const all = (page as string[]).join('')
    expect(all).toContain('(이름 없음)')
    expect(all).toContain('다육이네')
    expect(all).not.toContain('배송 메모')
  })
})

// ── AC-T1-44 (문서 쪽) ─────────────────────────────────────────────────────

describe('AC-T1-44 B1으로 찍지 않는다 (문서 패키지)', () => {
  it('문서 패키지는 라벨·프린터 패키지에 기대지 않는다 (운송장은 PDF만)', () => {
    const pkg = JSON.parse(readFileSync(new URL('packages/documents/package.json', ROOT), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(deps).not.toContain('@livejjim/label')
    expect(deps).not.toContain('@livejjim/printer')
    const source = readFileSync(new URL('packages/documents/src/waybill.ts', ROOT), 'utf8')
    expect(source).not.toMatch(/@livejjim\/(label|printer)/u)
  })
})
