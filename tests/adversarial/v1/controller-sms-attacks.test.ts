// V1 적대 시험 (test-domain, AC-V1-21~25): 콘솔 음성 컨트롤러의 문자찜 카드를 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계로 공격한다.
// 화면 파일은 DOM 타입으로 검사하므로(루트 tsconfig는 Node 타입) 경로를 값으로 불러온다(i4/voice-controller-auto.test.ts와 같은 까닭).
// 노리는 것: 같은 찜이 두 번 가거나, 넣으면 안 되는 때(판매 종료·창 열림·음성 끔·넘쳐 닫힘·넣지 않기 뒤 같은 말) 쓰기가 가는 것.
import * as voiceModule from '@livejjim/voice'
import type { SmsCard, SmsProductView, SmsWrite } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 화면처럼 같은 상품 이름 목록을 돌려준다(ConsolePage useMemo — 상품이 바뀔 때만 새 목록). 부를 때마다 새 목록이면 컨트롤러가 사전을
// 매번 다시 만든다(#prepared는 목록이 같을 때만 다시 씀) — 사전이 1,082개로 커진 뒤(D-V3-115) 시험이 느려진 틀 문제. 단언은 그대로.
const NO_NAMES: readonly string[] = []

// SRV1(D-APP-22·23, AC-SRV1-15): 음성 읽기 컨트롤러는 웹에서 서버 음성 흐름(packages/voice-session, server.ts createReadingSession)으로 옮겼다 — 같은 사례를 지금 제품 경로에서 본다.
const CONTROLLER_MODULE = '../../../packages/voice-session/src/controller/controller.ts'
const RECEIVED_MODULE = '../../../packages/voice-session/src/read/received.ts'
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

interface Entry {
  readonly card: SmsCard
  readonly reason: string | null
  readonly sending: boolean
  readonly hidden: boolean
  readonly results: readonly { no: number }[]
}

interface ControllerLike {
  turnOn(): Promise<void>
  turnOff(): void
  refresh(): void
  smsSkip(id: string): void
  smsSend(id: string): void
  smsChoose(id: string, buyer: string): void
  smsDismiss(id: string): void
  smsEscape(): boolean
  smsEscTarget(): string | null
  smsResultShown(): boolean
  describeSms(card: SmsCard): string
  getSnapshot(): { phase: string; sms: readonly Entry[] }
  dispose(): void
}
type ControllerCtor = new (host: unknown) => ControllerLike

interface Sent {
  readonly write: SmsWrite
  readonly received: string | null
  readonly requestId: string
}

type Outcome = { kind: 'ok'; seq: number; buyer: string | null } | { kind: 'ambiguous'; candidates: { buyer: string; display: string; phoneLast4: string }[] } | { kind: 'failed'; message: string }

interface World {
  voice: ControllerLike
  sent: Sent[]
  products: Map<number, SmsProductView>
  dialog: { open: boolean }
  outcomes: (Outcome | Error)[]
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

async function wait(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  await settle()
}

async function start(smsSettings: unknown = null, overrides: Record<string, unknown> = {}): Promise<World> {
  const { VoiceController } = (await import(/* @vite-ignore */ CONTROLLER_MODULE)) as { VoiceController: ControllerCtor }
  const { readReceived } = (await import(/* @vite-ignore */ RECEIVED_MODULE)) as {
    readReceived: (text: string, now: number) => { kind: 'ok'; value: string; late: boolean } | { kind: string }
  }
  let seq = 100
  let request = 1
  const world = {
    sent: [] as Sent[],
    products: new Map<number, SmsProductView>([
      [165, { state: 'OPEN', waitlistFull: false }],
      [166, { state: 'OPEN', waitlistFull: false }],
      [167, { state: 'OPEN', waitlistFull: false }],
      [168, { state: 'OPEN', waitlistFull: false }],
    ]),
    dialog: { open: false },
    outcomes: [] as (Outcome | Error)[],
  } as World
  const host = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    currentNames: () => NO_NAMES,
    products: () => new Map<number, boolean>(),
    fetchHistory: async () => [],
    dialogOpen: () => world.dialog.open,
    readConsent: () => true,
    writeConsent: () => {},
    readSettings: () => null,
    writeSettings: () => {},
    register: () => {},
    focusQuick: () => {},
    smsReadOptions: () => ({ parseMode: 'STRICT', maxNumber: 999 }),
    smsProduct: (no: number) => world.products.get(no) ?? null,
    smsProductName: () => null,
    readSmsTime: (time: string, now: number) => {
      const read = readReceived(time, now)
      return read.kind === 'ok' && 'value' in read ? { value: read.value, late: read.late } : null
    },
    writeSms: async (write: SmsWrite, received: string | null, requestId: string) => {
      world.sent.push({ write, received, requestId })
      const next = world.outcomes.shift()
      if (next instanceof Error) throw next
      return next ?? { kind: 'ok', seq: seq++, buyer: 'sms:new' }
    },
    newRequestId: () => `req-${String(request++)}`,
    readSmsSettings: () => smsSettings,
    writeSmsSettings: () => {},
    ...overrides,
  }
  world.voice = new VoiceController(host)
  await world.voice.turnOn()
  await settle()
  return world
}

const shown = (world: World) => world.voice.getSnapshot().sms.filter((entry) => !entry.hidden && entry.card.status !== 'CLOSED')

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  FakeRecognition.all.length = 0
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('TD-V1-CTL 저절로 넣기는 카드마다 정확히 한 번 (AC-V1-21·22)', () => {
  it('다른 두 문장을 1초 간격으로 → 각각 3초 뒤 한 번씩, 요청 번호가 다르다', async () => {
    const world = await start()
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(1000)
    FakeRecognition.last.say('166번 문자찜 끝자리 5678')
    await wait(1999)
    expect(world.sent).toHaveLength(0)
    await wait(1)
    expect(world.sent.map((sent) => sent.write.no)).toEqual([165])
    await wait(1000)
    expect(world.sent.map((sent) => sent.write.no)).toEqual([165, 166])
    await wait(20_000)
    expect(world.sent).toHaveLength(2)
    expect(new Set(world.sent.map((sent) => sent.requestId)).size).toBe(2)
    expect(world.sent[0]?.write).toMatchObject({ no: 165, last4: '1234', memo: null })
    world.voice.dispose()
  })

  it('기다리는 동안 판매 종료 → 쓰기 없음, 이유 카드', async () => {
    const world = await start()
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(2000)
    world.products.set(165, { state: 'CLOSED', waitlistFull: false })
    await wait(5000)
    expect(world.sent).toHaveLength(0)
    expect(shown(world)[0]?.reason).toBe('165번은 지금 판매 중이 아니에요.')
    world.voice.dispose()
  })

  it('창이 열린 동안은 보내지 않고, 닫히면 한 번만 보낸다', async () => {
    const world = await start()
    world.dialog.open = true
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(10_000)
    expect(world.sent).toHaveLength(0)
    world.dialog.open = false
    await wait(2000)
    expect(world.sent).toHaveLength(1)
    await wait(10_000)
    expect(world.sent).toHaveLength(1)
    world.voice.dispose()
  })

  it('음성을 끄면 기다리던 카드는 저절로 가지 않는다 — 다시 켜도', async () => {
    const world = await start()
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(1000)
    world.voice.turnOff()
    await wait(5000)
    await world.voice.turnOn()
    await wait(10_000)
    expect(world.sent).toHaveLength(0)
    world.voice.dispose()
  })

  // D-V1-17(TD-V1-003)로 바뀐 기대: "넣지 않기"로 닫은 카드는 같은 말 검사에서 보지 않는다 — 같은 말은 새 기다리는 카드, 3초 뒤 쓰기 한 번 (AC-V1-04 예)
  it('TD-V1-CTL D-V1-17: "넣지 않기" 뒤 2초 안에 같은 말 → 새 기다리는 카드, 3초 뒤 쓰기 한 번(새 요청 번호)', async () => {
    const world = await start()
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(500)
    const id = shown(world)[0]?.card.id ?? ''
    world.voice.smsSkip(id)
    await wait(2000)
    expect(world.sent).toHaveLength(0)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(10)
    const fresh = shown(world)
    expect(fresh).toHaveLength(1)
    expect(fresh[0]?.card.id).not.toBe(id)
    expect(fresh[0]?.card.repeats).toBe(0)
    await wait(2980)
    expect(world.sent).toHaveLength(0)
    await wait(20)
    await wait(10_000)
    expect(world.sent.map((sent) => [sent.write.no, sent.write.last4])).toEqual([[165, '1234']])
    world.voice.dispose()
  })

  it('TD-V1-CTL D-V1-17: 넣을 수 없는 상품의 이유 카드 뒤 같은 말 → 새 카드로 처음부터 판단, 옛 이유 카드는 끝까지 보내지 않는다', async () => {
    const world = await start()
    world.products.set(300, { state: 'READY', waitlistFull: false })
    FakeRecognition.last.say('300번 문자찜 끝자리 1234')
    await wait(3500)
    const reasonCard = shown(world)[0]
    expect(reasonCard?.reason).not.toBeNull()
    expect(world.sent).toHaveLength(0)
    // 판매자가 300번을 열고 같은 말을 다시 한다 (10초 안)
    world.products.set(300, { state: 'OPEN', waitlistFull: false })
    FakeRecognition.last.say('300번 문자찜 끝자리 1234')
    await wait(10)
    const ids = shown(world).map((entry) => entry.card.id)
    expect(ids).toHaveLength(2)
    await wait(15_000)
    // 쓰기는 새 카드에서 한 번 — 이유 카드가 상품이 열렸다고 저절로 넣히면 쓰기가 둘
    expect(world.sent.map((sent) => sent.write.no)).toEqual([300])
    world.voice.dispose()
  })

  it('TD-V1-CTL D-V1-17: 번호 못 알아들은 이유 카드 뒤 2초 안에 끝자리 갈린 말 → 새 이유 카드(끝자리), 쓰기 없음', async () => {
    const world = await start()
    FakeRecognition.last.say('문자찜 들어왔어요')
    await wait(500)
    FakeRecognition.last.say('165번 문자찜 끝자리 12 34')
    await wait(10)
    const entries = shown(world)
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.card.reading.problem).sort()).toEqual(['LAST4_UNCLEAR', 'NUMBER_UNCLEAR'])
    expect(entries.every((entry) => entry.card.repeats === 0)).toBe(true)
    await wait(10_000)
    expect(world.sent).toHaveLength(0)
    world.voice.dispose()
  })

  it('TD-V1-CTL D-V1-18: 넣을 수 있는 카드 넷을 1초 간격으로 → 넷 다 열려 있고 각자 3초 뒤 165·166·167·168 쓰기 넷 (AC-V1-03 예)', async () => {
    const world = await start()
    for (const [no, last4] of [
      [165, '1111'],
      [166, '2222'],
      [167, '3333'],
      [168, '4444'],
    ] as const) {
      FakeRecognition.last.say(`${String(no)}번 문자찜 끝자리 ${last4}`)
      await wait(1000)
    }
    // 첫 카드는 3초가 지나 이미 갔을 수 있다 — 넣지 않고 닫힌 카드는 없어야 한다
    expect(world.voice.getSnapshot().sms.filter((entry) => entry.card.status === 'CLOSED')).toHaveLength(0)
    await wait(10_000)
    expect(world.sent.map((sent) => [sent.write.no, sent.write.last4])).toEqual([
      [165, '1111'],
      [166, '2222'],
      [167, '3333'],
      [168, '4444'],
    ])
    expect(new Set(world.sent.map((sent) => sent.requestId)).size).toBe(4)
    world.voice.dispose()
  })

  it('TD-V1-CTL D-V1-18: 기다림 10초에서 넷을 1초 간격으로 → 넷 다 열림, 각자 10초 뒤 쓰기 넷', async () => {
    const world = await start({ 'voice.smsAutoSec': 10 })
    for (const [no, last4] of [
      [165, '1111'],
      [166, '2222'],
      [167, '3333'],
      [168, '4444'],
    ] as const) {
      FakeRecognition.last.say(`${String(no)}번 문자찜 끝자리 ${last4}`)
      await wait(1000)
    }
    expect(shown(world).map((entry) => entry.card.status)).toEqual(['OPEN', 'OPEN', 'OPEN', 'OPEN'])
    expect(world.sent).toHaveLength(0)
    await wait(15_000)
    expect(world.sent.map((sent) => sent.write.no)).toEqual([165, 166, 167, 168])
    world.voice.dispose()
  })

  it('TD-V1-CTL D-V1-20: Esc는 맨 앞(가장 새) 기다리는 카드만 "넣지 않기" — 고르기·이유·결과 카드는 닫지 않고, 없으면 false', async () => {
    const world = await start({ 'voice.smsAutoSec': 10 })
    // 결과 카드 하나 (지금 넣기)
    FakeRecognition.last.say('165번 문자찜 끝자리 1111')
    await wait(10)
    world.voice.smsSend(shown(world)[0]?.card.id ?? '')
    await wait(10)
    expect(world.sent).toHaveLength(1)
    // 이유 카드 하나
    FakeRecognition.last.say('문자찜 들어왔어요')
    await wait(10)
    // 넣기 누르기 카드(번호 둘 — 기다리지 않음)
    FakeRecognition.last.say('166번 167번 문자찜 끝자리 2222')
    await wait(10)
    expect(world.voice.smsEscTarget()).toBeNull()
    expect(world.voice.smsEscape()).toBe(false)
    // 기다리는 카드 둘 — Esc는 더 새 것부터
    FakeRecognition.last.say('167번 문자찜 끝자리 3333')
    await wait(1000)
    FakeRecognition.last.say('168번 문자찜 끝자리 4444')
    await wait(10)
    const newest = shown(world).find((entry) => entry.card.reading.last4 === '4444')?.card.id
    expect(world.voice.smsEscTarget()).toBe(newest)
    expect(world.voice.smsEscape()).toBe(true)
    const older = shown(world).find((entry) => entry.card.reading.last4 === '3333')?.card.id
    expect(world.voice.smsEscTarget()).toBe(older)
    expect(world.voice.smsEscape()).toBe(true)
    expect(world.voice.smsEscape()).toBe(false)
    await wait(15_000)
    // 쓰기는 처음 결과 카드 하나뿐, 넣기 누르기 카드는 열린 그대로(D-V1-18 — 넷째 카드가 들어올 때 열린 카드 수 규칙은 이유 카드를 닫는다)
    expect(world.sent).toHaveLength(1)
    const statuses = world.voice.getSnapshot().sms.map((entry) => [entry.card.reading.last4 ?? entry.card.reading.problem, entry.card.status])
    expect(statuses).toEqual(
      expect.arrayContaining([
        ['2222', 'OPEN'],
        ['3333', 'CLOSED'],
        ['4444', 'CLOSED'],
      ]),
    )
    world.voice.dispose()
  })

  it('TD-V1-CTL D-V1-20 + D-V1-17: Esc로 닫은 뒤 같은 말 → 새 카드로 넣는다 (Esc 실수를 다시 말로 바로잡을 수 있음)', async () => {
    const world = await start()
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(500)
    expect(world.voice.smsEscape()).toBe(true)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(10_000)
    expect(world.sent.map((sent) => sent.write.no)).toEqual([165])
    world.voice.dispose()
  })

  it('TD-V1-CTL D-V1-22: 결과 카드가 보이는 동안만 smsResultShown — 화면에서 닫으면 false', async () => {
    const world = await start()
    expect(world.voice.smsResultShown()).toBe(false)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(500)
    expect(world.voice.smsResultShown()).toBe(false)
    await wait(3000)
    expect(world.sent).toHaveLength(1)
    expect(world.voice.smsResultShown()).toBe(true)
    const id = world.voice.getSnapshot().sms.find((entry) => entry.card.status === 'SENT')?.card.id ?? ''
    world.voice.smsDismiss(id)
    expect(world.voice.smsResultShown()).toBe(false)
    world.voice.dispose()
  })

  it('TD-V1-CTL D-V1-21: 카드 글에 품종 — 있으면 번호 뒤, 비었거나 조회가 던지면 번호만', async () => {
    const names = new Map<number, string>([
      [165, '핑크프릴'],
      [166, ''],
    ])
    const world = await start(null, {
      smsProductName: (no: number) => {
        if (no === 167) throw new Error('x')
        return names.get(no) ?? null
      },
    })
    const say = async (text: string): Promise<string> => {
      FakeRecognition.last.say(text)
      await wait(10)
      const card = shown(world)[0]?.card
      if (card === undefined) throw new Error('카드 없음')
      world.voice.smsSkip(card.id)
      return world.voice.describeSms(card)
    }
    expect(await say('165번 문자찜 끝자리 1234')).toBe('165번 핑크프릴 · 끝자리 1234 · 문자찜')
    expect(await say('166번 문자찜 끝자리 1234')).toBe('166번 · 끝자리 1234 · 문자찜')
    expect(await say('167번 문자찜 끝자리 1234')).toBe('167번 · 끝자리 1234 · 문자찜')
    expect(await say('165번 168번 문자찜 김민지님')).toBe('165번 핑크프릴 · 168번 · 김민지님 · 문자찜 — 넣을까요?')
    world.voice.dispose()
  })

  it('같은 말 2초 간격 세 번 → 쓰기 한 번, 끝자리가 다르면 바로 새 카드', async () => {
    const world = await start()
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(2000)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(2000)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    FakeRecognition.last.say('165번 문자찜 끝자리 5678')
    await wait(5000)
    expect(world.sent.map((sent) => [sent.write.no, sent.write.last4])).toEqual([
      [165, '1234'],
      [165, '5678'],
    ])
    world.voice.dispose()
  })

  it('연결 실패 → 저절로 다시 보내지 않고, 다시 "넣기"는 같은 요청 번호', async () => {
    const world = await start()
    world.outcomes.push(new Error('network'))
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(3000)
    expect(world.sent).toHaveLength(1)
    await wait(20_000)
    expect(world.sent).toHaveLength(1)
    const id = shown(world)[0]?.card.id ?? ''
    world.voice.smsSend(id)
    await wait(0)
    expect(world.sent).toHaveLength(2)
    expect(world.sent[1]?.requestId).toBe(world.sent[0]?.requestId)
    world.voice.dispose()
  })

  it('409 → 고르기 카드는 저절로 넣지 않고, 후보를 누르면 buyer만(끝자리 없이) 한 번', async () => {
    const world = await start()
    world.outcomes.push({
      kind: 'ambiguous',
      candidates: [
        { buyer: 'sms:a', display: '문자찜(김씨)', phoneLast4: '1234' },
        { buyer: 'sms:b', display: '문자찜', phoneLast4: '1234' },
      ],
    })
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(3000)
    await wait(30_000)
    expect(world.sent).toHaveLength(1)
    const id = shown(world)[0]?.card.id ?? ''
    // 후보 밖의 구매자는 보내지 않는다
    world.voice.smsChoose(id, 'UC_someone_else')
    await wait(0)
    expect(world.sent).toHaveLength(1)
    world.voice.smsChoose(id, 'sms:b')
    world.voice.smsChoose(id, 'sms:b')
    await wait(0)
    expect(world.sent).toHaveLength(2)
    expect(world.sent[1]?.write).toMatchObject({ no: 165, buyer: 'sms:b' })
    expect(world.sent[1]?.write).not.toHaveProperty('last4')
    world.voice.dispose()
  })

  it('"지금 넣기"를 기다림이 끝나는 순간에 눌러도 한 번만', async () => {
    const world = await start()
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(2999)
    const id = shown(world)[0]?.card.id ?? ''
    world.voice.smsSend(id)
    world.voice.smsSend(id)
    await wait(1)
    world.voice.smsSend(id)
    await wait(10_000)
    expect(world.sent).toHaveLength(1)
    world.voice.dispose()
  })
})
