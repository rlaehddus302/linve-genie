// @vitest-environment jsdom
// QL3R2 적대 시험 (test-domain): 이번 회차에서 바뀐 순수 함수·작은 화면 조각만 공격한다(화면 실측은 E2E 몫).
// 1) .csv가 아닌 파일 거름 (D-QL3R2-01, AC-QL3R2-01·02) — lib/csv-text.ts
//    - UTF-8 글(BOM 있음·없음) 무작위 1,000개: 그대로 돌아온다. EUC-KR(KS X 1001 한글·숫자·쉼표) 무작위 1,000개: 그대로 돌아온다.
//    - 맞는 글의 아무 자리에 NUL 한 바이트를 끼우면 늘 NotTextFileError.
//    - 아무 바이트 2,000개: NotTextFileError가 아닌 다른 예외는 없고, 글로 풀리면 그 안에 U+FFFD가 없다(원래 바이트에 EF BF BD가 없는 한).
//    - 판매자 휴대폰에서 실제로 고를 법한 파일 머리(아이폰 HEIC 사진·안드로이드 스크린숏 PNG·JPEG·GIF·WebP·xlsx·옛 xls·hwp·mp4·UTF-16 글): 모두 예외.
//    - readCsvFile(Blob): arrayBuffer 길·FileReader 길 모두 같은 규칙.
// 2) 접힌 휴대폰 알림 띠 (D-QL3R2-02·03, AC-QL3R2-11·12·14) — AlertStrip
//    - 무작위 알림 수·출력 기기 상태 600개 × (휴대폰 접힘·휴대폰 펼침·PC): 출력 기기 긴 문장·짧은 줄은 각각 모형대로 정확히 0번/1번,
//      알림 수("알림 n 펼치기/접기")는 셋 모두 같고 출력 기기 항목을 세지 않는다, 보류 단추 글은 접힌 휴대폰만 "보류 n"(PC·펼침은 "보류 찜 n").
// 3) 숫자 키 반복 무시 (D-QL3R2-06 (2), AC-QL3R2-30) — Modal
//    - 숫자 키 무작위 열 300개(repeat 섞음): 단추가 눌린 횟수 = repeat이 아닌 그 숫자 키 수. repeat 키도 창 밖으로 새지 않는다(기본 동작 막음).
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'

const CSV_MODULE = '../../../apps/web/src/lib/csv-text.ts'
const WORDS_MODULE = '../../../apps/web/src/lib/print-words.ts'
const ALERT_MODULE = '../../../apps/web/src/components/AlertStrip.tsx'
const MODAL_MODULE = '../../../apps/web/src/components/Modal.tsx'
const REACT_MODULE = '../../../apps/web/node_modules/react/index.js'
const REACT_DOM_MODULE = '../../../apps/web/node_modules/react-dom/client.js'

interface CsvModule {
  readonly NotTextFileError: new () => Error
  decodeCsv(bytes: ArrayBuffer | Uint8Array): string
  readCsvFile(file: Blob): Promise<string>
}
interface Device {
  readonly id: string
  readonly name: string
  readonly live: boolean
  readonly releasing: boolean
}
interface StationInput {
  readonly labelsOn: boolean | null
  readonly rehearsal: boolean
  readonly ended: boolean
  readonly mine: boolean
  readonly queue: { readonly device: Device | null; readonly waiting: number; readonly printing: number; readonly paused: null } | null
}
interface WordsModule {
  readonly NO_STATION_PILING: string
  deviceLostMessage(name: string): string
  stationLeadText(input: StationInput): string | null
  stationLeadShortText(input: StationInput): string | null
}

type Element = unknown
interface ReactLike {
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element
  act(callback: () => void): void
}
interface Root {
  render(element: Element): void
  unmount(): void
}
interface HostNode {
  innerHTML: string
  readonly textContent: string | null
  querySelector(selector: string): HostNode | null
  querySelectorAll(selector: string): Iterable<HostNode> & { readonly length: number }
  append(node: HostNode): void
  focus(): void
  click(): void
  dispatchEvent(event: unknown): boolean
  getAttribute(name: string): string | null
}
interface DomGlobals {
  readonly document: { body: HostNode; activeElement: HostNode | null; createElement(tag: string): HostNode }
  readonly KeyboardEvent: new (type: string, init: Record<string, unknown>) => { readonly defaultPrevented: boolean }
  matchMedia?: (query: string) => unknown
}
const dom = globalThis as unknown as DomGlobals
const document = dom.document

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const load = async <T>(path: string): Promise<T> => (await import(/* @vite-ignore */ path)) as T

const mounted: Root[] = []
const unmountAll = () => {
  for (const root of mounted.splice(0)) root.unmount()
  document.body.innerHTML = ''
}
afterEach(() => {
  unmountAll()
  delete dom.matchMedia
})

async function draw(element: (react: ReactLike) => Element): Promise<{ host: HostNode; react: ReactLike }> {
  const React = await load<ReactLike>(REACT_MODULE)
  const { createRoot } = await load<{ createRoot(node: HostNode): Root }>(REACT_DOM_MODULE)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push(root)
  React.act(() => root.render(element(React)))
  return { host, react: React }
}

/** PC 폭 흉내 (useWide = matchMedia('(min-width: 48rem)')). 지우면 jsdom에는 matchMedia가 없어 휴대폰 모양 */
function pretendWide(): void {
  dom.matchMedia = (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const hex = (text: string): Uint8Array => Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
const count = (haystack: string, needle: string): number => (needle === '' ? 0 : haystack.split(needle).length - 1)

// ── 1) 파일 읽기 ─────────────────────────────────────────────────────

/** EUC-KR 부호기 (참조 모형): 디코더로 KS X 1001 한글 2,350자(B0A1~C8FE)를 뒤집어 만든다 */
function eucKrTable(): Map<string, [number, number]> {
  const decoder = new TextDecoder('euc-kr', { fatal: true })
  const table = new Map<string, [number, number]>()
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
      const letter = decoder.decode(Uint8Array.from([lead, trail]))
      if (letter.length === 1 && letter !== '�') table.set(letter, [lead, trail])
    }
  }
  return table
}

describe('TD-QL3R2 .csv가 아닌 파일 거름 (D-QL3R2-01)', () => {
  it('UTF-8 글 무작위 1,000개: BOM 있음·없음 모두 그대로 (NUL·맨 앞 U+FEFF 없는 글)', async () => {
    const { decodeCsv } = await load<CsvModule>(CSV_MODULE)
    const textArb = fc
      .string({ unit: fc.oneof(fc.constantFrom('거래일시', ',', '입금액', '\n', '\r\n', '"', '24,000', '물주기담당', '🌵', '\t', ' '), fc.string({ unit: 'grapheme', maxLength: 1 })), maxLength: 60 })
      .filter((text) => !text.includes('\u0000') && !text.startsWith('﻿'))
    fc.assert(
      fc.property(textArb, fc.boolean(), (text, bom) => {
        const bytes = bom ? Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(text)]) : utf8(text)
        expect(decodeCsv(bytes)).toBe(text)
        expect(decodeCsv(bytes.slice().buffer)).toBe(text)
      }),
      { numRuns: 1000 },
    )
  })

  it('EUC-KR 은행 글 무작위 1,000개 (한글 한 자 이상): 그대로', async () => {
    const { decodeCsv } = await load<CsvModule>(CSV_MODULE)
    const table = eucKrTable()
    expect(table.size).toBe(2350)
    const hangul = [...table.keys()]
    const encode = (text: string): Uint8Array => Uint8Array.from(Array.from(text).flatMap((letter) => table.get(letter) ?? [letter.charCodeAt(0)]))
    const unit = fc.oneof(fc.constantFrom(...hangul), fc.constantFrom(',', '\r\n', '\n', ' ', '0', '9', '-', ':', '.', '"'))
    // 앞쪽 바이트가 B0~BF인 한글(거·래·시·액 등 은행 머리 줄 글자)이 하나는 있다 — 그런 글은 UTF-8로 풀리지 않는다.
    // (C2~C8 + A1~BF 한글만으로 된 짧은 글, 예 "킵"=C5 B5는 올바른 UTF-8이라 UTF-8 먼저 규칙(AC-N3-45)대로 UTF-8로 읽힌다 — 은행 파일엔 머리 줄이 있어 생기지 않음)
    const notUtf8 = hangul.filter((letter) => (table.get(letter)?.[0] ?? 0) <= 0xbf)
    const arb = fc.tuple(fc.string({ unit, maxLength: 40 }), fc.constantFrom(...notUtf8), fc.string({ unit, maxLength: 40 })).map(([a, b, c]) => `${a}${b}${c}`)
    fc.assert(
      fc.property(arb, (text) => {
        expect(decodeCsv(encode(text))).toBe(text)
      }),
      { numRuns: 1000 },
    )
    // 은행 머리 줄 그대로 (AC-QL3R2-02 (b))
    const bank = '거래일시,입금액,출금액,잔액,내용\r\n2026-10-26 14:20,24000,0,124000,물주기담당\r\n'
    expect(Array.from(bank).every((letter) => table.has(letter) || letter.charCodeAt(0) < 0x80)).toBe(true)
    expect(decodeCsv(encode(bank))).toBe(bank)
  })

  it('맞는 글(UTF-8·EUC-KR)의 아무 자리에 NUL 한 바이트를 끼우면 늘 NotTextFileError', async () => {
    const { decodeCsv, NotTextFileError } = await load<CsvModule>(CSV_MODULE)
    const table = eucKrTable()
    const encode = (text: string): Uint8Array => Uint8Array.from(Array.from(text).flatMap((letter) => table.get(letter) ?? [letter.charCodeAt(0)]))
    const base = fc.oneof(
      fc.string({ maxLength: 40 }).map((text) => utf8(text.replaceAll('\u0000', ''))),
      fc.constantFrom('거래일시,입금액\r\n10/26,24000\r\n', '가나다').map(encode),
    )
    fc.assert(
      fc.property(base, fc.nat(), (bytes, at) => {
        const spot = bytes.length === 0 ? 0 : at % (bytes.length + 1)
        const withNul = Uint8Array.from([...bytes.slice(0, spot), 0x00, ...bytes.slice(spot)])
        expect(() => decodeCsv(withNul)).toThrow(NotTextFileError)
      }),
      { numRuns: 1000 },
    )
  })

  it('아무 바이트 2,000개: 다른 예외 없음, 글로 풀리면 깨진 글자(U+FFFD) 없음', async () => {
    const { decodeCsv, NotTextFileError } = await load<CsvModule>(CSV_MODULE)
    const hasReplacementBytes = (bytes: Uint8Array): boolean => {
      for (let i = 0; i + 2 < bytes.length; i += 1) if (bytes[i] === 0xef && bytes[i + 1] === 0xbf && bytes[i + 2] === 0xbd) return true
      return false
    }
    const bytesArb = fc.oneof(
      fc.uint8Array({ maxLength: 64 }),
      // 높은 바이트 쪽으로 치우친 열 (EUC-KR·UTF-8 경계)
      fc.array(fc.integer({ min: 0x80, max: 0xff }), { maxLength: 32 }).map((list) => Uint8Array.from(list)),
    )
    fc.assert(
      fc.property(bytesArb, (bytes) => {
        let out: string
        try {
          out = decodeCsv(bytes)
        } catch (error) {
          expect(error).toBeInstanceOf(NotTextFileError)
          return
        }
        expect(bytes.includes(0)).toBe(false)
        if (!hasReplacementBytes(bytes)) expect(out.includes('�')).toBe(false)
      }),
      { numRuns: 2000 },
    )
  })

  it('판매자 휴대폰에서 고를 법한 글이 아닌 파일 머리: 모두 NotTextFileError', async () => {
    const { decodeCsv, NotTextFileError } = await load<CsvModule>(CSV_MODULE)
    const heads: Record<string, string> = {
      // 아이폰 사진 (HEIC, ftyp heic)
      'IMG_0001.HEIC': '00000018667479706865696300000000',
      // 안드로이드 스크린숏 PNG
      'Screenshot.png': '89504e470d0a1a0a0000000d494844520000043800000960',
      'KakaoTalk.jpg': 'ffd8ffe000104a46494600010100000100010000',
      'sticker.gif': '47494638396101000100800000ffffff00000021',
      'photo.webp': '52494646a40000005745425056503820980000003001009d012a',
      '거래내역.xlsx': '504b030414000600080000002100',
      '거래내역.xls': 'd0cf11e0a1b11ae1000000000000000000000000',
      '문서.hwp': 'd0cf11e0a1b11ae10000000000000000',
      'video.mp4': '000000206674797069736f6d0000020069736f6d',
      // 메모장 "유니코드" 저장(UTF-16LE + BOM) — "거래" 두 글자: 결정 규칙 (1) NUL이 있어 거른다
      'utf16.csv': 'fffe70ac98b72c00',
    }
    for (const [name, head] of Object.entries(heads)) {
      expect(() => decodeCsv(hex(head)), name).toThrow(NotTextFileError)
    }
  })

  it('readCsvFile: arrayBuffer 길과 FileReader 길이 같은 규칙 (PNG는 거절, EUC-KR은 글)', async () => {
    const { readCsvFile, NotTextFileError } = await load<CsvModule>(CSV_MODULE)
    const png = hex('89504e470d0a1a0a0000000d49484452')
    const table = eucKrTable()
    const euc = Uint8Array.from(Array.from('거래일시,입금액\r\n').flatMap((letter) => table.get(letter) ?? [letter.charCodeAt(0)]))
    const plain = (bytes: Uint8Array): Blob => new Blob([bytes])
    // FileReader 길: arrayBuffer가 없는 Blob 흉내
    const oldBlob = (bytes: Uint8Array): Blob => {
      const blob = new Blob([bytes])
      Object.defineProperty(blob, 'arrayBuffer', { value: undefined })
      return blob
    }
    for (const make of [plain, oldBlob]) {
      await expect(readCsvFile(make(png))).rejects.toBeInstanceOf(NotTextFileError)
      await expect(readCsvFile(make(euc))).resolves.toBe('거래일시,입금액\r\n')
      await expect(readCsvFile(make(new Uint8Array()))).resolves.toBe('')
    }
  })
})

// ── 2) 접힌 휴대폰 알림 띠 ───────────────────────────────────────────

const NASTY = ['<b>PC</b>', '<img src onerror=a>', '🌵 다육이 폰 🌵', 'PC 2', '매장노트북포장대옆두번째']

describe('TD-QL3R2 접힌 휴대폰 띠 이중 표시 없음·보류 n·출력 기기 없음 짧은 줄 (D-QL3R2-02·03)', () => {
  it('무작위 600개 × 휴대폰 접힘·휴대폰 펼침·PC: 출력 기기 문장 수·알림 수·보류 단추 글이 모형과 같다', async () => {
    const words = await load<WordsModule>(WORDS_MODULE)
    const { AlertStrip } = await load<{ AlertStrip: unknown }>(ALERT_MODULE)
    const device = fc.record({ id: fc.constant('dev-1'), name: fc.constantFrom(...NASTY), live: fc.boolean(), releasing: fc.constant(false) })
    const station = fc.record({
      labelsOn: fc.constantFrom<boolean | null>(true, true, true, false),
      rehearsal: fc.constantFrom(false, false, true),
      ended: fc.constantFrom(false, false, true),
      mine: fc.constantFrom(false, false, true),
      queue: fc.record({ device: fc.option(device, { nil: null }), waiting: fc.nat({ max: 3 }), printing: fc.constant(0), paused: fc.constant(null) }),
    })
    const counts = fc.record({
      conflict: fc.nat({ max: 2 }),
      cancelRequest: fc.nat({ max: 2 }),
      succession: fc.nat({ max: 1 }),
      pending: fc.nat({ max: 12 }),
      attention: fc.nat({ max: 2 }),
    })
    const print = fc.record({ pause: fc.option(fc.constant('프린터 덮개가 열렸어요.'), { nil: null }), discard: fc.nat({ max: 2 }) })
    let checked = 0
    await fc.assert(
      fc.asyncProperty(station, counts, print, fc.boolean(), async (input, alertCounts, printAlerts, platformLead) => {
        const long = words.stationLeadText(input)
        const short = words.stationLeadShortText(input)
        // 짧은 줄은 긴 문장이 있을 때만, 그리고 있으면 늘 있다 (끊김·없음+대기 둘 다 짧은 줄)
        expect(short === null).toBe(long === null)
        const leads = [
          ...(platformLead ? [{ key: 'tiktok', text: '틱톡 알림 1', onClick: () => {} }] : []),
          ...(long === null ? [] : [{ key: 'print-station', text: long, ...(short === null ? {} : { shortText: short }), soft: true, uncounted: true, onClick: () => {} }]),
        ]
        const totals: string[] = []
        for (const mode of ['folded', 'expanded', 'pc'] as const) {
          if (mode === 'pc') pretendWide()
          const { host } = await draw((React) =>
            React.createElement(AlertStrip, { leads, counts: alertCounts, print: printAlerts, expanded: mode === 'expanded', onOpen: () => {}, onToggle: () => {} }),
          )
          const all = host.textContent ?? ''
          const label = `${mode} ${JSON.stringify(input)}`
          if (long !== null && short !== null) {
            // 접힌 휴대폰: 짧은 줄 1번·긴 문장 0번, 펼친 띠·PC: 긴 문장 1번·짧은 줄 0번 (AC-QL3R2-12·14)
            expect(count(all, long), label).toBe(mode === 'folded' ? 0 : 1)
            expect(count(all, short), label).toBe(mode === 'folded' ? 1 : 0)
            // 화면 읽기(이름)에도 긴 문장이 없다
            const labelled = [...host.querySelectorAll('[aria-label],[title]')].map((node) => `${node.getAttribute('aria-label') ?? ''}${node.getAttribute('title') ?? ''}`).join('|')
            if (mode === 'folded') expect(labelled.includes(long), label).toBe(false)
          }
          // 보류 단추 글: 접힌 휴대폰만 "보류 n" (AC-QL3R2-11)
          const buttonTexts = [...host.querySelectorAll('button')].map((node) => node.textContent ?? '')
          if (alertCounts.pending > 0) {
            const want = mode === 'folded' ? `보류 ${String(alertCounts.pending)}` : `보류 찜 ${String(alertCounts.pending)}`
            expect(buttonTexts.filter((text) => text === want).length, label).toBe(1)
            if (mode === 'folded') expect(buttonTexts.some((text) => text.startsWith('보류 찜')), label).toBe(false)
          } else {
            expect(buttonTexts.some((text) => text.startsWith('보류')), label).toBe(false)
          }
          const toggle = host.querySelector('button.alert-toggle')
          totals.push((toggle?.textContent ?? '').replace(/ (펼치기|접기)$/, ''))
          unmountAll()
          delete dom.matchMedia
        }
        // 알림 수는 세 모양 모두 같다. 출력 기기 항목은 세지 않는다 (AC-QL3R2-12)
        const expectedTotal =
          alertCounts.conflict + alertCounts.cancelRequest + alertCounts.succession + alertCounts.pending + alertCounts.attention + (printAlerts.pause === null ? 0 : 1) + printAlerts.discard + (platformLead ? 1 : 0)
        // 띠에 항목이 하나도 없으면 펼치기 단추도 없다 (QL2 D-QL2-02)
        const word = expectedTotal > 0 ? `알림 ${String(expectedTotal)}` : leads.length > 0 ? '알림' : ''
        expect(totals[0]).toBe(word)
        expect(totals[1]).toBe(word)
        checked += 1
      }),
      { numRuns: 600 },
    )
    expect(checked).toBe(600)
  })

  it('출력 기기 없음 + 대기: 접힌 띠 짧은 줄은 정확한 문장, 대기 0장이면 줄 없음 (AC-QL3R2-14)', async () => {
    const words = await load<WordsModule>(WORDS_MODULE)
    const base: StationInput = { labelsOn: true, rehearsal: false, ended: false, mine: false, queue: { device: null, waiting: 2, printing: 0, paused: null } }
    expect(words.stationLeadText(base)).toBe(words.NO_STATION_PILING)
    expect(words.stationLeadShortText(base)).toBe('라벨이 안 나가요 · 프린터를 연결해 주세요') // MOB2 D-MOB2-17
    const empty: StationInput = { ...base, queue: { device: null, waiting: 0, printing: 0, paused: null } }
    expect(words.stationLeadShortText(empty)).toBeNull()
    expect(words.stationLeadText(empty)).toBeNull()
  })
})

// ── 3) 숫자 키 반복 무시 ─────────────────────────────────────────────

describe('TD-QL3R2 숫자 키를 누르고 있어도 한 번만 (D-QL3R2-06 (2))', () => {
  it('무작위 숫자 키 열 300개(repeat 섞음): 눌린 횟수 = repeat 아닌 그 키 수, repeat도 기본 동작 막음', async () => {
    const { Modal } = await load<{ Modal: unknown }>(MODAL_MODULE)
    const keyArb = fc.record({ key: fc.constantFrom('1', '2', '3', '4'), repeat: fc.boolean() })
    await fc.assert(
      fc.asyncProperty(fc.array(keyArb, { maxLength: 30 }), async (keys) => {
        const pressed: Record<string, number> = { '1': 0, '2': 0, '3': 0 }
        const { host, react } = await draw((React) =>
          React.createElement(
            Modal,
            { title: '찜 취소하기', onClose: () => {}, unlocked: true },
            ...['1', '2', '3'].map((key) => React.createElement('button', { key, type: 'button', 'data-key': key, onClick: () => (pressed[key] = (pressed[key] ?? 0) + 1) }, `${key}. 사유`)),
          ),
        )
        const panel = host.querySelector('[role="dialog"]')
        expect(panel).not.toBeNull()
        for (const { key, repeat } of keys) {
          const event = new dom.KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true })
          react.act(() => {
            ;(document.activeElement ?? panel)?.dispatchEvent(event)
          })
          // 그 숫자 단추가 있으면(1~3) repeat이어도 창 밖으로 내보내지 않는다(다른 단축키가 받지 않게)
          if (key !== '4') expect(event.defaultPrevented, `${key} repeat=${String(repeat)}`).toBe(true)
        }
        for (const key of ['1', '2', '3']) {
          expect(pressed[key], key).toBe(keys.filter((k) => k.key === key && !k.repeat).length)
        }
        unmountAll()
      }),
      { numRuns: 300 },
    )
  })
})
