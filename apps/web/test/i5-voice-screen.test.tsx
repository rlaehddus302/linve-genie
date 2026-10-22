// 아이폰(사파리) 음성 화면 (I5 — AC-I5-11·12·13·90, D-I5-05~08).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONSENT_LINES, VoiceLive } from '../src/components/VoicePanel.tsx'
import { SENT_NOTICE, STANDALONE_NOTICE, VOICE_IDLE, VoiceController, type VoiceSnapshot } from '../src/voice/controller.ts'
import { isHomeScreenApp } from '../src/voice/standalone.ts'

const NOTICE_HOME = '홈 화면 앱에서는 음성이 자주 끊길 수 있어요. 안 되면 사파리에서 열어 주세요.'

function controller(): VoiceController {
  return new VoiceController({
    load: () => Promise.reject(new Error('x')),
    now: () => 0,
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
  })
}

function show(snapshot: Partial<VoiceSnapshot>): void {
  render(<VoiceLive voice={controller()} snapshot={{ ...VOICE_IDLE, ...snapshot }} badge={null} onSubmitForm={() => {}} onRegister={() => {}} />)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('외부 전송 고지 (AC-I5-12, D-I5-06)', () => {
  it('켜진 동안의 한 줄과 안내 창 문장이 "크롬은 구글, 아이폰은 애플"이고 옛 문장은 없다', () => {
    expect(SENT_NOTICE).toBe('음성은 인식을 위해 크롬은 구글로, 아이폰은 애플로 보내져요.')
    expect(CONSENT_LINES).toContain('음성은 인식을 위해 브라우저의 음성 인식 서버(크롬은 구글, 아이폰은 애플)로 보내져요. 라이브찜은 음성을 녹음하거나 저장하지 않아요.')
    for (const line of [SENT_NOTICE, ...CONSENT_LINES]) expect(line).not.toContain('구글로 보내져요')
    show({ phase: 'on', stateLabel: '음성: 듣는 중' })
    expect(screen.getByText(SENT_NOTICE)).toBeDefined()
  })
})

describe('홈 화면 앱 한 줄 (AC-I5-11, D-I5-05)', () => {
  it('navigator.standalone === true일 때만 홈 화면 앱이다 (UA는 보지 않는다)', () => {
    expect(isHomeScreenApp({ standalone: true })).toBe(true)
    for (const value of [false, undefined, 'true', 1, null]) expect(isHomeScreenApp({ standalone: value })).toBe(false)
    expect(isHomeScreenApp({ userAgent: 'iPhone', standalone: false })).toBe(false)
    expect(isHomeScreenApp(undefined)).toBe(false)
    expect(isHomeScreenApp(null)).toBe(false)
    expect(STANDALONE_NOTICE).toBe(NOTICE_HOME)
  })

  it('홈 화면 앱: 켜진 동안과 오류로 멈춘 뒤 보인다 (막지 않는다)', () => {
    vi.stubGlobal('navigator', { ...navigator, standalone: true })
    show({ phase: 'on', stateLabel: '음성: 듣는 중' })
    expect(screen.getByText(NOTICE_HOME)).toBeDefined()
    expect(screen.getByRole('button', { name: '음성 끄기' })).toBeDefined()
    cleanup()
    show({ phase: 'off', error: '마이크 사용이 막혀 있어요.' })
    expect(screen.getByText(NOTICE_HOME)).toBeDefined()
    cleanup()
    // 꺼져 있고 오류도 없으면 보이지 않는다
    show({ phase: 'off' })
    expect(screen.queryByText(NOTICE_HOME)).toBeNull()
  })

  it('홈 화면 앱이 아니면(값이 없거나 false) 보이지 않는다', () => {
    show({ phase: 'on', stateLabel: '음성: 듣는 중' })
    expect(screen.queryByText(NOTICE_HOME)).toBeNull()
    cleanup()
    vi.stubGlobal('navigator', { ...navigator, standalone: false })
    show({ phase: 'on', stateLabel: '음성: 듣는 중', error: '마이크 사용이 막혀 있어요.' })
    expect(screen.queryByText(NOTICE_HOME)).toBeNull()
  })
})
