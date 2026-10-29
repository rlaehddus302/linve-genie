import './legacy-voice-ui-fixture.ts'
// AC-V3-98 (9)·(10) 화면: 천원 단위 작은 빠른 꼴(D-V3-112)의 카드 안내·가격 칸 고쳐 등록, 손 빠른 입력은 그대로.
// AC-V3-99 (1)·(7) 화면: 번호가 붙은 가격(D-V3-113)은 가격 칸이 빈 카드, 있는 번호면 고칠 값 칸이 빈 고칠까요 카드(D-V3-114 (2)). 실제 코어로 도는 가짜 서버 + 가짜 인식 객체.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { FakeEventSource, flush } from './support.ts'

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
  static say(text: string, final = true): void {
    const rec = FakeRecognition.all.at(-1)
    if (rec === undefined) throw new Error('인식 객체가 없다')
    act(() => {
      rec.results.push({ isFinal: final, length: 1, 0: { transcript: text } })
      rec.onresult?.({ resultIndex: rec.results.length - 1, results: rec.results })
      if (!final) rec.results.pop()
    })
  }
}

let engine: EngineServer

function setup(events: Record<string, unknown>[] = []) {
  engine = new EngineServer(events)
  vi.stubGlobal('fetch', engine.server.fetch)
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
  // PC 폭(48rem 이상) — 음성 카드의 Enter 등록은 PC 모양에서만이다(D-I4-03). jsdom에는 matchMedia가 없어
  // 폭 훅이 휴대폰 모양으로 보므로(S06b 규칙), 다른 화면 시험처럼 PC 폭을 명시한다.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 48rem)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  FakeEventSource.reset()
  FakeRecognition.all.length = 0
  window.localStorage.clear()
  // 바로 등록(기본 켬) 그대로 — 확정 아닌 조각만 카드가 되는지 본다
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  window.localStorage.clear()
})

async function openConsole() {
  const utils = render(<ConsolePage broadcastId="b1" navigate={vi.fn()} />)
  const quick = (await screen.findByLabelText('빠른 입력')) as HTMLInputElement
  await flush(10)
  return { ...utils, quick }
}

async function turnOnVoice(firstTime = true) {
  fireEvent.click(await screen.findByRole('button', { name: '음성 켜기' }))
  if (firstTime) {
    const dialog = await screen.findByRole('dialog', { name: '음성으로 상품 등록' })
    fireEvent.click(within(dialog).getByRole('button', { name: '음성 켜기' }))
  }
  await screen.findByText('음성: 듣는 중')
}

const sleep = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))
/** 조용한 시간(기본 1.8초)이 지나야 최종 결과를 한 덩어리로 읽는다 (D-V2-03, AC-V2-32 — 기대 글은 그대로) */
const quiet = () => sleep(1850)
const updates = () => engine.posts.filter((post) => post.type === 'product.update').map((post) => [post.no, post.name, post.price])
const registers = () => engine.posts.filter((post) => post.type === 'product.register').map((post) => [post.no, post.name, post.price])
const pressEnter = (input: HTMLElement) => fireEvent.keyDown(input, { key: 'Enter' })


describe('AC-V3-98 화면 (D-V3-112)', () => {
  it('(1)·(9) 천원 단위 "9번입니다 17까지" → 등록 없이 카드와 안내, [등록]하면 9번 17,000원', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('9번입니다 17까지')
    await quiet()
    const card = await screen.findByRole('listitem', { name: '9번 품종 미입력 17,000원 카드' })
    expect(within(card).getByText('17,000원으로 들렸어요. 가격을 확인해 주세요')).toBeDefined()
    expect(registers()).toEqual([])
    fireEvent.click(within(card).getByRole('button', { name: '9번 품종 미입력 17,000원 등록' }))
    await waitFor(() => expect(registers()).toEqual([[9, '', 17000]]))
  }, 15_000)

  it('(9) 가격 칸을 170,000으로 고쳐 등록하면 170,000원', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('9번입니다 17까지')
    await quiet()
    fireEvent.click(await screen.findByRole('button', { name: '9번 품종 미입력 17,000원 고치기' }))
    const form = await screen.findByRole('group', { name: '9번 품종 미입력 17,000원 고치기 칸' })
    const price = within(form).getByLabelText('가격') as HTMLInputElement
    fireEvent.change(price, { target: { value: '170,000원' } })
    pressEnter(price)
    await waitFor(() => expect(registers()).toEqual([[9, '', 170000]]))
  }, 15_000)

  it('(10) 손으로 친 빠른 입력 "9 17"(천원 단위)은 지금처럼 17,000원 — 음성을 켜 둬도', async () => {
    setup()
    const { quick } = await openConsole()
    await turnOnVoice()
    fireEvent.change(quick, { target: { value: '9 17' } })
    pressEnter(quick)
    await waitFor(() => expect(registers()).toEqual([[9, '', 17000]]))
  }, 15_000)
})

describe('AC-V3-99 화면 (D-V3-113)', () => {
  it('(1) "자 2275만 원 자 227번이고요" → 등록 없이 가격 칸이 빈 227번 카드와 안내', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('자 2275만 원 자 227번이고요')
    await quiet()
    const card = await screen.findByRole('listitem', { name: '227번 품종 미입력 가격 없음 카드' })
    expect(within(card).getByText('2275만 원으로 들렸어요. 227번 5만 원인지 확인해 주세요')).toBeDefined()
    expect(registers()).toEqual([])
  }, 15_000)

  it('(7) 227번(50,000원)이 있으면 고칠까요 카드: 지금 가격만 보이고 고칠 값 칸은 비어 [고치기]가 눌리지 않음, 값을 넣으면 그 값으로 고침', async () => {
    setup([register(227, '', 50000)])
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('자 2275만 원 자 227번이고요')
    await quiet()
    const offer = await screen.findByRole('listitem', { name: '227번을 고칠까요? 지금 가격 50,000원' })
    expect(within(offer).getByText('2275만 원으로 들렸어요. 227번 5만 원인지 확인해 주세요')).toBeDefined()
    const field = within(offer).getByLabelText('고칠 가격') as HTMLInputElement
    expect(field.value).toBe('')
    const fix = within(offer).getByRole('button', { name: '고치기' }) as HTMLButtonElement
    expect(fix.disabled).toBe(true)
    expect(offer.textContent).not.toContain('22,750,000')
    fireEvent.change(field, { target: { value: '60' } })
    await waitFor(() => expect((within(offer).getByRole('button', { name: '고치기' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(offer).getByRole('button', { name: '고치기' }))
    await waitFor(() => expect(updates()).toEqual([[227, undefined, 60000]]))
    expect(registers()).toEqual([])
  }, 20_000)

  it('(7) [그대로 두기]면 쓰기 0', async () => {
    setup([register(227, '', 50000)])
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('자 2275만 원 자 227번이고요')
    await quiet()
    const offer = await screen.findByRole('listitem', { name: '227번을 고칠까요? 지금 가격 50,000원' })
    fireEvent.click(within(offer).getByRole('button', { name: '그대로 두기' }))
    await waitFor(() => expect(screen.queryByRole('listitem', { name: '227번을 고칠까요? 지금 가격 50,000원' })).toBeNull())
    await flush(10)
    expect(updates()).toEqual([])
    expect(registers()).toEqual([])
  }, 20_000)
})
