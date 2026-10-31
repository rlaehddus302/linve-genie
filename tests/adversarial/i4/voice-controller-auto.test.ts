// I4 적대 테스트 (test-domain): 콘솔 음성 컨트롤러의 자동 확정 타이머 (AC-I4-31, D-204, D-I4-05).
// 실제 음성 모듈 + 실제 Web Speech 어댑터 + 가짜 인식 객체(globalThis.SpeechRecognition) + 가짜 시계(Date·setTimeout).
// 화면 파일은 DOM 타입으로 검사하므로(루트 tsconfig는 Node 타입) 경로를 값으로 불러온다(s05/console-store-race.test.ts와 같은 까닭).
import * as voiceModule from '@livejjim/voice'
import type { CardRegistration, SuggestionCard } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 화면처럼 같은 상품 이름 목록을 돌려준다(ConsolePage useMemo — 상품이 바뀔 때만 새 목록). 부를 때마다 새 목록이면 컨트롤러가 사전을
// 매번 다시 만든다(#prepared는 목록이 같을 때만 다시 씀) — 사전이 1,082개로 커진 뒤(D-V3-115) 시험이 느려진 틀 문제. 단언은 그대로.
const NO_NAMES: readonly string[] = []

// SRV1(D-APP-22·23, AC-SRV1-15): 음성 읽기 컨트롤러는 웹에서 서버 음성 흐름(packages/voice-session, server.ts createReadingSession)으로 옮겼다 — 같은 사례를 지금 제품 경로에서 본다.
const CONTROLLER_MODULE = '../../../packages/voice-session/src/controller/controller.ts'
const T0 = Date.UTC(2026, 9, 20, 1, 0, 0)

class FakeRecognition {
  static all: FakeRecognition[] = []
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
  /** 최종 결과 여러 개를 한 이벤트로 (크롬은 이어 말하면 한 onresult에 최종 결과를 여럿 담을 수 있다) */
  sayAll(...texts: string[]): void {
    const from = this.results.length
    for (const text of texts) this.results.push({ isFinal: true, length: 1, 0: { transcript: text } })
    this.onresult?.({ resultIndex: from, results: this.results })
  }
}

interface ControllerLike {
  turnOn(): Promise<void>
  setSeconds(text: string): void
  refresh(): void
  getSnapshot(): { phase: string; cards: readonly SuggestionCard[]; notes: ReadonlyMap<string, string> }
}
type ControllerCtor = new (host: unknown) => ControllerLike

interface HostOverrides {
  maxNumber?: () => number
  products?: () => Map<number, boolean>
  onRegister?: (card: SuggestionCard, voice: ControllerLike & { restore(card: SuggestionCard, options?: { note?: string }): void }) => void
}

async function start(settings: unknown, dialog: { open: boolean } = { open: false }, overrides: HostOverrides = {}) {
  const { VoiceController } = (await import(/* @vite-ignore */ CONTROLLER_MODULE)) as { VoiceController: ControllerCtor }
  const registered: { registration: CardRegistration; source: string }[] = []
  const host = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: overrides.maxNumber ?? (() => 999),
    currentNames: () => NO_NAMES,
    products: overrides.products ?? (() => new Map<number, boolean>()),
    fetchHistory: async () => [],
    dialogOpen: () => dialog.open,
    readConsent: () => true,
    writeConsent: () => {},
    readSettings: () => settings,
    writeSettings: () => {},
    register: (card: SuggestionCard, registration: CardRegistration, source: string) => {
      registered.push({ registration, source })
      overrides.onRegister?.(card, voice as never)
    },
    focusQuick: () => {},
  }
  const voice = new VoiceController(host)
  await voice.turnOn()
  expect(voice.getSnapshot().phase).toBe('on')
  const recognition = FakeRecognition.all.at(-1)
  if (recognition === undefined) throw new Error('인식 객체가 없다')
  return { voice, registered, recognition }
}

/** V2: 말이 끝나고 조용한 시간(1.8초)이 지나야 덩어리가 끝나 카드가 생긴다 — 시계만 넘기고 기대는 그대로 (AC-V2-32) */
const quiet = () => vi.advanceTimersByTimeAsync(1_800)

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  FakeRecognition.all = []
  ;(globalThis as Record<string, unknown>)['SpeechRecognition'] = FakeRecognition
})
afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as Record<string, unknown>)['SpeechRecognition']
})

describe('TD-I4-001 자동 확정 시각이 같은 카드 둘 — 하나만 제때 등록되고 다른 하나는 늦거나 멈춘다 (AC-I4-31)', () => {
  it('한 이벤트로 온 HIGH 카드 둘(같은 밀리초): 둘 다 만든 시각 + 5초에 등록된다', async () => {
    const { registered, recognition } = await start({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 })
    recognition.sayAll('15번 핑크프릴 만오천 원', '16번 라울 오천 원')
    await quiet() // 조용한 시간 1.8초가 지나야 카드가 된다 (AC-V2-32, D-V2-03)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(registered).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    // 기대: 15번·16번 둘 다 T0 + 5초에 (AC-I4-31 "만든 시각 + 5초에 등록된다")
    expect(registered.map((item) => item.registration.no).sort()).toEqual([15, 16])
  })

  it('그 뒤에 더 새 카드(자동 확정 없음)가 맨 앞이어도 두 번째 카드가 자동 등록된다 (GATE-I4-VERIFY: 그 순간에 둘 다)', async () => {
    const { voice, registered, recognition } = await start({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 })
    recognition.sayAll('15번 핑크프릴 만오천 원', '16번 라울 오천 원')
    await quiet() // 조용한 시간 1.8초가 지나야 카드가 된다 (AC-V2-32, D-V2-03)
    await vi.advanceTimersByTimeAsync(500)
    // 자동 확정 없는 카드가 맨 앞 — D-V3-41로 번호 없는 결과는 카드가 아니므로 번호만 있는 카드("가격을 말하면 바로 등록돼요")로
    recognition.sayAll('17번 블루엘프')
    await quiet() // 조용한 시간 1.8초가 지나야 카드가 된다 (AC-V2-32, D-V2-03)
    expect(voice.getSnapshot().cards).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(4_499)
    expect(registered).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    // 판정 GATE-I4-VERIFY: 기다림이 같은 순간(T0 + 5초)에 끝난 카드는 맨 앞이 LOW 카드여도 그 순간에 모두 등록된다
    expect(registered.map((item) => item.registration.no).sort()).toEqual([15, 16])
    // 한 카드는 한 번만 (1분이 지나도 더 등록되지 않는다)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(registered).toHaveLength(2)
  })

  it('기다리는 시간을 5초 → 3초로 바꾼 뒤의 카드가 앞 카드와 같은 시각에 끝나도 둘 다 제때 등록된다', async () => {
    const { voice, registered, recognition } = await start({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 })
    recognition.sayAll('15번 핑크프릴 만오천 원') // T0 + 5초
    await quiet() // 조용한 시간 1.8초가 지나야 카드가 된다 (AC-V2-32, D-V2-03)
    await vi.advanceTimersByTimeAsync(2_000)
    voice.setSeconds('3')
    recognition.sayAll('16번 라울 오천 원') // T0 + 2초 + 3초 = T0 + 5초
    await quiet() // 조용한 시간 1.8초가 지나야 카드가 된다 (AC-V2-32, D-V2-03)
    await vi.advanceTimersByTimeAsync(500)
    recognition.sayAll('블루엘프 칠천 원') // 맨 앞(자동 확정 없음)
    await quiet() // 조용한 시간 1.8초가 지나야 카드가 된다 (AC-V2-32, D-V2-03)
    await vi.advanceTimersByTimeAsync(2_500)
    expect(registered.map((item) => item.registration.no).sort()).toEqual([15, 16])
  })

  it('창이 열린 동안 기다림이 지난 카드 둘: 창을 닫으면 둘 다 바로 등록된다 (D-I4-05 "창을 닫으면 그때 다시 보고 기다림이 지났으면 바로 등록")', async () => {
    const dialog = { open: false }
    const { voice, registered, recognition } = await start({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }, dialog)
    recognition.sayAll('15번 핑크프릴 만오천 원') // T0 + 5초
    await quiet() // 조용한 시간 1.8초가 지나야 카드가 된다 (AC-V2-32, D-V2-03)
    await vi.advanceTimersByTimeAsync(500)
    recognition.sayAll('16번 라울 오천 원') // T0 + 5.5초
    await quiet() // 조용한 시간 1.8초가 지나야 카드가 된다 (AC-V2-32, D-V2-03)
    await vi.advanceTimersByTimeAsync(500)
    recognition.sayAll('블루엘프 칠천 원') // 맨 앞(자동 확정 없음)
    await quiet() // 조용한 시간 1.8초가 지나야 카드가 된다 (AC-V2-32, D-V2-03)
    dialog.open = true
    await vi.advanceTimersByTimeAsync(7_000) // T0 + 8초: 둘 다 기다림이 지났다
    expect(registered).toHaveLength(0)
    dialog.open = false
    voice.refresh() // 콘솔은 창 수가 바뀌면 refresh를 부른다
    await vi.advanceTimersByTimeAsync(300)
    expect(registered.map((item) => item.registration.no).sort()).toEqual([15, 16])
  })
})

describe('TD-I4-001 회귀 — 함께 끝난 카드를 모두 등록하는 고침이 만든 새 길 (GATE-I4-VERIFY)', () => {
  it('같은 순간 셋 중 가운데 번호가 이미 있으면: 나머지 둘은 등록, 가운데는 "고칠까요?"·자동 확정 끔·창 없음', async () => {
    const { voice, registered, recognition } = await start({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }, { open: false }, {
      products: () => new Map([[16, false]]),
    })
    recognition.sayAll('15번 핑크프릴 만오천 원', '16번 라울 오천 원', '17번 블루엘프 칠천 원')
    await quiet() // 조용한 시간 1.8초가 지나야 카드가 된다 (AC-V2-32, D-V2-03)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(registered.map((item) => item.registration.no).sort()).toEqual([15, 17])
    const snapshot = voice.getSnapshot()
    expect(snapshot.cards.map((card) => card.no)).toEqual([16])
    expect(snapshot.cards[0]?.autoConfirmAt).toBeNull()
    expect(snapshot.notes.get(snapshot.cards[0]?.id ?? '')).toContain('16번')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(registered).toHaveLength(2)
  })

  it('첫 자동 등록이 창을 열면 남은 카드는 미루고, 창을 닫으면 그때 등록한다 (한 카드 한 번)', async () => {
    const dialog = { open: false }
    const { voice, registered, recognition } = await start({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }, dialog, {
      onRegister: () => {
        dialog.open = true
      },
    })
    recognition.sayAll('15번 핑크프릴 만오천 원', '16번 라울 오천 원')
    await quiet() // 조용한 시간 1.8초가 지나야 카드가 된다 (AC-V2-32, D-V2-03)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(registered).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(registered).toHaveLength(1)
    dialog.open = false
    voice.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(registered.map((item) => item.registration.no).sort()).toEqual([15, 16])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(registered).toHaveLength(2)
  })

  it('등록 경로가 그 자리에서 카드를 되돌려도(차례에서 같은 번호) 그 카드를 다시 자동 등록하지 않는다', async () => {
    const { voice, registered, recognition } = await start({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }, { open: false }, {
      onRegister: (card, controller) => {
        if (card.no === 15) controller.restore(card, { note: '15번이 이미 있어요. 고칠까요?' })
      },
    })
    recognition.sayAll('15번 핑크프릴 만오천 원', '16번 라울 오천 원')
    await quiet() // 조용한 시간 1.8초가 지나야 카드가 된다 (AC-V2-32, D-V2-03)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(registered.map((item) => item.registration.no).sort()).toEqual([15, 16])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(registered).toHaveLength(2)
    const cards = voice.getSnapshot().cards
    expect(cards.map((card) => card.no)).toEqual([15])
    expect(cards[0]?.autoConfirmAt).toBeNull()
  })

  it('기다리는 동안 번호 상한이 줄어 등록할 수 없는 카드: 바쁜 반복 없이 자동 확정만 끄고 다른 카드는 제때 등록', async () => {
    let max = 999
    const { voice, registered, recognition } = await start({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }, { open: false }, {
      maxNumber: () => max,
    })
    recognition.sayAll('15번 핑크프릴 만오천 원', '120번 라울 오천 원')
    await quiet() // 조용한 시간 1.8초가 지나야 카드가 된다 (AC-V2-32, D-V2-03)
    max = 50
    await vi.advanceTimersByTimeAsync(5_000)
    expect(registered.map((item) => item.registration.no)).toEqual([15])
    const left = voice.getSnapshot().cards
    expect(left.map((card) => card.no)).toEqual([120])
    expect(left[0]?.autoConfirmAt).toBeNull()
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1)
  })
})
