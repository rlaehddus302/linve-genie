import { act, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { expect, it, vi } from 'vitest'
import { toWire } from '@livejjim/voice-session/wire'
import { VoiceSession } from '../src/lib/voice-session.ts'
import { FakeNativeAudio } from '../src/native/audio.ts'
import { VoicePanel } from '../src/screens/console/VoicePanel.tsx'
import { RemoteVoicePanel } from '../src/screens/console/RemoteVoicePanel.tsx'
import { configureVoiceStorage } from '../src/lib/voice-preferences.ts'

it('서버의 카드 폼·후보·정정·손님 선택을 같은 명령으로 보낸다', async () => {
  let receive: ((value: unknown) => void) | undefined
  const audio = Object.assign(new FakeNativeAudio(), { onSession(cb: (value: unknown) => void) { receive = cb; return () => undefined }, sendSession: vi.fn() })
  configureVoiceStorage({ getItem: async () => null, setItem: async () => undefined })
  const session = new VoiceSession({ audio, deviceId: 'abcdefgh', register: async () => undefined, undoRegister: async () => undefined })
  await session.turnOn('b1', '방송'); await session.acceptConsent()
  receive?.({ type: 'ready' })
  const now = Date.now()
  receive?.({ type: 'voice.state', sessionId: 's1', snapshot: toWire({
    phase: 'on', cards: [{ id: 'c1', no: 15, text: '15번 2만 원', price: 20000, autoConfirmAt: now + 3000 }],
    forms: new Map([['c1', { no: '15', name: '', price: '2만', message: null }]]), notes: new Map(), info: new Map([['c1', { candidates: [{ name: '핑크프릴' }], ask: '품종 확인 필요' }]]), paused: new Map(),
    offers: [{ id: 'o1', kind: 'offer', stage: 'ask', message: '가격을 30,000원으로 고칠까요?', error: null }],
    sms: [{ card: { id: 's1', status: 'OPEN', candidates: [{ buyer: 'buyer1', display: '문자 손님', phoneLast4: '1234' }] }, hidden: false, reason: null, sending: false, error: null, results: [] }],
    smsDropped: [], flushedClosed: [], missedFolded: 0, instant: true, archive: false, settings: { 'voice.autoConfirm': false }, smsSettings: { 'voice.smsListen': true }, secondsText: '5', smsSecondsText: '3', quietText: '1.8', learnedCount: 0,
    hearing: null, readout: { text: '15번 20,000원' }, error: null, now,
  }), display: toWire({ cards: new Map([['c1', '15번 20,000원']]), sms: new Map([['s1', '15번 · 끝자리 1234 · 문자찜']]), countdowns: new Map([['s1', '3초 뒤 넣어요']]) }) })
  const command = vi.spyOn(session, 'command')
  // D-UX4-92 (사용자 지시 2026-11-10 "탭 위에 저런 알림 띄우지 마. 그냥 사용자가 상품 목록 보고 직접 수정하게 해"): 라이브 화면 음성 칸은 확인 카드를 띄우지 않는다
  const panel = render(<VoicePanel session={session} broadcastId="b1" title="방송" seller ended={false} />)
  expect(screen.queryByText('품종 확인 필요')).toBeNull()
  expect(screen.queryByText('가격을 30,000원으로 고칠까요?')).toBeNull()
  expect(screen.queryByRole('group', { name: '음성 카드 c1' })).toBeNull()
  panel.unmount()
  // 카드 부품 자체(cards 켬)는 지금처럼 같은 명령을 보낸다 — 옛 시험 그대로
  function Cards() {
    const view = useSyncExternalStore(session.subscribe, session.getView)
    return view.remote === null ? null : <RemoteVoicePanel session={session} snapshot={view.remote} display={view.display} cards />
  }
  const rendered = render(<Cards />)
  expect(screen.getByText('품종 확인 필요')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('가격'), { target: { value: '3만' } })
  expect(command).toHaveBeenCalledWith('editForm', ['c1', { price: '3만' }])
  fireEvent.click(screen.getByRole('button', { name: '고친 값으로 등록' }))
  expect(command).toHaveBeenCalledWith('submitForm', ['c1'])
  fireEvent.click(screen.getByRole('button', { name: '핑크프릴' }))
  expect(command).toHaveBeenCalledWith('chooseCandidate', ['c1', '핑크프릴'])
  fireEvent.click(screen.getByRole('button', { name: '고치기' }))
  expect(command).toHaveBeenCalledWith('fixOffer', ['o1'])
  fireEvent.click(screen.getByRole('button', { name: '문자 손님 · 끝자리 1234' }))
  expect(command).toHaveBeenCalledWith('smsChoose', ['s1', 'buyer1'])
  expect(screen.queryByText(/시험:.*들림/)).toBeNull()
  expect(screen.getByText('3초 뒤 등록')).toBeTruthy()
  expect(screen.getByText('3초 뒤 넣어요')).toBeTruthy()
  await act(async () => { await session.turnOff() })
  expect(screen.queryByText('3초 뒤 등록')).toBeNull()
  expect(screen.queryByText('3초 뒤 넣어요')).toBeNull()
  expect(screen.getByRole('button', { name: '고친 값으로 등록' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '문자 손님 · 끝자리 1234' })).toBeTruthy()
  rendered.unmount()
  await act(async () => { await session.turnOff(); session.dispose() })
})
