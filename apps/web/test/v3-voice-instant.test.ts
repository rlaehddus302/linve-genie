// V3 바로 등록 (번호·가격이 들리는 순간 등록, 이미 있는 번호는 무시·자동 고침·묻기) — 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계.
import * as voiceModule from '@livejjim/voice'
import type { SuggestionCard, VoiceSettings } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceController, type ExistingView, type RecentFixOutcome, type VoiceHost } from '../src/voice/controller.ts'
import { askMessage, fixedMessage, numbersNote, otherNumberMessage, readInstant, registeredReadout } from '../src/voice/instant.ts'

const T0 = Date.UTC(2026, 9, 25, 1, 0, 0)

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
}

function harness(options: { settings?: unknown; noBoard?: boolean } = {}): Harness {
  const state = {
    registered: [] as Harness['registered'],
    written: [] as unknown[],
    fixes: [] as Harness['fixes'],
    board: new Map<number, ExistingView>(),
    fixResult: null as RecentFixOutcome | null,
    dialog: false,
    undone: [] as string[],
  }
  const host: VoiceHost = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
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
    fixRecent: async (id, changes) => {
      state.fixes.push({ id, changes })
      const product = [...state.board.values()].find((item) => item.key === id)
      return state.fixResult ?? { kind: 'fixed', before: { ...(changes.price !== undefined ? { price: product?.price ?? 0 } : {}), ...(changes.name !== undefined ? { name: product?.name ?? '' } : {}) } }
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

describe('바로 등록 (V3)', () => {
  it('중간 결과에서 번호와 가격이 들린 순간 조용한 시간 없이 등록한다 — 카드 없음', async () => {
    const h = await ready()
    say('네 108번 bts 어 요한이 10만 원까지', false)
    expect(reg(h)).toEqual([{ no: 108, name: 'bts', price: 100000, source: 'instant' }])
    expect(h.registered[0]?.card.nameNeedsCheck).toBe(true)
    expect(cards(h)).toEqual([])
    // 같은 덩어리에서 더 들어와도 다시 등록하지 않는다
    say('네 108번 bts 어 요한이 10만 원까지 안토 일단 색감 안쪽 봐주세요', false)
    say('네 108번 bts 어 요한이 10만 원까지 안토 일단 색감 안쪽 봐주세요')
    at(5000)
    expect(h.registered).toHaveLength(1)
    expect(cards(h)).toEqual([])
    expect(h.voice.getSnapshot().log[0]?.reason).not.toBeNull()
  })

  it('보낸 등록이 아직 목록에 없어도 다음 덩어리에서 같은 번호를 다시 등록하지 않는다', async () => {
    const h = await ready()
    say('108번 bts 10만 원')
    at(3000)
    say('자 bts 그대로 보냅니다 10만 원 108번')
    at(6000)
    expect(h.registered).toHaveLength(1)
    expect(cards(h)).toEqual([])
  })

  it('이미 등록된 번호를 같은 값으로 다시 말하면 카드 없이 기록에만 "이미 등록됨"', async () => {
    const h = await ready()
    h.board.set(108, product(108, 'bts', 100000))
    say('자 bts 그대로 보냅니다 요 아이 자 10만 원 108번')
    at(3000)
    expect(h.registered).toEqual([])
    expect(cards(h)).toEqual([])
    expect(h.voice.getSnapshot().offers).toEqual([])
    expect(h.voice.getSnapshot().log.some((entry) => entry.reason === '이미 등록됨')).toBe(true)
  })

  it('찜이 없는 이미 있는 번호의 가격이 다르게 들리면 바로 고치고 알림 + 되돌리기', async () => {
    const h = await ready()
    h.board.set(108, product(108, 'bts', 100000))
    say('108번 12만 원')
    await settle()
    at(3000)
    await settle()
    expect(h.fixes).toEqual([{ id: 'b1:108', changes: { price: 120000 } }])
    const offer = h.voice.getSnapshot().offers[0]
    expect(offer?.stage).toBe('fixed')
    expect(offer?.message).toBe('108번을 고쳤어요: 가격 100,000원 → 120,000원')
    // 되돌리기
    await h.voice.revertOffer(offer?.id ?? '')
    expect(h.fixes.at(-1)).toEqual({ id: 'b1:108', changes: { price: 100000 } })
    expect(h.registered).toEqual([])
    expect(cards(h)).toEqual([])
  })

  it('찜이 있는 상품은 결정이 ASK면 고칠까요 카드만 띄우고 바꾸지 않는다', async () => {
    const h = await ready()
    h.board.set(108, product(108, 'bts', 100000, 2))
    say('108번 12만 원')
    at(3000)
    await settle()
    expect(h.fixes).toEqual([])
    const offer = h.voice.getSnapshot().offers[0]
    expect(offer?.stage).toBe('ask')
    expect(offer?.changes).toEqual({ price: 120000 })
    expect(h.registered).toEqual([])
  })

  it('실방송 3번 줄: 35만 원이 들린 순간 180번 350,000원으로 바로 등록, 뒤 "30 5만 원"은 다시 등록하지 않는다', async () => {
    const h = await ready()
    say('자 180번 상관 세금 자 요 아이 자 유아이 35만 원까지', false)
    say('자 180번 상관 세금 자 요 아이 자 유아이 35만 원까지 네 요 아이는 35만 원까지 그대로 봅니다 색금 이렇게 잘 들었어요 자 3강색급 요 아이는 30 5만 원')
    at(5000)
    expect(reg(h).map((item) => [item.no, item.price])).toEqual([[180, 350000]])
    expect(cards(h)).toEqual([])
  })

  it('번호나 가격이 확정되지 않으면 자동 등록 없이 카드로', async () => {
    const h = await ready()
    say('15번 핑크문')
    at(3000)
    expect(h.registered).toEqual([])
    expect(cards(h).map((card) => card.no)).toEqual([15])
  })

  it('같은 번호 카드가 열려 있으면 새 카드를 만들지 않고 그 카드를 고친다', async () => {
    const h = await ready()
    say('15번 핑크문')
    at(3000)
    expect(cards(h)).toHaveLength(1)
    say('15번 엘레강스')
    at(6000)
    expect(cards(h)).toHaveLength(1)
    expect(cards(h)[0]?.no).toBe(15)
  })

  it('설정을 끄면 지금처럼 카드 확인 — 저장값에 끈 것을 남기고 다시 켜면 지운다', async () => {
    const h = await ready()
    h.voice.setInstant(false)
    expect(h.written.at(-1)).toMatchObject({ 'voice.autoRegister': false })
    say('108번 bts 10만 원')
    at(3000)
    expect(h.registered).toEqual([])
    expect(cards(h).map((card) => card.no)).toEqual([108])
    h.voice.setInstant(true)
    expect(h.written.at(-1)).not.toHaveProperty('voice.autoRegister')
  })

  it('저장값에 끈 것이 있으면 꺼진 채로 시작한다', async () => {
    const h = await ready({ settings: { 'voice.autoRegister': false } })
    expect(h.voice.getSnapshot().instant).toBe(false)
  })

  it('상품 보드를 넘기지 않는 화면은 바로 등록하지 않는다', async () => {
    const h = await ready({ noBoard: true })
    say('108번 bts 10만 원')
    at(3000)
    expect(h.registered).toEqual([])
  })

  it('등록하지 못해 돌아온 바로 등록은 카드가 되고, 같은 번호를 다시 보낼 수 있다', async () => {
    const h = await ready()
    say('108번 bts 10만 원')
    at(3000)
    const sent = h.registered[0]
    expect(sent).toBeDefined()
    if (sent === undefined) return
    h.voice.restore(sent.card, { touched: true })
    expect(cards(h).map((card) => card.no)).toEqual([108])
  })
})

/** 콘솔이 등록을 마쳤다 (상품 보드에 생기고 음성에 알린다) */
function finish(h: Harness, index = 0): void {
  const sent = h.registered[index]
  if (sent === undefined) throw new Error('보낸 등록이 없다')
  const key = `b1:${String(sent.no)}`
  h.board.set(sent.no, { key, name: sent.name, price: sent.price, claimCount: 0, closed: false, status: 'OPEN' })
  h.voice.noteVoiceRegistered({ id: key, no: sent.no, name: sent.name, price: sent.price })
}

describe('바로 등록 V3 수용 사례', () => {
  it('R7: 서로 다른 N번 둘이면 등록하지 않고 번호 칸이 빈 카드에 "번호 확인 필요 · 들린 번호: 189·139"', async () => {
    const h = await ready()
    say('어 자 요거 지금 189번인데 뿌리가 있습니다 뿌리 있는데 컵이 너무 잘 들었어요 빅뱅 금 139번 얘 50만 원 들어요')
    at(3000)
    expect(h.registered).toEqual([])
    const card = cards(h)[0]
    expect(card?.no).toBeNull()
    expect(h.voice.getSnapshot().notes.get(card?.id ?? '')).toBe('번호 확인 필요 · 들린 번호: 189·139')
  })

  it('R26: 등록 뒤 같은 덩어리에서 다른 번호가 들리면 알림만 ("알겠어요"까지)', async () => {
    const h = await ready()
    say('189번 빅뱅금 50만 원', false)
    say('189번 빅뱅금 50만 원 139번')
    at(3000)
    expect(reg(h).map((item) => item.no)).toEqual([189])
    const notice = h.voice.getSnapshot().offers.find((offer) => offer.kind === 'notice')
    expect(notice?.message).toBe('189번으로 등록했는데 139번도 들렸어요. 맞는지 확인해 주세요.')
    at(20_000)
    expect(h.voice.getSnapshot().offers.some((offer) => offer.kind === 'notice')).toBe(true)
    h.voice.seenNotice(notice?.id ?? '')
    expect(h.voice.getSnapshot().offers).toEqual([])
  })

  it('R18: "108번 10만원 아니 12만원" — 10만원에서 등록, 등록이 끝난 뒤 덩어리 결과로 바로 고침', async () => {
    const h = await ready()
    say('108번 10만원', false)
    expect(reg(h).map((item) => item.price)).toEqual([100000])
    say('108번 10만원 아니 12만원')
    at(3000)
    expect(h.fixes).toEqual([])
    finish(h)
    await settle()
    expect(h.fixes).toEqual([{ id: 'b1:108', changes: { price: 120000 } }])
    expect(h.registered).toHaveLength(1)
  })

  it('R20: 바로 등록한 덩어리 끝에 취소 → 그 등록을 되돌리고, 같은 말은 카드만 (껐다 켜면 다시 바로)', async () => {
    const h = await ready()
    say('21번 핑크문 만원', false)
    finish(h)
    say('21번 핑크문 만원 취소')
    at(3000)
    expect(h.undone).toEqual(['b1:21'])
    expect(h.voice.getSnapshot().readout?.text).toBe('21번 등록을 되돌렸어요')
    h.board.delete(21)
    say('21번 핑크문 만원')
    at(6000)
    expect(h.registered).toHaveLength(1)
    expect(cards(h).map((card) => card.no)).toEqual([21])
    h.voice.turnOff()
    await h.voice.turnOn()
    await settle()
    say('21번 핑크문 만원')
    expect(reg(h).map((item) => item.no)).toEqual([21, 21])
  })

  it('R22·R23: 열린 카드에 같은 번호를 합치고, 원 가격이 들리면 그 카드(핑크문)로 바로 등록', async () => {
    const h = await ready()
    say('15번 핑크프릴 만오천')
    at(3000)
    say('15번 핑크문 만오천')
    at(6000)
    expect(cards(h).map((card) => [card.no, card.name])).toEqual([[15, '핑크문']])
    say('15번 만오천 원')
    at(9000)
    expect(reg(h)).toEqual([{ no: 15, name: '핑크문', price: 15000, source: 'instant' }])
    expect(cards(h)).toEqual([])
  })

  it('카드 "닫기"를 누른 번호는 같은 말을 해도 카드만 (D-V3-10)', async () => {
    const h = await ready()
    say('15번 핑크프릴 만오천')
    at(3000)
    h.voice.close(cards(h)[0]?.id ?? '')
    say('15번 핑크프릴 만오천 원')
    at(6000)
    expect(h.registered).toEqual([])
    expect(cards(h).map((card) => card.no)).toEqual([15])
  })

  it('창이 열린 동안은 미루고 창이 닫히면 등록 (AC-V3-43 a)', async () => {
    const h = await ready()
    h.dialog = true
    say('108번 bts 10만 원')
    at(3000)
    expect(h.registered).toEqual([])
    h.dialog = false
    h.voice.refresh()
    expect(reg(h).map((item) => item.no)).toEqual([108])
    expect(cards(h)).toEqual([])
  })

  it('찜이 있으면 묻기 카드에 까닭 줄, "그대로 두기"를 누르면 그 번호는 묻기만 (까닭 줄 없음)', async () => {
    const h = await ready()
    h.board.set(108, { ...product(108, 'bts', 100000, 1), status: 'OPEN' })
    say('108번 12만 원')
    at(3000)
    const offer = h.voice.getSnapshot().offers[0]
    expect(offer?.message).toBe('108번을 고칠까요? 가격 100,000원 → 120,000원')
    expect(offer?.note).toBe('찜이 있는 상품이라 저절로 고치지 않았어요.')
    h.voice.dismissOffer(offer?.id ?? '')
    h.board.set(108, product(108, 'bts', 100000, 0))
    say('108번 12만 원')
    at(6000)
    const again = h.voice.getSnapshot().offers[0]
    expect(again?.stage).toBe('ask')
    expect(again?.note).toBeUndefined()
    expect(h.fixes).toEqual([])
  })
})

describe('중간 결과 끝의 번 없는 번호 (D-V3-26)', () => {
  it('R34: 중간 결과 "… 25만 원 170"은 아직 등록하지 않고, 최종 결과가 되면 170번으로 등록', async () => {
    const h = await ready()
    say('자 9cm에 이거 25만 원 170', false)
    expect(h.registered).toEqual([])
    say('자 9cm에 이거 25만 원 170')
    expect(reg(h).map((item) => [item.no, item.price])).toEqual([[170, 250000]])
  })
})

describe('바로 등록 문장', () => {
  it('저장값 읽기: 없거나 모르는 값은 켬', () => {
    expect(readInstant(null)).toBe(true)
    expect(readInstant({ 'voice.autoRegister': 'no' })).toBe(true)
    expect(readInstant({ 'voice.autoRegister': false })).toBe(false)
  })

  it('알림 문장 (D-V3-17)', () => {
    expect(fixedMessage(108, { name: 'bts', price: 100000 }, { price: 120000 })).toBe('108번을 고쳤어요: 가격 100,000원 → 120,000원')
    expect(fixedMessage(108, { name: '', price: 100000 }, { name: '핑크프릴' })).toBe('108번을 고쳤어요: 품종 없음 → 핑크프릴')
    expect(askMessage(108, { name: 'bts', price: 100000 }, { price: 120000 })).toBe('108번을 고칠까요? 가격 100,000원 → 120,000원')
    expect(registeredReadout(108, 'bts', 100000, true)).toBe('108번 bts 100,000원 등록했어요 · 품종 확인 필요')
    expect(numbersNote([189, 139])).toBe('번호 확인 필요 · 들린 번호: 189·139')
    expect(otherNumberMessage(189, [139])).toBe('189번으로 등록했는데 139번도 들렸어요. 맞는지 확인해 주세요.')
  })
})
