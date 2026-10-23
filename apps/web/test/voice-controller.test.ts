// 콘솔 음성 컨트롤러 (AC-I4-10~14·20~23·30·31·40, D-I4-03~06·09) — 실제 음성 모듈 + 가짜 인식 객체(window.SpeechRecognition) + 가짜 시계.
import * as voiceModule from '@livejjim/voice'
import type { CardRegistration, SuggestionCard, VoiceSettings } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HISTORY_FAILED, HISTORY_WAIT_MS, RESTART_LABEL_MS, TOO_SOON, VOICE_LOAD_FAILED, VoiceController, type PastDay, type VoiceHost } from '../src/voice/controller.ts'

const T0 = Date.UTC(2026, 9, 20, 1, 0, 0)

/** 가짜 인식 객체 (만든 수·start·stop·abort를 센다) */
class FakeRecognition {
  static readonly all: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  starts = 0
  stops = 0
  aborts = 0
  results: { isFinal: boolean; length: number; 0: { transcript: string } }[] = []
  constructor() {
    FakeRecognition.all.push(this)
  }
  start(): void {
    this.starts++
  }
  stop(): void {
    this.stops++
  }
  abort(): void {
    this.aborts++
  }
  /** 최종 결과 여러 개를 한 이벤트로 (크롬은 이어 말하면 한 onresult에 최종 결과를 여럿 담는다) */
  sayAll(...texts: string[]): void {
    const from = this.results.length
    for (const text of texts) this.results.push({ isFinal: true, length: 1, 0: { transcript: text } })
    this.onresult?.({ resultIndex: from, results: this.results })
  }
  say(text: string, final = true): void {
    this.results.push({ isFinal: final, length: 1, 0: { transcript: text } })
    this.onresult?.({ resultIndex: this.results.length - 1, results: this.results })
    if (!final) this.results.pop()
  }
  fail(error: string): void {
    this.onerror?.({ error })
  }
  end(): void {
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
  readonly host: VoiceHost
  readonly registered: { card: SuggestionCard; registration: CardRegistration; source: string }[]
  readonly products: Map<number, boolean>
  consent: boolean
  settings: unknown
  readonly written: VoiceSettings[]
  dialog: boolean
  focusQuick: ReturnType<typeof vi.fn>
  fetchHistory: ReturnType<typeof vi.fn<() => Promise<readonly PastDay[]>>>
  names: readonly string[]
}

function harness(patch: Partial<VoiceHost> = {}): Harness {
  const state = {
    registered: [] as Harness['registered'],
    products: new Map<number, boolean>(),
    consent: true,
    settings: null as unknown,
    written: [] as VoiceSettings[],
    dialog: false,
    focusQuick: vi.fn(),
    fetchHistory: vi.fn<() => Promise<readonly PastDay[]>>(async () => []),
    names: [] as readonly string[],
  }
  const host: VoiceHost = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    currentNames: () => state.names,
    products: () => state.products,
    fetchHistory: () => state.fetchHistory(),
    dialogOpen: () => state.dialog,
    readConsent: () => state.consent,
    writeConsent: () => {
      state.consent = true
    },
    readSettings: () => state.settings,
    writeSettings: (settings) => {
      state.written.push(settings)
    },
    register: (card, registration, source) => {
      state.registered.push({ card, registration, source })
    },
    focusQuick: () => state.focusQuick(),
    ...patch,
  }
  const voice = new VoiceController(host)
  return Object.assign(state, { voice, host }) as unknown as Harness
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

async function turnOn(h: Harness): Promise<void> {
  await h.voice.turnOn()
  await settle()
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

describe('켜기·안내 창 (AC-I4-10·11, D-I4-04)', () => {
  it('만들기만 해서는 음성 모듈·인식 객체·이력 조회가 없다', () => {
    const load = vi.fn(async () => voiceModule)
    const h = harness({ load })
    expect(h.voice.getSnapshot().phase).toBe('off')
    expect(load).not.toHaveBeenCalled()
    expect(FakeRecognition.all).toHaveLength(0)
    expect(h.fetchHistory).not.toHaveBeenCalled()
  })

  it('처음(확인 기록 없음): 안내 창 → 닫기면 꺼진 그대로·인식 객체 0개·빠른 입력칸으로', async () => {
    const h = harness()
    h.consent = false
    await turnOn(h)
    expect(h.voice.getSnapshot().phase).toBe('consent')
    expect(FakeRecognition.all).toHaveLength(0)
    h.voice.declineConsent()
    expect(h.voice.getSnapshot().phase).toBe('off')
    expect(FakeRecognition.all).toHaveLength(0)
    expect(h.focusQuick).toHaveBeenCalled()
    expect(h.fetchHistory).not.toHaveBeenCalled()
  })

  it('안내 창의 "음성 켜기": 확인을 남기고 ko-KR·연속·중간 결과로 한 번 시작, 이력 조회는 이때 한 번', async () => {
    const h = harness()
    h.consent = false
    await turnOn(h)
    h.voice.acceptConsent()
    expect(h.consent).toBe(true)
    const rec = FakeRecognition.last
    expect([rec.lang, rec.continuous, rec.interimResults, rec.starts]).toEqual(['ko-KR', true, true, 1])
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'on', stateLabel: '음성: 듣는 중', error: null })
    expect(h.fetchHistory).toHaveBeenCalledTimes(1)
    // 끄고 다시 켜도 같은 콘솔에선 다시 받지 않는다
    h.voice.turnOff()
    await turnOn(h)
    expect(h.fetchHistory).toHaveBeenCalledTimes(1)
  })

  it('확인 기록이 있으면 창 없이 바로 시작', async () => {
    const h = harness()
    await turnOn(h)
    expect(h.voice.getSnapshot().phase).toBe('on')
    expect(FakeRecognition.all).toHaveLength(1)
  })

  it('생성자가 없으면 창을 띄우기 전에 "지원하지 않아요" — 꺼진 그대로', async () => {
    vi.stubGlobal('SpeechRecognition', undefined)
    const h = harness()
    h.consent = false
    await turnOn(h)
    // 문장: D-I5-03 (AC-I5-06 UNSUPPORTED)
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'off', error: '이 기기에서는 음성이 어려워요. PC 크롬이나 안드로이드 크롬에서 켜 주세요. 상품은 빠른 입력으로 그대로 등록할 수 있어요.' })
  })

  it('webkitSpeechRecognition만 있어도 된다', async () => {
    vi.stubGlobal('SpeechRecognition', undefined)
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const h = harness()
    await turnOn(h)
    expect(h.voice.getSnapshot().phase).toBe('on')
  })

  it('음성 코드를 받지 못하면 알리고 꺼진 그대로 — 다시 켜면 다시 받는다', async () => {
    let fail = true
    const h = harness({ load: async () => (fail ? Promise.reject(new Error('x')) : voiceModule) })
    await turnOn(h)
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'off', error: VOICE_LOAD_FAILED })
    fail = false
    await turnOn(h)
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'on', error: null })
  })

  it('지난 범위를 받지 못하면 알리고 계속 돈다 — 다음에 켤 때 다시 받는다', async () => {
    const h = harness()
    h.fetchHistory.mockRejectedValueOnce(new Error('x'))
    await turnOn(h)
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'on', historyFailed: true })
    expect(HISTORY_FAILED).toBe('지난 판매 품종을 불러오지 못했어요. 기본 품종 사전으로 알아들어요.')
    h.voice.turnOff()
    await turnOn(h)
    expect(h.fetchHistory).toHaveBeenCalledTimes(2)
    expect(h.voice.getSnapshot().historyFailed).toBe(false)
  })
})

describe('상태·오류 (AC-I4-12, D-205)', () => {
  it('not-allowed → 막힘 문장, 꺼짐, 다시 시작하지 않는다(start 1번) — 다시 켜면 문장이 사라진다', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.fail('not-allowed')
    FakeRecognition.last.end()
    // 문장: D-I5-03 (AC-I5-06 PERMISSION_DENIED)
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'off', error: '마이크 사용이 막혀 있어요. PC·안드로이드 크롬은 주소창 왼쪽 자물쇠에서, 아이폰은 설정 > 사파리 > 마이크에서 허용해 주세요.' })
    expect(FakeRecognition.all).toHaveLength(1)
    expect(FakeRecognition.last.starts).toBe(1)
    await turnOn(h)
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'on', error: null })
  })

  it('audio-capture → 마이크 없음 문장, 꺼짐', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.fail('audio-capture')
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'off', error: '마이크를 찾지 못했어요. 마이크 연결을 확인해 주세요.' })
  })

  it('저절로 끝나면 "다시 시작 중"을 거쳐 다시 듣고, 최종 결과 없이 60초 안에 6번째면 멈춘다', async () => {
    const h = harness()
    await turnOn(h)
    const labels: (string | null)[] = []
    h.voice.subscribe(() => labels.push(h.voice.getSnapshot().stateLabel))
    for (let i = 1; i <= 5; i++) {
      FakeRecognition.last.fail('no-speech')
      FakeRecognition.last.end()
      expect(h.voice.getSnapshot().phase).toBe('on')
    }
    expect(labels).toContain('음성: 다시 시작 중')
    expect(FakeRecognition.all).toHaveLength(6)
    FakeRecognition.last.end()
    // 문장: D-I5-03 (AC-I5-06 KEEPS_STOPPING). 시계를 당기지 않으므로 모두 연 지 2초 안에 끝난 "빨리 끝남"이다(D-I5-01)
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'off', error: '음성 인식이 자꾸 끊겨요. 마이크를 확인하고 다시 켜 주세요. 계속 끊기면 PC 크롬이나 안드로이드에서 켜 주세요.' })
  })

  it('"다시 시작 중"은 엔진이 같은 순간에 다시 들어도 1초 동안 보이고, 그 사이 최종 결과가 오면 바로 "듣는 중" (AC-I4-12, TE-I4-001)', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.end()
    expect(FakeRecognition.all).toHaveLength(2)
    expect(h.voice.getSnapshot().stateLabel).toBe('음성: 다시 시작 중')
    vi.advanceTimersByTime(RESTART_LABEL_MS - 1)
    expect(h.voice.getSnapshot().stateLabel).toBe('음성: 다시 시작 중')
    vi.advanceTimersByTime(1)
    expect(h.voice.getSnapshot().stateLabel).toBe('음성: 듣는 중')
    // 보이는 동안 다시 끊기면 그때부터 다시 잰다
    FakeRecognition.last.end()
    vi.advanceTimersByTime(RESTART_LABEL_MS - 200)
    FakeRecognition.last.end()
    vi.advanceTimersByTime(RESTART_LABEL_MS - 1)
    expect(h.voice.getSnapshot().stateLabel).toBe('음성: 다시 시작 중')
    // 최종 결과 = 다시 듣고 있다
    FakeRecognition.last.say('안녕하세요')
    expect(h.voice.getSnapshot().stateLabel).toBe('음성: 듣는 중')
    // 끈 뒤에 남은 기다림이 글자를 되살리지 않는다
    FakeRecognition.last.end()
    h.voice.turnOff()
    vi.advanceTimersByTime(RESTART_LABEL_MS)
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'off', stateLabel: null })
  })

  it('오류로 멈추면 "다시 시작 중" 기다림도 버린다', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.end()
    FakeRecognition.last.fail('audio-capture')
    vi.advanceTimersByTime(RESTART_LABEL_MS)
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'off', stateLabel: null, error: '마이크를 찾지 못했어요. 마이크 연결을 확인해 주세요.' })
  })
})

describe('인식 문장·카드 (AC-I4-13·20, D-I4-09)', () => {
  it('중간 결과는 자막(덮어쓰기), 최종 결과는 자막을 비우고 기록 맨 앞(20개) + 카드', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('15번 핑', false)
    FakeRecognition.last.say('15번 핑크프릴 만오', false)
    expect(h.voice.getSnapshot()).toMatchObject({ interim: '15번 핑크프릴 만오', cards: [] })
    FakeRecognition.last.say('15번 핑크프릴 만오천 원')
    const snapshot = h.voice.getSnapshot()
    expect(snapshot.interim).toBeNull()
    expect(snapshot.heard.map((line) => line.text)).toEqual(['15번 핑크프릴 만오천 원'])
    expect(snapshot.cards).toHaveLength(1)
    expect(h.voice.describe(snapshot.cards[0] as SuggestionCard)).toBe('15번 핑크프릴 15,000원 — 등록할까요?')
    for (let i = 0; i < 25; i++) FakeRecognition.last.say(`잡담 ${String(i)}`)
    expect(h.voice.getSnapshot().heard).toHaveLength(20)
    expect(h.voice.getSnapshot().heard[0]?.text).toBe('잡담 24')
  })

  it('카드를 만들 결과가 아니면(인사·만원만·끊어 말한 번호) 기록에만 남는다', async () => {
    const h = harness()
    await turnOn(h)
    for (const text of ['안녕하세요 여러분', '만원', '십 오번 라울 오천 원', '1 5번 핑크프릴 만오천 원']) FakeRecognition.last.say(text)
    expect(h.voice.getSnapshot().cards).toEqual([])
    expect(h.voice.getSnapshot().heard).toHaveLength(4)
  })

  it('사전 = 지금 범위 이름 → 지난 범위 → 기본 사전; 지금 범위 이름이 바뀌면 다음 문장부터', async () => {
    const h = harness()
    h.fetchHistory.mockResolvedValue([{ date: '2026-10-01', names: ['몽블랑레드'] }])
    await turnOn(h)
    FakeRecognition.last.say('20번 몽블랑레드 만원')
    expect(h.voice.getSnapshot().cards[0]?.name).toBe('몽블랑레드')
    FakeRecognition.last.say('21번 하늘별꽃 만원')
    expect(h.voice.getSnapshot().cards[0]?.name).toBeNull()
    h.names = ['하늘별꽃']
    FakeRecognition.last.say('22번 하늘별꽃 만원')
    expect(h.voice.getSnapshot().cards[0]?.name).toBe('하늘별꽃')
  })

  /** 끝나지 않은 이력 조회 (받기·실패를 시험이 정한다) */
  function pendingHistory(h: Harness): { resolve: (past: readonly PastDay[]) => void; reject: () => void } {
    const out = { resolve: (_past: readonly PastDay[]) => {}, reject: () => {} }
    h.fetchHistory.mockImplementation(
      () =>
        new Promise<readonly PastDay[]>((resolve, reject) => {
          out.resolve = resolve
          out.reject = () => reject(new Error('x'))
        }),
    )
    return out
  }

  it('켠 직후 이력을 받는 동안 온 최종 문장은 기록에 바로 남고, 카드는 이력을 받은 뒤 이력 사전으로 — 온 차례대로 (SA-N3-04, D-I4-06)', async () => {
    const h = harness()
    const history = pendingHistory(h)
    await turnOn(h)
    FakeRecognition.last.say('21번 펭귄얼음 만원')
    FakeRecognition.last.say('22번 핑크프릴 만오천 원')
    expect(h.voice.getSnapshot().heard.map((line) => line.text)).toEqual(['22번 핑크프릴 만오천 원', '21번 펭귄얼음 만원'])
    expect(h.voice.getSnapshot().cards).toEqual([])
    vi.advanceTimersByTime(HISTORY_WAIT_MS - 1)
    expect(h.voice.getSnapshot().cards).toEqual([])
    history.resolve([{ date: '2026-10-11', names: ['펭귄얼음'] }])
    await settle()
    expect(h.voice.getSnapshot().cards.map((card) => [card.no, card.name])).toEqual([
      [22, '핑크프릴'],
      [21, '펭귄얼음'],
    ])
    // 받은 뒤의 문장은 바로 카드
    FakeRecognition.last.say('23번 펭귄얼음 만원')
    expect(h.voice.getSnapshot().cards[0]).toMatchObject({ no: 23, name: '펭귄얼음' })
  })

  it(`이력을 ${String(HISTORY_WAIT_MS)}ms 안에 받지 못하면 그때의 사전으로 카드를 만들고, 그 뒤 문장도 기다리지 않는다`, async () => {
    const h = harness()
    const history = pendingHistory(h)
    await turnOn(h)
    vi.advanceTimersByTime(500)
    FakeRecognition.last.say('21번 펭귄얼음 만원')
    expect(h.voice.getSnapshot().cards).toEqual([])
    vi.advanceTimersByTime(HISTORY_WAIT_MS - 500)
    expect(h.voice.getSnapshot().cards.map((card) => [card.no, card.name])).toEqual([[21, null]])
    FakeRecognition.last.say('22번 핑크프릴 만오천 원')
    expect(h.voice.getSnapshot().cards[0]).toMatchObject({ no: 22, name: '핑크프릴' })
    // 늦게 받은 이력은 다음 문장부터 (이미 만든 카드는 그대로)
    history.resolve([{ date: '2026-10-11', names: ['펭귄얼음'] }])
    await settle()
    expect(h.voice.getSnapshot().cards.find((card) => card.no === 21)?.name).toBeNull()
    FakeRecognition.last.say('24번 펭귄얼음 만원')
    expect(h.voice.getSnapshot().cards[0]).toMatchObject({ no: 24, name: '펭귄얼음' })
  })

  it('이력을 받지 못하면(실패) 미룬 문장을 바로 지금 범위 + 기본 사전으로', async () => {
    const h = harness()
    const history = pendingHistory(h)
    h.names = ['토끼당근']
    await turnOn(h)
    FakeRecognition.last.say('24번 토끼당근 만원')
    expect(h.voice.getSnapshot().cards).toEqual([])
    history.reject()
    await settle()
    expect(h.voice.getSnapshot()).toMatchObject({ historyFailed: true })
    expect(h.voice.getSnapshot().cards.map((card) => [card.no, card.name])).toEqual([[24, '토끼당근']])
  })

  it('이력을 기다리는 동안 끄면 미룬 문장은 카드가 되고(자동 확정 없음), 떠나면 버린다', async () => {
    const auto = { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }
    const h = harness({ readSettings: () => auto })
    pendingHistory(h)
    await turnOn(h)
    FakeRecognition.last.say('15번 핑크프릴 만오천 원')
    h.voice.turnOff()
    expect(h.voice.getSnapshot().cards.map((card) => [card.no, card.autoConfirmAt])).toEqual([[15, null]])
    vi.advanceTimersByTime(60_000)
    expect(h.registered).toEqual([])

    const left = harness()
    pendingHistory(left)
    await turnOn(left)
    FakeRecognition.last.say('16번 라울 만원')
    left.voice.dispose()
    vi.advanceTimersByTime(60_000)
    expect(left.voice.getSnapshot().cards).toEqual([])
  })

  it('미룬 문장은 온 때의 설정으로 카드가 된다 — 끈 채 말하고 기다리는 사이 자동 등록을 켜도 자동 등록하지 않는다 (TE-N3-004, AC-I4-31)', async () => {
    const h = harness()
    const history = pendingHistory(h)
    await turnOn(h)
    FakeRecognition.last.say('15번 라울 만원')
    h.voice.setAutoConfirm(true)
    history.resolve([])
    await settle()
    expect(h.voice.getSnapshot().cards.map((card) => [card.no, card.autoConfirmAt])).toEqual([[15, null]])
    vi.advanceTimersByTime(60_000)
    expect(h.registered).toEqual([])
    // 켠 뒤에 말한 문장은 자동 등록 기다림
    FakeRecognition.last.say('16번 라울 만원')
    expect(h.voice.getSnapshot().cards[0]).toMatchObject({ no: 16, autoConfirmAt: Date.now() + 5000 })
  })

  it('켠 채 말한 미룬 문장도 기다리는 사이 자동 등록을 끄면 자동 등록하지 않는다(다시 켜도), 켠 채 그대로면 카드가 보인 때부터 정한 시간 전부를 기다린다', async () => {
    const auto = { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }
    const h = harness({ readSettings: () => auto })
    const history = pendingHistory(h)
    await turnOn(h)
    FakeRecognition.last.say('15번 라울 만원')
    h.voice.setAutoConfirm(false)
    h.voice.setAutoConfirm(true)
    history.resolve([])
    await settle()
    expect(h.voice.getSnapshot().cards.map((card) => [card.no, card.autoConfirmAt])).toEqual([[15, null]])

    const kept = harness({ readSettings: () => auto })
    pendingHistory(kept)
    await turnOn(kept)
    FakeRecognition.last.say('17번 라울 만원')
    vi.advanceTimersByTime(HISTORY_WAIT_MS)
    expect(kept.voice.getSnapshot().cards[0]).toMatchObject({ no: 17, autoConfirmAt: Date.now() + 5000 })
  })

  it('미룬 문장은 온 때의 번호 범위로 읽는다', async () => {
    let max = 20
    const h = harness({ maxNumber: () => max })
    const history = pendingHistory(h)
    await turnOn(h)
    FakeRecognition.last.say('25번 라울 만원')
    max = 999
    history.resolve([])
    await settle()
    const wide = harness()
    pendingHistory(wide)
    await turnOn(wide)
    FakeRecognition.last.say('25번 라울 만원')
    vi.advanceTimersByTime(HISTORY_WAIT_MS)
    // 범위 20에서 읽은 결과는 범위 999에서 읽은 결과와 같지 않다 (온 때의 범위를 쓴다)
    expect(h.voice.getSnapshot().cards.map((card) => card.no)).not.toEqual(wide.voice.getSnapshot().cards.map((card) => card.no))
  })

  it('끈 뒤에 온 결과는 자막·기록·카드를 만들지 않는다 (stop을 부른다)', async () => {
    const h = harness()
    await turnOn(h)
    const rec = FakeRecognition.last
    h.voice.turnOff()
    expect(rec.stops + rec.aborts).toBeGreaterThan(0)
    rec.say('15번 핑크프릴 만오천 원')
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'off', heard: [], cards: [], interim: null })
  })

  it('떠나면(dispose) 인식을 멈추고 늦은 결과를 받지 않는다', async () => {
    const h = harness()
    await turnOn(h)
    const rec = FakeRecognition.last
    h.voice.dispose()
    expect(rec.stops).toBe(1)
    rec.say('15번 핑크프릴 만오천 원')
    expect(h.voice.getSnapshot().cards).toEqual([])
  })
})

describe('Enter·등록·고치기 (AC-I4-21·22·23, D-I4-03)', () => {
  it('맨 앞이 된 지 1초 안의 Enter는 등록하지 않고 알린다, 1초 뒤엔 맨 앞 카드만 한 번 등록', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('15번 핑크프릴 만오천 원')
    vi.advanceTimersByTime(300)
    FakeRecognition.last.say('16번 라울 만원')
    expect(h.voice.enter('', { wide: true, dialogOpen: false })).toBe(true)
    expect(h.voice.getSnapshot().tooSoon).toBe(true)
    expect(TOO_SOON).toBe('새 카드가 방금 나왔어요. 확인하고 다시 Enter를 눌러 주세요.')
    expect(h.registered).toEqual([])
    vi.advanceTimersByTime(1000)
    expect(h.voice.enter('', { wide: true, dialogOpen: false })).toBe(true)
    expect(h.registered.map((item) => [item.registration, item.source])).toEqual([[{ no: 16, name: '라울', price: 10000 }, 'enter']])
    expect(h.voice.getSnapshot().tooSoon).toBe(false)
    // 15번이 맨 앞이 된 지 1초가 안 됐다 — 두 번째 Enter는 등록하지 않는다
    expect(h.voice.enter('', { wide: true, dialogOpen: false })).toBe(true)
    expect(h.registered).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    h.voice.enter('', { wide: true, dialogOpen: false })
    expect(h.registered.map((item) => item.registration.no)).toEqual([16, 15])
  })

  it('글자가 있는 칸·휴대폰 폭·창·카드 없음 → 카드 쪽이 처리하지 않는다', async () => {
    const h = harness()
    await turnOn(h)
    expect(h.voice.enter('', { wide: true, dialogOpen: false })).toBe(false)
    FakeRecognition.last.say('15번 핑크프릴 만오천 원')
    vi.advanceTimersByTime(2000)
    expect(h.voice.enter('20 라울 10', { wide: true, dialogOpen: false })).toBe(false)
    expect(h.voice.enter('', { wide: false, dialogOpen: false })).toBe(false)
    expect(h.voice.enter('', { wide: true, dialogOpen: true })).toBe(false)
    expect(h.registered).toEqual([])
  })

  it('번호 없는 카드 → 등록 없이 고치기 칸(번호 칸 커서·"번호가 없어요…"), 가격 없는 카드 → 가격 칸', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('핑크프릴 만오천 원')
    const id = h.voice.getSnapshot().cards[0]?.id as string
    h.voice.confirm(id, 'click')
    expect(h.registered).toEqual([])
    expect(h.voice.getSnapshot().forms.get(id)).toMatchObject({ no: '', name: '핑크프릴', price: '15,000원', focus: 'no', message: '번호가 없어요. 번호를 넣어 주세요.' })
    expect(h.voice.getSnapshot().cards[0]?.touched).toBe(true)
    FakeRecognition.last.say('15번 핑크프릴')
    const id2 = h.voice.getSnapshot().cards[0]?.id as string
    h.voice.confirm(id2, 'click')
    expect(h.voice.getSnapshot().forms.get(id2)).toMatchObject({ focus: 'price', message: '가격이 없어요. 가격을 넣어 주세요.' })
  })

  it('"고치기": 처음 값 = 카드 값(가격은 "15,000원"), 커서는 첫 빈 칸, 손댐(자동 확정 끔) / 닫기·Esc', async () => {
    const h = harness({ readSettings: () => ({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }) })
    await turnOn(h)
    FakeRecognition.last.say('15번 만오천 원')
    const id = h.voice.getSnapshot().cards[0]?.id as string
    h.voice.openForm(id)
    expect(h.voice.getSnapshot().forms.get(id)).toMatchObject({ no: '15', name: '', price: '15,000원', focus: 'name' })
    h.voice.closeForm(id)
    expect(h.voice.getSnapshot().forms.has(id)).toBe(false)
    expect(h.voice.getSnapshot().cards[0]?.touched).toBe(true)
    h.voice.close(id)
    expect(h.voice.getSnapshot().cards).toEqual([])
    expect(h.registered).toEqual([])
  })

  it('한 카드는 한 번만 등록 경로로 간다 (누르기·Enter·자동이 겹쳐도)', async () => {
    const h = harness({ readSettings: () => ({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 3 }) })
    await turnOn(h)
    FakeRecognition.last.say('15번 핑크프릴 만오천 원')
    const id = h.voice.getSnapshot().cards[0]?.id as string
    vi.advanceTimersByTime(2999)
    h.voice.confirm(id, 'click')
    h.voice.confirm(id, 'click')
    h.voice.enter('', { wide: true, dialogOpen: false })
    vi.advanceTimersByTime(5000)
    expect(h.registered).toHaveLength(1)
  })

  it('되살리기: 만든 순서 자리에 열린 카드로, 자동 확정 끔, 문장', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('15번 핑크프릴 만오천 원')
    vi.advanceTimersByTime(10)
    FakeRecognition.last.say('16번 라울 만원')
    const old = h.voice.take(h.voice.getSnapshot().cards[1]?.id as string) as SuggestionCard
    h.voice.restore(old, { note: '15번이 이미 있어요. 고칠까요?' })
    const snapshot = h.voice.getSnapshot()
    expect(snapshot.cards.map((card) => card.no)).toEqual([16, 15])
    expect(snapshot.notes.get(old.id)).toBe('15번이 이미 있어요. 고칠까요?')
  })
})

describe('자동 확정 (AC-I4-30·31, D-I4-05)', () => {
  const AUTO = { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }

  it('저장값을 resolveVoiceSettings로 읽는다 (틀린 값은 꺼짐·5초)', async () => {
    for (const stored of [{ 'voice.autoConfirm': 'true' }, { 'voice.autoConfirmSec': 0 }, { 'voice.autoConfirmSec': 31 }, { x: true }, 'x', null]) {
      const h = harness({ readSettings: () => stored })
      await turnOn(h)
      expect(h.voice.getSnapshot().settings).toEqual({ 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5 })
      h.voice.dispose()
    }
  })

  it('만든 시각 + 5초에 자동 등록 (4.9초엔 아직)', async () => {
    const h = harness({ readSettings: () => AUTO })
    await turnOn(h)
    FakeRecognition.last.say('15번 핑크프릴 만오천 원')
    vi.advanceTimersByTime(4900)
    expect(h.registered).toEqual([])
    vi.advanceTimersByTime(100)
    expect(h.registered.map((item) => [item.registration.no, item.source])).toEqual([[15, 'auto']])
  })

  it('LOW·손댐("자동 등록 멈추기")·설정을 끈 채 만든 카드·음성을 끈 뒤 → 자동 등록 없음', async () => {
    const h = harness({ readSettings: () => AUTO })
    await turnOn(h)
    FakeRecognition.last.say('16번 핑크푸릴 만원') // LOW
    FakeRecognition.last.say('17번 라울 만원')
    h.voice.stopAuto(h.voice.getSnapshot().cards[0]?.id as string)
    h.voice.setAutoConfirm(false)
    FakeRecognition.last.say('18번 블루엘프 칠천 원')
    h.voice.setAutoConfirm(true)
    FakeRecognition.last.say('19번 라울 만원')
    h.voice.turnOff()
    vi.advanceTimersByTime(60_000)
    expect(h.registered).toEqual([])
    expect(h.voice.getSnapshot().cards.every((card) => card.autoConfirmAt === null)).toBe(true)
  })

  it('창이 열린 동안 미루고, 닫히면 기다림이 지났으면 바로 등록', async () => {
    const h = harness({ readSettings: () => AUTO })
    await turnOn(h)
    FakeRecognition.last.say('15번 핑크프릴 만오천 원')
    h.dialog = true
    vi.advanceTimersByTime(8000)
    expect(h.registered).toEqual([])
    h.dialog = false
    vi.advanceTimersByTime(300)
    expect(h.registered).toHaveLength(1)
  })

  it('기다림이 같은 순간에 끝난 카드 둘은 그 순간에 함께 등록된다 — 더 새 LOW 카드가 맨 앞이어도 (AC-I4-31, TD-I4-001)', async () => {
    const h = harness({ readSettings: () => AUTO })
    await turnOn(h)
    FakeRecognition.last.sayAll('15번 핑크프릴 만오천 원', '16번 라울 오천 원')
    vi.advanceTimersByTime(500)
    FakeRecognition.last.say('블루엘프 칠천 원') // 번호 없음 — 맨 앞, 자동 확정 없음
    expect(h.voice.getSnapshot().cards).toHaveLength(3)
    vi.advanceTimersByTime(4499)
    expect(h.registered).toEqual([])
    vi.advanceTimersByTime(1)
    expect(h.registered.map((item) => [item.registration.no, item.source]).sort()).toEqual([
      [15, 'auto'],
      [16, 'auto'],
    ])
    vi.advanceTimersByTime(60_000)
    expect(h.registered).toHaveLength(2)
  })

  it('창이 열린 동안 기다림이 지난 카드 둘: 창이 닫혀 다시 보면 둘 다 바로 등록된다 (D-I4-05, TD-I4-001)', async () => {
    const h = harness({ readSettings: () => AUTO })
    await turnOn(h)
    FakeRecognition.last.say('15번 핑크프릴 만오천 원')
    vi.advanceTimersByTime(500)
    FakeRecognition.last.say('16번 라울 오천 원')
    vi.advanceTimersByTime(500)
    FakeRecognition.last.say('블루엘프 칠천 원')
    h.dialog = true
    vi.advanceTimersByTime(7000)
    expect(h.registered).toEqual([])
    h.dialog = false
    h.voice.refresh()
    expect(h.registered.map((item) => item.registration.no)).toEqual([15, 16])
  })

  it('기다림이 끝난 뒤 타이머가 돌기 전에 다른 일(인식 결과)로 타이머를 다시 잡아도 그 카드를 놓치지 않는다 (TD-I4-001)', async () => {
    const h = harness({ readSettings: () => AUTO })
    await turnOn(h)
    FakeRecognition.last.say('15번 핑크프릴 만오천 원')
    // 시계만 간다 — 배경 탭처럼 타이머가 늦는 경우
    vi.setSystemTime(T0 + 5200)
    FakeRecognition.last.say('안녕하세요')
    expect(h.registered).toEqual([])
    vi.advanceTimersByTime(0)
    expect(h.registered.map((item) => item.registration.no)).toEqual([15])
  })

  it('기다림이 끝났는데 확정할 수 없는 카드(그 사이 번호 범위가 줄었다)는 칸을 열지 않고 자동 확정만 끈다 — 다시 넘기지 않고 타이머도 남지 않는다', async () => {
    let max = 999
    const h = harness({ readSettings: () => AUTO, maxNumber: () => max })
    await turnOn(h)
    FakeRecognition.last.say('15번 핑크프릴 만오천 원')
    max = 10
    vi.advanceTimersByTime(5000)
    expect(h.registered).toEqual([])
    expect(h.voice.getSnapshot().cards.map((card) => card.autoConfirmAt)).toEqual([null])
    expect(h.voice.getSnapshot().forms.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('그 순간 그 번호가 있으면 등록 없이 카드에 "고칠까요?"를 붙이고 자동 확정을 끈다', async () => {
    const h = harness({ readSettings: () => AUTO })
    await turnOn(h)
    FakeRecognition.last.say('15번 핑크프릴 만오천 원')
    h.products.set(15, false)
    vi.advanceTimersByTime(5000)
    expect(h.registered).toEqual([])
    const [card] = h.voice.getSnapshot().cards
    expect(card?.autoConfirmAt).toBeNull()
    expect(h.voice.getSnapshot().notes.get(card?.id as string)).toBe('15번이 이미 있어요. 고칠까요?')
    // 판매 종료된 상품이면 그 물음
    FakeRecognition.last.say('16번 라울 만원')
    h.products.set(16, true)
    vi.advanceTimersByTime(5000)
    expect(h.voice.getSnapshot().notes.get(h.voice.getSnapshot().cards[0]?.id as string)).toBe('16번은 판매 종료된 상품이에요. 새 값으로 고쳐서 다시 팔까요?')
  })

  it('기다리는 시간: 3~30 정수만 받고 아니면 checkVoiceSettings 문장(값은 그대로), 받으면 그 기기에 남긴다', async () => {
    const h = harness()
    await turnOn(h)
    for (const text of ['2', '31', '4.5', '', '열']) {
      h.voice.setSeconds(text)
      expect(h.voice.getSnapshot()).toMatchObject({ secondsText: text, settingsProblem: '자동 확정 기다림은 3초부터 30초까지의 정수로 적어 주세요', settings: { 'voice.autoConfirmSec': 5 } })
    }
    expect(h.written).toEqual([])
    h.voice.setSeconds('10')
    expect(h.voice.getSnapshot()).toMatchObject({ settingsProblem: null, settings: { 'voice.autoConfirmSec': 10 } })
    h.voice.setAutoConfirm(true)
    expect(h.written.at(-1)).toEqual({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 10 })
  })
})

describe('아이폰(사파리) 음성 (I5 — D-I5-01~04)', () => {
  const AUTO = { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }

  it('끝에서 넘긴 문장(최종 표시 없이 끝난 중간 결과)의 카드는 자동 등록하지 않고, "등록" 누르기로는 등록된다 (AC-I5-04, D-I5-02)', async () => {
    const h = harness({ readSettings: () => AUTO })
    await turnOn(h)
    FakeRecognition.last.say('15번 핑크프릴 만오천원', false)
    FakeRecognition.last.end()
    const cards = h.voice.getSnapshot().cards
    expect(cards.map((card) => [card.no, card.name, card.price, card.confidence, card.autoConfirmAt, card.flushedAtEnd])).toEqual([[15, '핑크프릴', 15000, 'HIGH', null, true]])
    vi.advanceTimersByTime(30_000)
    expect(h.registered).toEqual([])
    expect(h.voice.getSnapshot().cards).toHaveLength(1)
    h.voice.confirm(cards[0]?.id as string, 'click')
    expect(h.registered.map((item) => [item.registration.no, item.registration.name, item.registration.price, item.source])).toEqual([[15, '핑크프릴', 15000, 'click']])
  })

  it('끝에서 넘긴 카드가 새 카드 3장에 밀려 닫히면 조용히 사라지지 않고 안내가 남는다, "알겠어요"로 닫는다 (U-I5-01)', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('15번 핑크프릴 만오천원', false)
    FakeRecognition.last.end()
    expect(h.voice.getSnapshot().flushedClosed).toEqual([])
    FakeRecognition.last.say('16번 라울 이만원')
    FakeRecognition.last.say('17번 라울 이만원')
    expect(h.voice.getSnapshot().flushedClosed).toEqual([])
    FakeRecognition.last.say('18번 라울 이만원')
    const snapshot = h.voice.getSnapshot()
    expect(snapshot.cards.map((card) => card.no)).toEqual([18, 17, 16])
    expect(snapshot.flushedClosed).toEqual(['15번 핑크프릴 15,000원 — 등록할까요?'])
    // 다른 일로 스냅샷이 바뀌어도 남는다
    FakeRecognition.last.say('19번 라울 이만원')
    expect(h.voice.getSnapshot().flushedClosed).toEqual(['15번 핑크프릴 15,000원 — 등록할까요?'])
    h.voice.dismissFlushedClosed()
    expect(h.voice.getSnapshot().flushedClosed).toEqual([])
    expect(h.registered).toEqual([])
  })

  it('넘긴 카드 두 장이 "알겠어요" 전에 차례로 밀려 닫히면 두 안내가 모두 남는다(앞의 것을 덮지 않음), "알겠어요"로 모두 닫는다 (U-I5-01)', async () => {
    const h = harness({ readSettings: () => ({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }) })
    await turnOn(h)
    // 사파리가 조용해서 연달아 끝남 — 넘긴 카드 두 장
    FakeRecognition.last.say('15번 핑크프릴 만오천원', false)
    FakeRecognition.last.end()
    FakeRecognition.last.say('16번 라울 이만원', false)
    FakeRecognition.last.end()
    expect(h.voice.getSnapshot().cards.map((card) => [card.no, card.flushedAtEnd])).toEqual([[16, true], [15, true]])
    FakeRecognition.last.say('17번 라울 이만원')
    FakeRecognition.last.say('18번 라울 이만원')
    expect(h.voice.getSnapshot().flushedClosed).toEqual(['15번 핑크프릴 15,000원 — 등록할까요?'])
    FakeRecognition.last.say('19번 라울 이만원')
    expect(h.voice.getSnapshot().cards.map((card) => card.no)).toEqual([19, 18, 17])
    expect(h.voice.getSnapshot().flushedClosed).toEqual(['15번 핑크프릴 15,000원 — 등록할까요?', '16번 라울 20,000원 — 등록할까요?'])
    // 넘긴 카드는 자동 등록되지 않는다
    expect(h.registered.map((item) => item.registration.no)).not.toContain(15)
    expect(h.registered.map((item) => item.registration.no)).not.toContain(16)
    h.voice.dismissFlushedClosed()
    expect(h.voice.getSnapshot().flushedClosed).toEqual([])
    // 닫은 뒤 새로 밀려 닫히면 그 한 장만 다시 알린다
    FakeRecognition.last.say('20번 핑크프릴 만오천원', false)
    FakeRecognition.last.end()
    for (const no of ['21', '22', '23']) FakeRecognition.last.say(`${no}번 라울 이만원`)
    expect(h.voice.getSnapshot().flushedClosed).toEqual(['20번 핑크프릴 15,000원 — 등록할까요?'])
  })

  it('보통 카드가 밀려 닫히는 것은 안내하지 않는다 (D-204 그대로)', async () => {
    const h = harness()
    await turnOn(h)
    for (const no of ['15', '16', '17', '18']) FakeRecognition.last.say(`${no}번 라울 이만원`)
    expect(h.voice.getSnapshot().cards.map((card) => card.no)).toEqual([18, 17, 16])
    expect(h.voice.getSnapshot().flushedClosed).toEqual([])
  })

  it('같은 문장이 보통 최종 결과로 오면 I4대로 5초 뒤 자동 등록 (AC-I5-04)', async () => {
    const h = harness({ readSettings: () => AUTO })
    await turnOn(h)
    FakeRecognition.last.say('15번 핑크프릴 만오천원')
    expect(h.voice.getSnapshot().cards[0]?.flushedAtEnd).toBeUndefined()
    vi.advanceTimersByTime(5000)
    expect(h.registered.map((item) => [item.registration.no, item.source])).toEqual([[15, 'auto']])
  })

  it('이력을 기다리며 미룬 끝에서 넘긴 문장도 자동 등록하지 않는다 (AC-I5-04)', async () => {
    const h = harness({ readSettings: () => AUTO })
    let resolve: (past: readonly PastDay[]) => void = () => {}
    h.fetchHistory.mockImplementation(() => new Promise<readonly PastDay[]>((done) => (resolve = done)))
    await turnOn(h)
    FakeRecognition.last.say('15번 핑크프릴 만오천원', false)
    FakeRecognition.last.end()
    expect(h.voice.getSnapshot().cards).toEqual([])
    resolve([])
    await settle()
    expect(h.voice.getSnapshot().cards.map((card) => [card.no, card.autoConfirmAt, card.flushedAtEnd])).toEqual([[15, null, true]])
    vi.advanceTimersByTime(30_000)
    expect(h.registered).toEqual([])
  })

  it('조용함으로 끝난 것(연 지 2초 넘게)은 세지 않고 계속 다시 듣는다 (AC-I5-02, D-I5-01)', async () => {
    const h = harness()
    await turnOn(h)
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(3000)
      FakeRecognition.last.end()
    }
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'on', error: null })
    expect(FakeRecognition.all).toHaveLength(41)
  })

  it('처음 켤 때 service-not-allowed → Siri·받아쓰기 문장, 꺼짐 (AC-I5-05·21, D-I5-03)', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.fail('service-not-allowed')
    FakeRecognition.last.end()
    expect(h.voice.getSnapshot()).toMatchObject({
      phase: 'off',
      error: '이 기기에서 음성 인식이 꺼져 있어요. 아이폰은 설정에서 Siri와 받아쓰기를 켜 주세요. 그래도 안 되면 PC 크롬이나 안드로이드에서 켜 주세요.',
    })
    expect(FakeRecognition.all).toHaveLength(1)
  })

  it('저절로 다시 연 인식에서 not-allowed → "저절로 다시 켜지지 않아요", 다시 켜면 창 없이 새 인식으로 듣고 문장이 사라지며 카드는 남는다 (AC-I5-14)', async () => {
    const h = harness()
    await turnOn(h)
    FakeRecognition.last.say('15번 핑크프릴 만오천원')
    FakeRecognition.last.end()
    expect(FakeRecognition.all).toHaveLength(2)
    FakeRecognition.last.fail('not-allowed')
    FakeRecognition.last.end()
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'off', error: "이 기기는 음성이 저절로 다시 켜지지 않아요. 말하기 전에 '음성 켜기'를 다시 눌러 주세요." })
    expect(FakeRecognition.all).toHaveLength(2)
    await turnOn(h)
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'on', error: null, stateLabel: '음성: 듣는 중' })
    expect(FakeRecognition.all).toHaveLength(3)
    expect(FakeRecognition.last.starts).toBe(1)
    expect(h.voice.getSnapshot().cards.map((card) => card.no)).toEqual([15])
  })

  it('생성자가 둘 다 없으면 창·확인 기록·인식 객체·이력 조회 없이 꺼진 채 문장 (AC-I5-10, D-I5-04)', async () => {
    vi.stubGlobal('SpeechRecognition', undefined)
    vi.stubGlobal('webkitSpeechRecognition', undefined)
    const h = harness()
    h.consent = false
    await turnOn(h)
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'off', error: voiceModule.SPEECH_ERROR_MESSAGES.UNSUPPORTED })
    expect(h.consent).toBe(false)
    expect(FakeRecognition.all).toHaveLength(0)
    expect(h.fetchHistory).not.toHaveBeenCalled()
    // 다시 눌러도 같다
    await turnOn(h)
    expect(h.voice.getSnapshot()).toMatchObject({ phase: 'off', error: voiceModule.SPEECH_ERROR_MESSAGES.UNSUPPORTED })
    expect(h.consent).toBe(false)
  })
})
