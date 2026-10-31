// 음성 문자찜 컨트롤러 (V1 AC-V1-20~28, VOC-04 문자찜 카드, D-V1-03~09) — 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계.
// 쓰기는 가짜 host.writeSms가 받는다(본문 칸·요청 번호·받은 시각을 검사). 화면(E2E)은 tests/e2e/v1(test-e2e 몫).
import * as voiceModule from '@livejjim/voice'
import type { SmsProductView, SmsVoiceSettings } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readReceived } from '../../src/read/received.ts'
import { SMS_RESULTS_SHOWN, SMS_SEND_FAILED, VoiceController, candidateClaims, pruneSms, smsCandidateLabel, smsShown, type SmsEntry, type SmsWriteOutcome, type VoiceHost, type VoiceSmsWrite } from '../../src/controller/controller.ts'

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
  readonly write: VoiceSmsWrite
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

  // D-V1-17 (앞 기대값 "넣지 않기로 닫은 카드도 같은 말"을 바꿈): 넣지 않고 닫은 카드는 같은 말 검사에서 보지 않는다
  it('넣지 않기로 닫은 카드 뒤 2초에 같은 말 → 새 기다리는 카드, 3초 뒤 쓰기 한 번 (D-V1-17, AC-V1-22)', async () => {
    const h = harness()
    h.products.set(166, { state: 'OPEN', waitlistFull: false })
    await turnOn(h)
    FakeRecognition.last.say('166번 문자찜 끝자리 1234')
    h.voice.smsSkip(only(h).card.id)
    await wait(2000)
    FakeRecognition.last.say('166번 문자찜 끝자리 1234')
    expect(h.voice.getSnapshot().sms.filter(smsShown)).toHaveLength(1)
    expect(only(h).card.repeats).toBe(0)
    await wait(3000)
    expect(h.sent.map((one) => one.write.no)).toEqual([166])
  })

  it('이유 카드 뒤 같은 말은 새 카드 — 상품을 연 뒤 다시 말하면 넣는다 (D-V1-17)', async () => {
    const h = harness()
    await turnOn(h)
    h.products.set(165, { state: 'READY', waitlistFull: false })
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    expect(only(h).reason).toBe('165번은 지금 판매 중이 아니에요.')
    h.products.set(165, { state: 'OPEN', waitlistFull: false })
    await wait(1000)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    const shown = h.voice.getSnapshot().sms.filter(smsShown)
    expect(shown).toHaveLength(2)
    expect(shown[0]?.reason).toBeNull()
    await wait(3000)
    expect(h.sent.map((one) => one.write.no)).toEqual([165])
  })

  it('문제 문장 뒤 다른 문제 문장은 앞 이유 카드로 합치지 않는다 (D-V1-17, TE-V1-006)', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('문자찜 들어왔어요')
    await wait(1000)
    FakeRecognition.last.say('15번 문자찜 끝자리 12 34')
    const shown = h.voice.getSnapshot().sms.filter(smsShown)
    expect(shown.map((entry) => entry.reason)).toEqual(['끝자리를 못 알아들었어요. 숫자 네 개로 다시 말해 주세요.', '번호를 못 알아들었어요. 다시 말하거나 문자찜 입력에 넣어 주세요.'])
    expect(h.sent).toHaveLength(0)
  })
})

describe('고르기·실패 (AC-V1-25, D-V1-03)', () => {
  it('409 → 후보 카드(저절로 넣지 않음), 후보를 누르면 buyer로 한 번 (last4 없음·새 요청 번호)', async () => {
    const h = harness()
    h.outcomes.push({
      kind: 'ambiguous',
      candidates: [
        { buyer: 'sms:a', display: '문자찜', phoneLast4: '1234', claims: [] },
        { buyer: 'sms:b', display: '문자찜', phoneLast4: '1234', claims: [] },
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

describe('후보 찜 번호·새 손님으로 넣기 (AC-V1-25 보강, D-V1-14)', () => {
  const twoSame = (): SmsWriteOutcome => ({
    kind: 'ambiguous',
    message: '끝자리 1234 손님이 여러 명이에요. 누구인지 골라 주세요.',
    candidates: [
      { buyer: 'sms:a', display: '문자찜', phoneLast4: '1234', claims: [15, 22] },
      { buyer: 'sms:b', display: '문자찜', phoneLast4: '1234', claims: [] },
    ],
  })

  it('후보 버튼 글: 찜 번호 3개까지, 넘으면 " 외 N개", 없으면 "찜 없음", 이름에 끝자리가 있으면 다시 쓰지 않음', () => {
    expect(smsCandidateLabel('문자찜', '1234', [15, 22])).toBe('문자찜 · 끝자리 1234 · 15번·22번')
    expect(smsCandidateLabel('문자찜', '1234', [])).toBe('문자찜 · 끝자리 1234 · 찜 없음')
    expect(smsCandidateLabel('문자찜', '1234', [1, 2, 3])).toBe('문자찜 · 끝자리 1234 · 1번·2번·3번')
    expect(smsCandidateLabel('문자찜', '1234', [1, 2, 3, 4, 5])).toBe('문자찜 · 끝자리 1234 · 1번·2번·3번 외 2개')
    expect(smsCandidateLabel('문자찜(1234)', '1234', [7])).toBe('문자찜(1234) · 7번')
    expect(smsCandidateLabel('김씨', null, [7])).toBe('김씨 · 7번')
    // 같은 표시 이름·끝자리라도 찜 번호로 글이 다르다
    expect(smsCandidateLabel('문자찜', '1234', [15])).not.toBe(smsCandidateLabel('문자찜', '1234', [22]))
  })

  it('카드의 후보는 찜 번호를 그대로 들고, 서버 문장을 고르기 문장으로 쓴다', async () => {
    const h = harness()
    h.outcomes.push(twoSame())
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(3000)
    const entry = only(h)
    expect(entry.card.candidates?.map(candidateClaims)).toEqual([[15, 22], []])
    expect(entry.choose).toBe('끝자리 1234 손님이 여러 명이에요. 누구인지 골라 주세요.')
    // 깨진 claims는 빈 목록으로 읽는다
    expect(candidateClaims({ buyer: 'x', display: '', phoneLast4: null, claims: 'no' } as never)).toEqual([])
    expect(candidateClaims({ buyer: 'x', display: '', phoneLast4: null })).toEqual([])
  })

  it('"새 손님으로 넣기" → last4 + newBuyer 쓰기 한 번(buyer 없음·새 요청 번호) → 결과, 다시 누르지 않으면 저절로 넣지 않는다', async () => {
    const h = harness()
    h.outcomes.push(twoSame())
    await turnOn(h)
    FakeRecognition.last.say('김민지님 165번 문자찜 끝자리 1234')
    await wait(3000)
    await wait(10_000)
    expect(h.sent).toHaveLength(1)
    const entry = only(h)
    h.voice.smsNewBuyer(entry.card.id)
    await settle()
    expect(h.sent).toHaveLength(2)
    expect(h.sent[1]?.write).toEqual({ no: 165, qty: 1, memo: '김민지', last4: '1234', newBuyer: true, time: null })
    expect(h.sent[1]?.requestId).not.toBe(h.sent[0]?.requestId)
    expect(only(h).card.status).toBe('SENT')
    expect(only(h).results).toEqual([{ no: 165, seq: 100, buyer: 'sms:new' }])
  })

  it('고르기 카드가 아니면 "새 손님으로 넣기"는 아무것도 보내지 않는다', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    h.voice.smsNewBuyer(only(h).card.id)
    await settle()
    expect(h.sent).toHaveLength(0)
    await wait(3000)
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]?.write.newBuyer).toBeUndefined()
  })

  it('주문 둘이면 첫 주문만 newBuyer, 둘째는 첫 주문이 만든 구매자로 — 새 손님이 둘 생기지 않는다', async () => {
    const h = harness()
    h.products.set(15, { state: 'OPEN', waitlistFull: false })
    h.products.set(28, { state: 'OPEN', waitlistFull: false })
    h.outcomes.push(twoSame(), { kind: 'ok', seq: 200, buyer: 'sms:made' }, { kind: 'ok', seq: 201, buyer: 'sms:made' })
    await turnOn(h)
    FakeRecognition.last.say('15번 28번 문자찜 끝자리 1234')
    h.voice.smsSend(only(h).card.id)
    await settle()
    expect(only(h).card.candidates).not.toBeNull()
    h.voice.smsNewBuyer(only(h).card.id)
    await settle()
    expect(h.sent.map((one) => one.write)).toEqual([
      { no: 15, qty: 1, memo: null, last4: '1234', time: null },
      { no: 15, qty: 1, memo: null, last4: '1234', newBuyer: true, time: null },
      { no: 28, qty: 1, memo: null, buyer: 'sms:made', time: null },
    ])
    expect(only(h).results.map((line) => line.buyer)).toEqual(['sms:made', 'sms:made'])
  })

  it('새 손님 쓰기가 실패하면 고르기 카드로 다시 열리고, 다시 누르면 같은 요청 번호(두 번 기록되지 않게)', async () => {
    const h = harness()
    h.outcomes.push(twoSame(), { kind: 'failed', message: SMS_SEND_FAILED })
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(3000)
    const id = only(h).card.id
    h.voice.smsNewBuyer(id)
    await settle()
    expect(only(h).error).toBe(SMS_SEND_FAILED)
    expect(only(h).card.status).toBe('OPEN')
    expect(only(h).card.candidates?.map((c) => c.buyer)).toEqual(['sms:a', 'sms:b'])
    await wait(10_000)
    expect(h.sent).toHaveLength(2)
    h.voice.smsNewBuyer(id)
    await settle()
    expect(h.sent).toHaveLength(3)
    expect(h.sent[2]?.requestId).toBe(h.sent[1]?.requestId)
    expect(h.sent[2]?.write.newBuyer).toBe(true)
    expect(only(h).card.status).toBe('SENT')
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
  // D-V1-18 (앞 기대값 "가장 오래된 기다리는 문자찜 카드가 닫힌다"를 바꿈): 넣을 수 있는 문자찜 카드는 닫지 않고 손대지 않은 상품 카드를 닫는다
  it('상품 카드와 문자찜 카드를 함께 센다 — 넷째 카드가 오면 손대지 않은 상품 카드가 닫히고 기다리는 문자찜 카드는 남는다 (D-V1-18)', async () => {
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
    expect(snapshot.cards).toHaveLength(0)
    expect(snapshot.sms.filter(smsShown).map((entry) => entry.card.reading.orders[0]?.no)).toEqual([3, 2, 1])
    expect(snapshot.smsDropped).toEqual([])
    await wait(10_000)
    expect(h.sent.map((s) => s.write.no).sort()).toEqual([1, 2, 3])
  })

  it('기다림 10초에서 문자찜 넷을 1초 간격으로 → 넷 다 열려 있고 각자 쓰기 (D-V1-18, AC-V1-03 예)', async () => {
    const h = harness()
    for (const no of [165, 166, 167, 168]) h.products.set(no, { state: 'OPEN', waitlistFull: false })
    h.smsSettings = { 'voice.smsAutoSec': 10 }
    await turnOn(h)
    for (const [i, no] of [165, 166, 167, 168].entries()) {
      FakeRecognition.last.say(`${String(no)}번 문자찜 끝자리 ${String(i + 1).repeat(4)}`)
      await wait(1000)
    }
    expect(h.voice.getSnapshot().sms.filter(smsShown)).toHaveLength(4)
    await wait(10_000)
    expect(h.sent.map((s) => s.write.no)).toEqual([165, 166, 167, 168])
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

// D-V1-18: 넣을 수 있는 문자찜 카드는 열린 카드 수 규칙으로 닫히지 않는다 — U-V1-01 안내가 생길 일이 없다
// (앞 기대값 "넣을까요? 카드·기다리던 카드가 밀려 닫히면 안내"를 바꿈)
describe('넣을 수 있는 문자찜 카드는 저절로 닫히지 않는다 (D-V1-18, 앞 U-V1-01 안내 대신)', () => {
  it('이유 카드가 쌓여도 "넣을까요?" 카드는 남고(안내 없음), 넘친 이유 카드가 닫힌다', async () => {
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
    expect(shown).toHaveLength(3)
    expect(shown.filter((entry) => entry.reason === null).map((entry) => entry.card.reading.orders.map((order) => order.no))).toEqual([[15, 28]])
    expect(snapshot.smsDropped).toEqual([])
    await wait(10_000)
    expect(h.sent).toHaveLength(0)
    h.voice.smsSend(shown.find((entry) => entry.reason === null)?.card.id ?? '')
    await settle()
    expect(h.sent.map((one) => one.write.no)).toEqual([15, 28])
  })

  it('기다리던(3초) 문자찜 카드는 이유 카드 셋이 와도 닫히지 않고 3초 뒤 넣는다', async () => {
    const h = harness()
    await turnOn(h)
    for (const text of ['165번 문자찜 끝자리 1234', '300번 문자찜', '301번 문자찜', '302번 문자찜']) FakeRecognition.last.say(text)
    expect(h.voice.getSnapshot().smsDropped).toEqual([])
    await wait(3000)
    expect(h.sent.map((one) => one.write.no)).toEqual([165])
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

describe('다른 기기가 방금 같은 말을 넣음 (AC-V1-31, D-V1-13)', () => {
  it('409 VOICE_REPEATED → 이유 카드("닫기"만), 다시 넣지 않고, 같은 말 검사에서 빠진다', async () => {
    const h = harness()
    h.outcomes.push({ kind: 'repeated', message: '같은 말을 다른 기기에서 방금 넣었어요.' })
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜')
    await wait(3000)
    expect(h.sent).toHaveLength(1)
    const entry = only(h)
    expect(entry.reason).toBe('같은 말을 다른 기기에서 방금 넣었어요.')
    expect(entry.card.status).toBe('OPEN')
    expect(entry.card.autoAt).toBeNull()
    await wait(10_000)
    expect(h.sent).toHaveLength(1)
    h.voice.smsSend(entry.card.id)
    await settle()
    expect(h.sent).toHaveLength(1)
    h.voice.smsSkip(entry.card.id)
    expect(h.voice.getSnapshot().sms.filter(smsShown)).toHaveLength(0)
  })
})

describe('Esc = 맨 앞 기다리는 카드 넣지 않기 (D-V1-20, AC-V1-32)', () => {
  it('기다리는 카드 둘이면 맨 앞(가장 새) 카드만 닫고 쓰기 없음, 번호 둘 카드는 Esc 대상이 아니다', async () => {
    const h = harness()
    h.products.set(166, { state: 'OPEN', waitlistFull: false })
    h.products.set(15, { state: 'OPEN', waitlistFull: false })
    h.products.set(28, { state: 'OPEN', waitlistFull: false })
    await turnOn(h)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(10)
    FakeRecognition.last.say('166번 문자찜 끝자리 5678')
    const newest = h.voice.getSnapshot().sms[0]?.card.id
    expect(h.voice.smsEscTarget()).toBe(newest)
    expect(h.voice.smsEscape()).toBe(true)
    await wait(3000)
    expect(h.sent.map((one) => one.write.no)).toEqual([165])
    FakeRecognition.last.say('15번 28번 문자찜 끝자리 1234')
    expect(h.voice.smsEscTarget()).toBeNull()
    expect(h.voice.smsEscape()).toBe(false)
  })

  it('음성 문자찜 결과 카드가 열려 있는가 (Ctrl+Z 알림, D-V1-22)', async () => {
    const h = harness()
    await turnOn(h)
    expect(h.voice.smsResultShown()).toBe(false)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    expect(h.voice.smsResultShown()).toBe(false)
    await wait(3000)
    expect(h.voice.smsResultShown()).toBe(true)
    h.voice.smsDismiss(only(h).card.id)
    expect(h.voice.smsResultShown()).toBe(false)
  })
})
