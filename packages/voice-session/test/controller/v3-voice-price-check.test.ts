// AC-V3-98·99 확정 아닌 조각 (R-17 8): 천원 단위 방송의 음성 빠른 꼴 1~2자리 수(D-V3-112), 번호 숫자가 만 계수 앞에 붙은 300만 원 넘는 가격(D-V3-113)은
// 바로 등록·바로 고치지 않는다 — 없는 번호면 제안 카드(안내 글), 있는 번호면 R-22 묻기. 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계.
import type { PriceUnit } from '@livejjim/core'
import * as voiceModule from '@livejjim/voice'
import type { SuggestionCard, VoiceSettings } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceController, type ExistingView, type RecentFixOutcome, type VoiceHost } from '../../src/controller/controller.ts'

const T0 = Date.UTC(2026, 9, 28, 1, 0, 0)

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
  say(text: string, final = true): void {
    this.results.push({ isFinal: final, length: 1, 0: { transcript: text } })
    this.onresult?.({ resultIndex: this.results.length - 1, results: this.results })
    if (!final) this.results.pop()
  }
  static get last(): FakeRecognition {
    const last = FakeRecognition.all.at(-1)
    if (last === undefined) throw new Error('인식 객체가 없다')
    return last
  }
}

interface Harness {
  readonly voice: VoiceController
  readonly registered: { card: SuggestionCard; no: number; name: string; price: number; source: string }[]
  readonly written: unknown[]
  readonly fixes: { id: string; changes: { name?: string; price?: number } }[]
  /** 상품 보드 (번호 → 상품) */
  readonly board: Map<number, ExistingView>
  fixResult: RecentFixOutcome | null
  dialog: boolean
  readonly undone: string[]
  readonly moves: [number, number][]
  readonly fixOptions: unknown[]
  readonly archived: unknown[]
}

function harness(options: { settings?: unknown; noBoard?: boolean; priceUnit?: PriceUnit; lastDevice?: Map<number, string>; renumberResult?: 'claimed' } = {}): Harness {
  const state = {
    registered: [] as Harness['registered'],
    written: [] as unknown[],
    fixes: [] as Harness['fixes'],
    board: new Map<number, ExistingView>(),
    fixResult: null as RecentFixOutcome | null,
    dialog: false,
    undone: [] as string[],
    moves: [] as [number, number][],
    fixOptions: [] as unknown[],
    archived: [] as unknown[],
  }
  const host: VoiceHost = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    priceUnit: () => options.priceUnit ?? 'WON',
    deviceId: () => 'this-device',
    lastVoiceDevice: (no) => options.lastDevice?.get(no) ?? null,
    currentNames: () => [],
    products: () => new Map([...state.board].map(([no, product]) => [no, product.closed])),
    fetchHistory: async () => [],
    dialogOpen: () => state.dialog,
    readConsent: () => true,
    writeConsent: () => {},
    readSettings: () => options.settings ?? null,
    writeSettings: (settings: VoiceSettings) => {
      state.written.push(settings)
    },
    register: (card, registration, source) => {
      state.registered.push({ card, ...registration, source })
    },
    focusQuick: () => {},
    fixRecent: async (id, changes, options) => {
      state.fixes.push({ id, changes })
      state.fixOptions.push(options ?? {})
      const product = [...state.board.values()].find((item) => item.key === id)
      return state.fixResult ?? { kind: 'fixed', before: { ...(changes.price !== undefined ? { price: product?.price ?? 0 } : {}), ...(changes.name !== undefined ? { name: product?.name ?? '' } : {}) } }
    },
    archiveChunk: (chunk) => {
      state.archived.push(chunk)
    },
    renumber: async (from, to) => {
      state.moves.push([from, to])
      if (options.renumberResult === 'claimed') return 'claimed'
      const item = state.board.get(from)
      if (item === undefined) return false
      state.board.delete(from)
      state.board.set(to, { ...item, key: `b1:${String(to)}` })
      return true
    },
    undoRecent: (id) => {
      state.undone.push(id)
      return true
    },
    ...(options.noBoard === true ? {} : { existingProduct: (no: number) => state.board.get(no) ?? null }),
  }
  const voice = new VoiceController(host)
  return Object.assign(state, { voice }) as unknown as Harness
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const at = (ms: number): void => {
  vi.advanceTimersByTime(T0 + ms - Date.now())
}
const say = (text: string, final = true): void => FakeRecognition.last.say(text, final)
const cards = (h: Harness) => h.voice.getSnapshot().cards
const reg = (h: Harness) => h.registered.map((item) => ({ no: item.no, name: item.name, price: item.price, source: item.source }))
const product = (no: number, name: string, price: number, claimCount = 0): ExistingView => ({ key: `b1:${String(no)}`, name, price, claimCount, closed: false })

beforeEach(() => {
  vi.useFakeTimers({ now: T0 - 5000 })
  FakeRecognition.all.length = 0
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function ready(options: Parameters<typeof harness>[0] = {}): Promise<Harness> {
  vi.setSystemTime(T0 - 5000)
  const h = harness(options)
  await h.voice.turnOn()
  await settle()
  at(0)
  return h
}

const asks = (h: Harness) => h.voice.getSnapshot().offers.filter((offer) => offer.stage === 'ask')
const noteOf = (h: Harness, card: SuggestionCard | undefined) => h.voice.getSnapshot().notes.get(card?.id ?? '')
const shown = (h: Harness) => cards(h).map((card) => [card.no, card.name, card.price])

describe('AC-V3-98 천원 단위의 작은 빠른 꼴은 묻는다 (D-V3-112)', () => {
  it('(1) 천원 단위 "9번입니다 17까지" → 쓰기 0, 제안 카드(9번 · 17,000원, 안내 "17,000원으로 들렸어요. 가격을 확인해 주세요")', async () => {
    const h = await ready({ priceUnit: 'THOUSAND' })
    say('9번입니다 17까지')
    at(3000)
    expect(reg(h)).toEqual([])
    expect(h.fixes).toEqual([])
    expect(shown(h)).toEqual([[9, null, 17000]])
    expect(noteOf(h, cards(h)[0])).toBe('17,000원으로 들렸어요. 가격을 확인해 주세요')
  })

  it('(2) 천원 단위 "92번 빅뱅 60"·"92번 60" → 카드(60,000원) — 표 R61·R64 (D-V3-112가 "바로 60,000원"을 바꿈)', async () => {
    for (const [text, name] of [['92번 빅뱅 60', '빅뱅'], ['92번 60', null], ['92번 저거 60', null]] as const) {
      const h = await ready({ priceUnit: 'THOUSAND' })
      say(text)
      at(3000)
      expect(reg(h), text).toEqual([])
      expect(shown(h), text).toEqual([[92, name, 60000]])
      expect(noteOf(h, cards(h)[0]), text).toBe('60,000원으로 들렸어요. 가격을 확인해 주세요')
      h.voice.dispose()
    }
  })

  it('R64: 같은 글이 중간 결과뿐이면 쓰기 0·카드 0 (1초 넘게 보여도 중간 글로 등록하지 않는다)', async () => {
    const h = await ready({ priceUnit: 'THOUSAND' })
    say('92번 빅뱅 60', false)
    at(1500)
    expect(reg(h)).toEqual([])
    expect(cards(h)).toEqual([])
  })

  it('(3) 천원 단위 "92번 빅뱅 180" → 바로 92번 · 빅뱅 · 180,000원', async () => {
    const h = await ready({ priceUnit: 'THOUSAND' })
    say('92번 빅뱅 180')
    at(3000)
    expect(reg(h)).toEqual([{ no: 92, name: '빅뱅', price: 180000, source: 'instant' }])
    expect(cards(h)).toEqual([])
  })

  it('(4) 천원 단위 "68번 이십오" → 카드(25,000원)', async () => {
    const h = await ready({ priceUnit: 'THOUSAND' })
    say('68번 이십오')
    at(3000)
    expect(reg(h)).toEqual([])
    expect(shown(h)).toEqual([[68, null, 25000]])
    expect(noteOf(h, cards(h)[0])).toBe('25,000원으로 들렸어요. 가격을 확인해 주세요')
  })

  it('(5) 자동 단위·만원 단위 "92번 빅뱅 60" → 바로 600,000원', async () => {
    for (const priceUnit of ['AUTO', 'TEN_THOUSAND'] as const) {
      const h = await ready({ priceUnit })
      say('92번 빅뱅 60')
      at(3000)
      expect(reg(h), priceUnit).toEqual([{ no: 92, name: '빅뱅', price: 600000, source: 'instant' }])
      expect(cards(h), priceUnit).toEqual([])
      h.voice.dispose()
    }
  })

  it('(6) 천원 단위 "92번 빅뱅 6만 자" → 바로 60,000원 (단위 붙음)', async () => {
    const h = await ready({ priceUnit: 'THOUSAND' })
    say('92번 빅뱅 6만 자')
    at(3000)
    expect(reg(h)).toEqual([{ no: 92, name: '빅뱅', price: 60000, source: 'instant' }])
  })

  it('(7) 원 단위 "92번 60" → 지금처럼 쓰기 0 (100원 미만)', async () => {
    const h = await ready({ priceUnit: 'WON' })
    say('92번 60')
    at(3000)
    expect(reg(h)).toEqual([])
    expect(h.fixes).toEqual([])
  })

  it('(8) 천원 단위, 92번(빅뱅 50,000원, 찜 0)이 있고 "92번 60" → 고침 0, 고칠까요 카드(같은 안내)', async () => {
    const h = await ready({ priceUnit: 'THOUSAND' })
    h.board.set(92, product(92, '빅뱅', 50000))
    say('92번 60')
    at(3000)
    await settle()
    expect(reg(h)).toEqual([])
    expect(h.fixes).toEqual([])
    expect(asks(h).map((offer) => [offer.no, offer.changes, offer.message, offer.note])).toEqual([
      [92, { price: 60000 }, '92번을 고칠까요? 가격 50,000원 → 60,000원', '60,000원으로 들렸어요. 가격을 확인해 주세요'],
    ])
    // 지금 가격과 같으면(바꿀 것이 없으면) 묻지 않는다
    const same = await ready({ priceUnit: 'THOUSAND' })
    same.board.set(92, product(92, '빅뱅', 60000))
    say('92번 60')
    at(3000)
    await settle()
    expect(same.fixes).toEqual([])
    expect(asks(same)).toEqual([])
  })

  it('(9) (1)의 카드에서 [등록] → 9번 · 17,000원 등록', async () => {
    const h = await ready({ priceUnit: 'THOUSAND' })
    say('9번입니다 17까지')
    at(3000)
    const card = cards(h)[0]
    h.voice.confirm(card?.id ?? '', 'click')
    expect(reg(h)).toEqual([{ no: 9, name: '', price: 17000, source: 'click' }])
  })
})

describe('AC-V3-99 번호가 붙은 가격은 묻는다 (D-V3-113)', () => {
  const NOTE = '2275만 원으로 들렸어요. 227번 5만 원인지 확인해 주세요'

  it('(1) "자 2275만 원 자 227번이고요" → 쓰기 0, 제안 카드(227번, 가격 칸 비움, 안내)', async () => {
    const h = await ready()
    say('자 2275만 원 자 227번이고요')
    at(3000)
    expect(reg(h)).toEqual([])
    expect(h.fixes).toEqual([])
    expect(shown(h)).toEqual([[227, null, null]])
    expect(noteOf(h, cards(h)[0])).toBe(NOTE)
  })

  it('(2) "227번 2275만 원"(차례 반대) → 같은 카드 — 중간 글로도 등록하지 않는다', async () => {
    const h = await ready()
    say('227번 2275만 원', false)
    at(1500)
    expect(reg(h)).toEqual([])
    say('227번 2275만 원')
    at(4000)
    expect(reg(h)).toEqual([])
    expect(shown(h)).toEqual([[227, null, null]])
    expect(noteOf(h, cards(h)[0])).toBe(NOTE)
  })

  it('(3) "15번 150만 원" → 바로 15번 · 1,500,000원 (300만 원 넘지 않음)', async () => {
    const h = await ready()
    say('15번 150만 원')
    at(3000)
    expect(reg(h)).toEqual([{ no: 15, name: '', price: 1500000, source: 'instant' }])
  })

  it('(4) "15번 1505만 원" → 카드(안내 "… 15번 5만 원인지 …")', async () => {
    const h = await ready()
    say('15번 1505만 원')
    at(3000)
    expect(reg(h)).toEqual([])
    expect(shown(h)).toEqual([[15, null, null]])
    expect(noteOf(h, cards(h)[0])).toBe('1505만 원으로 들렸어요. 15번 5만 원인지 확인해 주세요')
  })

  it('(5) "227번 2000만 원" → 바로 20,000,000원 (번호로 시작하지 않음 — D-V3-64)', async () => {
    const h = await ready()
    say('227번 2000만 원')
    at(3000)
    expect(reg(h)).toEqual([{ no: 227, name: '', price: 20000000, source: 'instant' }])
  })

  it('(6) "227번 227만 원" → 바로 2,270,000원 (더 길지 않음)', async () => {
    const h = await ready()
    say('227번 227만 원')
    at(3000)
    expect(reg(h)).toEqual([{ no: 227, name: '', price: 2270000, source: 'instant' }])
  })

  // D-V3-114 (2): 들린 가격을 고칠 값으로 채우지 않는다 — 지금 가격만 보이고 고칠 값 칸은 비움(처음 구현 "고칠 값 22,750,000원"을 바꿈)
  it('(7) 227번(50,000원, 찜 0)이 있고 "자 2275만 원 자 227번이고요" → 고침 0, 고칠까요 카드(지금 가격, 고칠 값 칸 비움, 안내) — 값을 넣어야 고친다', async () => {
    const h = await ready()
    h.board.set(227, product(227, '', 50000))
    say('자 2275만 원 자 227번이고요')
    at(3000)
    await settle()
    expect(reg(h)).toEqual([])
    expect(h.fixes).toEqual([])
    expect(asks(h).map((offer) => [offer.no, offer.message, offer.changes, offer.priceEntry, offer.note])).toEqual([[227, '227번을 고칠까요? 지금 가격 50,000원', {}, '', NOTE]])
    const id = asks(h)[0]?.id ?? ''
    // 빈 칸이면 [고치기]를 눌러도 쓰기 0
    await h.voice.fixOffer(id)
    await settle()
    expect(h.fixes).toEqual([])
    // 읽지 못하는 값(100원 미만)도 쓰기 0, 문장
    h.voice.setOfferPrice(id, '5')
    await h.voice.fixOffer(id)
    await settle()
    expect(h.fixes).toEqual([])
    expect(asks(h)[0]?.error).toBe('가격을 확인해 주세요. 숫자로 적으면 그 방송 가격 단위로 들어가요.')
    // 적은 값으로 고친다
    h.voice.setOfferPrice(id, '6만')
    await h.voice.fixOffer(id)
    await settle()
    expect(h.fixes).toEqual([{ id: 'b1:227', changes: { price: 60000 } }])
  })

  it('(7) [그대로 두기]면 쓰기 0', async () => {
    const h = await ready()
    h.board.set(227, product(227, '', 50000))
    say('227번 2275만 원')
    at(3000)
    await settle()
    const offer = asks(h)[0]
    expect(offer?.priceEntry).toBe('')
    h.voice.dismissOffer(offer?.id ?? '')
    await settle()
    expect(h.fixes).toEqual([])
    expect(asks(h)).toEqual([])
  })

  it('(9) "227번 2270만 원" → 카드(가격 칸 비움, 안내 "2270만 원으로 들렸어요. 227번 가격을 확인해 주세요") — 남은 수 0 (D-V3-114 (1))', async () => {
    const h = await ready()
    say('227번 2270만 원')
    at(3000)
    expect(reg(h)).toEqual([])
    expect(shown(h)).toEqual([[227, null, null]])
    expect(noteOf(h, cards(h)[0])).toBe('2270만 원으로 들렸어요. 227번 가격을 확인해 주세요')
  })

  it('(10) 기다리는 번호: "227번"(가격 없음) 뒤 다음 덩어리 "2275만 원" → 쓰기 0, (1)과 같은 카드 (D-V3-114 (3))', async () => {
    const h = await ready()
    say('227번')
    at(3000)
    say('2275만 원')
    at(6000)
    await settle()
    expect(reg(h)).toEqual([])
    expect(shown(h)).toEqual([[227, null, null]])
    expect(noteOf(h, cards(h)[0])).toBe(NOTE)
  })

  it('(11) 번호 없는 가격 기억: "2275만 원" 뒤 15초 안 다음 덩어리 "227번" → 쓰기 0, (1)과 같은 카드 (D-V3-114 (3))', async () => {
    const h = await ready()
    say('2275만 원')
    at(3000)
    say('227번')
    at(6000)
    await settle()
    expect(reg(h)).toEqual([])
    expect(shown(h)).toEqual([[227, null, null]])
    expect(noteOf(h, cards(h)[0])).toBe(NOTE)
  })

  it('(12) 기다리는 번호 "15번" 뒤 "150만 원" → 지금처럼 바로 1,500,000원 · 번호 없는 가격 "150만 원" 뒤 "15번"도', async () => {
    const h = await ready()
    say('15번')
    at(3000)
    say('150만 원')
    at(6000)
    await settle()
    expect(reg(h).map((item) => [item.no, item.price])).toEqual([[15, 1500000]])
    const later = await ready()
    say('150만 원')
    at(3000)
    say('15번')
    at(6000)
    await settle()
    expect(reg(later).map((item) => [item.no, item.price])).toEqual([[15, 1500000]])
  })

  it('(8) "227번 이천이백칠십오만 원" → 해당 없음(한글 계수), 바로 22,750,000원', async () => {
    const h = await ready()
    say('227번 이천이백칠십오만 원')
    at(3000)
    expect(reg(h)).toEqual([{ no: 227, name: '', price: 22750000, source: 'instant' }])
  })

  it('창이 열린 동안 끝난 덩어리(옛 판단)도 바로 등록하지 않는다', async () => {
    const h = await ready()
    h.dialog = true
    say('227번 2275만 원')
    at(3000)
    h.dialog = false
    at(6000)
    await settle()
    expect(reg(h)).toEqual([])
  })
})
