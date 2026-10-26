// V3 바로 등록 (번호·가격이 들리는 순간 등록, 이미 있는 번호는 무시·자동 고침·묻기) — 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계.
import * as voiceModule from '@livejjim/voice'
import type { SuggestionCard, VoiceSettings } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceController, type ExistingView, type RecentFixOutcome, type VoiceHost } from '../src/voice/controller.ts'
import { askMessage, fixedMessage, otherNumberMessage, readInstant, registeredReadout } from '../src/voice/instant.ts'

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
  readonly moves: [number, number][]
  readonly fixOptions: unknown[]
  readonly archived: unknown[]
}

function harness(options: { settings?: unknown; noBoard?: boolean; priceUnit?: 'WON' | 'THOUSAND'; lastDevice?: Map<number, string>; renumberResult?: 'claimed' } = {}): Harness {
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

describe('바로 등록 (V3)', () => {
  it('중간 결과에서 번호와 가격이 들린 순간 조용한 시간 없이 등록한다 — 카드 없음', async () => {
    const h = await ready()
    say('네 108번 bts 어 요한이 10만 원까지', false)
    // 실방송 3차(dev-notes 추가 5): 한 번만 나온 추측 낱말은 품종으로 쓰지 않는다 — 품종 미입력
    expect(reg(h)).toEqual([{ no: 108, name: '', price: 100000, source: 'instant' }])
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
    // 실방송 333번 (가격 고침 문턱): 다른 가격은 정정 낱말이 있거나 다른 조각에서 두 번 들려야 바로 고친다 — 한 번이면 고침 후보(묻기)
    say('108번 12만 원')
    await settle()
    at(3000)
    await settle()
    expect(h.fixes).toEqual([])
    expect(h.voice.getSnapshot().offers[0]?.stage).toBe('ask')
    say('108번 12만 원')
    await settle()
    at(6000)
    await settle()
    expect(h.fixes).toEqual([{ id: 'b1:108', changes: { price: 120000 } }])
    // 고침 후보 묻기 카드는 내려간다
    expect(h.voice.getSnapshot().offers.filter((item) => item.stage === 'ask')).toEqual([])
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

  it('D-V3-44: 바로 등록 켬에서 \'원\' 가격이 없는 결과는 카드 없이 기록 "가격을 못 들었어요" — 끔이면 카드', async () => {
    const h = await ready()
    say('이 10번 오타 하나 지우신 거예요')
    at(2000)
    expect(h.registered).toEqual([])
    expect(cards(h)).toEqual([])
    expect(h.voice.getSnapshot().log[0]?.reason).toBe('가격을 못 들었어요')
    say('15번 핑크프릴 만오천')
    at(5000)
    // D-V3-67: 기다리던 10번은 다른 N번(15번)이 먼저 와서 "가격을 못 들었어요" 카드가 되고, 15번이 새로 기다린다
    expect(cards(h).map((card) => card.no)).toEqual([10])
    const off = await ready({ settings: { 'voice.autoRegister': false } })
    say('15번 핑크문')
    at(3000)
    expect(off.registered).toEqual([])
    expect(cards(off).map((card) => card.no)).toEqual([15])
  })

  it('D-V3-44: 같은 덩어리에서 나중에 \'원\' 가격이 오면 바로 등록', async () => {
    const h = await ready()
    say('15번 핑크프릴')
    at(1000)
    say('만오천 원')
    expect(reg(h)).toEqual([{ no: 15, name: '핑크프릴', price: 15000, source: 'instant' }])
  })

  it('같은 번호 카드가 열려 있으면 새 카드를 만들지 않고 그 카드를 고친다 (바로 등록 끔)', async () => {
    const h = await ready({ settings: { 'voice.autoRegister': false } })
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
  it('R7 (D-V3-46): 원 가격 바로 앞 139번과 짝지어 139번 500,000원 등록, 덩어리 끝에 "139번으로 등록했는데 189번도 들렸어요" 4초 + 기록', async () => {
    const h = await ready()
    say('어 자 요거 지금 189번인데 뿌리가 있습니다 뿌리 있는데 컵이 너무 잘 들었어요 빅뱅 금 139번 얘 50만 원 들어요')
    at(2000)
    expect(reg(h).map((item) => [item.no, item.price])).toEqual([[139, 500000]])
    expect(cards(h)).toEqual([])
    const text = '139번으로 등록했는데 189번도 들렸어요. 맞는지 확인해 주세요.'
    expect(h.voice.getSnapshot().log[0]?.reason).toBe(text)
    // 등록 안내 4초 뒤 차례로 (D-V3-61)
    expect(h.voice.getSnapshot().readout?.text).toBe('139번 빅뱅금 500,000원 등록했어요')
    at(2000 + 4000)
    expect(h.voice.getSnapshot().readout?.text).toBe(text)
  })

  it('D-V3-46: 쉬지 않고 이어 말한 한 덩어리의 상품 둘을 조각마다 바로 등록', async () => {
    const h = await ready()
    say('93번 빅뱅금 10만 원 자 다음 97번 23만 원', false)
    expect(reg(h).map((item) => [item.no, item.price])).toEqual([
      [93, 100000],
      [97, 230000],
    ])
  })

  it('D-V3-48: 천원 단위 방송의 "92번 빅뱅 60"(최종 결과)은 60,000원으로 바로 등록', async () => {
    const h = await ready({ priceUnit: 'THOUSAND' })
    say('92번 빅뱅 60')
    expect(reg(h).map((item) => [item.no, item.name, item.price])).toEqual([[92, '빅뱅', 60000]])
  })

  it('번호 없는 말은 카드 없이 "번호를 못 들었어요", 끔이면 번호만 있는 카드에 "가격을 말해 주세요" (D-V3-41·44)', async () => {
    const h = await ready()
    say('핑크프릴 만오천 원')
    at(2000)
    expect(cards(h)).toEqual([])
    expect(h.voice.getSnapshot().readout?.text).toBe('15,000원 · 번호를 못 들었어요')
    const off = await ready({ settings: { 'voice.autoRegister': false } })
    say('15번 핑크프릴')
    at(3000)
    const card = cards(off)[0]
    expect(off.voice.cardInfo(card?.id ?? '')?.ask).toBe('가격을 말해 주세요')
  })

  it('R26: 등록 뒤 같은 덩어리에서 다른 번호가 들리면 큰 글자 칸 4초 + 음성 기록 (D-V3-45), 등록은 그대로', async () => {
    const h = await ready()
    say('189번 빅뱅금 50만 원', false)
    say('189번 빅뱅금 50만 원 139번')
    at(1800)
    const text = '189번으로 등록했는데 139번도 들렸어요. 맞는지 확인해 주세요.'
    expect(reg(h).map((item) => item.no)).toEqual([189])
    expect(h.voice.getSnapshot().log[0]?.reason).toBe(text)
    expect(h.voice.getSnapshot().offers).toEqual([])
    // 등록 안내 다음 차례로 4초 (D-V3-61)
    at(1800 + 4000)
    expect(h.voice.getSnapshot().readout?.text).toBe(text)
    at(1800 + 8100)
    expect(h.voice.getSnapshot().readout).toBeNull()
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
    at(5000)
    expect(h.voice.getSnapshot().readout?.text).toBe('21번 등록을 되돌렸어요')
    h.board.delete(21)
    say('21번 핑크문 만원')
    at(11000)
    expect(h.registered).toHaveLength(1)
    expect(cards(h).map((card) => card.no)).toEqual([21])
    h.voice.turnOff()
    await h.voice.turnOn()
    await settle()
    say('21번 핑크문 만원')
    expect(reg(h).map((item) => item.no)).toEqual([21, 21])
  })

  it('R22·R23 (D-V3-44 뒤): 원 없는 말은 카드가 없고, "15번 만오천 원"에서 바로 등록 · 끔이면 열린 카드에 합친다', async () => {
    const h = await ready()
    say('15번 핑크프릴 만오천')
    at(3000)
    say('15번 핑크문 만오천')
    at(6000)
    expect(cards(h)).toEqual([])
    say('15번 만오천 원')
    at(9000)
    // 사용자 요구(1분 맥락): 같은 번호를 바로 앞 덩어리에서 품종과 함께 들었으면 그 품종 — 다른 결과에 들린 번호·품종·가격을 잇는다
    expect(reg(h)).toEqual([{ no: 15, name: '핑크문', price: 15000, source: 'instant' }])
    const off = await ready({ settings: { 'voice.autoRegister': false } })
    say('15번 핑크프릴 만오천')
    at(3000)
    say('15번 핑크문 만오천')
    at(6000)
    expect(cards(off).map((card) => [card.no, card.name])).toEqual([[15, '핑크문']])
  })

  it('카드 "닫기"를 누른 번호는 같은 말을 해도 카드만 (D-V3-10)', async () => {
    const h = await ready({ settings: { 'voice.autoRegister': false } })
    say('15번 핑크프릴 만오천')
    at(3000)
    h.voice.close(cards(h)[0]?.id ?? '')
    h.voice.setInstant(true)
    say('15번 핑크프릴 만오천 원')
    at(6000)
    expect(h.registered).toEqual([])
    expect(cards(h).map((card) => card.no)).toEqual([15])
  })

  it('창이 닫히면 따로 알리지 않아도 곧 등록 (AC-V3-43 a, TE-V3-006)', async () => {
    const h = await ready()
    h.dialog = true
    say('네 108번 bts 어 요한이 10만 원까지 안토 일단 색감 안쪽 봐주세요')
    at(3000)
    expect(h.registered).toEqual([])
    h.dialog = false
    at(3300)
    expect(reg(h).map((item) => item.no)).toEqual([108])
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

  // D-V3-59: 이 콘솔이 방금 등록한 번호가 아니고 찜이 있으면 다른 화분일 수 있다는 카드 — 그대로 두면 거절한 번호(묻기만)
  it('찜 있는 상품을 다시 들으면 "108번이 이미 있어요" 카드, 그대로 두면 그 번호는 묻기만 (까닭 줄 없음)', async () => {
    const h = await ready()
    h.board.set(108, { ...product(108, 'bts', 100000, 1), status: 'OPEN' })
    say('108번 12만 원')
    at(3000)
    const offer = h.voice.getSnapshot().offers[0]
    expect(offer?.message).toBe('108번이 이미 있어요 (100,000원, 찜 1개)')
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

describe('중간 결과 끝의 번 없는 번호 (D-V3-26)·막음 (실방송 3차)', () => {
  it('R34: "… 25만 원 170"은 바로 등록하지 않고 카드도 없이 "번호가 가격 뒤에 들렸어요" (D-V3-41)', async () => {
    const h = await ready()
    say('자 9cm에 이거 25만 원 170', false)
    expect(h.registered).toEqual([])
    say('자 9cm에 이거 25만 원 170')
    at(2000)
    expect(h.registered).toEqual([])
    expect(cards(h)).toEqual([])
    expect(h.voice.getSnapshot().readout?.text).toBe('번호가 가격 뒤에 들렸어요')
  })

  // D-V3-64: N번 + 원으로 분명히 들은 등록은 크기와 상관없이 바로 (300만 원 "가격 확인 필요" 카드 없음 — 정산 때 다시 본다)
  it('300만 원을 넘는 가격도 바로 등록한다 (D-V3-64)', async () => {
    const h = await ready()
    say('38번 라울 605만 원')
    at(3000)
    expect(reg(h).map((item) => [item.no, item.price])).toEqual([[38, 6050000]])
    expect(cards(h)).toEqual([])
  })

  // D-V3-57·59: 3배 넘게 바뀌어도 N번 + 원이면 바로 고친다 — 이 콘솔이 방금 등록한 번호가 아니면(찜 0) 바꾸고 다른 번호였을 때 할 말을 4초
  it('이미 있는 상품(찜 0)을 N번 + 원으로 다시 들으면 3배가 넘어도 바로 고치고, 고쳐 말함이 아니면 안내 (D-V3-57·59)', async () => {
    const h = await ready()
    h.board.set(38, product(38, '라울', 100000))
    // 실방송 333번 (가격 고침 문턱): 다른 가격은 정정 낱말이 있거나 다른 조각에서 두 번 들려야 바로 고친다 — 한 번이면 고침 후보(묻기)
    say('38번 라울 50만 원')
    at(3000)
    say('38번 라울 50만 원')
    await settle()
    expect(h.fixes).toEqual([{ id: 'b1:38', changes: { price: 500000 } }])
    expect(h.voice.getSnapshot().readout?.text).toBe("38번을 바꿨어요: 100,000원 → 500,000원 · 아까 것이 다른 번호였으면 '아까 38번은 61번'이라고 말해 주세요")
  })

  it('찜 있는 상품을 나중에 다시 들으면 덮어쓰지 않고 "65번이 이미 있어요 (30,000원, 찜 2개)" (D-V3-59)', async () => {
    const h = await ready()
    h.board.set(65, product(65, '라울', 30000, 2))
    say('65번 5만 원')
    await settle()
    expect(h.fixes).toEqual([])
    const offer = h.voice.getSnapshot().offers[0]
    expect(offer?.message).toBe('65번이 이미 있어요 (30,000원, 찜 2개)')
    expect(offer?.maybeOther).toBe(true)
    await h.voice.fixOffer(offer?.id ?? '')
    expect(h.fixes).toEqual([{ id: 'b1:65', changes: { price: 50000 } }])
  })

  it('방금 바로 등록한 번호를 찜이 생긴 뒤 다시 말하면 바로 고치고 "찜 N개는 전 가격 그대로예요" (D-V3-57)', async () => {
    const h = await ready()
    say('70번 라울 3만 원')
    finish(h)
    h.board.set(70, { ...product(70, '라울', 30000, 1), status: 'OPEN' })
    at(2500)
    // 실방송 333번 (가격 고침 문턱): 다른 가격은 정정 낱말이 있거나 다른 조각에서 두 번 들려야 바로 고친다 — 한 번이면 고침 후보(묻기)
    say('70번 5만 원 70번 5만 원')
    await settle()
    expect(h.fixes).toEqual([{ id: 'b1:70', changes: { price: 50000 } }])
    const offer = h.voice.getSnapshot().offers[0]
    expect(offer?.stage).toBe('fixed')
    expect(offer?.note).toBe('찜 1개는 전 가격 그대로예요. 바꾸려면 상품에서 고쳐 주세요.')
  })
})

describe('덩어리 내내 켜져 있어야 바로 (D-V3-35)', () => {
  it('끈 채 말하고 조용한 시간 안에 켜면 그 덩어리는 카드만, 다음 덩어리부터 바로', async () => {
    const h = await ready()
    h.voice.setInstant(false)
    say('108번 bts 10만 원', false)
    h.voice.setInstant(true)
    say('108번 bts 10만 원')
    at(3000)
    expect(h.registered).toEqual([])
    expect(cards(h).map((card) => card.no)).toEqual([108])
    say('109번 라울 만 원')
    expect(reg(h).map((item) => item.no)).toEqual([109])
  })

  it('켠 채 말하다 도중에 끄면 바로 등록하지 않는다', async () => {
    const h = await ready()
    say('108번 bts', false)
    h.voice.setInstant(false)
    h.voice.setInstant(true)
    say('108번 bts 10만 원')
    at(3000)
    expect(h.registered).toEqual([])
  })
})

describe('추측 품종은 등록에 쓰지 않는다 (D-V3-37)', () => {
  it('바로 등록은 품종 미입력, 큰 글자 칸 "15번 10,000원 등록했어요"', async () => {
    const h = await ready()
    say('15번 bts 자 bts 만 원')
    expect(reg(h)).toEqual([{ no: 15, name: '', price: 10000, source: 'instant' }])
    expect(h.voice.getSnapshot().readout?.text).toBe('15번 10,000원 등록했어요')
  })

  it('카드 품종 칸은 비우고 추측은 후보 단추 — 누르면 채우고 손댄 카드 (바로 등록 끔)', async () => {
    const h = await ready({ settings: { 'voice.autoRegister': false } })
    say('15번 bts 자 bts 만오천')
    at(3000)
    const card = cards(h)[0]
    expect(card?.name).toBeNull()
    expect(h.voice.cardInfo(card?.id ?? '')?.candidates.map((item) => item.name)).toContain('bts')
    h.voice.chooseCandidate(card?.id ?? '', 'bts')
    expect(cards(h)[0]?.name).toBe('bts')
    expect(cards(h)[0]?.touched).toBe(true)
  })
})

describe('음성 기록 한 줄 (R-25, D-V3-65)', () => {
  it('바로 고침 쓰기에 가린 들은 말 한 줄을 싣고, 되돌리기에는 그 요청 번호를 싣는다', async () => {
    const h = await ready()
    h.board.set(108, product(108, 'bts', 100000))
    // 실방송 333번 (가격 고침 문턱): 다른 가격은 정정 낱말이 있거나 다른 조각에서 두 번 들려야 바로 고친다 — 한 번이면 고침 후보(묻기)
    say('108번 12만 원')
    at(3000)
    say('108번 12만 원 끝자리 1234')
    await settle()
    // RA-V3-004: 들은 말은 그 일을 만든 조각 글만 (뒤의 끝자리 말은 싣지 않는다)
    expect(h.fixOptions[0]).toMatchObject({ newOnly: true, voiceLog: { heard: '108번 12만 원', source: 'voice' } })
    const requestId = (h.fixOptions[0] as { requestId: string }).requestId
    expect(typeof requestId).toBe('string')
    const offer = h.voice.getSnapshot().offers[0]
    await h.voice.revertOffer(offer?.id ?? '')
    // RA-V3-003: 되돌리기는 입금 전 찜도 원래 가격으로
    expect(h.fixOptions[1]).toMatchObject({ applyTo: 'UNPAID_CLAIMS', voiceLog: { undo: requestId } })
  })
})

describe('음성 인식 기록 모아 두기 (D-V3-56)', () => {
  it('켜져 있으면 덩어리마다 가린 글·읽은 값·한 일을 남긴다', async () => {
    const h = await ready({ settings: { 'voice.archive': true } })
    say('15번 라울 만 원 끝자리 1234', false)
    say('15번 라울 만 원 끝자리 1234')
    at(2000)
    expect(h.archived[0]).toMatchObject({ text: '15번 라울 만 원 끝자리 ****', action: 'REGISTERED', reading: { no: 15 } })
  })

  it('꺼져 있으면 남기지 않는다', async () => {
    const h = await ready({ settings: { 'voice.archive': false } })
    say('15번 라울 만 원')
    at(2000)
    expect(h.archived).toEqual([])
  })
})

describe('고쳐 말함 (D-V3-59, TD-V3-005)', () => {
  it('다른 번호를 음성으로 고치기만 한 것은 고쳐 말함을 끊지 않는다 — 다른 번호의 새 등록만 끊는다', async () => {
    const h = await ready()
    say('70번 라울 3만 원')
    finish(h)
    h.board.set(71, product(71, '녹금', 20000))
    at(2500)
    // 실방송 333번 (가격 고침 문턱): 다른 가격은 정정 낱말이 있거나 다른 조각에서 두 번 들려야 바로 고친다 — 한 번이면 고침 후보(묻기)
    say('71번 2만 5천 원 71번 2만 5천 원')
    await settle()
    expect(h.fixes.map((fix) => fix.id)).toEqual(['b1:71'])
    h.board.set(70, product(70, '라울', 30000, 1))
    at(5000)
    say('70번 4만 원 70번 4만 원')
    await settle()
    // 찜이 있어도 고쳐 말함이면 바로 고친다 (MAYBE_OTHER 카드 아님)
    expect(h.fixes.map((fix) => fix.id)).toEqual(['b1:71', 'b1:70'])
    expect(h.voice.getSnapshot().offers.some((offer) => offer.maybeOther === true)).toBe(false)
  })

  it('그 뒤 다른 번호를 새로 등록했으면 고쳐 말함이 아니다 — 찜 있으면 "이미 있어요" 카드', async () => {
    const h = await ready()
    say('70번 라울 3만 원')
    finish(h, 0)
    at(2500)
    say('72번 녹금 2만 원')
    finish(h, 1)
    h.board.set(70, product(70, '라울', 30000, 1))
    at(5000)
    say('70번 4만 원')
    await settle()
    expect(h.fixes).toEqual([])
    expect(h.voice.getSnapshot().offers[0]?.maybeOther).toBe(true)
  })
})

describe('중간 결과 안정 (D-V3-71)', () => {
  it('중간 결과 "148번 280"이 1초 같으면 바로 등록하고, 최종이 280을 지워도 다시 등록하지 않는다', async () => {
    const h = await ready({ priceUnit: 'THOUSAND' })
    say('148번 280', false)
    at(999)
    expect(h.registered).toEqual([])
    at(1000)
    expect(reg(h).map((item) => [item.no, item.price])).toEqual([[148, 280000]])
    expect(h.voice.getSnapshot().log[0]?.reason).toBe('중간 글로 등록')
    say('148번 자 회장님들 자국 8번 캡처 떠 주시고요')
    at(5000)
    expect(h.registered).toHaveLength(1)
  })

  it('1초 안에 바뀌면 다시 센다', async () => {
    const h = await ready({ priceUnit: 'THOUSAND' })
    say('148번 280', false)
    at(600)
    say('148번 280만', false)
    at(1100)
    expect(h.registered).toEqual([])
  })
})

describe('기다리는 번호 (D-V3-67)', () => {
  it('번호만 들린 덩어리 뒤 60초 안에 원 가격만 들리면 그 번호로 바로 등록 (이어 받음)', async () => {
    const h = await ready()
    say('15번 이거 예쁘죠')
    at(2000)
    expect(h.registered).toEqual([])
    expect(cards(h)).toEqual([])
    say('자 이건 만오천 원')
    at(5000)
    expect(reg(h)).toEqual([{ no: 15, name: '', price: 15000, source: 'instant' }])
    expect(h.voice.getSnapshot().readout?.text).toContain('이어 받음')
  })

  it('다른 N번이 먼저 오면 기다리던 번호는 "15번 가격을 못 들었어요" 카드', async () => {
    const h = await ready()
    say('15번 이거 예쁘죠')
    at(2000)
    say('16번 라울 만 원')
    at(5000)
    expect(reg(h).map((item) => item.no)).toEqual([16])
    const card = cards(h).find((item) => item.no === 15)
    expect(card).toBeDefined()
    expect(h.voice.getSnapshot().notes.get(card?.id ?? '')).toBe('15번 가격을 못 들었어요')
  })

  it('둘째 덩어리의 원 가격은 조용한 시간 전에 그 자리에서 이어 받는다, 품종도 사전 이름이면 함께 (TE-V3-014)', async () => {
    const h = await ready()
    say('15번')
    at(2000)
    expect(h.registered).toEqual([])
    say('엘레강스', false)
    say('엘레강스 이만원')
    expect(reg(h)).toEqual([{ no: 15, name: '엘레강스', price: 20000, source: 'instant' }])
    expect(h.voice.getSnapshot().log[0]?.reason).toBe('이어 받음')
  })

  it('"가격을 못 들었어요" 카드는 가격 칸에 적어 등록한다 (TE-V3-014)', async () => {
    const h = await ready({ priceUnit: 'THOUSAND' })
    say('15번')
    at(2000)
    say('16번 2만 원')
    at(5000)
    const card = cards(h).find((item) => item.no === 15)
    expect(h.voice.cardInfo(card?.id ?? '')?.missed).toBe(true)
    expect(h.voice.submitMissed(card?.id ?? '', '15')).toBeNull()
    expect(reg(h).at(-1)).toEqual({ no: 15, name: '', price: 15000, source: 'click' })
  })

  it('60초는 그 번호를 들은 때부터 센다 (TE-V3-014)', async () => {
    const h = await ready()
    say('15번')
    at(61_000)
    expect(cards(h).map((card) => card.no)).toEqual([15])
  })

  it('R80: 가격 못 들은 번호 카드는 3장까지, 넘으면 가장 오래된 것을 접는다', async () => {
    const h = await ready()
    let t = 0
    for (const no of [15, 16, 17, 18]) {
      say(`${String(no)}번`)
      t += 3000
      at(t)
    }
    expect(cards(h).map((card) => card.no).sort()).toEqual([15, 16, 17])
    say('19번')
    at(t + 3000)
    expect(cards(h).map((card) => card.no).sort()).toEqual([16, 17, 18])
    expect(h.voice.getSnapshot().missedFolded).toBe(1)
  })

  it('60초가 지나면 덩어리가 없어도 카드', async () => {
    const h = await ready()
    say('15번 이거 예쁘죠')
    at(2000)
    expect(cards(h)).toEqual([])
    at(2000 + 61_000)
    expect(cards(h).map((card) => card.no)).toEqual([15])
  })
})

describe('위험 감사 RA-V3-001·007', () => {
  it('옮긴 뒤 새 번호에 찜이 생겼으면 되돌리지 않고 4초 안내 (RA-V3-001)', async () => {
    const h = await ready()
    h.board.set(65, product(65, '라울', 30000))
    say('아까 65번은 61번이에요')
    at(2000)
    await settle()
    expect(h.moves).toEqual([[65, 61]])
    h.board.set(61, product(61, '라울', 30000, 1))
    const offer = h.voice.getSnapshot().offers[0]
    await h.voice.revertOffer(offer?.id ?? '')
    expect(h.moves).toEqual([[65, 61]])
    // 옮긴 안내 다음 차례로 (D-V3-61)
    at(6500)
    expect(h.voice.getSnapshot().readout?.text).toBe('61번에 찜이 생겨 번호를 되돌리지 않았어요. 상품 목록에서 고쳐 주세요.')
  })

  it('서버가 찜이 있다고 막으면 그 문장 (409 VOICE_RENUMBER_CLAIMED)', async () => {
    const h = await ready({ renumberResult: 'claimed' })
    h.board.set(65, product(65, '라울', 30000))
    say('아까 65번은 61번이에요')
    at(2000)
    await settle()
    expect(h.voice.getSnapshot().readout?.text).toBe('찜이 있는 상품이라 번호를 옮기지 않았어요.')
  })

  it('다른 기기가 마지막으로 등록한 번호를 다른 가격으로 들으면 바로 고치지 않고 "이미 있어요" (D-V3-76)', async () => {
    const h = await ready({ lastDevice: new Map([[108, 'phone-device']]) })
    h.board.set(108, product(108, 'bts', 100000))
    say('108번 12만 원')
    await settle()
    expect(h.fixes).toEqual([])
    expect(h.voice.getSnapshot().offers[0]?.maybeOther).toBe(true)
  })
})

describe('음성 번호 옮기기 (R-24, D-V3-58)', () => {
  it('"아까 65번은 61번이에요" → 번호 바꾸기, 4초 "65번을 61번으로 옮겼어요"와 [되돌리기]', async () => {
    const h = await ready()
    h.board.set(65, product(65, '라울', 30000))
    say('아까 65번은 61번이에요')
    at(2000)
    await settle()
    expect(h.moves).toEqual([[65, 61]])
    const offer = h.voice.getSnapshot().offers[0]
    expect(offer?.message).toBe('65번을 61번으로 옮겼어요')
    await h.voice.revertOffer(offer?.id ?? '')
    expect(h.moves).toEqual([[65, 61], [61, 65]])
  })

  it('찜이 있거나 새 번호가 있으면 옮기지 않고 4초 안내', async () => {
    const h = await ready()
    h.board.set(65, product(65, '라울', 30000, 1))
    say('아까 65번은 61번이에요')
    at(2000)
    expect(h.moves).toEqual([])
    expect(h.voice.getSnapshot().readout?.text).toBe('65번에 찜이 있어 번호를 옮기지 않았어요. 상품 목록에서 고쳐 주세요.')
    h.board.set(65, product(65, '라울', 30000))
    h.board.set(61, product(61, '녹금', 30000))
    say('아까 65번은 61번이에요')
    at(10_000)
    expect(h.moves).toEqual([])
    expect(h.voice.getSnapshot().log[0]?.reason).toBe('61번이 이미 있어 옮기지 않았어요')
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
    expect(registeredReadout(108, '', 100000)).toBe('108번 100,000원 등록했어요')
    expect(registeredReadout(180, '삼광색금', 350000)).toBe('180번 삼광색금 350,000원 등록했어요')
    expect(otherNumberMessage(189, [139])).toBe('189번으로 등록했는데 139번도 들렸어요. 맞는지 확인해 주세요.')
  })
})
