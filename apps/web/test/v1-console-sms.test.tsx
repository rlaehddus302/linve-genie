// 콘솔의 음성 문자찜 (V1 AC-V1-20·21·25·30) — 실제 코어로 도는 가짜 서버(끝자리 계약 포함) + 가짜 인식 객체.
// 정산 화면 "구매자를 확인해 주세요"(AC-V1-29)는 unknownSmsBuyers(순수)와 화면 한 번.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { ConsolePage, smsProductView, smsReadOptions } from '../src/components/ConsolePage.tsx'
import { SettlementsPage, UNKNOWN_SMS_DISPLAY, unknownSmsBuyers } from '../src/components/SettlementsPage.tsx'
import type { Route, ScopeRoute } from '../src/lib/router.ts'
import { VOICE_CONSENT_KEY, VOICE_SMS_SETTINGS_KEY } from '../src/voice/storage.ts'
import { chat, dataOf, register, sms } from './engine.ts'
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
  results: { isFinal: boolean; length: number; 0: { transcript: string } }[] = []
  constructor() {
    FakeRecognition.all.push(this)
  }
  start(): void {}
  stop(): void {}
  abort(): void {}
  static say(text: string): void {
    const rec = FakeRecognition.all.at(-1)
    if (rec === undefined) throw new Error('인식 객체가 없다')
    act(() => {
      rec.results.push({ isFinal: true, length: 1, 0: { transcript: text } })
      rec.onresult?.({ resultIndex: rec.results.length - 1, results: rec.results })
    })
  }
}

let engine: EngineServer

function setup(events: Record<string, unknown>[], smsSettings: unknown = { 'voice.smsAutoSec': 0 }) {
  engine = new EngineServer(events)
  vi.stubGlobal('fetch', engine.server.fetch)
  window.localStorage.setItem(VOICE_CONSENT_KEY, 'yes')
  window.localStorage.setItem(VOICE_SMS_SETTINGS_KEY, JSON.stringify(smsSettings))
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 48rem)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  FakeEventSource.reset()
  FakeRecognition.all.length = 0
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  window.localStorage.clear()
})

async function openConsoleWithVoice() {
  render(<ConsolePage broadcastId="b1" navigate={vi.fn()} />)
  await screen.findByLabelText('빠른 입력')
  await flush(10)
  fireEvent.click(await screen.findByRole('button', { name: '음성 켜기' }))
  await screen.findByText('음성: 듣는 중')
}

const smsPosts = () => engine.posts.filter((post) => post.type === 'sms')
const cards = () => screen.getByRole('list', { name: '음성 카드' })

describe('콘솔 음성 문자찜', () => {
  it('켜면 "문자찜도 듣는 중"·설정 두 칸, 끄면 그 글이 사라진다 (AC-V1-20)', async () => {
    setup([register(165, '핑크프릴', 10000)], null)
    await openConsoleWithVoice()
    expect(screen.getByText('문자찜도 듣는 중')).toBeDefined()
    const listen = screen.getByRole('checkbox', { name: '문자찜도 듣기' }) as HTMLInputElement
    expect(listen.checked).toBe(true)
    expect((screen.getByLabelText('문자찜 자동으로 넣기까지(초)') as HTMLInputElement).value).toBe('3')
    fireEvent.click(listen)
    expect(screen.queryByText('문자찜도 듣는 중')).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(VOICE_SMS_SETTINGS_KEY) ?? 'null')).toEqual({ 'voice.smsListen': false, 'voice.smsAutoSec': 3 })
  })

  it('"165번 문자찜 끝자리 1234" → 쓰기 한 번(본문은 정한 칸만, 인식 문장 없음) → 손 입력과 같은 결과 문장·뒤 4자리·"찜 취소하기" (AC-V1-21·30)', async () => {
    setup([register(165, '핑크프릴', 10000)])
    await openConsoleWithVoice()
    FakeRecognition.say('165번 문자찜 끝자리 1234')
    await waitFor(() => expect(smsPosts()).toHaveLength(1))
    const post = smsPosts()[0] as Record<string, unknown>
    expect(Object.keys(post).sort()).toEqual(['b', 'last4', 'no', 'requestId', 'type'])
    expect(post).toMatchObject({ type: 'sms', b: 'b1', no: 165, last4: '1234' })
    expect(JSON.stringify(engine.posts)).not.toContain('문자찜 끝자리')
    const card = within(cards()).getByRole('listitem', { name: '165번 · 끝자리 1234 · 문자찜 카드' })
    await waitFor(() => expect(card.textContent).toMatch(/165번 · 문자찜 · 1등 · 받은 시각 \d{2}\/\d{2} \d{2}:\d{2}:\d{2}/))
    expect(card.textContent).toContain('뒤 4자리 1234')
    expect(within(card).getByRole('button', { name: '165번 문자찜 찜 취소하기' })).toBeDefined()
    expect(screen.queryByRole('listitem', { name: /등록할까요|핑크프릴 .*카드/ })).toBeNull()
    // 인식 문장은 저장소에 없다
    for (let i = 0; i < window.localStorage.length; i++) expect(window.localStorage.getItem(window.localStorage.key(i) ?? '')).not.toContain('끝자리')
  })

  it('이름에 <b>를 말해도 글자 그대로 그린다 (AC-V1-30)', async () => {
    setup([register(165, '핑크프릴', 10000)], { 'voice.smsAutoSec': 10 })
    await openConsoleWithVoice()
    FakeRecognition.say('<b>굵게</b> 165번 문자찜')
    expect(cards().querySelector('b')).toBeNull()
    expect(cards().textContent).toContain('<b>굵게</b>')
  })

  it('끝자리 손님이 둘 → 고르기 카드(후보 버튼·저절로 넣지 않음) → 누르면 buyer로 한 번 (AC-V1-25)', async () => {
    setup([
      register(165, '핑크프릴', 10000),
      register(10, '청보석', 7000),
      // 처음 이벤트의 ref는 가짜 서버가 새로 매기는 ref(r1…)와 겹치지 않게
      sms('x1', 10, { phoneKey: 'phonekey-aaaaaaaaaa', phoneLast4: '1234', memo: '김씨' }),
      sms('x2', 10, { phoneKey: 'phonekey-bbbbbbbbbb', phoneLast4: '1234', memo: '이씨' }),
    ])
    await openConsoleWithVoice()
    FakeRecognition.say('165번 문자찜 끝자리 1234')
    await screen.findByText('끝자리 1234 손님이 여러 명이에요. 누구인지 골라 주세요.')
    expect(smsPosts()).toHaveLength(1)
    const choose = screen.getAllByRole('button', { name: /손님 고르기/ })
    expect(choose.map((button) => button.textContent)).toEqual(['문자찜(김씨) · 끝자리 1234', '문자찜(이씨) · 끝자리 1234'])
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)))
    expect(smsPosts()).toHaveLength(1)
    fireEvent.click(choose[1] as HTMLElement)
    await waitFor(() => expect(smsPosts()).toHaveLength(2))
    const second = smsPosts()[1] as Record<string, unknown>
    expect(second.last4).toBeUndefined()
    expect(second.buyer).toBe('sms:x2')
    await waitFor(() => expect(cards().textContent).toContain('165번 · 문자찜(이씨) · 1등'))
  })

  it('"300번 문자찜" → "300번 상품이 없어요."·닫기만·쓰기 없음 (AC-V1-23)', async () => {
    setup([register(165, '핑크프릴', 10000)])
    await openConsoleWithVoice()
    FakeRecognition.say('300번 문자찜')
    expect(await screen.findByText('300번 상품이 없어요.')).toBeDefined()
    const card = within(cards()).getByRole('listitem', { name: '300번 · 손님 확인 필요 · 문자찜 카드' })
    expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual(['닫기'])
    await flush(10)
    expect(smsPosts()).toHaveLength(0)
  })
})

describe('읽기 설정·상품 모습 (D-V1-07·08)', () => {
  it('번호 방식은 범위만, 대기 자리는 waitlist.max로 본다', () => {
    const data = dataOf([register(165, '핑크프릴', 10000), chat('m1', 'c1', '가나', '165')], { 'waitlist.max': 0 })
    expect(smsReadOptions(data, 'b1', 0)).toEqual({ parseMode: 'STRICT', maxNumber: 999, maxQuantity: 10 })
    expect(smsProductView(data, 'b1', 165)).toEqual({ state: 'SOLD', waitlistFull: true })
    expect(smsProductView(data, 'b1', 300)).toBeNull()
  })
})

describe('정산 화면 — 구매자를 확인해 주세요 (AC-V1-29)', () => {
  const EVENTS = [register(165, '핑크프릴', 10000), register(166, '청보석', 7000), sms('r1', 165, { memo: '확인 필요' }), sms('r2', 166, { memo: '확인 필요' })]

  it('활성 찜이 있는 "문자찜(확인 필요)" 구매자만, 합치면 빠진다', () => {
    expect(unknownSmsBuyers(dataOf(EVENTS))).toEqual(['sms:r1', 'sms:r2'])
    expect(unknownSmsBuyers(dataOf([...EVENTS, { type: 'buyer.merge', from: 'sms:r1', into: 'sms:r2', reason: '같은 사람' }]))).toEqual(['sms:r2'])
    expect(unknownSmsBuyers(dataOf([...EVENTS, { type: 'host.cancel', b: 'b1', no: 165, buyer: 'sms:r1', reason: '시청자 요청' }]))).toEqual(['sms:r2'])
    expect(unknownSmsBuyers(dataOf([register(165, '핑크프릴', 10000), sms('r1', 165, { memo: '김민지' })]))).toEqual([])
    expect(dataOf(EVENTS).buyers.get('sms:r1')?.display).toBe(UNKNOWN_SMS_DISPLAY)
  })

  it('목록 위 안내와 구매자 자세히로 가는 링크', async () => {
    engine = new EngineServer(EVENTS)
    vi.stubGlobal('fetch', engine.server.fetch)
    const routes: Route[] = []
    function Harness() {
      const [route, setRoute] = useState<Route>({ name: 'settlements', date: DATE, rehearsal: false })
      return route.name === 'settlements' ? (
        <SettlementsPage
          route={route as ScopeRoute}
          navigate={(next) => {
            routes.push(next as Route)
            setRoute(next as Route)
          }}
        />
      ) : null
    }
    render(<Harness />)
    const notice = await screen.findByRole('region', { name: '구매자를 확인해 주세요' })
    expect(notice.textContent).toContain('구매자를 확인해야 하는 문자찜이 2건 있어요.')
    const links = within(notice).getAllByRole('link')
    expect(links).toHaveLength(2)
    fireEvent.click(links[0] as HTMLElement)
    expect(routes.at(-1)).toMatchObject({ name: 'buyers', date: DATE, buyer: 'sms:r1' })
  })
})
