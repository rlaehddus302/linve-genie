// 아이폰(사파리) 음성 화면 (I5 — AC-I5-11·12·13·90, D-I5-05~08).
import type { SuggestionCard } from '@livejjim/voice'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONSENT_LINES, VoiceLive, revealCard } from '../src/components/VoicePanel.tsx'
import { FLUSHED_CARD_NOTE, SENT_NOTICE, SENT_NOTICE_SHORT, STANDALONE_NOTICE, errorLines, flushedClosedNotice, VOICE_IDLE, VoiceController, type VoiceSnapshot } from '../src/voice/controller.ts'
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
    // D-I5-16: 폭 768px 이상은 긴 문장, 미만은 짧은 문장 (AC-I5-31)
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 48rem)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    show({ phase: 'on', stateLabel: '음성: 듣는 중' })
    expect(screen.getByText(SENT_NOTICE)).toBeDefined()
    expect(screen.queryByText(SENT_NOTICE_SHORT)).toBeNull()
  })

  it('폭 768px 미만은 짧은 문장 "구글·애플로" (AC-I5-31, D-I5-16)', () => {
    expect(SENT_NOTICE_SHORT).toBe('음성은 인식을 위해 구글·애플로 보내져요.')
    show({ phase: 'on', stateLabel: '음성: 듣는 중' })
    expect(screen.getByText(SENT_NOTICE_SHORT)).toBeDefined()
    expect(screen.queryByText(SENT_NOTICE)).toBeNull()
    expect(document.body.textContent).not.toContain('음성은 인식을 위해 구글로 보내져요.')
  })
})

describe('안내 창 마이크 줄 (AC-I5-27, D-I5-11)', () => {
  it('"브라우저가 마이크 사용을 물으면", "크롬이 마이크"는 없다', () => {
    expect(CONSENT_LINES).toContain('다음에 브라우저가 마이크 사용을 물으면 "허용"을 눌러 주세요.')
    for (const line of CONSENT_LINES) expect(line).not.toContain('크롬이 마이크')
  })
})

describe('오류 문장은 줄마다 따로 (AC-I5-28, D-I5-12·13)', () => {
  it('\\n에서 나눈 줄이 차례대로 서로 다른 블록, 지원 안 함이 아니면 "닫기" 없음', () => {
    show({ phase: 'off', error: '마이크 사용이 막혀 있어요.\n· PC·안드로이드 크롬: 주소창 왼쪽 자물쇠에서 마이크를 허용해 주세요.\n· 아이폰: 설정 > 사파리 > 마이크에서 허용해 주세요.' })
    const alert = screen.getByRole('alert')
    expect(alert.className).toContain('voice-error')
    expect([...alert.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      '마이크 사용이 막혀 있어요.',
      '· PC·안드로이드 크롬: 주소창 왼쪽 자물쇠에서 마이크를 허용해 주세요.',
      '· 아이폰: 설정 > 사파리 > 마이크에서 허용해 주세요.',
    ])
    expect(screen.queryByRole('button', { name: '닫기' })).toBeNull()
  })

  it('errorLines: 줄이 하나면 한 줄, 빈 줄은 버린다', () => {
    expect(errorLines('음성 인식이 멈췄어요. 다시 켜 주세요.')).toEqual(['음성 인식이 멈췄어요. 다시 켜 주세요.'])
    expect(errorLines('가\n\n나')).toEqual(['가', '나'])
  })

  it('지원 안 함은 안내 색 블록과 "닫기" (D-I5-15)', () => {
    show({ phase: 'off', error: '이 기기에서는 음성이 어려워요.', unsupported: true })
    const alert = screen.getByRole('alert')
    expect(alert.className).toContain('voice-guide')
    expect(screen.getByRole('button', { name: '닫기' })).toBeDefined()
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

function card(patch: Partial<SuggestionCard>): SuggestionCard {
  return { id: 'voice-1', no: 15, name: '핑크프릴', price: 15000, confidence: 'HIGH', text: '15번 핑크프릴 만오천원', createdAt: 0, status: 'OPEN', touched: false, autoConfirmAt: null, ...patch }
}

function fakeVoice(dismiss: () => void = () => {}): VoiceController {
  const voice = { describe: (item: SuggestionCard) => `${String(item.no)}번 ${item.name ?? ''} ${String(item.price)}원 — 등록할까요?`, dismissFlushedClosed: dismiss }
  return voice as unknown as VoiceController
}

describe('끝에서 넘긴 카드 (U-I5-01, D-I5-02)', () => {
  it('넘긴 카드에는 "확인 필요" 글자와 까닭 줄이 있고, 자동 등록 남은 초가 없다', () => {
    const settings = { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }
    render(
      <VoiceLive
        voice={fakeVoice()}
        snapshot={{ ...VOICE_IDLE, phase: 'on', stateLabel: '음성: 듣는 중', settings, cards: [card({ flushedAtEnd: true }), card({ id: 'voice-2', no: 12, autoConfirmAt: 3000 })] }}
        badge={null}
        onSubmitForm={() => {}}
        onRegister={() => {}}
      />,
    )
    expect(FLUSHED_CARD_NOTE).toBe('끝까지 못 들었어요. 맞는지 확인하고 "등록"을 눌러 주세요.')
    const flushed = screen.getByRole('listitem', { name: '15번 핑크프릴 15000원 카드' })
    expect(flushed.textContent).toContain('확인 필요')
    expect(flushed.textContent).toContain(FLUSHED_CARD_NOTE)
    expect(flushed.textContent).not.toContain('자동 등록')
    expect(flushed.className).toContain('voice-card-low')
    // 보통 카드(12번)는 까닭 줄·꼬리표 없이 남은 초만
    const normal = screen.getByRole('listitem', { name: '12번 핑크프릴 15000원 카드' })
    expect(normal.textContent).not.toContain(FLUSHED_CARD_NOTE)
    expect(normal.textContent).not.toContain('확인 필요')
    expect(normal.textContent).toContain('초 뒤 자동 등록')
  })

  it('밀려 닫힌 넘긴 카드의 안내: 알림으로 보이고 "알겠어요"로 닫는다', () => {
    const dismiss = vi.fn()
    render(<VoiceLive voice={fakeVoice(dismiss)} snapshot={{ ...VOICE_IDLE, phase: 'on', stateLabel: '음성: 듣는 중', flushedClosed: ['15번 핑크프릴 15,000원 — 등록할까요?'] }} badge={null} onSubmitForm={() => {}} onRegister={() => {}} />)
    expect(flushedClosedNotice('15번 핑크프릴 15,000원')).toBe('새 카드에 밀려 끝까지 못 들은 카드(15번 핑크프릴 15,000원)를 닫았어요. 맞는 상품이면 빠른 입력으로 등록해 주세요.')
    expect(screen.getByRole('alert').textContent).toContain(flushedClosedNotice('15번 핑크프릴 15,000원'))
    fireEvent.click(screen.getByRole('button', { name: '알겠어요' }))
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('밀려 닫힌 넘긴 카드가 두 장이면 두 안내가 모두 보이고, "알겠어요" 하나로 모두 닫는다', () => {
    const dismiss = vi.fn()
    render(
      <VoiceLive
        voice={fakeVoice(dismiss)}
        snapshot={{ ...VOICE_IDLE, phase: 'on', stateLabel: '음성: 듣는 중', flushedClosed: ['15번 핑크프릴 15,000원 — 등록할까요?', '16번 라울 20,000원 — 등록할까요?'] }}
        badge={null}
        onSubmitForm={() => {}}
        onRegister={() => {}}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(flushedClosedNotice('15번 핑크프릴 15,000원'))
    expect(alert.textContent).toContain(flushedClosedNotice('16번 라울 20,000원'))
    expect(screen.getAllByRole('button', { name: '알겠어요' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '알겠어요' }))
    expect(dismiss).toHaveBeenCalledTimes(1)
  })
})

describe('휴대폰에서 새 카드 보이게 내리기 (U-I5-02)', () => {
  function rect(top: number, bottom: number): DOMRect {
    return { top, bottom, left: 0, right: 320, width: 320, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  }

  function page(menuTop: number, stickyBottom: number): void {
    document.body.replaceChildren()
    const sticky = document.createElement('div')
    sticky.className = 'console-sticky'
    const menu = document.createElement('nav')
    menu.className = 'menu'
    menu.style.position = 'fixed'
    document.body.append(sticky, menu)
    vi.spyOn(document.querySelector('.menu') as HTMLElement, 'getBoundingClientRect').mockReturnValue(rect(menuTop, menuTop + 55))
    vi.spyOn(document.querySelector('.console-sticky') as HTMLElement, 'getBoundingClientRect').mockReturnValue(rect(0, stickyBottom))
  }

  function element(top: number, bottom: number): HTMLElement {
    const el = document.createElement('li')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(top, bottom))
    return el
  }

  it('카드가 메뉴 막대 밑에 있으면 막대 위까지 내린다', () => {
    const scroll = vi.fn()
    vi.stubGlobal('scrollBy', scroll)
    page(513, 200)
    revealCard(element(500, 650))
    expect(scroll).toHaveBeenCalledWith({ top: 650 - (513 - 8), behavior: 'auto' })
  })

  it('이미 다 보이면 움직이지 않는다', () => {
    const scroll = vi.fn()
    vi.stubGlobal('scrollBy', scroll)
    page(513, 200)
    revealCard(element(220, 400))
    expect(scroll).not.toHaveBeenCalled()
  })

  it('고정 영역이 아직 붙기 전(화면 중간)이어도 붙은 뒤의 높이만큼만 비워 두고 내린다', () => {
    const scroll = vi.fn()
    vi.stubGlobal('scrollBy', scroll)
    page(513, 0)
    vi.spyOn(document.querySelector('.console-sticky') as HTMLElement, 'getBoundingClientRect').mockReturnValue(rect(182, 326))
    revealCard(element(483, 705))
    expect(scroll).toHaveBeenCalledWith({ top: 705 - 505, behavior: 'auto' })
  })

  it('카드가 보이는 곳보다 크면 카드 위(카드 글)가 고정 영역 바로 아래에 오게', () => {
    const scroll = vi.fn()
    vi.stubGlobal('scrollBy', scroll)
    page(513, 200)
    revealCard(element(400, 900))
    expect(scroll).toHaveBeenCalledWith({ top: 400 - 208, behavior: 'auto' })
  })
})
