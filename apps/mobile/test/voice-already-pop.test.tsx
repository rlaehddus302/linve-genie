// 이미 있는 번호 알림 (D-VOICE-EXISTS-01, 사용자 2026-11-17 "인식을 못해서 등록이 안 된건지 아니면 이미 있어서 등록 안 된건지"):
// 서버 음성 판단이 already를 새로 채우면 라이브 화면 위에 "12번은 이미 등록된 상품이에요"를 잠깐 띄운다. 화면을 열 때 이미 있던 알림은 띄우지 않는다.
import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { toWire } from '@livejjim/voice-session/wire'
import { VoiceSession } from '../src/lib/voice-session.ts'
import { FakeNativeAudio } from '../src/native/audio.ts'
import { ALREADY_POP_MS, AlreadyPop, alreadyLine } from '../src/screens/console/VoicePanel.tsx'
import { configureVoiceStorage } from '../src/lib/voice-preferences.ts'

const state = (already: unknown) => ({
  phase: 'on', cards: [], forms: new Map(), notes: new Map(), info: new Map(), paused: new Map(), offers: [], sms: [], smsDropped: [], flushedClosed: [], missedFolded: 0,
  instant: true, archive: false, settings: {}, smsSettings: {}, secondsText: '5', smsSecondsText: '3', quietText: '1.8', learnedCount: 0, hearing: null, readout: null, error: null, now: Date.now(), already,
})

it('새 already만 잠깐 띄운다 — 열 때 있던 것은 띄우지 않고, 값이 다르면 고치는 곳을 알린다', async () => {
  vi.useFakeTimers()
  let receive: ((value: unknown) => void) | undefined
  const audio = Object.assign(new FakeNativeAudio(), { onSession(cb: (value: unknown) => void) { receive = cb; return () => undefined }, sendSession: vi.fn() })
  configureVoiceStorage({ getItem: async () => null, setItem: async () => undefined })
  const session = new VoiceSession({ audio, deviceId: 'abcdefgh', register: async () => undefined, undoRegister: async () => undefined })
  await session.turnOn('b1', '방송'); await session.acceptConsent()
  receive?.({ type: 'ready' })
  const send = (already: unknown) => act(() => { receive?.({ type: 'voice.state', sessionId: 's1', snapshot: toWire(state(already)), display: toWire({}) }) })
  send({ no: 7, differs: false, at: 1 })
  render(<AlreadyPop session={session} broadcastId="b1" />)
  expect(screen.queryByText(alreadyLine(7, false))).toBeNull()
  send({ no: 12, differs: false, at: 2 })
  expect(screen.getByText('12번은 이미 등록된 상품이에요')).toBeTruthy()
  // 같은 알림이 다시 와도(다른 상태 갱신) 새로 띄우지 않고, 시간이 지나면 사라진다
  send({ no: 12, differs: false, at: 2 })
  await act(async () => { vi.advanceTimersByTime(ALREADY_POP_MS + 500) })
  expect(screen.queryByText('12번은 이미 등록된 상품이에요')).toBeNull()
  send({ no: 12, differs: true, at: 3 })
  expect(screen.getByText('12번은 이미 등록된 상품이에요. 바꾸려면 상품을 눌러 고쳐 주세요')).toBeTruthy()
  await act(async () => { await session.turnOff(); session.dispose() })
  vi.useRealTimers()
})
