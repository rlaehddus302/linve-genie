// 문서 패키지 시험 도구 (테스트 파일 아님). 테스터(tests/adversarial/p2)도 상대 경로로 가져다 쓸 수 있다.
// - replayGolden: 골든 시나리오(G-ENG-201·202 등)의 이벤트를 그대로 실제 코어에 넣은 상태 (골든 러너의 어댑터와 같은 변환 — 문자찜 phone → phoneKey·phoneLast4)
// - fontBytes: 저장소의 Pretendard 글꼴 바이트
// - pdfTexts·pdfPageTexts·pdfFonts: PDF 글자 뽑기(pdfjs-dist)·글꼴 객체 검사(pdf-lib)
// - decodePng: PNG 머리·화소 풀기(Node zlib)
// - readXlsx: exceljs로 다시 읽기
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { applyEvent, initEngine, isInvalidEvent, isNotImplemented, type EngineEvent, type EngineState, type SettingsOverride } from '@livejjim/core'
import fc from 'fast-check'
import { parseGoldenYaml, realCore, smsPhoneFields, validateDocument, type ScenarioDoc } from '@livejjim/core/golden'
import ExcelJS from 'exceljs'
import { PDFDict, PDFDocument, PDFName, PDFRef, PDFStream } from 'pdf-lib'

const ROOT = new URL('../../../', import.meta.url)

let fontCache: Uint8Array | null = null
/** 저장소의 문서 글꼴 (Pretendard Regular, OFL) */
export function fontBytes(): Uint8Array {
  fontCache ??= new Uint8Array(readFileSync(new URL('packages/documents/fonts/Pretendard-Regular.ttf', ROOT)))
  return fontCache
}

/** 골든 파일의 시나리오 하나 (검증을 통과한 모양) */
export function goldenScenario(file: string, id: string): ScenarioDoc {
  const parsed = parseGoldenYaml(readFileSync(new URL(`tests/golden/${file}`, ROOT), 'utf8'))
  if (!parsed.ok) throw new Error(`골든 파일을 읽지 못했다: ${file}`)
  for (const document of parsed.documents) {
    const result = validateDocument(document.value)
    if (result.ok && result.doc.kind === 'scenario' && result.doc.id === id) return result.doc
  }
  throw new Error(`시나리오가 없다: ${id}`)
}

/** 골든 시나리오의 이벤트를 처음부터 실제 코어에 넣은 마지막 상태 */
export function replayGolden(id: string, file = 'engine/19-p2-documents.yaml'): EngineState {
  const scenario = goldenScenario(file, id)
  let state = realCore.engine.start(scenario.setup)
  for (const step of scenario.steps) {
    if (step.kind === 'event') state = realCore.engine.apply(state, step.event).state
  }
  return state as EngineState
}

// ── 직접 만든 상태 ───────────────────────────────────────────────────────

export const B1 = { id: 'b1', date: '2026-10-18', title: '1부' } as const
/** 2026-10-18 20:00:00 KST */
export const T0 = Date.UTC(2026, 9, 18, 11, 0, 0)

/** 이벤트 입력 (seq·at은 채운다 — at을 적지 않으면 T0 + i초). 문자찜의 phone은 골든 어댑터처럼 phoneKey·phoneLast4로 바꾼다 */
export type EventInput = { readonly type: string; readonly at?: number; readonly phone?: string } & Record<string, unknown>

export function play(events: readonly EventInput[], options: { broadcasts?: readonly { id: string; date: string; title: string }[]; settings?: SettingsOverride } = {}): EngineState {
  let state = initEngine({ broadcasts: options.broadcasts ?? [B1], settings: options.settings ?? {} })
  events.forEach((input, i) => {
    const { phone, ...rest } = input
    const event = { at: T0 + i * 1000, ...rest, ...(input.type === 'sms' ? smsPhoneFields(phone) : {}), seq: i + 1 } as unknown as EngineEvent
    state = applyEvent(state, event).state
  })
  return state
}

/** 상품 하나·채팅 찜 하나 */
export const sale = (no: number, buyer: string, nick: string, fields: { price?: number; name?: string; b?: string } = {}): EventInput[] => [
  { type: 'product.register', b: fields.b ?? 'b1', no, name: fields.name ?? '핑크프릴', price: fields.price ?? 10000 },
  { type: 'chat', b: fields.b ?? 'b1', id: `m-${fields.b ?? 'b1'}-${String(no)}-${buyer}`, ch: buyer, nick, text: String(no) },
]

// ── 무작위 이벤트 (속성 시험) ─────────────────────────────────────────────

/** 두 날짜의 방송 (b1: 2026-10-18, b2: 2026-10-19) */
export const RANDOM_BROADCASTS = [
  { id: 'b1', date: '2026-10-18', title: '1부' },
  { id: 'b2', date: '2026-10-19', title: '다음 날' },
] as const

/** 상품·채팅 찜·취소·가격 변경·판매 종료·입금·조정·배송비 예외·합치기를 섞은 이벤트 열 */
export function randomEvents(maxLength = 30): fc.Arbitrary<EventInput[]> {
  const buyer = fc.constantFrom('UC_1', 'UC_2', 'UC_3', 'UC_4')
  const b = fc.constantFrom('b1', 'b2')
  const no = fc.integer({ min: 1, max: 5 })
  const date = fc.constantFrom('2026-10-18', '2026-10-19')
  const event = fc.oneof(
    { arbitrary: fc.record({ type: fc.constant('product.register'), b, no, name: fc.constantFrom('핑크프릴', '라울', ''), price: fc.integer({ min: 0, max: 30 }).map((k) => k * 1000), stock: fc.integer({ min: 1, max: 2 }) }), weight: 3 },
    { arbitrary: fc.record({ type: fc.constant('chat'), b, id: fc.uuid(), ch: buyer, nick: fc.constantFrom('홍길동', '꽃님', '🌵다육맘'), text: no.map(String) }), weight: 4 },
    { arbitrary: fc.record({ type: fc.constant('chat'), b, id: fc.uuid(), ch: buyer, nick: fc.constant('홍길동'), text: no.map((n) => `${String(n)} 취소`) }), weight: 1 },
    { arbitrary: fc.record({ type: fc.constant('host.cancel'), b, no, buyer, reason: fc.constant('사유') }), weight: 1 },
    { arbitrary: fc.record({ type: fc.constant('product.update'), b, no, price: fc.integer({ min: 1, max: 30 }).map((k) => k * 1000) }), weight: 1 },
    { arbitrary: fc.record({ type: fc.constant('product.close'), b, no }), weight: 1 },
    { arbitrary: fc.record({ type: fc.constant('settlement.payment'), buyer, date, amount: fc.integer({ min: 1, max: 40 }).map((k) => k * 1000) }), weight: 1 },
    { arbitrary: fc.record({ type: fc.constant('settlement.adjust'), buyer, date, amount: fc.integer({ min: -20, max: 20 }).map((k) => k * 1000), reason: fc.constant('조정') }), weight: 1 },
    { arbitrary: fc.record({ type: fc.constant('settlement.shippingOverride'), buyer, date, mode: fc.constantFrom('PICKUP', 'COMBINED', 'DEFAULT') }), weight: 1 },
    { arbitrary: fc.record({ type: fc.constant('buyer.merge'), from: buyer, into: buyer, reason: fc.constant('같은 사람') }), weight: 1 },
  )
  return fc.array(event, { minLength: 1, maxLength }) as fc.Arbitrary<EventInput[]>
}

/** 엔진이 받지 않는 이벤트(입력 오류·미구현)는 건너뛰고 차례로 넣는다 */
export function playLoosely(events: readonly EventInput[], broadcasts: readonly { id: string; date: string; title: string }[] = RANDOM_BROADCASTS): EngineState {
  let state = initEngine({ broadcasts, settings: {} })
  let seq = 0
  events.forEach((event, i) => {
    try {
      state = applyEvent(state, { at: T0 + i * 1000, ...event, seq: seq + 1 } as unknown as EngineEvent).state
      seq++
    } catch (error) {
      if (!isInvalidEvent(error) && !isNotImplemented(error)) throw error
    }
  })
  return state
}

// ── PDF ─────────────────────────────────────────────────────────────────

interface TextItem {
  readonly str: string
  readonly transform: readonly number[]
}

/** PDF 쪽마다 뽑은 글자 조각 (놓인 순서) */
export async function pdfPageTexts(bytes: Uint8Array): Promise<string[][]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, verbosity: 0 })
  const loaded = await task.promise
  const pages: string[][] = []
  for (let n = 1; n <= loaded.numPages; n++) {
    const page = await loaded.getPage(n)
    const content = await page.getTextContent()
    pages.push((content.items as TextItem[]).map((item) => item.str).filter((text) => text.trim() !== ''))
  }
  await task.destroy()
  return pages
}

/** PDF 전체 글자를 한 줄로 (조각 사이 공백) */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  return (await pdfPageTexts(bytes)).map((page) => page.join(' ')).join('\n')
}

export interface PdfFontInfo {
  readonly subtype: string
  readonly baseFont: string
  /** 글꼴 파일이 문서 안에 들어 있는가 (FontFile·FontFile2·FontFile3) */
  readonly embedded: boolean
}

/** PDF 안의 글꼴 객체 (복합 글꼴은 자손 글꼴의 글꼴 설명까지 본다) */
export async function pdfFonts(bytes: Uint8Array): Promise<PdfFontInfo[]> {
  const doc = await PDFDocument.load(bytes)
  const context = doc.context
  const deref = (value: unknown): unknown => (value instanceof PDFRef ? context.lookup(value) : value)
  const out: PdfFontInfo[] = []
  for (const [, object] of context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFStream ? object.dict : object
    if (!(dict instanceof PDFDict) || dict.get(PDFName.of('Type')) !== PDFName.of('Font')) continue
    const subtype = String(dict.get(PDFName.of('Subtype')))
    const baseFont = String(dict.get(PDFName.of('BaseFont')))
    let descriptor = deref(dict.get(PDFName.of('FontDescriptor')))
    const descendants = deref(dict.get(PDFName.of('DescendantFonts')))
    if (descriptor === undefined && Array.isArray((descendants as { array?: unknown[] } | undefined)?.array)) {
      const first = deref((descendants as { array: unknown[] }).array[0])
      if (first instanceof PDFDict) descriptor = deref(first.get(PDFName.of('FontDescriptor')))
    }
    const embedded =
      descriptor instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((key) => descriptor instanceof PDFDict && descriptor.get(PDFName.of(key)) !== undefined)
    out.push({ subtype, baseFont, embedded })
  }
  return out
}

/**
 * PDF에 실제로 찍힌 글리프마다 ① 들어 있는 글꼴 파일에 모양이 있는가 ② 글자 폭(/W)이 적혀 있는가.
 * 글자 뽑기(ToUnicode)는 멀쩡해도 화면에는 빈칸·벌어진 칸으로 보이는 깨짐(D-PDF-FONT-01)을 잡는다. 문제 목록을 돌려준다.
 */
export async function pdfGlyphProblems(bytes: Uint8Array): Promise<string[]> {
  const fontkit = (await import('@pdf-lib/fontkit')).default as unknown as {
    create(buffer: Uint8Array): { getGlyph(id: number): { path: { commands: readonly unknown[] }; name?: string } }
  }
  const doc = await PDFDocument.load(bytes)
  const context = doc.context
  const deref = (value: unknown): unknown => (value instanceof PDFRef ? context.lookup(value) : value)
  const streamBytes = (stream: PDFStream): Uint8Array => {
    const raw = (stream as unknown as { contents: Uint8Array }).contents
    return String(stream.dict.get(PDFName.of('Filter'))) === '/FlateDecode' ? new Uint8Array(inflateSync(raw)) : raw
  }
  let fontFile: Uint8Array | undefined
  const widths = new Set<number>()
  for (const [, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || String(object.get(PDFName.of('Subtype'))) !== '/CIDFontType2') continue
    const w = deref(object.get(PDFName.of('W'))) as { asArray(): unknown[] } | undefined
    const items = w?.asArray() ?? []
    for (let i = 0; i < items.length; ) {
      const first = (items[i] as { asNumber(): number }).asNumber()
      const next = deref(items[i + 1])
      if (next !== undefined && typeof (next as { asArray?: unknown }).asArray === 'function') {
        ;(next as { asArray(): unknown[] }).asArray().forEach((_, k) => widths.add(first + k))
        i += 2
      } else {
        for (let g = first; g <= (next as { asNumber(): number }).asNumber(); g++) widths.add(g)
        i += 3
      }
    }
    const descriptor = deref(object.get(PDFName.of('FontDescriptor')))
    const file = descriptor instanceof PDFDict ? deref(descriptor.get(PDFName.of('FontFile2'))) : undefined
    if (file instanceof PDFStream) fontFile = streamBytes(file)
  }
  if (fontFile === undefined) return ['글꼴 파일(FontFile2)이 없다']
  const embedded = fontkit.create(fontFile)
  const used = new Set<number>()
  for (const page of doc.getPages()) {
    const contents = deref(page.node.get(PDFName.of('Contents')))
    const streams = contents instanceof PDFStream ? [contents] : ((contents as { asArray(): unknown[] } | undefined)?.asArray().map(deref) ?? [])
    for (const stream of streams) {
      if (!(stream instanceof PDFStream)) continue
      const text = new TextDecoder('latin1').decode(streamBytes(stream))
      for (const match of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
        const hex = match[1] as string
        for (let i = 0; i + 4 <= hex.length; i += 4) used.add(Number.parseInt(hex.slice(i, i + 4), 16))
      }
    }
  }
  const problems: string[] = []
  for (const id of [...used].sort((a, b) => a - b)) {
    if (!widths.has(id)) problems.push(`글리프 ${String(id)}: 폭(/W) 없음`)
    try {
      const glyph = embedded.getGlyph(id)
      const name = glyph.name ?? ''
      if (glyph.path.commands.length === 0 && !/space|uni00A0|uni3000/.test(name)) problems.push(`글리프 ${String(id)}(${name}): 모양 없음`)
    } catch (error) {
      problems.push(`글리프 ${String(id)}: 모양을 읽을 수 없음 (${String(error)})`)
    }
  }
  return used.size === 0 ? ['찍힌 글리프가 없다'] : problems
}

/** PDF 쪽 크기 (pt) */
export async function pdfPageSizes(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((page) => page.getSize())
}

// ── PNG ─────────────────────────────────────────────────────────────────

export interface DecodedPng {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly colorType: number
  /** 회색조 화소 (거르기를 푼 값) */
  readonly pixels: Uint8Array
}

/** 회색조 8비트 PNG를 푼다 (시험용 — 이 패키지가 만든 모양만) */
export function decodePng(bytes: Uint8Array): DecodedPng {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!signature.every((byte, i) => bytes[i] === byte)) throw new Error('PNG 서명이 아니다')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Uint8Array[] = []
  while (offset < bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8)
      height = view.getUint32(offset + 12)
      bitDepth = data[8] as number
      colorType = data[9] as number
    } else if (type === 'IDAT') idat.push(data)
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const pixels = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)] as number
    for (let x = 0; x < width; x++) {
      const value = raw[y * (width + 1) + 1 + x] as number
      const left = x === 0 ? 0 : (pixels[y * width + x - 1] as number)
      const up = y === 0 ? 0 : (pixels[(y - 1) * width + x] as number)
      let out = value
      if (filter === 1) out = value + left
      else if (filter === 2) out = value + up
      else if (filter !== 0) throw new Error(`시험 도구가 모르는 거르기 ${String(filter)}`)
      pixels[y * width + x] = out & 0xff
    }
  }
  return { width, height, bitDepth, colorType, pixels }
}

// ── 엑셀 ─────────────────────────────────────────────────────────────────

export interface XlsxCell {
  readonly value: unknown
  /** exceljs ValueType 이름 (String·Number·Null·Formula …) */
  readonly type: string
  readonly numFmt: string | undefined
}

export interface XlsxSheet {
  readonly name: string
  readonly rows: XlsxCell[][]
  readonly views: unknown
}

/** .xlsx 바이트를 exceljs로 다시 읽는다 (빈 칸은 Null) */
export async function readXlsx(bytes: Uint8Array): Promise<XlsxSheet[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer)
  const typeName = (type: number): string => Object.entries(ExcelJS.ValueType).find(([, value]) => value === type)?.[0] ?? String(type)
  return workbook.worksheets.map((sheet) => {
    const rows: XlsxCell[][] = []
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r)
      const cells: XlsxCell[] = []
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = row.getCell(c)
        cells.push({ value: cell.value, type: typeName(cell.type), numFmt: cell.numFmt })
      }
      rows.push(cells)
    }
    return { name: sheet.name, rows, views: sheet.views }
  })
}
