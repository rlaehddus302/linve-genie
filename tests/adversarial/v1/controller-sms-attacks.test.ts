// V1 적대 시험 (test-domain, AC-V1-21~25): 콘솔 음성 컨트롤러의 문자찜 카드를 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계로 공격한다.
// 화면 파일은 DOM 타입으로 검사하므로(루트 tsconfig는 Node 타입) 경로를 값으로 불러온다(i4/voice-controller-auto.test.ts와 같은 까닭).
// 노리는 것: 같은 찜이 두 번 가거나, 넣으면 안 되는 때(판매 종료·창 열림·음성 끔·넘쳐 닫힘·넣지 않기 뒤 같은 말) 쓰기가 가는 것.
import * as voiceModule from '@livejjim/voice'
import type { SmsCard, SmsProductView, SmsWrite } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CONTROLLER_MODULE = '../../../apps/web/src/voice/controller.ts'
const RECEIVED_MODULE = '../../../apps/web/src/lib/received.ts'
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

async function start(smsSettings: unknown = null): Promise<World> {
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
    currentNames: () => [] as readonly string[],
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

  it('"넣지 않기" 뒤 10초 안에 같은 말 → 쓰기 없음 (닫은 카드도 같은 말로 본다)', async () => {
    const world = await start()
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(500)
    const id = shown(world)[0]?.card.id ?? ''
    world.voice.smsSkip(id)
    await wait(4000)
    FakeRecognition.last.say('165번 문자찜 끝자리 1234')
    await wait(10_000)
    expect(world.sent).toHaveLength(0)
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
