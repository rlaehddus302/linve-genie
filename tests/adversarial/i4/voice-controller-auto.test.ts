// I4 적대 테스트 (test-domain): 콘솔 음성 컨트롤러의 자동 확정 타이머 (AC-I4-31, D-204, D-I4-05).
// 실제 음성 모듈 + 실제 Web Speech 어댑터 + 가짜 인식 객체(globalThis.SpeechRecognition) + 가짜 시계(Date·setTimeout).
// 화면 파일은 DOM 타입으로 검사하므로(루트 tsconfig는 Node 타입) 경로를 값으로 불러온다(s05/console-store-race.test.ts와 같은 까닭).
import * as voiceModule from '@livejjim/voice'
import type { CardRegistration, SuggestionCard } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CONTROLLER_MODULE = '../../../apps/web/src/voice/controller.ts'
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
  getSnapshot(): { phase: string; cards: readonly SuggestionCard[] }
}
type ControllerCtor = new (host: unknown) => ControllerLike

async function start(settings: unknown, dialog: { open: boolean } = { open: false }) {
  const { VoiceController } = (await import(/* @vite-ignore */ CONTROLLER_MODULE)) as { VoiceController: ControllerCtor }
  const registered: { registration: CardRegistration; source: string }[] = []
  const host = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    currentNames: () => [] as readonly string[],
    products: () => new Map<number, boolean>(),
    fetchHistory: async () => [],
    dialogOpen: () => dialog.open,
    readConsent: () => true,
    writeConsent: () => {},
    readSettings: () => settings,
    writeSettings: () => {},
    register: (_card: SuggestionCard, registration: CardRegistration, source: string) => {
      registered.push({ registration, source })
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
    await vi.advanceTimersByTimeAsync(4_999)
    expect(registered).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    // 기대: 15번·16번 둘 다 T0 + 5초에 (AC-I4-31 "만든 시각 + 5초에 등록된다")
    expect(registered.map((item) => item.registration.no).sort()).toEqual([15, 16])
  })

  it('그 뒤에 더 새 카드(자동 확정 없음)가 맨 앞이어도 두 번째 카드가 자동 등록된다 (지금은 타이머가 없어 1분이 지나도 멈춰 있다)', async () => {
    const { voice, registered, recognition } = await start({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 })
    recognition.sayAll('15번 핑크프릴 만오천 원', '16번 라울 오천 원')
    await vi.advanceTimersByTimeAsync(500)
    // 번호 없는 카드(품종·가격만 — 확인 필요, 자동 확정 없음)가 맨 앞
    recognition.sayAll('블루엘프 칠천 원')
    expect(voice.getSnapshot().cards).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(4_500)
    expect(registered).toHaveLength(1)
    // 남은 카드는 "1초 뒤 자동 등록"을 보인 채 멈춰 있다 — 1분이 지나도
    await vi.advanceTimersByTimeAsync(60_000)
    expect(registered.map((item) => item.registration.no).sort()).toEqual([15, 16])
  })

  it('기다리는 시간을 5초 → 3초로 바꾼 뒤의 카드가 앞 카드와 같은 시각에 끝나도 둘 다 제때 등록된다', async () => {
    const { voice, registered, recognition } = await start({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 })
    recognition.sayAll('15번 핑크프릴 만오천 원') // T0 + 5초
    await vi.advanceTimersByTimeAsync(2_000)
    voice.setSeconds('3')
    recognition.sayAll('16번 라울 오천 원') // T0 + 2초 + 3초 = T0 + 5초
    await vi.advanceTimersByTimeAsync(500)
    recognition.sayAll('블루엘프 칠천 원') // 맨 앞(자동 확정 없음)
    await vi.advanceTimersByTimeAsync(2_500)
    expect(registered.map((item) => item.registration.no).sort()).toEqual([15, 16])
  })

  it('창이 열린 동안 기다림이 지난 카드 둘: 창을 닫으면 둘 다 바로 등록된다 (D-I4-05 "창을 닫으면 그때 다시 보고 기다림이 지났으면 바로 등록")', async () => {
    const dialog = { open: false }
    const { voice, registered, recognition } = await start({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }, dialog)
    recognition.sayAll('15번 핑크프릴 만오천 원') // T0 + 5초
    await vi.advanceTimersByTimeAsync(500)
    recognition.sayAll('16번 라울 오천 원') // T0 + 5.5초
    await vi.advanceTimersByTimeAsync(500)
    recognition.sayAll('블루엘프 칠천 원') // 맨 앞(자동 확정 없음)
    dialog.open = true
    await vi.advanceTimersByTimeAsync(7_000) // T0 + 8초: 둘 다 기다림이 지났다
    expect(registered).toHaveLength(0)
    dialog.open = false
    voice.refresh() // 콘솔은 창 수가 바뀌면 refresh를 부른다
    await vi.advanceTimersByTimeAsync(300)
    expect(registered.map((item) => item.registration.no).sort()).toEqual([15, 16])
  })
})
