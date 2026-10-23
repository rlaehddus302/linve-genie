// 음성 문자찜 컨트롤러 (V1 AC-V1-20~28, VOC-04 문자찜 카드, D-V1-03~09) — 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계.
// 쓰기는 가짜 host.writeSms가 받는다(본문 칸·요청 번호·받은 시각을 검사). 화면(E2E)은 tests/e2e/v1(test-e2e 몫).
import * as voiceModule from '@livejjim/voice'
import type { SmsProductView, SmsVoiceSettings, SmsWrite } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readReceived } from '../src/lib/received.ts'
import { SMS_RESULTS_SHOWN, SMS_SEND_FAILED, VoiceController, pruneSms, smsDroppedText, smsShown, type SmsEntry, type SmsWriteOutcome, type VoiceHost } from '../src/voice/controller.ts'

/** 2026-10-23 20:01:00 KST */
const T0 = Date.UTC(2026, 9, 23, 11, 1, 0)

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
  say(text: string): void {
    this.results.push({ isFinal: true, length: 1, 0: { transcript: text } })
    this.onresult?.({ resultIndex: this.results.length - 1, results: this.results })
  }
  static get last(): FakeRecognition {
    const last = FakeRecognition.all.at(-1)
    if (last === undefined) throw new Error('인식 객체가 없다')
    return last
  }
}

interface Sent {
  readonly write: SmsWrite
  readonly received: string | null
  readonly requestId: string
}

interface Harness {
  readonly voice: VoiceController
  readonly sent: Sent[]
  readonly products: Map<number, SmsProductView>
  smsSettings: unknown
  readonly writtenSms: SmsVoiceSettings[]
  dialog: boolean
  /** 다음 쓰기의 결과 (비우면 ok) */
  readonly outcomes: (SmsWriteOutcome | Error)[]
  registered: number
}

function harness(patch: Partial<VoiceHost> = {}): Harness {
  let seq = 100
  let request = 1
  const state = {
    sent: [] as Sent[],
    products: new Map<number, SmsProductView>([[165, { state: 'OPEN', waitlistFull: false }]]),
    smsSettings: null as unknown,
    writtenSms: [] as SmsVoiceSettings[],
    dialog: false,
    outcomes: [] as (SmsWriteOutcome | Error)[],
    registered: 0,
  }
  const host: VoiceHost = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    currentNames: () => [],
    products: () => new Map(),
    fetchHistory: async () => [],
    dialogOpen: () => state.dialog,
    readConsent: () => true,
    writeConsent: () => {},
    readSettings: () => null,
    writeSettings: () => {},
    register: () => {
      state.registered++
    },
    focusQuick: () => {},
    smsReadOptions: () => ({ parseMode: 'STRICT', maxNumber: 999 }),
    smsProduct: (no) => state.products.get(no) ?? null,
    smsProductName: () => null,
    readSmsTime: (time, now) => {
      const read = readReceived(time, now)
      return read.kind === 'ok' ? { value: read.value, late: read.late } : null
    },
    writeSms: async (write, received, requestId) => {
      state.sent.push({ write, received, requestId })
      const next = state.outcomes.shift()
      if (next instanceof Error) throw next
      return next ?? { kind: 'ok', seq: seq++, buyer: 'sms:new' }
    },
    newRequestId: () => `req-${String(request++)}`,
    readSmsSettings: () => state.smsSettings,
    writeSmsSettings: (settings) => {
      state.writtenSms.push(settings)
    },
    ...patch,
  }
  const voice = new VoiceController(host)
  return Object.assign(state, { voice }) as unknown as Harness
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

async function turnOn(h: Harness): Promise<void> {
  await h.voice.turnOn()
  await settle()
}

/** 시계를 당기고 그 사이 쓰기 응답(약속)도 끝낸다 */
async function wait(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  await settle()
}

function only(h: Harness): SmsEntry {
  const shown = h.voice.getSnapshot().sms.filter(smsShown)
  expect(shown).toHaveLength(1)
  return shown[0] as SmsEntry
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

describe('문자찜도 듣기·설정 (AC-V1-20, D-V1-09)', () => {
  it('기본은 듣기 켬·3초, 깨진 저장값은 기본값', async () => {
    const h = harness()
    h.smsSettings = { 'voice.smsListen': 'yes', 'voice.smsAutoSec': 99 }
    await turnOn(h)
    expect(h.voice.getSnapshot().smsSettings).toEqual({ 'voice.smsListen': true, 'voice.smsAutoSec': 3 })
    expect(h.voice.getSnapshot().smsSecondsText).toBe('3')
  })

  it('끄면 문자찜 문장은 어떤 카드도 만들지 않는다(상품 카드도) — 저장한다', async () => {
    const h = harness()
    await turnOn(h)
    h.voice.setSmsListen(false)
    expect(h.writtenSms.at(-1)).toEqual({ 'voice.smsListen': false, 'voice.smsAutoSec': 3 })
    FakeRecognition.last.say('15번 핑크프릴 만원 문자찜')
    expect(h.voice.getSnapshot().sms).toHaveLength(0)
    expect(h.voice.getSnapshot().cards).toHaveLength(0)
    await wait(10_000)
    expect(h.sent).toHaveLength(0)
  })

  it('초 칸: 0~10 정수만 저장, 아니면 문장을 보이고 값은 그대로', async () => {
    const h = harness()
    await turnOn(h)
    h.voice.setSmsSeconds('11')
    expect(h.voice.getSnapshot().smsSettingsProblem).toContain('0초부터 10초까지')
    expect(h.voice.getSnapshot().smsSettings?.['voice.smsAutoSec']).toBe(3)
    h.voice.setSmsSeconds('0')
    expect(h.voice.getSnapshot().smsSettingsProblem).toBeNull()
    expect(h.writtenSms.at(-1)).toEqual({ 'voice.smsListen': true, 'voice.smsAutoSec': 0 })
  })

  it('문자찜 쓰기가 없는 화면이면 문자찜 문장은 카드를 만들지 않는다', async () => {
    const h = harness({ writeSms: undefined })
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    expect(h.voice.getSnapshot().sms).toHaveLength(0)
    expect(h.voice.getSnapshot().cards).toHaveLength(0)
  })
})

describe('기본 흐름 (AC-V1-21·22)', () => {
  it('"165번 문자찜 끝자리 1234" → 문자찜 카드(상품 카드 없음), 3초 뒤 쓰기 한 번 → 결과', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    const entry = only(h)
    expect(h.voice.getSnapshot().cards).toHaveLength(0)
    expect(h.voice.describeSms(entry.card)).toBe('165번 · 끝자리 1234 · 문자찜')
    expect(h.voice.smsCountdown(entry)).toBe('3초 뒤 넣어요')
    await wait(1000)
    expect(h.voice.smsCountdown(only(h))).toBe('2초 뒤 넣어요')
    await wait(1999)
    expect(h.sent).toHaveLength(0)
    await wait(1)
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]?.write).toEqual({ no: 165, qty: 1, memo: null, last4: '1234', time: null })
    expect(h.sent[0]?.received).toBeNull()
    const done = only(h)
    expect(done.card.status).toBe('SENT')
    expect(done.sending).toBe(false)
    expect(done.results).toEqual([{ no: 165, seq: 100, buyer: 'sms:new' }])
    await wait(20_000)
    expect(h.sent).toHaveLength(1)
    // 결과 카드는 남는다 (찜 취소하기)
    expect(only(h).card.status).toBe('SENT')
  })

  it('"넣지 않기" → 닫히고 10초 뒤까지 쓰기 0번', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    h.voice.smsSkip(only(h).card.id)
    expect(h.voice.getSnapshot().sms.filter(smsShown)).toHaveLength(0)
    await wait(10_000)
    expect(h.sent).toHaveLength(0)
  })

  it('"지금 넣기" → 바로 한 번, 기다림 0 → 만들자마자', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    h.voice.smsSend(only(h).card.id)
    await settle()
    expect(h.sent).toHaveLength(1)
    await wait(5000)
    expect(h.sent).toHaveLength(1)

    const z = harness()
    z.smsSettings = { 'voice.smsAutoSec': 0 }
    await turnOn(z)
    FakeRecognition.last.say('165번 문자찜 끝자리 5678')
    await wait(0)
    expect(z.sent).toHaveLength(1)
  })

  it('번호 둘 → 저절로 넣지 않고, "넣기"면 주문마다 쓰기(요청 번호 다름)', async () => {
    const h = harness()
    h.products.set(15, { state: 'OPEN', waitlistFull: false })
    h.products.set(28, { state: 'OPEN', waitlistFull: false })
    await turnOn(h)
    FakeRecognition.last.say('15번 28번 문자찜 끝자리 1234')
    const entry = only(h)
    expect(h.voice.describeSms(entry.card)).toBe('15번 · 28번 · 끝자리 1234 · 문자찜 — 넣을까요?')
    expect(h.voice.smsCountdown(entry)).toBeNull()
    await wait(10_000)
    expect(h.sent).toHaveLength(0)
    h.voice.smsSend(entry.card.id)
    await settle()
    expect(h.sent.map((s) => s.write.no)).toEqual([15, 28])
    expect(new Set(h.sent.map((s) => s.requestId)).size).toBe(2)
    expect(only(h).results.map((line) => line.no)).toEqual([15, 28])
  })

  it('창이 열린 동안 기다림이 끝나면 보내지 않고, 닫힌 뒤 다시 보고 보낸다', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    h.dialog = true
    await wait(5000)
    expect(h.sent).toHaveLength(0)
    h.dialog = false
    h.voice.refresh()
    await settle()
    expect(h.sent).toHaveLength(1)
  })

  it('음성을 끄면 기다리던 카드는 남고 저절로 넣지 않는다 — 누르면 넣는다', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    h.voice.turnOff()
    await wait(10_000)
    expect(h.sent).toHaveLength(0)
    const entry = only(h)
    expect(entry.card.autoAt).toBeNull()
    h.voice.smsSend(entry.card.id)
    await settle()
    expect(h.sent).toHaveLength(1)
  })
})

describe('넣을 수 없는 경우 (AC-V1-23)', () => {
  const cases: [string, string, (h: Harness) => void][] = [
    ['300번 문자찜', '300번 상품이 없어요.', () => {}],
    ['300번 문자찜', '300번은 지금 판매 중이 아니에요.', (h) => h.products.set(300, { state: 'CLOSED', waitlistFull: false })],
    ['300번 문자찜', '300번은 대기까지 다 찼어요.', (h) => h.products.set(300, { state: 'SOLD', waitlistFull: true })],
    ['165번 문자찜 끝자리 12', '끝자리를 못 알아들었어요. 숫자 네 개로 다시 말해 주세요.', () => {}],
    ['165번 문자찜 취소', '음성으로는 찜을 취소하지 않아요. 찜 취소는 화면에서 해 주세요.', () => {}],
  ]
  for (const [text, message, prepare] of cases) {
    it(`"${text}" → "${message}"·닫기만·쓰기 없음`, async () => {
      const h = harness()
      prepare(h)
      await turnOn(h)
      FakeRecognition.last.say(text)
      const entry = only(h)
      expect(entry.reason).toBe(message)
      expect(h.voice.smsCountdown(entry)).toBeNull()
      h.voice.smsSend(entry.card.id)
      await wait(10_000)
      expect(h.sent).toHaveLength(0)
      h.voice.smsSkip(entry.card.id)
      expect(h.voice.getSnapshot().sms.filter(smsShown)).toHaveLength(0)
    })
  }

  it('1등이 찼지만 대기 자리가 있으면 넣는다', async () => {
    const h = harness()
    h.products.set(165, { state: 'SOLD', waitlistFull: false })
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(3000)
    expect(h.sent).toHaveLength(1)
  })

  it('만든 뒤 넣기 직전에 판매 종료되면 보내지 않고 이유 카드로', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    h.products.set(165, { state: 'CLOSED', waitlistFull: false })
    await wait(3000)
    expect(h.sent).toHaveLength(0)
    expect(only(h).reason).toBe('165번은 지금 판매 중이 아니에요.')
  })
})

describe('같은 말 두 번 (AC-V1-24, D-V1-06)', () => {
  it('2초 간격 같은 말 → 카드 하나·쓰기 한 번·"같은 말을 한 번 더 들었어요", 다른 끝자리는 새 카드', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(2000)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    expect(only(h).card.repeats).toBe(1)
    await wait(3000)
    expect(h.sent).toHaveLength(1)
    // 넣은 뒤에도 10초 안이면 같은 말
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    expect(h.voice.getSnapshot().sms.filter(smsShown)).toHaveLength(1)
    FakeRecognition.last.say('165번 문자찜 끝자리 5678')
    expect(h.voice.getSnapshot().sms.filter(smsShown)).toHaveLength(2)
  })

  it('넣지 않기로 닫은 카드도 10초 안 같은 말이면 새 카드가 아니다, 10초 뒤면 새 카드', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    h.voice.smsSkip(only(h).card.id)
    await wait(5000)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    expect(h.voice.getSnapshot().sms.filter(smsShown)).toHaveLength(0)
    await wait(6000)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    expect(h.voice.getSnapshot().sms.filter(smsShown)).toHaveLength(1)
  })
})

describe('고르기·실패 (AC-V1-25, D-V1-03)', () => {
  it('409 → 후보 카드(저절로 넣지 않음), 후보를 누르면 buyer로 한 번 (last4 없음·새 요청 번호)', async () => {
    const h = harness()
    h.outcomes.push({
      kind: 'ambiguous',
      candidates: [
        { buyer: 'sms:a', display: '문자찜', phoneLast4: '1234' },
        { buyer: 'sms:b', display: '문자찜', phoneLast4: '1234' },
      ],
    })
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(3000)
    expect(h.sent).toHaveLength(1)
    const entry = only(h)
    expect(entry.card.status).toBe('OPEN')
    expect(entry.card.candidates?.map((c) => c.buyer)).toEqual(['sms:a', 'sms:b'])
    expect(h.voice.smsWords()?.choose(entry.card.reading.last4)).toBe('끝자리 1234 손님이 여러 명이에요. 누구인지 골라 주세요.')
    await wait(10_000)
    expect(h.sent).toHaveLength(1)
    h.voice.smsChoose(entry.card.id, 'sms:b')
    await settle()
    expect(h.sent).toHaveLength(2)
    expect(h.sent[1]?.write).toEqual({ no: 165, qty: 1, memo: null, buyer: 'sms:b', time: null })
    expect(h.sent[1]?.requestId).not.toBe(h.sent[0]?.requestId)
    expect(only(h).card.status).toBe('SENT')
  })

  it('보내지 못함 → 문장과 함께 다시 열림(저절로 넣지 않음), 다시 누르면 같은 요청 번호', async () => {
    const h = harness()
    h.outcomes.push({ kind: 'failed', message: SMS_SEND_FAILED })
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(3000)
    const entry = only(h)
    expect(entry.error).toBe(SMS_SEND_FAILED)
    expect(entry.card.status).toBe('OPEN')
    expect(entry.card.autoAt).toBeNull()
    await wait(10_000)
    expect(h.sent).toHaveLength(1)
    h.voice.smsSend(entry.card.id)
    await settle()
    expect(h.sent).toHaveLength(2)
    expect(h.sent[1]?.requestId).toBe(h.sent[0]?.requestId)
    expect(only(h).error).toBeNull()
  })

  it('쓰기가 예외를 던져도 카드가 다시 열린다', async () => {
    const h = harness()
    h.outcomes.push(new Error('끊김'))
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(3000)
    expect(only(h).error).toBe(SMS_SEND_FAILED)
  })
})

describe('이름·확인 필요·받은 시각 (AC-V1-26, D-V1-04)', () => {
  it('"김민지님 165번 문자찜" → 메모 김민지, "165번 문자찜" → 메모 확인 필요', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('김민지님 165번 문자찜')
    expect(h.voice.describeSms(only(h).card)).toBe('165번 · 김민지님 · 문자찜')
    await wait(3000)
    expect(h.sent[0]?.write).toEqual({ no: 165, qty: 1, memo: '김민지', time: null })
    FakeRecognition.last.say('165번 문자찜')
    const unknown = h.voice.getSnapshot().sms.find((entry) => entry.card.status === 'OPEN') as SmsEntry
    expect(h.voice.describeSms(unknown.card)).toBe('165번 · 손님 확인 필요 · 문자찜')
    await wait(3000)
    expect(h.sent[1]?.write).toEqual({ no: 165, qty: 1, memo: '확인 필요', time: null })
  })

  it('지금 14:30에 "2시 15분" → 14:15로 저절로, 지금 13:00이면 묻고 저절로 넣지 않음', async () => {
    vi.setSystemTime(Date.UTC(2026, 9, 23, 5, 30, 0))
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 2시 15분')
    expect(h.voice.describeSms(only(h).card)).toBe('165번 · 손님 확인 필요 · 문자찜 · 받은 시각 2:15')
    await wait(3000)
    expect(h.sent[0]?.received).toBe('14:15')

    vi.setSystemTime(Date.UTC(2026, 9, 23, 4, 0, 0))
    const late = harness()
    await turnOn(late)
    FakeRecognition.last.say('165번 문자찜 2시 15분')
    const entry = only(late)
    expect(entry.timeCheck).toBe(true)
    expect(late.voice.smsCountdown(entry)).toBeNull()
    await wait(10_000)
    expect(late.sent).toHaveLength(0)
    late.voice.smsSend(entry.card.id)
    await settle()
    expect(late.sent[0]?.received).toBe('14:15')
  })
})

describe('열린 카드 수·결과 카드 수', () => {
  it('상품 카드와 문자찜 카드를 함께 센다 — 넷째 카드가 오면 가장 오래된 손대지 않은 카드가 닫힌다', async () => {
    const h = harness()
    for (const no of [1, 2, 3]) h.products.set(no, { state: 'OPEN', waitlistFull: false })
    h.smsSettings = { 'voice.smsAutoSec': 10 }
    await turnOn(h)
    FakeRecognition.last.say('1번 문자찜 끝자리 1111')
    await wait(10)
    FakeRecognition.last.say('15번 핑크프릴 만오천 원')
    await wait(10)
    FakeRecognition.last.say('2번 문자찜 끝자리 2222')
    await wait(10)
    FakeRecognition.last.say('3번 문자찜 끝자리 3333')
    const snapshot = h.voice.getSnapshot()
    expect(snapshot.cards).toHaveLength(1)
    expect(snapshot.sms.filter(smsShown).map((entry) => entry.card.reading.orders[0]?.no)).toEqual([3, 2])
    await wait(10_000)
    expect(h.sent.map((s) => s.write.no).sort()).toEqual([2, 3])
  })

  it('결과 카드는 최근 몇 개만 보이고, 닫은 카드는 10초 뒤 목록에서 빠진다', () => {
    const base = voiceModule.createSmsCard({ id: 'x', reading: { orders: [{ no: 1, qty: 1 }], last4: null, name: null, time: null, problem: null }, text: '', createdAt: T0 })
    const entries: SmsEntry[] = Array.from({ length: SMS_RESULTS_SHOWN + 2 }, (_, i) => ({
      card: { ...base, id: `c${String(i)}`, status: 'SENT', createdAt: T0 + 1000 * (10 - i) },
      reason: null,
      timeCheck: false,
      sending: false,
      error: null,
      results: [],
      hidden: false,
    }))
    const pruned = pruneSms(entries, T0 + 5000)
    expect(pruned.filter(smsShown)).toHaveLength(SMS_RESULTS_SHOWN)
    expect(pruneSms(pruned, T0 + 60_000).filter((entry) => entry.hidden)).toHaveLength(0)
  })
})

describe('넣지 않은 채 저절로 닫힌 문자찜 카드 안내 (U-V1-01, D-204·D-I4-02)', () => {
  it('이유 카드가 쌓여 "넣을까요?" 카드가 닫히면 안내가 남고("확인"까지), 이유 카드가 닫힐 때는 남기지 않는다', async () => {
    const h = harness()
    h.products.set(15, { state: 'OPEN', waitlistFull: false })
    h.products.set(28, { state: 'OPEN', waitlistFull: false })
    h.products.set(166, { state: 'OPEN', waitlistFull: false })
    await turnOn(h)
    for (const text of ['15번 28번 문자찜 끝자리 1234', '300번 문자찜', '166번 문자찜 끝자리 12', '166번 문자찜 취소', '문자찜 끝자리 5678']) {
      FakeRecognition.last.say(text)
    }
    const snapshot = h.voice.getSnapshot()
    const shown = snapshot.sms.filter(smsShown)
    expect(shown.every((entry) => entry.reason !== null)).toBe(true)
    expect(snapshot.smsDropped.map((item) => item.text)).toEqual([smsDroppedText('15번 · 28번 · 끝자리 1234 · 문자찜')])
    expect(snapshot.smsDropped[0]?.text).toBe('넣지 않은 문자찜 카드를 닫았어요: 15번 · 28번 · 끝자리 1234 · 문자찜. 넣으려면 다시 말하거나 문자찜 입력에 넣어 주세요.')
    await wait(10_000)
    expect(h.sent).toHaveLength(0)
    // 안내는 시간이 지나도 남는다 — "확인"을 눌러야 지워진다
    const id = snapshot.smsDropped[0]?.id ?? ''
    expect(h.voice.getSnapshot().smsDropped).toHaveLength(1)
    h.voice.smsDroppedSeen(id)
    expect(h.voice.getSnapshot().smsDropped).toEqual([])
  })

  it('기다리던(3초) 문자찜 카드가 새 카드에 밀려 닫혀도 안내가 남고, 보내지 않는다', async () => {
    const h = harness()
    await turnOn(h)
    for (const text of ['165번 문자찜 끝자리 1234', '300번 문자찜', '301번 문자찜', '302번 문자찜']) FakeRecognition.last.say(text)
    expect(h.voice.getSnapshot().smsDropped.map((item) => item.short)).toEqual(['165번 · 끝자리 1234 · 문자찜'])
    await wait(10_000)
    expect(h.sent).toHaveLength(0)
  })

  it('"넣지 않기"로 닫은 카드·넣은 카드는 안내가 없다', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    h.voice.smsSkip(only(h).card.id)
    for (const text of ['300번 문자찜', '301번 문자찜', '302번 문자찜', '303번 문자찜']) FakeRecognition.last.say(text)
    expect(h.voice.getSnapshot().smsDropped).toEqual([])
  })
})
