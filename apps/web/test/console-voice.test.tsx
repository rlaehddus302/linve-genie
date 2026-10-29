import './legacy-voice-ui-fixture.ts'
// 콘솔 음성 칸 (AC-I4-10~14·20~23·30·40·51, D-I4-03~06·09) — 실제 코어로 도는 가짜 서버 + 가짜 인식 객체(window.SpeechRecognition).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { VOICE_CONSENT_KEY, VOICE_SETTINGS_KEY } from '../src/voice/storage.ts'
import { register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, flush } from './support.ts'

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
  // 이 시험들은 카드 확인 동작을 본다 — V3 "번호와 가격이 들리면 바로 등록"(기본 켬)을 끈 기기로 시작한다 (바로 등록은 v3-voice-instant 시험)
  window.localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify({ 'voice.autoRegister': false }))
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
const pressEnter = (input: HTMLElement) => fireEvent.keyDown(input, { key: 'Enter' })

describe('켜기 전·안내 창 (AC-I4-10·11)', () => {
  it('누르기 전엔 인식 객체·판매 이력 조회가 없고, 처음 켤 때 안내 창(문장 그대로·처음 포커스 "닫기")', async () => {
    setup()
    const { quick } = await openConsole()
    expect(FakeRecognition.all).toHaveLength(0)
    expect(engine.server.callsTo('GET', /^\/api\/days(\?|$)/)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '음성 켜기' }))
    const dialog = await screen.findByRole('dialog', { name: '음성으로 상품 등록' })
    expect(dialog.textContent).toContain('말한 번호·품종·가격을 카드로 보여 줘요. 카드를 확인하고 등록해야 상품이 생겨요.')
    // 외부 전송 문장: D-I5-06 (AC-I5-12)
    expect(dialog.textContent).toContain('음성은 인식을 위해 브라우저의 음성 인식 서버(크롬은 구글, 아이폰은 애플)로 보내져요. 라이브지니는 음성을 녹음하거나 저장하지 않아요.')
    // 마이크 줄: D-I5-11 (AC-I5-27)
    expect(dialog.textContent).toContain('다음에 브라우저가 마이크 사용을 물으면 "허용"을 눌러 주세요.')
    expect(document.body.textContent).not.toContain('크롬이 마이크 사용을 물으면')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '닫기' }))
    // 창이 열린 동안 머리 줄의 "음성 켜기"는 없다 (창의 버튼 하나)
    expect(screen.getAllByRole('button', { name: '음성 켜기' })).toHaveLength(1)
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(quick))
    expect(FakeRecognition.all).toHaveLength(0)
    expect(engine.server.callsTo('GET', /^\/api\/days(\?|$)/)).toHaveLength(0)
  })

  it('창의 "음성 켜기" → 시작·확인 기록·안내 한 줄·"음성 끄기", 다음엔 창 없이 바로', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    expect(FakeRecognition.all).toHaveLength(1)
    // 누른 버튼이 사라졌다 — 빠른 입력칸으로
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('빠른 입력')))
    expect(window.localStorage.getItem(VOICE_CONSENT_KEY)).not.toBeNull()
    // 켜진 동안의 고지: D-I5-06 (AC-I5-12)
    expect(screen.getByText('음성은 인식을 위해 크롬은 구글로, 아이폰은 애플로 보내져요.')).toBeDefined()
    await waitFor(() => expect(engine.server.callsTo('GET', /^\/api\/days$/)).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '음성 끄기' }))
    expect(FakeRecognition.all[0]?.stops).toBe(1)
    await turnOnVoice(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(FakeRecognition.all).toHaveLength(2)
  })

  it('저장소를 쓸 수 없으면 매번 창을 보인다', async () => {
    setup()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('막힘')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('막힘')
    })
    await openConsole()
    await turnOnVoice()
    fireEvent.click(screen.getByRole('button', { name: '음성 끄기' }))
    fireEvent.click(await screen.findByRole('button', { name: '음성 켜기' }))
    expect(await screen.findByRole('dialog', { name: '음성으로 상품 등록' })).toBeDefined()
    vi.restoreAllMocks()
  })

  it('생성자가 없으면 창 없이 "지원하지 않아요"', async () => {
    setup()
    vi.stubGlobal('SpeechRecognition', undefined)
    await openConsole()
    fireEvent.click(screen.getByRole('button', { name: '음성 켜기' }))
    // 문장: D-I5-03 (AC-I5-06 UNSUPPORTED)
    expect(await screen.findByText('이 기기에서는 음성이 어려워요. PC 크롬이나 안드로이드 크롬에서 켜 주세요. 상품은 빠른 입력으로 그대로 등록할 수 있어요.')).toBeDefined()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('지원 안 함 안내는 안내 색·"닫기", 빠른 입력 등록이 성공하면 내려간다 (AC-I5-30, D-I5-15)', async () => {
    const TEXT = '이 기기에서는 음성이 어려워요. PC 크롬이나 안드로이드 크롬에서 켜 주세요. 상품은 빠른 입력으로 그대로 등록할 수 있어요.'
    setup()
    vi.stubGlobal('SpeechRecognition', undefined)
    const { quick } = await openConsole()
    fireEvent.click(screen.getByRole('button', { name: '음성 켜기' }))
    const line = await screen.findByText(TEXT)
    const alert = line.closest('[role="alert"]') as HTMLElement
    expect(alert.className).toContain('voice-guide')
    expect(alert.className).not.toContain('voice-error')
    fireEvent.click(within(alert).getByRole('button', { name: '닫기' }))
    expect(screen.queryByText(TEXT)).toBeNull()
    expect(screen.getByRole('button', { name: '음성 켜기' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '음성 켜기' }))
    await screen.findByText(TEXT)
    fireEvent.change(quick, { target: { value: '21 라울 10' } })
    pressEnter(quick)
    await waitFor(() => expect(registers()).toEqual([[21, '라울', 10000]]))
    await waitFor(() => expect(screen.queryByText(TEXT)).toBeNull())
  })
})

describe('자막·카드·Enter 등록 (AC-I4-13·20·21)', () => {
  // D-V3-50: "들리는 말:" 작은 줄은 없고 큰 칸("지금 들리는 말") 하나에만 보인다
  it('중간 결과는 큰 칸에만(작은 "들리는 말:" 줄 없음), 최종은 카드 + 기록, 문장은 글자로만', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('15번 핑크', false)
    expect(screen.queryByText(/들리는 말:/)).toBeNull()
    expect(screen.getByRole('region', { name: '지금 들리는 말' }).textContent).toContain('15번 핑크')
    FakeRecognition.say('<img src=x onerror=alert(1)>15번 라울 만원')
    await quiet()
    expect(screen.queryByText(/들리는 말:/)).toBeNull()
    // 붙여 쓴 "…>15번"은 번호 표시가 아니다(R-17) — 번호 없는 말은 카드 없이 기록에만 (D-V3-41)
    expect(screen.queryByRole('listitem', { name: '번호 없음 라울 10,000원 카드' })).toBeNull()
    expect(document.querySelector('img')).toBeNull()
    // 최종 결과의 기록은 [음성 기록] 창 하나 (D-V2-21 — "들린 말 기록" 목록은 없다)
    expect(screen.queryByText('들린 말 기록')).toBeNull()
    FakeRecognition.say('15번 라울 만원')
    await quiet()
    const high = screen.getByRole('listitem', { name: '15번 라울 10,000원 카드' })
    expect(within(high).queryByText('확인 필요')).toBeNull()
    expect(within(high).getByRole('button', { name: '15번 라울 10,000원 등록' })).toBeDefined()
    expect(within(high).getByRole('button', { name: '15번 라울 10,000원 고치기' })).toBeDefined()
    expect(within(high).getByRole('button', { name: '15번 라울 10,000원 닫기' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '음성 기록' }))
    const log = await screen.findByRole('dialog', { name: '음성 기록' })
    expect(log.textContent).toContain('<img src=x onerror=alert(1)>15번 라울 만원')
    expect(log.textContent).toContain('15번 라울 만원')
    expect(log.querySelector('img')).toBeNull()
  })

  it('1초 안의 Enter는 알리고 등록 없음 → "Enter 등록"이 보인 뒤 Enter로 맨 앞 카드만, 빠른 입력과 같은 등록(되돌리기 띠)', async () => {
    setup()
    const { quick } = await openConsole()
    await turnOnVoice()
    FakeRecognition.say('15번 핑크프릴 만오천 원')
    await quiet()
    FakeRecognition.say('16번 라울 만원')
    await quiet()
    quick.focus()
    pressEnter(quick)
    expect(await screen.findByText('새 카드가 방금 나왔어요. 확인하고 다시 Enter를 눌러 주세요.')).toBeDefined()
    const front = screen.getByRole('listitem', { name: '16번 라울 10,000원 카드' })
    expect(within(front).queryByText('Enter 등록')).toBeNull()
    await sleep(1050)
    expect(within(front).getByText('Enter 등록')).toBeDefined()
    expect(screen.queryByText('새 카드가 방금 나왔어요. 확인하고 다시 Enter를 눌러 주세요.')).toBeNull()
    expect(within(screen.getByRole('listitem', { name: '15번 핑크프릴 15,000원 카드' })).queryByText('Enter 등록')).toBeNull()
    pressEnter(quick)
    await waitFor(() => expect(registers()).toEqual([[16, '라울', 10000]]))
    expect(await screen.findByText('16번을 등록했어요')).toBeDefined()
    expect(screen.queryByRole('listitem', { name: '16번 라울 10,000원 카드' })).toBeNull()
    // 두 번째 Enter: 15번은 맨 앞이 된 지 1초가 안 됐다
    pressEnter(quick)
    await flush()
    expect(registers()).toHaveLength(1)
    // 조용한 시간 두 번(1.85초씩) + 1초 기다림 — 기본 5초 시험 시간에 붙어 있어 넉넉히
  }, 10_000)

  it('빠른 입력칸에 글자가 있으면 Enter는 빠른 입력이다(카드는 그대로)', async () => {
    setup()
    const { quick } = await openConsole()
    await turnOnVoice()
    FakeRecognition.say('15번 핑크프릴 만오천 원')
    await quiet()
    await sleep(1050)
    fireEvent.change(quick, { target: { value: '20 라울 10' } })
    expect(screen.queryByText('Enter 등록')).toBeNull()
    pressEnter(quick)
    await waitFor(() => expect(registers()).toEqual([[20, '라울', 10000]]))
    expect(screen.getByRole('listitem', { name: '15번 핑크프릴 15,000원 카드' })).toBeDefined()
  })

  it('"등록" 누르기는 1초 기다림 없이, 맨 앞이 아니어도', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('15번 핑크프릴 만오천 원')
    await quiet()
    FakeRecognition.say('16번 라울 만원')
    await quiet()
    fireEvent.click(screen.getByRole('button', { name: '15번 핑크프릴 15,000원 등록' }))
    await waitFor(() => expect(registers()).toEqual([[15, '핑크프릴', 15000]]))
  })
})

describe('번호·가격 없음, 이미 있는 번호, 고치기 (AC-I4-22·23)', () => {
  // D-V3-06 (AC-V3-41·47 R30): 이미 있는 번호를 다르게 들으면 카드 대신 묻기 카드 — 바로 등록을 끈 기기는 까닭 줄 없이 묻기만
  it('이미 있는 번호 → 카드 없이 묻기 카드 "15번을 고칠까요?", 그대로 두기면 쓰기 없음 (D-V3-06)', async () => {
    setup([register(15, '핑크프릴', 10000)])
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('15번 라울 만원')
    await quiet()
    const offer = await screen.findByRole('listitem', { name: '15번을 고칠까요? 품종 핑크프릴 → 라울' })
    expect(screen.queryByRole('listitem', { name: '15번 라울 10,000원 카드' })).toBeNull()
    fireEvent.click(within(offer).getByRole('button', { name: '그대로 두기' }))
    await flush()
    expect(engine.posts).toEqual([])
  })

  // D-V3-41 (AC-V3-47): 번호 없는 말은 카드가 없다 — Enter는 빠른 입력 그대로
  // 이 파일은 바로 등록 끔 — "70,000원 · 번호를 못 들었어요"는 켬에서만 (D-V3-61 b)
  it('번호 없는 말 → 카드 없음, 바로 등록 끔이면 큰 글자 칸 알림도 없음, 쓰기 없음 (D-V3-41·61)', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('핑크프릴 만오천 원')
    await quiet()
    expect(screen.queryByRole('listitem', { name: '번호 없음 핑크프릴 15,000원 카드' })).toBeNull()
    expect(screen.queryByText(/번호를 못 들었어요/)).toBeNull()
    expect(registers()).toEqual([])
  })

  it('고치기 칸의 가격은 그 방송 단위(천원): "10" = 10,000원, 틀리면 빠른 입력과 같은 문장', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('15번 핑크프릴')
    await quiet()
    fireEvent.click(screen.getByRole('button', { name: '15번 핑크프릴 가격 없음 등록' }))
    const form = await screen.findByRole('group', { name: '15번 핑크프릴 가격 없음 고치기 칸' })
    expect(within(form).getByText('가격이 없어요. 가격을 넣어 주세요.')).toBeDefined()
    const price = within(form).getByLabelText('가격') as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(price))
    fireEvent.change(price, { target: { value: '0.05' } })
    pressEnter(price)
    expect(await within(form).findByText('가격이 100원보다 적어요. 가격을 확인해 주세요.')).toBeDefined()
    fireEvent.change(price, { target: { value: '10' } })
    pressEnter(price)
    await waitFor(() => expect(registers()).toEqual([[15, '핑크프릴', 10000]]))
  })

  it('고치기 칸의 Esc는 칸만 닫고(카드는 남음) 빠른 입력칸으로, "닫기"는 등록 없이 카드를 없앤다', async () => {
    setup()
    const { quick } = await openConsole()
    await turnOnVoice()
    FakeRecognition.say('15번 핑크프릴 만오천 원')
    await quiet()
    fireEvent.click(screen.getByRole('button', { name: '15번 핑크프릴 15,000원 고치기' }))
    const form = await screen.findByRole('group', { name: '15번 핑크프릴 15,000원 고치기 칸' })
    const no = within(form).getByLabelText('번호')
    await waitFor(() => expect(document.activeElement).toBe(no))
    fireEvent.keyDown(no, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('group', { name: '15번 핑크프릴 15,000원 고치기 칸' })).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(quick))
    fireEvent.click(screen.getByRole('button', { name: '15번 핑크프릴 15,000원 닫기' }))
    expect(screen.queryByRole('listitem', { name: '15번 핑크프릴 15,000원 카드' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(quick))
    expect(engine.posts).toEqual([])
  })
})

describe('끄기·설정 (AC-I4-14·30)', () => {
  it('끄면 카드는 남고 손으로 등록되며, 끈 뒤의 결과는 무시한다', async () => {
    setup()
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('15번 핑크프릴 만오천 원')
    await quiet()
    fireEvent.click(screen.getByRole('button', { name: '음성 끄기' }))
    expect(await screen.findByRole('button', { name: '음성 켜기' })).toBeDefined()
    FakeRecognition.say('16번 라울 만원')
    await quiet()
    expect(screen.queryByRole('listitem', { name: '16번 라울 10,000원 카드' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '15번 핑크프릴 15,000원 등록' }))
    await waitFor(() => expect(registers()).toEqual([[15, '핑크프릴', 15000]]))
  })

  // D-V3-01·D-V3-16 (AC-V3-40·47): 옛 "확실한 카드는 자동으로 등록"·"기다리는 시간(초)"은 빠지고 "번호와 가격이 들리면 바로 등록"(기본 켬)이 대신한다
  it('바로 등록 설정: 처음 체크됨·도움말, 기다리는 시간 칸 없음, 끄면 기기에 남는다 — 옛 꺼짐 저장값이어도 켬 (D-V3-16)', async () => {
    setup()
    window.localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify({ 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5, 'voice.quietMs': 2500 }))
    await openConsole()
    await turnOnVoice()
    const box = screen.getByLabelText('번호와 가격이 들리면 바로 등록') as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(screen.getByText("'○○번'과 '○○원'이 들리면 그 자리에서 등록해요. 같은 번호를 다시 말하면 새로 만들지 않고, 찜이 없는 상품은 들은 대로 고쳐요. 등록 뒤 5초 안에 되돌릴 수 있어요.")).toBeDefined()
    expect(screen.queryByLabelText('기다리는 시간(초)')).toBeNull()
    expect(screen.queryByLabelText('확실한 카드는 자동으로 등록')).toBeNull()
    expect((screen.getByLabelText('말이 끝났다고 볼 때까지(초)') as HTMLInputElement).value).toBe('2.5')
    fireEvent.click(box)
    expect(JSON.parse(window.localStorage.getItem(VOICE_SETTINGS_KEY) ?? 'null')).toMatchObject({ 'voice.autoRegister': false, 'voice.quietMs': 2500 })
  })

  // D-V3-01 (AC-V3-26·47): 카드에는 자동 확정 기다림이 없다 — 옛 자동 확정 저장값이 있어도 남은 초가 없고 누르면 등록
  it('바로 등록을 끈 기기: 옛 자동 확정 저장값이 있어도 카드에 남은 초가 없고, "등록"으로 등록된다 (D-V3-01)', async () => {
    setup()
    window.localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 3, 'voice.autoRegister': false }))
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('15번 핑크프릴 만오천 원')
    await quiet()
    const card = screen.getByRole('listitem', { name: '15번 핑크프릴 15,000원 카드' })
    expect(within(card).queryByText('3초 뒤 자동 등록')).toBeNull()
    await sleep(3100)
    expect(registers()).toEqual([])
    fireEvent.click(within(card).getByRole('button', { name: /^15번 핑크프릴 15,000원 등록/ }))
    await waitFor(() => expect(registers()).toEqual([[15, '핑크프릴', 15000]]))
  }, 10_000)
})

describe('판매 이력 사전 (AC-I4-40)', () => {
  it('켤 때 실제 범위 목록과 지난 날짜(지금 범위 뺌)만 받는다', async () => {
    setup()
    const past = Array.from({ length: 12 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
    engine.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [...past, DATE].map((date) => ({ date, rehearsal: false, seq: 3 })) } }))
    engine.server.on('GET', /^\/api\/days\/2026-09-\d\d$/, (call) => ({ body: { products: [{ name: `품종${call.path.slice(-2)}` }] } }))
    await openConsole()
    await turnOnVoice()
    await waitFor(() => expect(engine.server.callsTo('GET', /^\/api\/days\/2026-09-\d\d$/)).toHaveLength(10))
    const asked = engine.server.callsTo('GET', /^\/api\/days\/2026-09-\d\d$/).map((call) => call.path.slice(-10)).sort()
    expect(asked).toEqual(past.slice(2).sort())
  })

  it('받지 못하면 음성 칸에 한 줄', async () => {
    setup()
    engine.server.on('GET', /^\/api\/days$/, () => ({ network: true }))
    await openConsole()
    await turnOnVoice()
    expect(await screen.findByText('지난 판매 품종을 불러오지 못했어요. 기본 품종 사전으로 알아들어요.')).toBeDefined()
  })
})

describe('바로 등록 (V3 — 기본 켬)', () => {
  it('번호와 가격이 들리면 조용한 시간 없이 빠른 입력과 같은 등록(되돌리기 띠), 카드 없음 — 같은 말을 다시 해도 한 번', async () => {
    setup()
    window.localStorage.removeItem(VOICE_SETTINGS_KEY)
    await openConsole()
    await turnOnVoice()
    FakeRecognition.say('15번 핑크프릴 만오천 원')
    await waitFor(() => expect(registers()).toEqual([[15, '핑크프릴', 15000]]))
    expect(await screen.findByText('15번을 등록했어요')).toBeDefined()
    expect(screen.queryByRole('listitem', { name: '15번 핑크프릴 15,000원 카드' })).toBeNull()
    await quiet()
    FakeRecognition.say('15번 핑크프릴 만오천 원')
    await quiet()
    expect(registers()).toEqual([[15, '핑크프릴', 15000]])
    expect(screen.queryByRole('listitem', { name: '15번 핑크프릴 15,000원 카드' })).toBeNull()
  }, 10_000)
})
