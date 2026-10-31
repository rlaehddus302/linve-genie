// V3 실방송 보강: 인식 끊김을 컨트롤러가 받아 탭 메모리에 두고, 기록 모아 두기가 켜져 있으면 "인식 끊김 0.8초 (network)" 한 줄을 남긴다.
// 쉬는 틈 다시 열기는 "다시 시작 중"을 보이지 않는다. 기기 안 인식은 확인만 한다. 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계.
import * as voiceModule from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArchiveGap } from '../../src/controller/archive-model.ts'
import { VoiceController, type VoiceHost } from '../../src/controller/controller.ts'

const T0 = Date.UTC(2026, 9, 26, 11, 0, 0)

class FakeRecognition {
  static readonly all: FakeRecognition[] = []
  static availableAnswer: string | null = null
  static availableCalls: unknown[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  onaudiostart: (() => void) | null = null
  onaudioend: (() => void) | null = null
  starts = 0
  stops = 0
  aborts = 0
  results: { isFinal: boolean; length: number; 0: { transcript: string } }[] = []
  constructor() {
    FakeRecognition.all.push(this)
  }
  static available(options: unknown): Promise<string> {
    FakeRecognition.availableCalls.push(options)
    return FakeRecognition.availableAnswer === null ? Promise.reject(new Error('없음')) : Promise.resolve(FakeRecognition.availableAnswer)
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

function harness(settings: unknown, patch: Partial<VoiceHost> = {}) {
  const gaps: ArchiveGap[] = []
  const written: unknown[] = []
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
    readSettings: () => settings,
    writeSettings: (value) => {
      written.push(value)
    },
    register: () => {},
    focusQuick: () => {},
    archiveGap: (gap) => {
      gaps.push(gap)
    },
    ...patch,
  }
  return { voice: new VoiceController(host), gaps, written }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  FakeRecognition.all.length = 0
  FakeRecognition.availableAnswer = null
  FakeRecognition.availableCalls = []
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('인식 끊김 기록', () => {
  it('network로 끝나 0.8초 뒤 다시 들으면 탭 메모리와 기록에 "인식 끊김 0.8초 (network)" — 들은 글은 없다', async () => {
    // 이 시험은 결과 없이 5초를 넘긴다 — 멈춤 지킴이는 길게
    const h = harness({ 'voice.archive': true, 'voice.stallMs': 60_000 })
    await h.voice.turnOn()
    await settle()
    const first = FakeRecognition.last
    first.onaudiostart?.()
    vi.advanceTimersByTime(5_000)
    first.say('15번 비밀말가나다 만 원')
    first.onerror?.({ error: 'network' })
    first.onend?.()
    expect(FakeRecognition.all).toHaveLength(2)
    vi.advanceTimersByTime(800)
    FakeRecognition.last.onaudiostart?.()
    expect(h.voice.recognitionGaps()).toEqual([{ from: T0 + 5_000, to: T0 + 5_800, ms: 800, reason: 'network', retries: 0 }])
    expect(h.gaps).toEqual([{ at: T0 + 5_800, ms: 800, reason: 'network', text: '인식 끊김 0.8초 (network)' }])
    expect(JSON.stringify(h.gaps)).not.toContain('비밀말가나다')
    h.voice.dispose()
  })

  it('기록 모아 두기가 꺼져 있으면 기기에 남기지 않는다(탭 메모리에만)', async () => {
    const h = harness({ 'voice.archive': false })
    await h.voice.turnOn()
    await settle()
    vi.advanceTimersByTime(3_000)
    FakeRecognition.last.onend?.()
    vi.advanceTimersByTime(400)
    FakeRecognition.last.onaudiostart?.()
    expect(h.voice.recognitionGaps().map((g) => g.reason)).toEqual(['end'])
    expect(h.gaps).toEqual([])
    h.voice.dispose()
  })

  it('쉬는 틈 다시 열기는 "다시 시작 중"을 보이지 않고 planned 끊김으로 남는다', async () => {
    const h = harness({ 'voice.archive': true, 'voice.stallMs': 60_000 })
    await h.voice.turnOn()
    await settle()
    const first = FakeRecognition.last
    first.onaudiostart?.()
    vi.advanceTimersByTime(voiceModule.PLANNED_RESTART_AFTER_MS)
    first.say('15번 라울 만 원')
    expect(first.stops).toBe(1)
    first.onend?.()
    expect(h.voice.getSnapshot().stateLabel).toBe('음성: 듣는 중')
    vi.advanceTimersByTime(300)
    FakeRecognition.last.onaudiostart?.()
    expect(h.gaps.map((g) => g.text)).toEqual(['인식 끊김 0.3초 (planned)'])
    expect(h.voice.getSnapshot().stateLabel).toBe('음성: 듣는 중')
    h.voice.dispose()
  })
})

describe('기기 안 인식 (확인만)', () => {
  it('켤 때 ko-KR processLocally를 확인해 값만 둔다 — 인식 객체 설정은 바꾸지 않는다', async () => {
    FakeRecognition.availableAnswer = 'available'
    const h = harness({})
    expect(h.voice.onDeviceRecognition()).toBeNull()
    await h.voice.turnOn()
    await settle()
    expect(FakeRecognition.availableCalls).toEqual([{ langs: ['ko-KR'], processLocally: true }])
    expect(h.voice.onDeviceRecognition()).toBe('available')
    expect(FakeRecognition.all).toHaveLength(1)
    expect(Object.hasOwn(FakeRecognition.last, 'processLocally')).toBe(false)
    h.voice.dispose()
  })

  it('확인할 수 없으면 unsupported', async () => {
    const h = harness({})
    await h.voice.turnOn()
    await settle()
    expect(h.voice.onDeviceRecognition()).toBe('unsupported')
    h.voice.dispose()
  })
})

describe('멈춤 지킴이 (듣는 중인 채 결과 없음)', () => {
  it('소리를 받는 중 2초 결과가 없으면 abort하고 같은 순간 새 객체 — "듣는 중" 그대로, 기록에 멈춤·첫 결과 줄', async () => {
    const h = harness({ 'voice.archive': true })
    await h.voice.turnOn()
    await settle()
    const first = FakeRecognition.last
    first.onaudiostart?.()
    vi.advanceTimersByTime(voiceModule.STALL_MS)
    expect(first.aborts).toBe(1)
    expect(FakeRecognition.all).toHaveLength(2)
    expect(FakeRecognition.last.starts).toBe(1)
    expect(h.voice.getSnapshot().stateLabel).toBe('음성: 듣는 중')
    expect(h.voice.getSnapshot().error).toBeNull()
    vi.advanceTimersByTime(200)
    FakeRecognition.last.onaudiostart?.()
    vi.advanceTimersByTime(700)
    FakeRecognition.last.say('15번 라울 만 원')
    expect(h.gaps.map((g) => g.text)).toEqual(['인식 멈춤 2.0초 → 다시 켬', '인식 끊김 0.2초 (stall)', '다시 켠 뒤 시작 0.2초 · 첫 결과 0.9초 (stall)'])
    expect(h.voice.recognitionDiagnostics().map((d) => d.kind)).toEqual(['stall', 'first-result'])
    h.voice.dispose()
  })

  it('그 기기 저장값 voice.stallMs(1초보다 짧으면 1초)로 바꾸고, 설정을 쓸 때 그 값을 지우지 않는다', async () => {
    const h = harness({ 'voice.stallMs': 400 })
    await h.voice.turnOn()
    await settle()
    FakeRecognition.last.onaudiostart?.()
    vi.advanceTimersByTime(999)
    expect(FakeRecognition.all).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeRecognition.all).toHaveLength(2)
    h.voice.setArchive(false)
    expect(h.written.at(-1)).toMatchObject({ 'voice.stallMs': 1_000 })
    h.voice.dispose()
  })
})
