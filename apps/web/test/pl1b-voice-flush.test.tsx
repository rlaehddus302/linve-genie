// PL1B 끝에서 넘긴 문자찜 카드 시험 (VOC-04, D-I5-20·D-I5-09·D-I5-10·D-V1-18, AC-PL1B-23~25 — 동작 변경 없음, 시험만):
// SRV1 (D-APP-23·24): 읽기 함수는 서버 전용 자리(packages/voice-session/src/read)로 옮겼다 — 기대값은 그대로, 서버 읽기 함수를 본다.
// 실제 음성 모듈 + 가짜 인식 객체(최종 표시 없이 끝나는 중간 결과 = 사파리 끝 넘김) + 가짜 시계. 쓰기는 가짜 host.writeSms가 받는다.
import * as voiceModule from '@livejjim/voice'
import { act, cleanup, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceLive } from '../src/components/VoicePanel.tsx'
import { readReceived } from '../../../packages/voice-session/src/read/index.ts'
import { VoiceController, smsShown, type SmsEntry, type VoiceHost, type VoiceSmsWrite } from '../../../packages/voice-session/src/controller/controller.ts'

/** 2026-10-23 20:01:00 KST */
const T0 = Date.UTC(2026, 9, 23, 11, 1, 0)
const SMS = '15번 문자찜 끝자리 1234'

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
  /** 사파리: 중간 결과 뒤 최종 표시 없이 끝난다 → 끝에서 넘긴 결과(flushedAtEnd) */
  sayCut(text: string): void {
    this.say(text, false)
    this.onend?.()
  }
  static get last(): FakeRecognition {
    const last = FakeRecognition.all.at(-1)
    if (last === undefined) throw new Error('인식 객체가 없다')
    return last
  }
}

interface Harness {
  readonly voice: VoiceController
  readonly sent: { readonly write: VoiceSmsWrite; readonly requestId: string }[]
  smsSettings: unknown
}

function harness(): Harness {
  let seq = 100
  let request = 1
  const state = { sent: [] as Harness['sent'], smsSettings: null as unknown }
  const products = new Map([[15, { state: 'OPEN' as const, waitlistFull: false }]])
  const host: VoiceHost = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    currentNames: () => [],
    products: () => new Map(),
    fetchHistory: async () => [],
    dialogOpen: () => false,
    readConsent: () => true,
    writeConsent: () => {},
    readSettings: () => null,
    writeSettings: () => {},
    register: () => {},
    focusQuick: () => {},
    smsReadOptions: () => ({ parseMode: 'STRICT', maxNumber: 999 }),
    smsProduct: (no) => products.get(no) ?? null,
    smsProductName: () => null,
    readSmsTime: (time, now) => {
      const read = readReceived(time, now)
      return read.kind === 'ok' ? { value: read.value, late: read.late } : null
    },
    writeSms: async (write, _received, requestId) => {
      state.sent.push({ write, requestId })
      return { kind: 'ok', seq: seq++, buyer: 'sms:new' }
    },
    newRequestId: () => `req-${String(request++)}`,
    readSmsSettings: () => state.smsSettings,
    writeSmsSettings: () => {},
  }
  return Object.assign(state, { voice: new VoiceController(host) }) as Harness
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

async function turnOn(h: Harness): Promise<void> {
  await h.voice.turnOn()
  await settle()
}

async function wait(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  await settle()
}

const shown = (h: Harness): SmsEntry[] => h.voice.getSnapshot().sms.filter(smsShown)

function only(h: Harness): SmsEntry {
  const list = shown(h)
  expect(list).toHaveLength(1)
  return list[0] as SmsEntry
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  FakeRecognition.all.length = 0
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('끝에서 넘긴 문자찜 카드는 저절로 넣지 않는다 (AC-PL1B-23, D-I5-20)', () => {
  it('(a) 끝 넘김 "15번 문자찜 끝자리 1234" → 문자찜 카드, "N초 뒤 넣어요" 없음, 30초가 지나도 쓰기 0번 — "넣기"면 쓰기 1번', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.sayCut(SMS)
    const entry = only(h)
    expect(h.voice.getSnapshot().cards).toHaveLength(0)
    expect(h.voice.describeSms(entry.card)).toContain('15번 · 끝자리 1234 · 문자찜')
    expect(entry.card.autoAt).toBeNull()
    expect(h.voice.smsCountdown(entry)).toBeNull()
    await wait(30_000)
    expect(h.sent).toHaveLength(0)
    expect(h.voice.smsCountdown(only(h))).toBeNull()
    h.voice.smsSend(only(h).card.id)
    await settle()
    expect(h.sent.map((one) => one.write)).toEqual([{ no: 15, qty: 1, memo: null, last4: '1234', time: null }])
  })

  it('(a) "넣지 않기"면 쓰기 0번', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.sayCut(SMS)
    h.voice.smsSkip(only(h).card.id)
    await wait(30_000)
    expect(h.sent).toHaveLength(0)
    expect(shown(h)).toHaveLength(0)
  })

  it('(b) 대조군: 같은 문장이 보통 최종 결과로 오면 "3초 뒤 넣어요", 3초 뒤 쓰기 1번 — (a)의 차이는 끝 넘김 표시뿐이다', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say(SMS)
    expect(h.voice.smsCountdown(only(h))).toBe('3초 뒤 넣어요')
    await wait(2999)
    expect(h.sent).toHaveLength(0)
    await wait(1)
    expect(h.sent.map((one) => [one.write.no, one.write.last4])).toEqual([[15, '1234']])
    // 끝 넘김만 다른 같은 시나리오는 30초에도 0번 (미루기를 없애면 (a)가 실패한다)
    const cut = harness()
    await turnOn(cut)
    FakeRecognition.last.sayCut(SMS)
    await wait(30_000)
    expect(cut.sent).toHaveLength(0)
  })

  it('같은 말 검사는 (a)·(b)가 같다 — 끝 넘김 뒤 같은 말을 다시 하면 앞 카드에 표시(카드 하나, 저절로 넣지 않음)', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.sayCut(SMS)
    await wait(2000)
    FakeRecognition.last.say(SMS)
    expect(only(h).card.repeats).toBe(1)
    await wait(30_000)
    expect(h.sent).toHaveLength(0)

    const normal = harness()
    await turnOn(normal)
    FakeRecognition.last.say(SMS)
    await wait(1000)
    FakeRecognition.last.sayCut(SMS)
    expect(only(normal).card.repeats).toBe(1)
    await wait(5000)
    expect(normal.sent).toHaveLength(1)
  })

  it('열린 카드 수 규칙은 (a)·(b)가 같다 — 문자찜 카드 + 상품 카드 셋이면 손대지 않은 상품 카드 하나가 닫히고 문자찜 카드는 남는다', async () => {
    const shape = async (cut: boolean) => {
      const h = harness()
      h.smsSettings = { 'voice.smsAutoSec': 10 }
      await turnOn(h)
      if (cut) FakeRecognition.last.sayCut(SMS)
      else FakeRecognition.last.say(SMS)
      for (const no of [21, 22, 23]) {
        await wait(10)
        FakeRecognition.last.say(`${String(no)}번 라울 이만원`)
      }
      // V2: 마지막 최종 결과는 조용한 시간(1.8초)이 지나야 카드가 된다 (D-V2-03)
      await wait(1800)
      const snapshot = h.voice.getSnapshot()
      return { cards: snapshot.cards.map((card) => card.no), sms: shown(h).map((entry) => entry.card.status), dropped: snapshot.smsDropped }
    }
    const cutShape = await shape(true)
    expect(cutShape).toEqual({ cards: [23, 22], sms: ['OPEN'], dropped: [] })
    expect(await shape(false)).toEqual(cutShape)
  })
})

describe('밀려 닫힘 알림은 끝에서 넘긴 상품 카드만 (AC-PL1B-24, D-I5-09·D-V1-18)', () => {
  it('넘긴 상품 카드가 밀려 닫히면 "알겠어요"까지 남는 알림에 쌓이고, 넘긴 문자찜 카드는 닫히지 않아 알림에 없다', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.sayCut('21번 핑크프릴 만오천원')
    await wait(10)
    FakeRecognition.last.sayCut(SMS)
    await wait(10)
    FakeRecognition.last.say('22번 라울 이만원')
    expect(h.voice.getSnapshot().flushedClosed).toEqual([])
    await wait(10)
    FakeRecognition.last.say('23번 라울 이만원')
    // V2: 마지막 최종 결과는 조용한 시간(1.8초)이 지나야 카드가 된다 (D-V2-03)
    await wait(1800)
    // 넷째 카드: 넘긴 상품 카드(21번)가 밀려 닫힌다 — 알림
    expect(h.voice.getSnapshot().cards.map((card) => card.no)).toEqual([23, 22])
    expect(h.voice.getSnapshot().flushedClosed).toEqual(['21번 핑크프릴 15,000원 — 등록할까요?'])
    for (const no of [24, 25, 26]) {
      await wait(10)
      FakeRecognition.last.say(`${String(no)}번 라울 이만원`)
    }
    await wait(1800)
    const snapshot = h.voice.getSnapshot()
    // 보통 상품 카드는 알림 없이 닫히고, 넘긴 문자찜 카드는 그대로 열려 있다
    expect(snapshot.flushedClosed).toEqual(['21번 핑크프릴 15,000원 — 등록할까요?'])
    expect(snapshot.flushedClosed.some((text) => text.includes('문자찜') || text.includes('1234'))).toBe(false)
    expect(snapshot.smsDropped).toEqual([])
    expect(only(h).card.status).toBe('OPEN')
    expect(snapshot.cards.map((card) => card.no)).toEqual([26, 25])
    h.voice.dismissFlushedClosed()
    expect(h.voice.getSnapshot().flushedClosed).toEqual([])
    await wait(30_000)
    expect(h.sent).toHaveLength(0)
  })
})

describe('휴대폰에서 맨 앞 문자찜 카드가 보이게 (AC-PL1B-25, D-I5-10)', () => {
  function Live({ voice }: { readonly voice: VoiceController }) {
    const snapshot = useSyncExternalStore(voice.subscribe, voice.getSnapshot)
    return <VoiceLive voice={voice} snapshot={snapshot} badge={null} onSubmitForm={() => {}} onRegister={() => {}} />
  }

  /** 카드가 화면 아래(메뉴 밑)에 있어 내려야 보인다 — 내리기(scrollBy)를 센다 */
  function phone(wide: boolean): ReturnType<typeof vi.fn> {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: wide, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 700, bottom: 900, left: 0, right: 375, width: 375, height: 200, x: 0, y: 700, toJSON: () => ({}) } as DOMRect)
    const scroll = vi.fn()
    vi.stubGlobal('scrollBy', scroll)
    return scroll
  }

  it.each([
    ['끝에서 넘긴', true],
    ['보통', false],
  ])('375px: 맨 앞에 새 %s 문자찜 카드가 생기면 내리기가 한 번', async (_name, cut) => {
    const scroll = phone(false)
    const h = harness()
    render(<Live voice={h.voice} />)
    await act(async () => {
      await turnOn(h)
    })
    expect(scroll).not.toHaveBeenCalled()
    act(() => {
      if (cut) FakeRecognition.last.sayCut(SMS)
      else FakeRecognition.last.say(SMS)
    })
    expect(scroll).toHaveBeenCalledTimes(1)
  })

  it('PC 폭이면 내리지 않는다', async () => {
    const scroll = phone(true)
    const h = harness()
    render(<Live voice={h.voice} />)
    await act(async () => {
      await turnOn(h)
    })
    act(() => FakeRecognition.last.sayCut(SMS))
    expect(shown(h)).toHaveLength(1)
    expect(scroll).not.toHaveBeenCalled()
  })

  it('고치는 칸이 열려 있으면 내리지 않는다', async () => {
    const scroll = phone(false)
    const h = harness()
    render(<Live voice={h.voice} />)
    await act(async () => {
      await turnOn(h)
    })
    act(() => FakeRecognition.last.say('21번 라울 이만원'))
    // V2: 최종 결과는 조용한 시간(1.8초)이 지나야 카드가 된다 (D-V2-03)
    await act(async () => {
      await wait(1800)
    })
    expect(scroll).toHaveBeenCalledTimes(1)
    act(() => h.voice.openForm(h.voice.getSnapshot().cards[0]?.id ?? ''))
    expect(h.voice.getSnapshot().forms.size).toBe(1)
    await act(async () => {
      await wait(10)
    })
    act(() => FakeRecognition.last.sayCut(SMS))
    expect(shown(h)).toHaveLength(1)
    expect(scroll).toHaveBeenCalledTimes(1)
  })
})
