// 콘솔의 음성 문자찜 (V1 AC-V1-20·21·25·30) — 실제 코어로 도는 가짜 서버(끝자리 계약 포함) + 가짜 인식 객체.
// 정산 화면 "구매자를 확인해 주세요"(AC-V1-29)는 unknownSmsBuyers(순수)와 화면 한 번.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { listClaims } from '@livejjim/core'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { ConsolePage, readCandidates, smsProductView, smsReadOptions } from '../src/components/ConsolePage.tsx'
import { SettlementsPage, UNKNOWN_SMS_DISPLAY, unknownSmsBuyers } from '../src/components/SettlementsPage.tsx'
import type { Route, ScopeRoute } from '../src/lib/router.ts'
import { VOICE_CONSENT_KEY, VOICE_SMS_SETTINGS_KEY } from '../src/voice/storage.ts'
import { chat, dataOf, register, sms } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, apiError, flush } from './support.ts'

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
    // AC-V1-31·D-V1-13: 음성 쓰기 본문에는 voice: true (손 입력 본문에는 없다 — sms-page 시험)
    expect(Object.keys(post).sort()).toEqual(['b', 'last4', 'no', 'requestId', 'type', 'voice'])
    expect(post).toMatchObject({ type: 'sms', b: 'b1', no: 165, last4: '1234', voice: true })
    expect(JSON.stringify(engine.posts)).not.toContain('문자찜 끝자리')
    // D-V1-21: 번호 뒤에 품종
    const card = within(cards()).getByRole('listitem', { name: '165번 핑크프릴 · 끝자리 1234 · 문자찜 카드' })
    await waitFor(() => expect(card.textContent).toMatch(/165번 · 문자찜 · 1등 · 받은 시각 \d{2}\/\d{2} \d{2}:\d{2}:\d{2}/))
    expect(card.textContent?.split('뒤 4자리 1234')).toHaveLength(2)
    // 끝자리로 넣은 결과 카드에는 확인 필요 안내가 없다 (D-V1-21)
    expect(card.textContent).not.toContain('방송 뒤 정산 화면에서 누구인지 확인해 주세요.')
    expect(within(card).getByRole('button', { name: '165번 문자찜 찜 취소하기' })).toBeDefined()
    // 상품 등록 카드는 없다 (문자찜 카드 이름의 "핑크프릴 · …"은 품종 표시 — D-V1-21)
    expect(screen.queryByRole('listitem', { name: /등록할까요|핑크프릴 [^·]*카드$/ })).toBeNull()
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
    // D-V1-14: 후보 버튼 끝에 그 손님의 찜 번호
    expect(choose.map((button) => button.textContent)).toEqual(['문자찜(김씨) · 끝자리 1234 · 10번', '문자찜(이씨) · 끝자리 1234 · 10번'])
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)))
    expect(smsPosts()).toHaveLength(1)
    fireEvent.click(choose[1] as HTMLElement)
    await waitFor(() => expect(smsPosts()).toHaveLength(2))
    const second = smsPosts()[1] as Record<string, unknown>
    expect(second.last4).toBeUndefined()
    expect(second.buyer).toBe('sms:x2')
    await waitFor(() => expect(cards().textContent).toContain('165번 · 문자찜(이씨) · 1등'))
  })

  it('표시 이름·끝자리가 같은 두 후보는 찜 번호로 갈리고, "새 손님으로 넣기"는 last4 + newBuyer 한 번 → 새 문자 구매자 (AC-V1-25, D-V1-14)', async () => {
    setup([
      register(165, '핑크프릴', 10000),
      register(15, '청보석', 7000),
      register(22, '금황', 5000),
      register(30, '은황', 5000),
      sms('x1', 15, { phoneKey: 'phonekey-aaaaaaaaaa', phoneLast4: '1234' }),
      sms('x2', 22, { phoneKey: 'phonekey-bbbbbbbbbb', phoneLast4: '1234' }),
      sms('x3', 30, { phoneKey: 'phonekey-aaaaaaaaaa', phoneLast4: '1234' }),
    ])
    await openConsoleWithVoice()
    FakeRecognition.say('165번 문자찜 끝자리 1234')
    await screen.findByText('끝자리 1234 손님이 여러 명이에요. 누구인지 골라 주세요.')
    const card = within(cards()).getByRole('listitem', { name: '165번 핑크프릴 · 끝자리 1234 · 문자찜 카드' })
    const labels = within(card).getAllByRole('button', { name: /손님 고르기/ }).map((button) => button.textContent ?? '')
    expect(labels).toHaveLength(2)
    // 표시 이름이 같아도(구매자 목록과 같은 구분 표기) 그 손님의 찜 번호가 붙는다
    expect(labels[0]).toMatch(/^문자찜 · 뒤 4자리 1234 · 15번·30번$/)
    expect(labels[1]).toMatch(/^문자찜 · 뒤 4자리 1234 · .*22번$/)
    // D-V1-20: "넣지 않기"가 첫 버튼, 넣는 버튼(후보·새 손님)은 뒤이고 주 버튼 색
    expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual(['넣지 않기', ...labels, '새 손님으로 넣기'])
    expect(within(card).getAllByRole('button').map((button) => button.classList.contains('button-primary'))).toEqual([false, true, true, true])
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)))
    expect(smsPosts()).toHaveLength(1)
    fireEvent.click(within(card).getByRole('button', { name: '165번 핑크프릴 · 끝자리 1234 · 문자찜 새 손님으로 넣기' }))
    await waitFor(() => expect(smsPosts()).toHaveLength(2))
    const second = smsPosts()[1] as Record<string, unknown>
    expect(Object.keys(second).sort()).toEqual(['b', 'last4', 'newBuyer', 'no', 'requestId', 'type', 'voice'])
    expect(second).toMatchObject({ last4: '1234', newBuyer: true, no: 165 })
    expect(second.requestId).not.toBe((smsPosts()[0] as Record<string, unknown>).requestId)
    // 결과 카드: 셋째 "문자찜 · 뒤 4자리 1234" 손님(구매자 목록과 같은 구분 표기)
    await waitFor(() => expect(cards().textContent).toContain('165번 · 문자찜 · 뒤 4자리 1234 · 3 · 1등'))
    // TE-V1-001·SA-V1-001: 이름의 구분 글자에 끝자리가 있으면 결과 줄 끝에 다시 붙이지 않는다
    expect(cards().textContent?.split('뒤 4자리 1234')).toHaveLength(2)
    // 165번 1등은 두 후보가 아닌 새 문자 구매자
    const first = listClaims(engine.state).find((claim) => claim.no === 165 && claim.status === 'CONFIRMED')
    expect(first?.currentBuyer).toBeDefined()
    expect(['sms:x1', 'sms:x2']).not.toContain(first?.currentBuyer)
  })

  it('이름이 다른 끝자리 손님 한 명 → "이름이 달라요" 고르기, 새 손님이면 메모의 이름으로 (D-V1-14)', async () => {
    setup([register(165, '핑크프릴', 10000), register(10, '청보석', 7000), sms('x1', 10, { phoneKey: 'phonekey-aaaaaaaaaa', phoneLast4: '1234', memo: '김씨' })])
    await openConsoleWithVoice()
    FakeRecognition.say('이민지님 165번 문자찜 끝자리 1234')
    await screen.findByText('끝자리 1234 손님의 이름이 달라요. 누구인지 골라 주세요.')
    const card = within(cards()).getByRole('listitem', { name: /이민지님 · 문자찜 카드$/ })
    expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual(['넣지 않기', '문자찜(김씨) · 끝자리 1234 · 10번', '새 손님으로 넣기'])
    fireEvent.click(within(card).getByRole('button', { name: /새 손님으로 넣기$/ }))
    await waitFor(() => expect(smsPosts()).toHaveLength(2))
    expect(smsPosts()[1]).toMatchObject({ memo: '이민지', last4: '1234', newBuyer: true })
    await waitFor(() => expect(cards().textContent).toContain('165번 · 문자찜(이민지) · 1등'))
  })

  it('409 후보 읽기: 찜 번호는 정수만, 칸이 없거나 깨졌으면 빈 목록', () => {
    expect(
      readCandidates([
        { buyer: 'sms:a', display: '문자찜', phoneLast4: '1234', claims: [15, '22', 1.5, 30] },
        { buyer: 'sms:b', display: '문자찜', phoneLast4: '1234' },
        { buyer: 'sms:c', display: '문자찜', phoneLast4: '1234', claims: 'x' },
        { buyer: '', claims: [1] },
      ]),
    ).toEqual([
      { buyer: 'sms:a', display: '문자찜', phoneLast4: '1234', claims: [15, 30] },
      { buyer: 'sms:b', display: '문자찜', phoneLast4: '1234', claims: [] },
      { buyer: 'sms:c', display: '문자찜', phoneLast4: '1234', claims: [] },
    ])
  })

  it('"300번 문자찜" → "300번 상품이 없어요."·닫기만·쓰기 없음 (AC-V1-23)', async () => {
    setup([register(165, '핑크프릴', 10000)])
    await openConsoleWithVoice()
    FakeRecognition.say('300번 문자찜')
    expect(await screen.findByText('300번 상품이 없어요.')).toBeDefined()
    // D-V1-21: 이유 카드 제목은 "문자찜 · 넣지 않았어요" (번호·손님 글 없음)
    const card = within(cards()).getByRole('listitem', { name: '문자찜 · 넣지 않았어요 카드' })
    expect(card.textContent).toContain('문자찜 · 넣지 않았어요')
    expect(card.textContent).not.toContain('손님 확인 필요')
    expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual(['닫기'])
    await flush(10)
    expect(smsPosts()).toHaveLength(0)
  })

  // D-V1-18 (앞 기대값 "밀려 닫히고 안내가 남는다"를 바꿈): 넣을 수 있는 문자찜 카드는 이유 카드에 밀려 닫히지 않는다
  it('이유 카드가 쌓여도 "넣을까요?" 카드는 남고 안내 줄이 없다 (D-V1-18)', async () => {
    setup([register(15, '', 10000), register(28, '', 7000), register(166, '금황', 5000)])
    await openConsoleWithVoice()
    for (const text of ['15번 28번 문자찜 끝자리 1234', '300번 문자찜', '166번 문자찜 끝자리 12', '166번 문자찜 취소', '문자찜 끝자리 5678']) FakeRecognition.say(text)
    const card = within(cards()).getByRole('listitem', { name: '15번 · 28번 · 끝자리 1234 · 문자찜 카드' })
    expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual(['넣지 않기', '넣기'])
    expect(screen.queryByRole('list', { name: '넣지 않고 닫힌 문자찜' })).toBeNull()
    expect(smsPosts()).toHaveLength(0)
  })

  it('"165번 문자찜" → 확인 필요 구매자로 넣고 결과 카드에 정산 안내 한 줄 (D-V1-21)', async () => {
    setup([register(165, '핑크프릴', 10000)])
    await openConsoleWithVoice()
    FakeRecognition.say('165번 문자찜')
    await waitFor(() => expect(smsPosts()).toHaveLength(1))
    expect(smsPosts()[0]).toMatchObject({ memo: '확인 필요', voice: true })
    await waitFor(() => expect(cards().textContent).toContain('165번 · 문자찜(확인 필요) · 1등'))
    expect(cards().textContent).toContain('방송 뒤 정산 화면에서 누구인지 확인해 주세요.')
  })

  it('다른 기기가 방금 같은 말을 넣었으면(409 VOICE_REPEATED) "같은 말을 다른 기기에서 방금 넣었어요."와 "닫기"만 (AC-V1-31)', async () => {
    setup([register(166, '청보석', 7000)])
    await openConsoleWithVoice()
    engine.failNext = apiError(409, 'VOICE_REPEATED', '같은 말을 다른 기기에서 방금 넣었어요.')
    FakeRecognition.say('166번 문자찜')
    expect(await screen.findByText('같은 말을 다른 기기에서 방금 넣었어요.')).toBeDefined()
    const card = within(cards()).getByRole('listitem', { name: '문자찜 · 넣지 않았어요 카드' })
    expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual(['닫기'])
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)))
    expect(smsPosts()).toHaveLength(0)
  })

  it('PC 폭: 기다리는 카드에 "Esc" 표시, Esc → 맨 앞 카드만 닫고 쓰기 없음, 빠른 입력칸에 글자가 있으면 그대로 (D-V1-20, AC-V1-32)', async () => {
    setup([register(165, '핑크프릴', 10000), register(166, '', 7000)], { 'voice.smsAutoSec': 10 })
    await openConsoleWithVoice()
    FakeRecognition.say('165번 문자찜 끝자리 1234')
    FakeRecognition.say('166번 문자찜 끝자리 5678')
    const newer = within(cards()).getByRole('listitem', { name: '166번 · 끝자리 5678 · 문자찜 카드' })
    const older = within(cards()).getByRole('listitem', { name: '165번 핑크프릴 · 끝자리 1234 · 문자찜 카드' })
    expect(within(newer).getAllByRole('button').map((button) => button.textContent)).toEqual(['넣지 않기', '지금 넣기'])
    expect(newer.textContent).toContain('Esc')
    expect(older.textContent).not.toContain('Esc')
    const quick = screen.getByLabelText('빠른 입력') as HTMLInputElement
    quick.focus()
    fireEvent.change(quick, { target: { value: '15' } })
    fireEvent.keyDown(quick, { key: 'Escape' })
    expect(within(cards()).queryByRole('listitem', { name: '166번 · 끝자리 5678 · 문자찜 카드' })).not.toBeNull()
    fireEvent.change(quick, { target: { value: '' } })
    fireEvent.keyDown(quick, { key: 'Escape' })
    expect(within(cards()).queryByRole('listitem', { name: '166번 · 끝자리 5678 · 문자찜 카드' })).toBeNull()
    expect(within(cards()).getByRole('listitem', { name: '165번 핑크프릴 · 끝자리 1234 · 문자찜 카드' }).textContent).toContain('Esc')
    expect(smsPosts()).toHaveLength(0)
  })

  it('되돌릴 것이 없을 때 Ctrl+Z → 결과 카드가 열려 있으면 알림만 (D-V1-22, AC-V1-33)', async () => {
    setup([register(165, '핑크프릴', 10000)])
    await openConsoleWithVoice()
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true })
    expect(screen.queryByText("문자찜은 카드의 '찜 취소하기'로 취소해요.")).toBeNull()
    FakeRecognition.say('165번 문자찜 끝자리 1234')
    await waitFor(() => expect(cards().textContent).toContain('165번 · 문자찜 · 1등'))
    const before = engine.posts.length
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true })
    expect(await screen.findByText("문자찜은 카드의 '찜 취소하기'로 취소해요.")).toBeDefined()
    expect(engine.posts).toHaveLength(before)
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
