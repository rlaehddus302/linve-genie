// 켠 음성은 앱 전체가 들고 있다 (V3 D-V3-52, AC-V3-58) — 콘솔을 떠나도 끄지 않고, 끄기·방송 끝·로그아웃 때만 끝난다.
import * as voiceModule from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceHost } from '../src/voice/controller.ts'
import { VOICE_ON_KEY, acquireVoiceSession, endVoiceSession, getVoiceSession, logoutVoice, readVoiceOn } from '../src/voice/session.ts'

class FakeRecognition {
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  start(): void {}
  stop(): void {}
  abort(): void {}
}

function host(): VoiceHost {
  return {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    currentNames: () => [],
    products: () => new Map(),
    fetchHistory: async () => [],
    dialogOpen: () => false,
    readConsent: () => true,
    writeConsent: () => {},
    readSettings: () => null,
    writeSettings: () => {},
    register: () => {},
    focusQuick: () => {},
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })))
  window.localStorage.clear()
})

afterEach(() => {
  endVoiceSession(getVoiceSession(), true)
  vi.unstubAllGlobals()
})

describe('음성 켬 유지 (D-V3-52)', () => {
  it('콘솔이 내려가도 켜진 음성은 끝나지 않고, 켠 방송 ID를 그 기기에 남긴다', async () => {
    const session = acquireVoiceSession('b1', '오늘 방송')
    expect(session).not.toBeNull()
    if (session === null) return
    const console1 = host()
    session.attach(console1, '오늘 방송')
    await session.controller.turnOn()
    await settle()
    expect(session.controller.getSnapshot().phase).toBe('on')
    expect(readVoiceOn()).toBe('b1')
    session.detach(console1)
    expect(getVoiceSession()).toBe(session)
    expect(session.controller.getSnapshot().phase).toBe('on')
    expect(session.getView()).toMatchObject({ on: true, title: '오늘 방송', broadcastId: 'b1' })
    // 같은 방송 콘솔을 다시 열면 같은 음성
    expect(acquireVoiceSession('b1', '오늘 방송')).toBe(session)
  })

  it('켜진 동안 다른 방송 콘솔은 음성을 가져가지 않는다(안내만)', async () => {
    const session = acquireVoiceSession('b1', '오늘 방송')
    if (session === null) throw new Error('없음')
    session.attach(host(), '오늘 방송')
    await session.controller.turnOn()
    await settle()
    expect(acquireVoiceSession('b2', '다른 방송')).toBeNull()
  })

  it('켜지 않은 채 콘솔이 내려가면 끝난다', () => {
    const session = acquireVoiceSession('b1', '오늘 방송')
    if (session === null) throw new Error('없음')
    const h = host()
    session.attach(h, '오늘 방송')
    session.detach(h)
    expect(getVoiceSession()).toBeNull()
  })

  it('콘솔 밖에서 [끄기]를 누르면 끝나고 켠 방송 ID를 지운다', async () => {
    const session = acquireVoiceSession('b1', '오늘 방송')
    if (session === null) throw new Error('없음')
    const h = host()
    session.attach(h, '오늘 방송')
    await session.controller.turnOn()
    await settle()
    session.detach(h)
    session.controller.turnOff()
    expect(getVoiceSession()).toBeNull()
    expect(window.localStorage.getItem(VOICE_ON_KEY)).toBeNull()
  })

  it('로그아웃하면 끝나고 켠 방송 ID를 지운다', async () => {
    const session = acquireVoiceSession('b1', '오늘 방송')
    if (session === null) throw new Error('없음')
    session.attach(host(), '오늘 방송')
    await session.controller.turnOn()
    await settle()
    logoutVoice()
    expect(getVoiceSession()).toBeNull()
    expect(readVoiceOn()).toBeNull()
  })
})
