// 실방송 금화다육 251번 (정답 BTS 30,000원): 번호 없는 가격(R-17 8 6a)으로 이어 받은 등록의 품종은 앞 말 맥락(R-17 8 1b)으로.
// 판매자 말 "3만 원에 드리라고요 자 BTS 완전 무지보다 더 좋은 가격 나왔는데요 251번" — 굳은 중간 글(D-V3-80)로 앞이 먼저 넘어가 덩어리가 둘로 갈리고,
// 번호만 든 "251번" 덩어리가 맥락을 비운 뒤 이어 받아 등록해 품종이 비었다.
// 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계.
import * as voiceModule from '@livejjim/voice'
import type { SuggestionCard, VoiceSettings } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceController, type ExistingView, type VoiceHost } from '../../src/controller/controller.ts'

const T0 = Date.UTC(2026, 9, 26, 8, 48, 0)

class FakeRecognition {
  static readonly all: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  onaudiostart: (() => void) | null = null
  aborts = 0
  results: { isFinal: boolean; length: number; 0: { transcript: string } }[] = []
  constructor() {
    FakeRecognition.all.push(this)
  }
  start(): void {}
  stop(): void {}
  abort(): void {
    this.aborts++
  }
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

const INTRO = '3만 원에 드리라고요 자 BTS 완전 무지보다 더 좋은 가격 나왔는데요'

describe('AC-V3-85 (d) 번호 없는 가격 다음 번호만 — 이어 받은 등록의 품종은 그 앞 말에서 (실방송 251번)', () => {
  it('최종 "3만 원에 … BTS … 나왔는데요" 다음 최종 "251번" → 251번 30,000원 BTS', async () => {
    const h = await ready()
    say(INTRO)
    at(800)
    say('251번')
    at(6_000)
    await settle()
    expect(reg(h)).toEqual([[251, 30_000, 'BTS']])
    expect(h.voice.getSnapshot().log.some((entry) => entry.action === 'create' && entry.reason === '이어 받음')).toBe(true)
  })

  it('한 결과의 중간 글이 굳어 갈려도 같다: 앞 낱말이 1초 넘게 그대로라 먼저 넘어가고 최종엔 "251번"만 남음 → BTS', async () => {
    const h = await ready()
    // 실방송 받아쓰기 차례 (0:23:16~0:23:23)
    const words = [...INTRO.split(' '), '251번']
    let t = 0
    for (let i = 1; i <= words.length; i++) {
      at(t)
      say(words.slice(0, i).join(' '), false)
      t += 300
    }
    at(t + 1_500)
    say(words.join(' '))
    at(t + 8_000)
    await settle()
    expect(reg(h)).toEqual([[251, 30_000, 'BTS']])
  })

  it('번호·가격은 그대로다: 앞 말에 사전 이름이 없으면 품종 미입력', async () => {
    const h = await ready()
    say('3만 원에 드리라고요 자 완전 무지보다 더 좋은 가격 나왔는데요')
    at(800)
    say('251번')
    at(6_000)
    await settle()
    expect(reg(h)).toEqual([[251, 30_000, '']])
  })

  it('앞 상품 말의 이름(1점)은 넘어오지 않는다: "250번 청개구리 2만 원 자 청개구리" 다음 "3만 원" · "251번" → 품종 미입력', async () => {
    const h = await ready()
    say('250번 청개구리 2만 원 자 청개구리')
    at(3_000)
    finishAll(h)
    await settle()
    at(8_000)
    say('자 요것도 3만 원에 드려 볼게요')
    at(8_800)
    say('251번')
    at(14_000)
    await settle()
    expect(reg(h)).toEqual([
      [250, 20_000, '청개구리'],
      [251, 30_000, ''],
    ])
  })
})

/** 낱말을 하나씩 300ms마다 더하는 한 크롬 결과의 중간 글 — 마지막 낱말을 낸 시각을 돌려준다 */
function speakInterim(text: string, from: number): number {
  const words = text.split(' ')
  let t = from
  for (let i = 1; i <= words.length; i++) {
    t = from + (i - 1) * 300
    at(t)
    say(words.slice(0, i).join(' '), false)
  }
  return t
}

/** 멈춤 지킴이: 결과 없이 STALL_MS가 지나 지금 객체를 닫고(abort) 새 객체를 연다 — 닫힌 객체의 끝(end)이 오면 남은 중간 글이 끝에서 넘긴 글이 된다 */
function stallAndEnd(last: number): void {
  const old = FakeRecognition.last
  at(last + voiceModule.STALL_MS + 10)
  expect(old.aborts).toBe(1)
  expect(FakeRecognition.last).not.toBe(old)
  old.onend?.()
}

const SPOKEN = '3만 원에 드리라고요 자 BTS 이렇게 예쁘게 나왔는데요'

describe('AC-V3-85 같은 크롬 결과에서 갈린 덩어리의 맥락 품종 (D-V3-93, 실방송 금화다육 251번)', () => {
  it('(a) 녹음 그대로: 한 결과의 앞부분이 굳은 글로 넘어가고 멈춤 지킴이가 닫아 남은 "251번"이 끝에서 넘긴 글 → 다음 "3만 원 자 251번"은 251번 · BTS · 30,000원 하나', async () => {
    const h = await ready()
    FakeRecognition.last.onaudiostart?.()
    const last = speakInterim(`${SPOKEN} 251번`, 0)
    stallAndEnd(last)
    await settle()
    // 끝에서 넘긴 "251번"은 바로 등록·이어 받기가 없다 (D-I5-02 그대로)
    expect(h.registered).toEqual([])
    const log = h.voice.getSnapshot().log
    expect(log.some((entry) => entry.pieces.length === 1 && entry.pieces[0]?.text === '251번' && entry.pieces[0].flushedAtEnd)).toBe(true)
    at(last + 6_000)
    FakeRecognition.last.onaudiostart?.()
    say('3만 원 자 251번')
    at(last + 10_000)
    await settle()
    expect(reg(h)).toEqual([[251, 30_000, 'BTS']])
    expect(h.registered).toHaveLength(1)
    expect(h.fixes).toEqual([])
  })

  it('(b) 앞 말이 그 앞 결과의 최종이고 "251번"은 다른 결과의 끝에서 넘긴 글 → 지금처럼 비움: 251번 · 품종 빈칸 · 30,000원', async () => {
    const h = await ready()
    FakeRecognition.last.onaudiostart?.()
    say(SPOKEN)
    at(1_000)
    say('251번', false)
    stallAndEnd(1_000)
    await settle()
    expect(h.registered).toEqual([])
    at(7_000)
    FakeRecognition.last.onaudiostart?.()
    say('3만 원 자 251번')
    at(11_000)
    await settle()
    expect(reg(h)).toEqual([[251, 30_000, '']])
    expect(h.fixes).toEqual([])
  })

  it('(c) 굳은 앞부분에 다른 번호가 있으면(번호 든 앞 덩어리) 그 이름은 251번 맥락에 남지 않는다 → 품종 빈칸', async () => {
    const h = await ready()
    FakeRecognition.last.onaudiostart?.()
    const last = speakInterim('250번 자 BTS 이렇게 예쁘게 나왔는데요 251번', 0)
    stallAndEnd(last)
    await settle()
    at(last + 6_000)
    FakeRecognition.last.onaudiostart?.()
    say('3만 원 자 251번')
    at(last + 10_000)
    await settle()
    expect(reg(h)).toEqual([[251, 30_000, '']])
    expect(h.fixes).toEqual([])
  })

  it('(a) 같은 결과여도 최종으로 온 남은 글 "251번"은 그 안에서 이어 받아 등록 — 251번 · BTS · 30,000원 하나 (쓰기 수 그대로)', async () => {
    const h = await ready()
    const last = speakInterim(`${SPOKEN} 251번`, 0)
    at(last + 1_500)
    say(`${SPOKEN} 251번`)
    at(last + 8_000)
    await settle()
    say('3만 원 자 251번')
    at(last + 12_000)
    await settle()
    expect(reg(h)).toEqual([[251, 30_000, 'BTS']])
    expect(h.fixes).toEqual([])
  })
})
