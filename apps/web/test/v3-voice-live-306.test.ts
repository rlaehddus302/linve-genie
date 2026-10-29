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

const NO_NAMES: readonly string[] = []

function harness(): Harness {
  const state = { registered: [] as Harness['registered'], fixes: [] as Harness['fixes'], board: new Map<number, ExistingView>() }
  const host: VoiceHost = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    priceUnit: () => 'THOUSAND',
    deviceId: () => 'this-device',
    lastVoiceDevice: () => null,
    // 화면처럼 같은 목록을 돌려준다(ConsolePage useMemo) — 부를 때마다 새 목록이면 사전을 매번 다시 만든다(사전이 커져 300글자 시험이 5초를 넘음, D-V3-115)
    currentNames: () => NO_NAMES,
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
  it('실방송 10:14: 번호 앞에 말한 다음 상품 가격은 앞 상품을 고치지 않고 다음 번호로 — 327번 200,000원 그대로, 389번 50,000원', async () => {
    const h = await ready()
    say('327번 자 쇼콜라 20만 원')
    at(3_000)
    finishAll(h)
    await settle()
    at(30_000)
    say('요거 요거 이렇게 5만 원')
    at(35_000)
    await settle()
    say('389번 자 요 아이 5만 원')
    at(38_000)
    finishAll(h)
    await settle()
    at(48_000)
    say('어 자 30만 원이에요')
    at(52_000)
    await settle()
    expect(h.fixes).toEqual([])
    expect(reg(h).map((item) => [item[0], item[1]])).toEqual([
      [327, 200_000],
      [389, 50_000],
    ])
    expect(h.voice.getSnapshot().offers).toEqual([])
  })

  it('번호 없이 먼저 들린 가격은 15초 안에 가격 없이 들린 "N번"의 가격 — 15초가 지나면 버린다', async () => {
    const h = await ready()
    say('요거 요거 이렇게 5만 원')
    at(3_000)
    say('389번 자 요 아이')
    at(6_000)
    expect(reg(h)).toEqual([[389, 50_000, '']])
    const g = await ready()
    say('요거 요거 이렇게 5만 원')
    at(18_500)
    say('390번 자 요 아이')
    at(22_000)
    expect(g.registered).toEqual([])
  })

  it('등록 30초 안·그 사이 다른 번호 없음·찜 0 → 바로 고침', async () => {
    const h = await ready()
    say('자 사용 잘 다녀오세요 자 309번이고요 자 선키스트 백금입니다 자 요 아이 뭐 얼마 얼마가 나셨죠 55만 원')
    expect(reg(h)).toEqual([[309, 550_000, '선키스트 백금']])
    at(3_000)
    finishAll(h)
    await settle()
    at(8_000)
    say('아니 50만 원')
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
    say('아니 50만 원')
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
    say('아니 50만 원')
    at(37_000)
    await settle()
    expect(h.fixes).toEqual([])
    const g = await ready()
    say('309번 55만 원')
    at(3_000)
    finishAll(g)
    say('310번은 이따가 볼게요')
    at(6_000)
    say('아니 50만 원')
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
    const words = '309번 55만 원 자 요 아이 아니 50만 원 자 그대로 보내 드릴게요 자'.split(' ')
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

  it('이름 없이 등록할 때는 앞 말의 사전 이름을 쓰되, 앞 상품의 품종은 넘어오지 않는다', async () => {
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
    // 번호 없는 덩어리에서 따로 든 이름은 한 번으로도 다음 번호의 것 (실방송 황소개구리·에스텔색금 — 사용자 요구)
    say('자 청사과 예쁘죠')
    at(15_000)
    say('307번 5만 원')
    expect(reg(h).at(-1)).toEqual([307, 50_000, '청사과'])
  })

  it('1분이 지난 말은 보지 않는다', async () => {
    const h = await ready()
    say('바이칼녹금 바이칼녹금')
    at(62_500)
    say('312번 5만 원')
    expect(reg(h)).toEqual([[312, 50_000, '']])
  })

  it('실방송 황소개구리: 번호 앞 따로 든 이름(한 번)도, 등록 뒤 다음 결과의 이름도 그 상품으로', async () => {
    const h = await ready()
    say('자 황소개구리 보세요')
    at(3_000)
    say('346번 자 요 아이 10 5만 원')
    expect(reg(h)).toEqual([[346, 150_000, '황소개구리']])
    const g = await ready()
    say('359번 자 요 아이는 50만 원')
    expect(reg(g)).toEqual([[359, 500_000, '']])
    finishAll(g)
    at(2_000)
    say('에스텔 색금이에요')
    at(5_000)
    await settle()
    expect(g.fixes).toEqual([{ id: 'b1:359', changes: { name: '에스텔색금' } }])
  })

  it('실방송 적상화: "적상화 … 30 자 요 아이 30만 원"은 30번이 아니고, 다음 "353번 … 30만 원"이 적상화로', async () => {
    const h = await ready()
    say('자 적상화 색상아 이거거 30 자 요 아이 30만 원')
    at(3_000)
    expect(h.registered).toEqual([])
    expect(h.voice.getSnapshot().cards).toEqual([])
    at(11_000)
    say('353번 자 요 아이는 30만 원')
    expect(reg(h)).toEqual([[353, 300_000, '적상화']])
  })

  it('번호만 들은 덩어리의 품종은 기다리던 번호가 가격을 받을 때 함께', async () => {
    const h = await ready()
    say('360번 황소개구리')
    at(3_000)
    say('자 요 아이는 15만 원')
    at(6_000)
    expect(reg(h)).toEqual([[360, 150_000, '황소개구리']])
  })
})

describe("번호 흐름 밖의 '번' 없는 수 · 가격 되풀이 (실방송 50번·25번·13번)", () => {
  it('3xx를 팔던 중 "얼마 드릴까 50 … 10만 원"·"너무예쁜데 25 자 25만 원"·"13 자 13만원"은 등록·카드·기다리는 번호 없음', async () => {
    const h = await ready()
    say('343번 2만 원')
    at(3_000)
    say('349번 2만 원')
    at(6_000)
    finishAll(h)
    for (const [i, text] of ['자 요거 요거는 뭐야 색금이네요 색금 색금 자 요거 얼마 드릴까 50 자 요거 일단 5cm로 해 가지고 10만 원', '자 요거 5.5cm요 너무예쁜데 25 자 25만 원', '13 자 13만원', '자 51 10만 원'].entries()) {
      at(9_000 + i * 3_000)
      say(text)
    }
    at(30_000)
    expect(h.registered.map((item) => item.no)).toEqual([343, 349])
    expect(h.voice.getSnapshot().cards).toEqual([])
  })
})

describe('방송 처음 (최근 등록 맥락 없음) — 실방송 10:05 15번', () => {
  it('"… 15 응 이모 … 자 15만 원"은 등록하지 않고, "390 5번입니다 자 요 아이는 15만 원"만 395번 150,000원', async () => {
    const h = await ready()
    say('입성 좋습니다 자 요 8cm 나와요 15 응 이모 그렇게밖에 안 한다고요 착하게 들이라며 자 15만 원')
    at(3_000)
    expect(h.registered).toEqual([])
    at(11_000)
    say('390 5번입니다 자 요 아이는 15만 원')
    at(14_000)
    expect(reg(h)).toEqual([[395, 150_000, '']])
    expect(h.voice.getSnapshot().cards).toEqual([])
  })
})

describe('같은 번호 가격 고침 문턱 (실방송 333번: 35만 원을 33만·30만으로 고쳤다)', () => {
  it('35만 원 등록 뒤 "33만 원"·"30만 원"을 한 번씩 들으면 고치지 않고 묻기만 — 가격은 350,000원 그대로', async () => {
    const h = await ready()
    say('자 요거는 6.43cm 정도 얘는 30원 자 35만 원 얘는 금발이 너무 잘 나왔죠 자 몽골이 색금입니다 몽골이 색금 333번')
    at(3_000)
    expect(reg(h)).toEqual([[333, 350_000, '몽고리색금']])
    finishAll(h)
    await settle()
    at(5_000)
    say('333번 자 요 아이는 33만 원')
    at(8_000)
    await settle()
    at(17_000)
    say('333번 자 요 아이는 30만 원')
    at(20_000)
    await settle()
    expect(h.fixes).toEqual([])
    expect(h.board.get(333)?.price).toBe(350_000)
    const asks = h.voice.getSnapshot().offers.filter((offer) => offer.kind === 'offer' && offer.stage === 'ask' && offer.no === 333)
    expect(asks.length).toBeGreaterThan(0)
    expect(h.voice.getSnapshot().log.some((entry) => (entry.reason ?? '').startsWith('고침 후보'))).toBe(true)
  })

  it('정정 낱말이 있거나 다른 조각에서 같은 새 가격을 두 번 들으면 고친다', async () => {
    const h = await ready()
    h.board.set(333, { key: 'b1:333', name: '', price: 350_000, claimCount: 0, closed: false, status: 'OPEN' })
    say('333번 33만 원')
    at(3_000)
    await settle()
    expect(h.fixes).toEqual([])
    say('333번 33만 원')
    at(6_000)
    await settle()
    expect(h.fixes).toEqual([{ id: 'b1:333', changes: { price: 330_000 } }])
  })
})

describe('정정 낱말이 든 같은 번호 가격 (TD-V3-012·013, D-V3-83 (가))', () => {
  /** 65번 30,000원을 음성으로 등록하고 마친 뒤 30초 */
  async function registered65(): Promise<Harness> {
    const h = await ready()
    say('65번 3만 원')
    at(2_000)
    finishAll(h)
    await settle()
    at(30_000)
    return h
  }
  const fixedCards = (h: Harness, no: number) => h.voice.getSnapshot().offers.filter((offer) => offer.kind === 'offer' && offer.stage !== 'ask' && offer.no === no)

  it.each(['65번 아니 5만 원', '65번 다시 5만 원', '65번 아니요 5만 원', '아니 65번 5만 원', '잘못 말했어요 65번 5만 원', '다시 65번 5만 원'])(
    '"%s"(최종만) → 65번을 50,000원으로 바로 고침 하나, 새 등록 없음',
    async (text) => {
      const h = await registered65()
      say(text)
      await settle()
      at(36_000)
      await settle()
      expect(reg(h)).toEqual([[65, 30_000, '']])
      expect(h.fixes).toEqual([{ id: 'b1:65', changes: { price: 50_000 } }])
      expect(fixedCards(h, 65)).toHaveLength(1)
    },
  )

  it('"65번 말고 5만 원"은 애매해 이 길로 바로 고치지 않는다 (덩어리 끝의 옛 판단 그대로)', async () => {
    const h = await registered65()
    say('65번 말고 5만 원')
    await settle()
    expect(h.fixes).toEqual([])
  })

  it('정정 낱말이 있어도 없는 번호는 새로 등록하지 않는다 ("66번 아니 5만 원")', async () => {
    const h = await registered65()
    say('66번 아니 5만 원')
    at(36_000)
    await settle()
    expect(reg(h)).toEqual([[65, 30_000, '']])
    expect(h.fixes).toEqual([])
  })

  it('낱말 하나씩 "65번 6만 원 말고 7만 원" → 고침 쓰기 하나(70,000원), 되돌리기 전 값은 고치기 전 가격', async () => {
    const h = await ready()
    h.board.set(65, { key: 'b1:65', name: '', price: 60_000, claimCount: 0, closed: false, status: 'OPEN' })
    const words = '65번 6만 원 말고 7만 원'.split(' ')
    let t = 0
    for (let i = 1; i <= words.length; i++) {
      at(t)
      say(words.slice(0, i).join(' '), false)
      t += 200
    }
    at(t)
    say(words.join(' '))
    await settle()
    at(t + 5_000)
    await settle()
    expect(h.fixes).toEqual([{ id: 'b1:65', changes: { price: 70_000 } }])
    expect(fixedCards(h, 65)).toHaveLength(1)
  })
})
