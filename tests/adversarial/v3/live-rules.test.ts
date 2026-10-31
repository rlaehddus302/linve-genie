// V3 적대 시험 (test-domain, 실방송 고침 — 사용자 요청으로 바뀐 규칙, D-V3 결정 기록 중): 실방송 1~3회에서 바꾼 인식 규칙을 공격한다.
// 1. 빠진 0 되살리기(number-context.ts fixDroppedZero, 실방송 306번): 36 → 306은 3xx 맥락(최근 음성 등록 둘이 306 ±20)이나 중간 결과·기다리는 번호에 306이 보일 때만.
//    방송 처음의 진짜 36번은 36번 그대로.
// 2. 가격만 들린 조각(price-only.ts priceOnlyFix, 실방송 10:14): 정정 낱말이 있을 때만 마지막 음성 상품 가격 고침. 아니면 번호 없는 가격으로 15초 기다려
//    가격 없이 들린 다음 'N번'의 가격으로, 'N번'이 가격과 함께 들리면 버림.
// 3. 짧은 이름 exactOnly(콜리·퍼플·창금·황소·레다·SP — 적은 모양으로만): 콜라·퍼즐·창극·황수·황소처럼은 이름이 아니다.
// 4. 이름 끝 '색급'은 '색금'(크롬 오기): 립스틱색급 → 립스틱색금, 사전에 그 이름이 없으면 그대로.
// 실제 음성 모듈 + 실제 콘솔 음성 컨트롤러 + 가짜 인식 객체 + 가짜 시계 (controller-stability.test.ts와 같은 틀).
import * as voiceModule from '@livejjim/voice'
import { DROPPED_ZERO_NEAR, fixDroppedZero, hasPriceCorrection, prepareVoiceDictionary, priceOnlyFix, readRegistration, type DroppedZeroProduct } from '@livejjim/voice'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 화면처럼 같은 상품 이름 목록을 돌려준다(ConsolePage useMemo — 상품이 바뀔 때만 새 목록). 부를 때마다 새 목록이면 컨트롤러가 사전을
// 매번 다시 만든다(#prepared는 목록이 같을 때만 다시 씀) — 사전이 1,082개로 커진 뒤(D-V3-115) 시험이 느려진 틀 문제. 단언은 그대로.
const NO_NAMES: readonly string[] = []

// SRV1(D-APP-22·23, AC-SRV1-15): 음성 읽기 컨트롤러는 웹에서 서버 음성 흐름(packages/voice-session, server.ts createReadingSession)으로 옮겼다 — 같은 사례를 지금 제품 경로에서 본다.
const CONTROLLER_MODULE = '../../../packages/voice-session/src/controller/controller.ts'
const T0 = Date.UTC(2026, 9, 27, 1, 0, 0)
const DICT = prepareVoiceDictionary()

class FakeRecognition {
  static readonly all: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  results: { isFinal: boolean; length: number; 0: { transcript: string } }[] = []
  constructor() {
    FakeRecognition.all.push(this)
  }
  start(): void {}
  stop(): void {}
  abort(): void {}
  say(text: string, final: boolean): void {
    const last = this.results.at(-1)
    if (last !== undefined && !last.isFinal) this.results.pop()
    this.results.push({ isFinal: final, length: 1, 0: { transcript: text } })
    this.onresult?.({ resultIndex: this.results.length - 1, results: this.results })
  }
}

interface View {
  key: string
  name: string
  price: number
  claimCount: number
  closed: boolean
  status?: string
}
interface Controller {
  turnOn(): Promise<void>
  noteVoiceRegistered(entry: { id: string; no: number; name: string; price: number }): void
  getSnapshot(): { offers: readonly { stage: string; no?: number; note?: string; message: string; changes?: { price?: number; name?: string } }[] }
}

async function harness(priceUnit: 'WON' | 'THOUSAND' = 'WON') {
  const { VoiceController } = (await import(/* @vite-ignore */ CONTROLLER_MODULE)) as { VoiceController: new (host: unknown) => Controller }
  const board = new Map<number, View>()
  const registered: { no: number; name: string; price: number }[] = []
  const fixes: { id: string; changes: { price?: number; name?: string } }[] = []
  let voice: Controller | null = null
  const host = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    priceUnit: () => priceUnit,
    currentNames: () => NO_NAMES,
    products: () => new Map([...board].map(([no, p]) => [no, p.closed])),
    fetchHistory: async () => [],
    dialogOpen: () => false,
    readConsent: () => true,
    writeConsent: () => {},
    readSettings: () => null,
    writeSettings: () => {},
    register: (_card: unknown, registration: { no: number; name: string; price: number }) => {
      registered.push(registration)
      const key = `b1:${String(registration.no)}`
      board.set(registration.no, { key, name: registration.name, price: registration.price, claimCount: 0, closed: false, status: 'OPEN' })
      queueMicrotask(() => voice?.noteVoiceRegistered({ id: key, no: registration.no, name: registration.name, price: registration.price }))
    },
    focusQuick: () => {},
    fixRecent: async (id: string, changes: { price?: number; name?: string }) => {
      fixes.push({ id, changes })
      const entry = [...board.entries()].find(([, p]) => p.key === id)
      const before = entry === undefined ? {} : { price: entry[1].price }
      if (entry !== undefined) board.set(entry[0], { ...entry[1], ...changes })
      return { kind: 'fixed', before }
    },
    renumber: async () => false,
    undoRecent: () => true,
    existingProduct: (no: number) => board.get(no) ?? null,
  }
  voice = new VoiceController(host)
  await voice.turnOn()
  await settle()
  const recognition = FakeRecognition.all.at(-1) as FakeRecognition
  return { board, registered, fixes, recognition, voice: voice as Controller }
}
type Harness = Awaited<ReturnType<typeof harness>>

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const advance = async (ms: number): Promise<void> => {
  vi.advanceTimersByTime(ms)
  await settle()
}

/** 최종 결과 하나 → 덩어리 끝까지 (조용한 3초) */
async function final(h: Harness, text: string): Promise<void> {
  h.recognition.say(text, true)
  await advance(3000)
}
/** 낱말 하나씩 중간 결과(200ms) → 최종 → 덩어리 끝 */
async function speak(h: Harness, text: string): Promise<void> {
  const tokens = text.split(' ')
  for (let k = 1; k <= tokens.length; k++) {
    h.recognition.say(tokens.slice(0, k).join(' '), false)
    await advance(200)
  }
  await final(h, text)
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  FakeRecognition.all.length = 0
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('빠진 0 되살리기 fixDroppedZero (실방송 306번)', () => {
  const none = (): DroppedZeroProduct => null
  const twoDigit = fc.integer({ min: 11, max: 99 }).filter((n) => n % 10 !== 0)

  it('성질: 맥락(최근 등록·앞에 들린 번호)이 없으면 두 자리 번호는 늘 그대로 — 방송 처음의 진짜 36번은 36번', () => {
    fc.assert(
      fc.property(twoDigit, fc.option(fc.integer({ min: 1, max: 999 }).map((n) => n * 1000), { nil: null }), (no, price) => {
        expect(fixDroppedZero({ no, price, recent: [], heardBefore: [], product: none })).toBeNull()
        // 최근 등록 하나만으로도 모자라다 (DROPPED_ZERO_RECENT = 2)
        const fixed = Math.floor(no / 10) * 100 + (no % 10)
        expect(fixDroppedZero({ no, price, recent: [fixed - 1], product: none })).toBeNull()
      }),
      { numRuns: 300 },
    )
  })

  it('성질: 바꾸면 늘 X0Y이고, 증거는 (앞에 들린 X0Y) 또는 (최근 둘이 X0Y ±20 · 최근 어느 것도 XY ±20 아님), XY 상품은 없다', () => {
    fc.assert(
      fc.property(
        twoDigit,
        fc.array(fc.integer({ min: 1, max: 999 }), { maxLength: 5 }),
        fc.array(fc.integer({ min: 1, max: 999 }), { maxLength: 2 }),
        fc.subarray([11, 36, 38, 306, 308, 45, 405]),
        (no, recent, heardBefore, existing) => {
          const product = (n: number): DroppedZeroProduct => (existing.includes(n) ? { price: 50_000 } : null)
          const fix = fixDroppedZero({ no, price: 50_000, recent, heardBefore, product })
          if (fix === null) return
          const fixed = Math.floor(no / 10) * 100 + (no % 10)
          expect(fix.no).toBe(fixed)
          expect(existing.includes(no), `${String(no)} 상품이 있는데 바꿈`).toBe(false)
          if (fix.why === 'HEARD') expect(heardBefore).toContain(fixed)
          else {
            expect(recent.length).toBeGreaterThanOrEqual(2)
            for (const r of recent.slice(-2)) expect(Math.abs(r - fixed)).toBeLessThanOrEqual(DROPPED_ZERO_NEAR)
            for (const r of recent) expect(Math.abs(r - no)).toBeGreaterThan(DROPPED_ZERO_NEAR)
          }
        },
      ),
      { numRuns: 1000 },
    )
  })

  it.each([
    ['3xx 맥락 (301·304 등록)', { no: 36, price: 50_000, recent: [301, 304] }, { no: 306, why: 'RECENT' }],
    ['중간 결과에 306', { no: 36, price: 50_000, recent: [], heardBefore: [306] }, { no: 306, why: 'HEARD' }],
    ['38 → 308 (300·312 등록)', { no: 38, price: 50_000, recent: [300, 312] }, { no: 308, why: 'RECENT' }],
    ['최근 둘 중 하나가 멀다 (301·340)', { no: 36, price: 50_000, recent: [301, 340] }, null],
    ['최근 등록에 36 근처 번호가 있다 (40·301·304)', { no: 36, price: 50_000, recent: [40, 301, 304] }, null],
    ['끝자리 0 (30)', { no: 30, price: 50_000, recent: [301, 304] }, null],
    ['세 자리 넘김 (maxNumber 300)', { no: 36, price: 50_000, recent: [290, 299], maxNumber: 300 }, null],
  ] as const)('%s', (_title, input, want) => {
    expect(fixDroppedZero({ ...input, product: none })).toEqual(want)
  })

  it('36번 상품이 이미 있으면(판매 종료 포함) 맥락이 있어도 36 그대로', () => {
    for (const there of [{ price: 10_000 }, 'closed'] as const) {
      expect(fixDroppedZero({ no: 36, price: 50_000, recent: [301, 304], product: (n) => (n === 36 ? there : null) })).toBeNull()
    }
  })

  it('306번이 판매 종료·다른 가격·가격 못 들음이면 바꾸지 않고, 같은 가격이면 바꾼다', () => {
    const with306 = (there: DroppedZeroProduct) => (n: number): DroppedZeroProduct => (n === 306 ? there : null)
    expect(fixDroppedZero({ no: 36, price: 50_000, recent: [301, 304], product: with306('closed') })).toBeNull()
    expect(fixDroppedZero({ no: 36, price: 50_000, recent: [301, 304], product: with306({ price: 70_000 }) })).toBeNull()
    expect(fixDroppedZero({ no: 36, price: null, recent: [301, 304], product: with306({ price: 50_000 }) })).toBeNull()
    expect(fixDroppedZero({ no: 36, price: 50_000, recent: [301, 304], product: with306({ price: 50_000 }) })).toEqual({ no: 306, why: 'RECENT' })
  })

  it('콘솔: 방송 처음 "36번 라울 5만 원" → 36번으로 등록', async () => {
    const h = await harness()
    await final(h, '36번 라울 5만 원')
    expect(h.registered).toEqual([{ no: 36, name: '라울', price: 50_000 }])
  })

  it('콘솔: 301·304번을 음성으로 등록한 뒤 "36번 라울 5만 원" → 306번으로 등록', async () => {
    const h = await harness()
    await final(h, '301번 라울 3만 원')
    await final(h, '304번 라울 4만 원')
    await final(h, '36번 라울 5만 원')
    expect(h.registered.map((r) => r.no)).toEqual([301, 304, 306])
    expect(h.registered[2]?.price).toBe(50_000)
  })

  it('콘솔: 301·304번 뒤라도 36번 상품이 이미 있으면 "36번 5만 원"은 36번(같은 번호 처리) — 306번 새 등록 없음', async () => {
    const h = await harness()
    h.board.set(36, { key: 'b1:36', name: '라울', price: 50_000, claimCount: 0, closed: false, status: 'OPEN' })
    await final(h, '301번 라울 3만 원')
    await final(h, '304번 라울 4만 원')
    await final(h, '36번 5만 원')
    expect(h.registered.map((r) => r.no)).toEqual([301, 304])
  })
})

describe('가격만 들린 조각 (실방송 10:14): 정정 낱말이 있을 때만 고침, 아니면 다음 N번의 가격', () => {
  it('성질(순수): 정정 낱말이 없으면 priceOnlyFix는 늘 null', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999 }).map((n) => n * 1000), fc.integer({ min: 0, max: 30_000 }), fc.nat(5), (price, after, claims) => {
        const input = { wonPrices: [price], heardNumbers: [], correction: false, lastRegistered: { no: 309, at: T0 }, lastHeardNo: 309, waiting: false, product: { price: price + 1000, claimCount: claims }, now: T0 + after }
        expect(priceOnlyFix(input)).toBeNull()
        // 같은 입력에 정정 낱말만 더하면 고침 (찜 있으면 묻기)
        expect(priceOnlyFix({ ...input, correction: true })).toEqual({ no: 309, price, auto: claims === 0 })
      }),
      { numRuns: 300 },
    )
  })

  it.each(['아니 50만 원', '아니고 50만 원', '50만 원 말고', '다시 50만 원', '정정 50만 원', '잘못 말했어요 50만 원'])('정정 낱말 "%s" → hasPriceCorrection 참', (text) => {
    expect(hasPriceCorrection(text)).toBe(true)
  })
  it.each(['자 50만 원', '어 자 30만 원이에요', '예쁘게 나왔어요 50만 원', '아이 50만 원'])('정정 낱말 없음 "%s" → 거짓', (text) => {
    expect(hasPriceCorrection(text)).toBe(false)
  })

  it('309번 55만 원 등록 뒤 "어 자 50만 원이에요"(정정 낱말 없음) → 309번을 건드리지 않음', async () => {
    const h = await harness()
    await final(h, '309번 라울 55만 원')
    await final(h, '어 자 50만 원이에요')
    expect(h.fixes).toEqual([])
    expect(h.voice.getSnapshot().offers.filter((o) => o.no === 309)).toEqual([])
  })

  it('309번 55만 원 등록 뒤 "아니 50만 원"(찜 0, 30초 안) → 309번 500,000원으로 바로 고침', async () => {
    const h = await harness()
    await final(h, '309번 라울 55만 원')
    await final(h, '아니 50만 원')
    expect(h.fixes).toEqual([{ id: 'b1:309', changes: { price: 500_000 } }])
  })

  it('309번 등록 30초 넘어 "아니 50만 원" → 고치지 않음', async () => {
    const h = await harness()
    await final(h, '309번 라울 55만 원')
    await advance(31_000)
    await final(h, '아니 50만 원')
    expect(h.fixes).toEqual([])
  })

  it('번호 없는 가격 "어 자 30만 원이에요" 뒤 15초 안 가격 없는 "389번" → 389번 300,000원으로 등록', async () => {
    const h = await harness()
    await final(h, '388번 라울 5만 원')
    await final(h, '어 자 30만 원이에요')
    await final(h, '389번')
    expect(h.registered).toEqual([
      { no: 388, name: '라울', price: 50_000 },
      { no: 389, name: expect.any(String) as unknown as string, price: 300_000 },
    ])
    // 388번은 그대로
    expect(h.fixes).toEqual([])
  })

  it('번호 없는 가격 뒤 15초를 넘겨 "389번" → 그 가격을 쓰지 않는다 (300,000원 등록 없음)', async () => {
    const h = await harness()
    await final(h, '어 자 30만 원이에요')
    await advance(13_000)
    await final(h, '389번')
    expect(h.registered.filter((r) => r.price === 300_000)).toEqual([])
  })

  it('번호 없는 가격 뒤 "389번 5만 원"(가격과 함께) → 389번 50,000원, 앞 가격은 버림 — 다음 "390번"이 300,000원을 받지 않는다', async () => {
    const h = await harness()
    await final(h, '어 자 30만 원이에요')
    await final(h, '389번 라울 5만 원')
    await final(h, '390번')
    expect(h.registered.map((r) => [r.no, r.price])).toEqual([[389, 50_000]])
  })

  it('정정 낱말이 든 번호 없는 가격 "아니 30만 원"은 기다리는 가격이 아니다 → 다음 "389번"이 300,000원을 받지 않는다', async () => {
    const h = await harness()
    await final(h, '아니 30만 원')
    await final(h, '389번')
    expect(h.registered.filter((r) => r.price === 300_000)).toEqual([])
  })

  it('낱말 하나씩: "어 자 30만 원이에요" → "389번" → 389번 300,000원 하나', async () => {
    const h = await harness()
    await speak(h, '어 자 30만 원이에요')
    await speak(h, '389번')
    expect(h.registered.map((r) => [r.no, r.price])).toEqual([[389, 300_000]])
  })
})

describe('짧은 이름은 적은 모양으로만 (exactOnly) · 이름 끝 색급 → 색금', () => {
  const nameOf = (text: string): string | null | undefined => readRegistration(text, { dictionary: DICT, final: true }).ready?.name

  it.each([
    ['콜라', null],
    ['콜리', '콜리'],
    ['퍼즐', null],
    ['퍼플', '퍼플'],
    ['창극', null],
    ['창금', '창금'],
    ['황수', null],
    ['황소', '황소'],
    ['황소처럼', null],
    ['레다', '레다'],
  ] as const)('"15번 %s 만원" → 품종 %s', (word, name) => {
    expect(nameOf(`15번 ${word} 만원`)).toBe(name)
  })

  it.each(['콜라', '퍼즐', '창극', '황수', '황소처럼'])('성질: "%s"는 앞뒤 군말·가격이 바뀌어도 품종이 되지 않는다', (word) => {
    fc.assert(
      fc.property(fc.constantFrom('15번', '108번', '자 15번'), fc.array(fc.constantFrom('자', '요', '이거', '그대로', '예쁘게'), { maxLength: 3 }), fc.constantFrom('만원', '5만 원', '25만 원까지'), (no, mid, price) => {
        const text = [no, ...mid, word, price].join(' ')
        const ready = readRegistration(text, { dictionary: DICT, final: true }).ready
        expect(ready, text).not.toBeNull()
        expect(ready?.name, text).toBeNull()
      }),
      { numRuns: 60 },
    )
  })

  it('"15번 황소개구리 만원" → 황소개구리 (짧은 이름 황소가 긴 이름을 가로채지 않는다)', () => {
    expect(nameOf('15번 황소개구리 만원')).toBe('황소개구리')
  })

  it.each([
    ['립스틱색급', '립스틱색금'],
    ['창색급', '창색금'],
    ['3강색급', '삼광색금'],
    ['상관세금', '삼광색금'],
    // 스펙 바뀜 (D-V3-115·116, DOMAIN_RULES R-17 5 꾸밈말 '받아쓰기 오류 모양'·v0.1.46): 기본 사전에 판매 영수증 거래명 '몰디브색금'이 들어왔다.
    // 붙인 '…색금'이 사전에 있으면 그 이름이므로 이제 '몰디브색금'(처음 기대 '몰디브'는 몰디브색금이 없던 사전 — AC-V3-84 (a)의 전제). 사전 밖 쪽은 아래 만든 이름으로 지킨다.
    ['몰디브 색급', '몰디브색금'],
  ])('이름 끝 색급: "15번 %s 만원" → %s', (word, name) => {
    expect(nameOf(`15번 ${word} 만원`)).toBe(name)
  })

  // 이 사례가 지키던 것(R-17 5 꾸밈말 — 오류 모양 '색급'은 붙인 이름이 사전에 있을 때만 '색금'으로 붙임, D-V3-87 끝 색급도 사전에 없으면 아무것도 안 함):
  // 기본 사전 + 판매 이력에만 있는 만든 이름 '달빛여울'(기본 사전에 '달빛여울색금' 없음)로 본다. 사전 밖 '달빛여울색금'을 지어내지 않고 들린 사전 이름 그대로.
  it.each([
    ['달빛여울 색급', '달빛여울'],
    ['달빛여울 색금', '달빛여울색금'],
  ])('사전 밖 X색금: "15번 %s 만원" → %s (붙인 오류 모양은 사전에 있을 때만)', (word, name) => {
    const dictionary = prepareVoiceDictionary({ history: ['달빛여울'] })
    expect(readRegistration(`15번 ${word} 만원`, { dictionary, final: true }).ready?.name).toBe(name)
  })
})
