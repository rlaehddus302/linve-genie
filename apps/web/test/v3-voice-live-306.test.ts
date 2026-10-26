// 실방송 V3 306번 방송: 빠진 0 되살리기(36 → 306) · 가격만 고쳐 말함(55만 → 50만) · 굳은 중간 글(최종이 늦어도 1초 지난 낱말은 최종처럼)
// 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계.
import * as voiceModule from '@livejjim/voice'
import type { SuggestionCard, VoiceSettings } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceController, type ExistingView, type VoiceHost } from '../src/voice/controller.ts'

const T0 = Date.UTC(2026, 9, 26, 8, 48, 0)

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
  readonly fixes: { id: string; changes: { name?: string; price?: number } }[]
  readonly board: Map<number, ExistingView>
}

function harness(): Harness {
  const state = { registered: [] as Harness['registered'], fixes: [] as Harness['fixes'], board: new Map<number, ExistingView>() }
  const host: VoiceHost = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    priceUnit: () => 'THOUSAND',
    deviceId: () => 'this-device',
    lastVoiceDevice: () => null,
    currentNames: () => [],
    products: () => new Map([...state.board].map(([no, item]) => [no, item.closed])),
    fetchHistory: async () => [],
    dialogOpen: () => false,
    readConsent: () => true,
    writeConsent: () => {},
    readSettings: () => null,
    writeSettings: (_settings: VoiceSettings) => {},
    register: (card, registration, source) => {
      state.registered.push({ card, ...registration, source })
    },
    focusQuick: () => {},
    fixRecent: async (id, changes) => {
      state.fixes.push({ id, changes })
      const item = [...state.board.values()].find((entry) => entry.key === id)
      return { kind: 'fixed', before: { ...(changes.price !== undefined ? { price: item?.price ?? 0 } : {}) } }
    },
    undoRecent: () => true,
    existingProduct: (no: number) => state.board.get(no) ?? null,
  }
  return Object.assign(state, { voice: new VoiceController(host) })
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
const at = (ms: number): void => {
  vi.advanceTimersByTime(T0 + ms - Date.now())
}
const say = (text: string, final = true): void => FakeRecognition.last.say(text, final)
const reg = (h: Harness) => h.registered.map((item) => [item.no, item.price, item.name])

/** 콘솔이 등록을 마쳤다 (상품 보드에 생기고 음성에 알린다) */
function finishAll(h: Harness, claimCount = 0): void {
  for (const sent of h.registered) {
    const key = `b1:${String(sent.no)}`
    if (h.board.has(sent.no)) continue
    h.board.set(sent.no, { key, name: sent.name, price: sent.price, claimCount, closed: false, status: 'OPEN' })
    h.voice.noteVoiceRegistered({ id: key, no: sent.no, name: sent.name, price: sent.price })
  }
}

/** 낱말을 하나씩 gap ms마다 더하는 중간 결과 (최종 없음) — 끝난 시각을 돌려준다 */
function monologue(words: readonly string[], from: number, gap: number, upto = words.length): number {
  let t = from
  for (let i = 1; i <= upto; i++) {
    at(t)
    say(words.slice(0, i).join(' '), false)
    t += gap
  }
  return t
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 - 5000 })
  FakeRecognition.all.length = 0
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function ready(): Promise<Harness> {
  vi.setSystemTime(T0 - 5000)
  const h = harness()
  await h.voice.turnOn()
  await settle()
  at(0)
  return h
}

/** 304·308·305를 차례로 음성 등록하고 마친다 (실방송 순서) */
async function liveStart(h: Harness): Promise<number> {
  say('304번 몰디브 2만 원')
  at(3_000)
  say('308번 자 요 아이도 2만 원')
  at(6_000)
  say('300 5번도 다 정면이 들어오셨네 이거 2만 원')
  at(9_000)
  finishAll(h)
  await settle()
  return 9_000
}

describe('빠진 0 되살리기 (실방송 "36번" = 306번)', () => {
  it('304·308·305 다음 "36번도 2만 원" → 306번으로 등록, 큰 글자 칸에 "36번으로 들려 306번으로 봤어요"', async () => {
    const h = await ready()
    const t = await liveStart(h)
    expect(reg(h)).toEqual([
      [304, 20_000, '몰디브'],
      [308, 20_000, ''],
      [305, 20_000, ''],
    ])
    say('36번도 2만 원')
    expect(reg(h).at(-1)).toEqual([306, 20_000, ''])
    // 큰 글자 칸은 차례로 보인다 (D-V3-61) — 앞 안내가 지나면 "… · 36번으로 들려 306번으로 봤어요"
    const shown: string[] = []
    for (let ms = t; ms <= t + 12_000; ms += 500) {
      at(ms)
      shown.push(h.voice.getSnapshot().readout?.text ?? '')
    }
    expect(shown.some((text) => text.includes('306번') && text.includes('36번으로 들려 306번으로 봤어요'))).toBe(true)
    expect(h.registered).toHaveLength(4)
    expect(h.voice.getSnapshot().log.some((entry) => (entry.reason ?? '').includes('36번으로 들려 306번으로 봤어요'))).toBe(true)
  })

  it('"38번 … 몰디브 … 2만 원"은 이미 있는 308번(같은 가격)으로 — 새로 만들지 않는다', async () => {
    const h = await ready()
    const t = await liveStart(h)
    say('38번 자 우리 박사님이래요 자 송이 송이야 이거 좀 봐 줘 봐 봐 우리 그 몰디브 박사님 자 요 아이도 자 2만 원')
    at(t + 3_000)
    await settle()
    expect(h.registered.map((item) => item.no)).toEqual([304, 308, 305])
    expect(h.registered.some((item) => item.no === 38)).toBe(false)
  })

  it('맥락이 없으면 그대로 36번 (앞 등록이 30번대)', async () => {
    const h = await ready()
    say('34번 2만 원')
    at(3_000)
    say('35번 2만 원')
    at(6_000)
    finishAll(h)
    say('36번도 2만 원')
    expect(reg(h).at(-1)).toEqual([36, 20_000, ''])
  })

  it('중간 결과에 "306번"이 보였는데 최종이 "36번도 2만 원"이면 306번 (맥락 없이도)', async () => {
    const h = await ready()
    say('306번', false)
    at(300)
    say('36번도 2만 원')
    expect(reg(h)).toEqual([[306, 20_000, '']])
  })
})

describe('가격만 고쳐 말함 (실방송 309번 55만 원 → 50만 원)', () => {
  it('등록 30초 안·그 사이 다른 번호 없음·찜 0 → 바로 고침', async () => {
    const h = await ready()
    say('자 사용 잘 다녀오세요 자 309번이고요 자 선키스트 백금입니다 자 요 아이 뭐 얼마 얼마가 나셨죠 55만 원')
    expect(reg(h)).toEqual([[309, 550_000, '선키스트 백금']])
    at(3_000)
    finishAll(h)
    await settle()
    at(8_000)
    say('아 50만 원')
    at(11_000)
    await settle()
    expect(h.fixes).toEqual([{ id: 'b1:309', changes: { price: 500_000 } }])
  })

  it('찜이 있으면 바로 고치지 않고 묻는다', async () => {
    const h = await ready()
    say('309번 55만 원')
    at(3_000)
    finishAll(h, 2)
    await settle()
    say('50만 원')
    at(6_000)
    await settle()
    expect(h.fixes).toEqual([])
    expect(h.voice.getSnapshot().offers.some((offer) => offer.kind === 'offer' && offer.stage === 'ask' && offer.no === 309)).toBe(true)
  })

  it('30초가 지났거나 그 사이 다른 번호가 들렸으면 고치지 않는다', async () => {
    const h = await ready()
    say('309번 55만 원')
    at(3_000)
    finishAll(h)
    at(34_000)
    say('50만 원')
    at(37_000)
    await settle()
    expect(h.fixes).toEqual([])
    const g = await ready()
    say('309번 55만 원')
    at(3_000)
    finishAll(g)
    say('310번은 이따가 볼게요')
    at(6_000)
    say('50만 원')
    at(9_000)
    await settle()
    expect(g.fixes).toEqual([])
  })
})

describe('굳은 중간 글 (사용자 결정 — 최종이 늦어도 1초 지난 낱말은 최종처럼)', () => {
  it('끝나지 않는 긴 말에서도 312번 50,000원을 등록하고, 늦게 온 최종이 다시 등록하지 않는다', async () => {
    const h = await ready()
    const words = '312번 자 수박금 자 ui 5만 원까지 드려볼게요 312번입니다 자 수박이 5만 원 자 다음 거 볼게요'.split(' ')
    const end = monologue(words, 0, 400)
    expect(reg(h)).toEqual([[312, 50_000, '수박금']])
    at(end + 1_500)
    say(words.join(' '))
    at(end + 5_000)
    await settle()
    expect(h.registered).toHaveLength(1)
  })

  it('최종 없이 이어지는 말 안의 가격만 고쳐 말함도 1초 굳으면 고친다', async () => {
    const h = await ready()
    const words = '309번 55만 원 자 요 아이 아 50만 원 자 그대로 보내 드릴게요 자'.split(' ')
    // 앞 낱말 셋만 먼저 — 바로 등록되고 콘솔이 마친다
    let t = monologue(words, 0, 300, 4)
    expect(reg(h)).toEqual([[309, 550_000, '']])
    finishAll(h)
    await settle()
    for (let i = 5; i <= words.length; i++) {
      at(t)
      say(words.slice(0, i).join(' '), false)
      t += 300
    }
    at(t + 1_100)
    await settle()
    expect(h.fixes).toEqual([{ id: 'b1:309', changes: { price: 500_000 } }])
  })

  it('300글자를 넘게 이어지는 중간 결과에서도 뒤의 번호·가격을 읽는다', async () => {
    const h = await ready()
    const filler = Array.from({ length: 70 }, (_, i) => (i % 2 === 0 ? '예쁘죠' : '자 요 아이')).join(' ').split(' ')
    const words = [...filler, '298번', '자', '청사과', '자', '요', '아이', '40만', '원', '드려요', '자']
    expect(words.join(' ').length).toBeGreaterThan(300)
    monologue(words, 0, 250)
    expect(reg(h)).toEqual([[298, 400_000, '청사과']])
  })

  it('굳은 낱말은 1,000ms부터 — 999ms 동안은 최종처럼 넘기지 않는다 (들은 말 줄이 그대로)', async () => {
    const h = await ready()
    say('자 요 아이 예쁘죠 정말', false)
    at(999)
    expect(h.voice.getSnapshot().heard).toHaveLength(0)
    at(1_000)
    expect(h.voice.getSnapshot().heard.map((line) => line.text)).toEqual(['자 요 아이 예쁘죠'])
    expect(h.voice.getSnapshot().interim).toBe('정말')
  })
})

describe('앞 말 맥락의 품종 (사용자 요구: 바이칼녹금이라고 했는데 녹금으로)', () => {
  it('앞 덩어리에 "바이칼녹금"이 들렸으면 "312번 녹금 5만 원"은 바이칼녹금으로', async () => {
    const h = await ready()
    say('자 바이칼 바이칼녹금 이거 봐 주세요')
    at(3_000)
    say('312번 녹금 5만 원')
    expect(reg(h)).toEqual([[312, 50_000, '바이칼녹금']])
  })

  it('이름 없이 등록할 때는 앞 말에 두 번 이상 들린 사전 이름만, 앞 상품의 품종은 넘어오지 않는다', async () => {
    const h = await ready()
    say('304번 몰디브 2만 원')
    at(3_000)
    say('305번 2만 원')
    expect(reg(h).at(-1)).toEqual([305, 20_000, ''])
    at(6_000)
    say('자 다음은 바이칼녹금 바이칼녹금이에요')
    at(9_000)
    say('306번 5만 원')
    expect(reg(h).at(-1)).toEqual([306, 50_000, '바이칼녹금'])
    at(12_000)
    say('자 청사과 예쁘죠')
    at(15_000)
    say('307번 5만 원')
    expect(reg(h).at(-1)).toEqual([307, 50_000, ''])
  })

  it('1분이 지난 말은 보지 않는다', async () => {
    const h = await ready()
    say('바이칼녹금 바이칼녹금')
    at(62_500)
    say('312번 5만 원')
    expect(reg(h)).toEqual([[312, 50_000, '']])
  })
})
