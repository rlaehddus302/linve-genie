import styles from '../src/styles.css?raw'
// V2 음성 칸 화면 (AC-V2-07·08·16·17·23·26·28·34, D-V2-01·06~09) — 실제 코어로 도는 가짜 서버 + 가짜 인식 객체.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { VOICE_LEARNED_KEY, VOICE_SETTINGS_KEY } from '../src/voice/storage.ts'
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
const registers = () => engine.posts.filter((post) => post.type === 'product.register').map((post) => [post.no, post.name, post.price])

const updates = () => engine.posts.filter((post) => post.type === 'product.update').map((post) => [post.no, post.name, post.price])
const voiceRegion = () => screen.getByRole('region', { name: '음성 등록' })
const heardBox = () => screen.getByRole('region', { name: '지금 들리는 말' })

describe('"들은 말" 칸 (AC-V2-17, D-V2-07)', () => {
  it('모으는 동안 모은 글·중간 결과·"듣는 중…", 읽으면 결과 한 줄 — 받은 글은 글자로만', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    // 제목 없이 글만 (D-V2-21)
    expect(heardBox().textContent).toBe('말하면 여기에 보여요')
    FakeRecognition.say('<b>15번</b> 엘레강스')
    FakeRecognition.say('이만', false)
    const box = heardBox()
    expect(within(box).getByText('듣는 중…')).toBeDefined()
    expect(box.textContent).toContain('<b>15번</b> 엘레강스 이만')
    expect(box.querySelector('b')).toBeNull()
    expect(within(box).getByText('이만').className).toContain('voice-now-interim')
    FakeRecognition.say('15번 엘레강스 이만원')
    await quiet()
    expect(within(heardBox()).getByRole('status').textContent).toBe('15번 · 엘레강스 · 20,000원')
    expect(within(heardBox()).queryByText('듣는 중…')).toBeNull()
    // 영어 상태값은 보이지 않는다 (AC-V2-34)
    expect(voiceRegion().textContent).not.toMatch(/HIGH|LOW|final/)
  }, 15_000)

  it('카드를 만들 수 없는 말은 "번호와 가격이 안 들렸어요"', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('안녕하세요 여러분')
    await quiet()
    expect(within(heardBox()).getByRole('status').textContent).toBe('번호와 가격이 안 들렸어요')
  }, 15_000)
})

describe('후보 단추·빈 품종 등록 (AC-V2-07·08·09)', () => {
  it('S9: "품종 확인 필요"와 후보 "선버스트" → 누르면 품종이 되고 배운 품종으로 저장', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('19번 선버스 팔천원')
    await quiet()
    const card = screen.getByRole('listitem', { name: '19번 품종 미입력 8,000원 카드' })
    expect(within(card).getByText('품종 확인 필요')).toBeDefined()
    fireEvent.click(within(card).getByRole('button', { name: '선버스트' }))
    const chosen = screen.getByRole('listitem', { name: '19번 선버스트 8,000원 카드' })
    expect(within(chosen).queryByRole('button', { name: '선버스트' })).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(VOICE_LEARNED_KEY) ?? '[]')).toMatchObject([{ heard: '선버스', name: '선버스트' }])
  }, 15_000)

  it('S10: 품종 빈칸 카드의 "등록" → 품종 미입력 상품', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('20번 음 그거 오천원')
    await quiet()
    fireEvent.click(screen.getByRole('button', { name: '20번 품종 미입력 5,000원 등록' }))
    await waitFor(() => expect(registers()).toEqual([[20, '', 5000]]))
  }, 15_000)
})

describe('고칠까요 카드 (AC-V2-26, D-V2-06 3)', () => {
  it('음성 카드로 등록한 뒤 "만오천 말고 만팔천" → 고칠까요, [고치기]는 손 고치기와 같은 product.update, [되돌리기]는 앞 값으로', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('15번 핑크문 만오천원')
    await quiet()
    fireEvent.click(screen.getByRole('button', { name: '15번 핑크문 15,000원 등록' }))
    await waitFor(() => expect(registers()).toEqual([[15, '핑크문', 15000]]))
    await flush(10)
    FakeRecognition.say('만오천 말고 만팔천')
    await quiet()
    const offer = await screen.findByRole('listitem', { name: '방금 등록한 15번 핑크문을 18,000원으로 고칠까요?' })
    expect(updates()).toEqual([])
    fireEvent.click(within(offer).getByRole('button', { name: '고치기' }))
    await waitFor(() => expect(updates()).toEqual([[15, undefined, 18000]]))
    const fixed = await screen.findByRole('listitem', { name: '고쳤어요. 10초 안에는 되돌릴 수 있어요.' })
    fireEvent.click(within(fixed).getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(updates()).toEqual([[15, undefined, 18000], [15, undefined, 15000]]))
  }, 20_000)
})

describe('음성 기록 보기·조용한 시간 설정 (AC-V2-16·28·29)', () => {
  it('켠 뒤 [음성 기록 보기] → 창에 덩어리 기록, [기록 지우기]면 비고, 조용한 시간 칸은 그 기기에 저장', async () => {
    setup()
    await openConsole()
    expect(screen.queryByRole('button', { name: '음성 기록' })).toBeNull()
    await turnOnVoice()
    const quietField = screen.getByLabelText('말이 끝났다고 볼 때까지(초)') as HTMLInputElement
    expect(quietField.value).toBe('1.8')
    fireEvent.change(quietField, { target: { value: '4.5' } })
    expect(screen.getByText('말이 끝났다고 볼 때까지는 1.0초부터 4.0초까지 0.1초 단위로 정해 주세요')).toBeDefined()
    fireEvent.change(quietField, { target: { value: '1.0' } })
    expect(JSON.parse(window.localStorage.getItem(VOICE_SETTINGS_KEY) ?? 'null')).toEqual({ 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5, 'voice.quietMs': 1000 })
    FakeRecognition.say('아니 이거 너무 예쁘죠')
    await sleep(1100)
    fireEvent.click(screen.getByRole('button', { name: '음성 기록' }))
    const dialog = await screen.findByRole('dialog', { name: '음성 기록' })
    expect(dialog.textContent).toContain('아니 이거 너무 예쁘죠')
    expect(dialog.textContent).toContain('버림')
    // 열린 카드도 방금 등록한 상품도 없다 (D-V2-06 4)
    expect(dialog.textContent).toContain('고칠 카드가 없어요')
    fireEvent.click(within(dialog).getByRole('button', { name: '기록 지우기' }))
    expect(dialog.textContent).toContain('아직 기록이 없어요.')
    // 받아쓴 글은 저장소에 없다 (AC-V2-30)
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('예쁘죠')
  }, 15_000)
})

describe('V2 화면 지적 (D-V2-19~21, U-V2-01~06, RA-V2-02)', () => {
  it('U-V2-01·D-V2-19: 카드 12,000원에 "만오천 말고 만팔천" → 카드는 그대로, 카드 위 고칠까요 → [고치기]면 18,000원, 저절로 등록 없음', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('15번 핑크문 만이천원')
    await quiet()
    expect(screen.getByRole('listitem', { name: '15번 핑크문 12,000원 카드' })).toBeDefined()
    FakeRecognition.say('만오천 말고 만팔천')
    await quiet()
    const card = screen.getByRole('listitem', { name: '15번 핑크문 12,000원 카드' })
    const ask = within(card).getByRole('group', { name: '12,000원을 18,000원으로 고칠까요?' })
    fireEvent.click(within(ask).getByRole('button', { name: '고치기' }))
    const fixed = screen.getByRole('listitem', { name: '15번 핑크문 18,000원 카드' })
    expect(fixed.textContent).toContain('고쳤어요: 가격 12,000원 → 18,000원')
    expect(within(fixed).queryByRole('group', { name: /고칠까요/ })).toBeNull()
    expect(registers()).toEqual([])
  }, 15_000)

  it('U-V2-01: [그대로 두기]면 12,000원 그대로', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('15번 핑크문 만이천원')
    await quiet()
    FakeRecognition.say('만오천 말고 만팔천')
    await quiet()
    fireEvent.click(within(screen.getByRole('group', { name: '12,000원을 18,000원으로 고칠까요?' })).getByRole('button', { name: '그대로 두기' }))
    expect(screen.getByRole('listitem', { name: '15번 핑크문 12,000원 카드' })).toBeDefined()
    expect(screen.queryByRole('group', { name: /고칠까요/ })).toBeNull()
    expect(registers()).toEqual([])
  }, 15_000)

  it('U-V2-02·03·D-V2-21: "음성 설정과 기록" 접는 칸(처음 접힘) 안에 설정과 [음성 기록], 옛 이름은 없다', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    const extras = screen.getByRole('region', { name: '음성 설정과 기록' })
    const details = extras.querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(within(extras).getByText('음성 설정과 기록').tagName).toBe('SUMMARY')
    expect(details.contains(within(extras).getByRole('button', { name: '음성 기록' }))).toBe(true)
    expect(details.contains(within(extras).getByLabelText('말이 끝났다고 볼 때까지(초)'))).toBe(true)
    // 자주 쓰는 문자찜 설정은 접는 칸 밖에 늘 보인다(기존 문자찜 흐름을 막지 않게)
    const listen = within(extras).getByRole('checkbox', { name: /문자찜/ })
    expect(details.contains(listen)).toBe(false)
    const text = document.body.textContent ?? ''
    for (const old of ['들린 말 기록', '음성 기록 보기']) expect(text).not.toContain(old)
    expect(screen.queryByText('들은 말', { exact: true })).toBeNull()
  })

  it('RA-V2-02·D-V2-20: 음성 기록 창에 8자리 이상 숫자는 ••••, 상품 번호·가격은 그대로', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('끝자리 010-1234-5678 만원')
    await quiet()
    FakeRecognition.say('15번 만오천')
    await quiet()
    fireEvent.click(screen.getByRole('button', { name: '음성 기록' }))
    const dialog = await screen.findByRole('dialog', { name: '음성 기록' })
    const text = dialog.textContent ?? ''
    expect(text).not.toContain('1234-5678')
    expect(text).not.toContain('01012345678')
    expect(text).toContain('••••')
    expect(text).toContain('15번 만오천')
    expect(text).toContain('15,000')
  }, 15_000)

  it('U-V2-05·06: 후보 단추에 1·2·3 키 표시와 안내, 1 키로 고름, 카드 Enter 표시는 "Enter 등록"(SPEC §459), 키 숫자는 단추 이름에 안 들어감', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('19번 선버스 팔천원')
    await quiet()
    const group = screen.getByRole('group', { name: '19번 품종 미입력 8,000원 품종 후보' })
    const first = within(group).getAllByRole('button')[0] as HTMLButtonElement
    expect(first.dataset.key).toBe('1')
    expect(first.textContent).toBe('선버스트')
    expect(styles).toContain('content: attr(data-key) / "";')
    expect(within(group).getByRole('button', { name: '선버스트' })).toBe(first)
    expect(first.className).toContain('voice-candidate')
    expect(group.textContent).toContain('1·2·3 키')
    ;(document.activeElement as HTMLElement | null)?.blur()
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
    expect(screen.getByRole('listitem', { name: '19번 선버스트 8,000원 카드' })).toBeDefined()
    await sleep(1050)
    expect(screen.getByText('Enter 등록', { exact: true })).toBeDefined()
    expect(screen.queryByText('Enter 키로 등록', { exact: true })).toBeNull()
  }, 15_000)
})
