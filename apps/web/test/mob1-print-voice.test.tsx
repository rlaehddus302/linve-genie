// MOB1 웹 단위 시험 — 출력 기기 끊김 문장 세 자리(D-MOB1-08, AC-MOB1-12~14), 기본 기기 이름(D-MOB1-13, AC-MOB1-24),
// 음성 화면 꺼짐 막기·안내 줄(D-MOB1-07, AC-MOB1-10·11), 아이폰 시험용 프린터 줄(D-MOB1-11), 휴대폰 크롬 확장 칸(D-MOB1-09, AC-MOB1-16).
// jsdom에는 matchMedia가 없어 휴대폰 모양이다.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AlertStrip } from '../src/components/AlertStrip.tsx'
import { EXTENSION_PHONE_ONLY, ExtensionSettings, type ExtensionHandle } from '../src/components/ExtensionConnection.tsx'
import { LABELS_SCREEN_LINK, NO_PRINT_DEVICE_WAITING, PackingPrintResult, type PackingPrintState } from '../src/components/PackingPrint.tsx'
import { PrintContext } from '../src/components/print-context.tsx'
import { CONSENT_LINES, CONSENT_OTHER_DEVICE, consentLines } from '../src/components/VoicePanel.tsx'
import type { QueueSummary } from '../src/api/print-types.ts'
import { DEFAULT_DEVICE_NAMES, cleanDeviceName, defaultDeviceName } from '../src/lib/device.ts'
import { PrintStore } from '../src/lib/print-store.ts'
import { IPHONE_TEST_PRINTER, NO_STATION_PILING, deviceLostMessage, isIphone, stationLeadText } from '../src/lib/print-words.ts'
import { ScreenWake, type VisibilitySource, type WakeSentinelLike } from '../src/voice/wake.ts'
import { device, overview, queue } from './print-support.ts'
import { FakeEventSource, flush } from './support.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const COUNTS = { conflict: 0, cancelRequest: 0, succession: 0, pending: 0, attention: 0 }

describe('출력 기기 끊김 문장 (AC-MOB1-12)', () => {
  it('이름을 괄호에 넣은 새 문장 — 받침과 상관없이 같은 조사, 옛 문장 없음', () => {
    expect(deviceLostMessage('안드로이드 폰')).toBe("출력 기기('안드로이드 폰')가 연결되어 있지 않아요. 그 기기에서 라이브지니를 열고 화면을 켜 두세요.")
    expect(deviceLostMessage('PC')).toBe("출력 기기('PC')가 연결되어 있지 않아요. 그 기기에서 라이브지니를 열고 화면을 켜 두세요.")
    expect(deviceLostMessage('휴대폰')).not.toContain('와 연결이 끊겼어요.')
  })
})

describe('콘솔 알림 띠 맨 끝 출력 기기 항목 (AC-MOB1-13, D-MOB1-14)', () => {
  const lost = queue({ device: device('other', { name: '안드로이드 폰', live: false }), waiting: 2 })
  const base = { labelsOn: true, rehearsal: false, ended: false, queue: lost, mine: false } as const

  it('라벨 켜짐·실제 방송·끝나지 않음·다른 기기가 끊김이면 끊김 문장, 출력 기기가 없고 대기가 있으면 쌓이는 중 문장', () => {
    expect(stationLeadText(base)).toBe(deviceLostMessage('안드로이드 폰'))
    expect(stationLeadText({ ...base, queue: queue({ device: null, waiting: 1 }) })).toBe(NO_STATION_PILING)
    expect(NO_STATION_PILING).toBe("출력 기기가 아직 없어 라벨이 쌓이고 있어요. 출력할 기기의 라벨 화면에서 '이 기기에서 출력'을 눌러 주세요.")
  })

  it('연결됨·대기 없음·이 기기가 출력 기기·라벨 꺼짐·모름·리허설·끝난 방송·요약 모름이면 없다', () => {
    expect(stationLeadText({ ...base, queue: queue({ device: device('other', { live: true }), waiting: 3 }) })).toBeNull()
    expect(stationLeadText({ ...base, queue: queue({ device: null, waiting: 0 }) })).toBeNull()
    expect(stationLeadText({ ...base, mine: true })).toBeNull()
    expect(stationLeadText({ ...base, labelsOn: false })).toBeNull()
    expect(stationLeadText({ ...base, labelsOn: null })).toBeNull()
    expect(stationLeadText({ ...base, rehearsal: true })).toBeNull()
    expect(stationLeadText({ ...base, ended: true })).toBeNull()
    expect(stationLeadText({ ...base, queue: null })).toBeNull()
  })

  // MOB1 D-MOB1-14: 출력 기기 항목은 띠 맨 끝(세는 알림 모두의 뒤)으로 바뀌었다 — 예전 "맨 앞" 단언을 바꾼 스펙에 맞춤
  it('띠 맨 끝의 노란 버튼 — 알림 수("알림 n 펼치기")에 넣지 않는다, 누르면 할 일, 기기 이름의 태그는 글자로만', () => {
    const onClick = vi.fn()
    const text = deviceLostMessage('<b>폰</b><script>x()</script>')
    render(<AlertStrip leads={[{ key: 'print-station', text, soft: true, uncounted: true, onClick }]} counts={{ ...COUNTS, pending: 2 }} onOpen={() => {}} onToggle={() => {}} />)
    const region = screen.getByRole('region', { name: '알림' })
    const buttons = within(region).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['보류 찜 2', text])
    const last = buttons[buttons.length - 1] as HTMLElement
    expect(last.className).toContain('alert-soft')
    expect(region.querySelector('b, script')).toBeNull()
    expect(screen.getByRole('button', { name: '알림 2 펼치기' })).toBeDefined()
    fireEvent.click(last)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('"출력 멈춤"(빨간)이 있으면 첫 항목은 "출력 멈춤 · …"이고 출력 기기 항목은 세는 알림 모두의 뒤 — 플랫폼 줄은 그대로 맨 앞 (U-MOB1-02)', () => {
    const text = deviceLostMessage('안드로이드 폰')
    render(
      <AlertStrip
        leads={[
          { key: 'tiktok', text: '틱톡 알림 줄', onClick: () => {} },
          { key: 'print-station', text, soft: true, uncounted: true, onClick: () => {} },
        ]}
        counts={{ conflict: 1, cancelRequest: 0, succession: 0, pending: 3, attention: 1 }}
        print={{ pause: '프린터가 꺼졌어요.', discard: 2 }}
        thanksFailed={1}
        onOpen={() => {}}
        onToggle={() => {}}
      />,
    )
    const region = screen.getByRole('region', { name: '알림' })
    const words = within(region).getAllByRole('button').map((b) => b.textContent)
    expect(words[0]).toBe('틱톡 알림 줄')
    expect(words[words.length - 1]).toBe(text)
    expect(words.slice(1, -1)).toEqual(['충돌 1', '출력 멈춤 · 프린터가 꺼졌어요.', '버릴 라벨 2', '보류 찜 3', '확인 필요 1', '감사 실패 1'])
  })

  it('플랫폼 줄 없이 "출력 멈춤"과 함께면 접힌 한 줄의 첫 항목이 "출력 멈춤 · …", 다른 알림이 없으면 출력 기기 항목이 첫 항목', () => {
    const text = deviceLostMessage('휴대폰')
    const lead = { key: 'print-station', text, soft: true, uncounted: true, onClick: () => {} }
    const { unmount } = render(<AlertStrip leads={[lead]} counts={COUNTS} print={{ pause: '종이가 없어요.', discard: 0 }} onOpen={() => {}} onToggle={() => {}} />)
    let buttons = within(screen.getByRole('region', { name: '알림' })).getAllByRole('button')
    expect(buttons[0]?.textContent).toBe('출력 멈춤 · 종이가 없어요.')
    expect(buttons[1]?.textContent).toBe(text)
    unmount()
    render(<AlertStrip leads={[lead]} counts={COUNTS} onOpen={() => {}} onToggle={() => {}} />)
    buttons = within(screen.getByRole('region', { name: '알림' })).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([text])
  })
})

function packingState(done: string | null): PackingPrintState {
  return { busy: false, done, error: null, ready: true, send: async () => {} }
}

async function packingResult(summary: QueueSummary) {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(overview({ queue: summary })), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  const store = new PrintStore({ openStream: () => new FakeEventSource('/api/stream') })
  await store.reload()
  render(
    <PrintContext.Provider value={{ store, station: { isMine: () => false } as never }}>
      <PackingPrintResult print={packingState('포장 라벨 1장 출력을 접수했어요.')} />
    </PrintContext.Provider>,
  )
}

describe('포장 접수 문장 (AC-MOB1-14)', () => {
  it('출력 기기가 있으나 끊김: 접수 문장 바로 뒤 안내 상자에 끊김 문장 + "라벨 화면으로"', async () => {
    await packingResult(queue({ device: device('other', { name: '휴대폰', live: false }) }))
    const done = screen.getByRole('status')
    expect(done.textContent).toBe('포장 라벨 1장 출력을 접수했어요.')
    const box = done.nextElementSibling as HTMLElement
    expect(box.getAttribute('role')).toBe('note')
    expect(box.textContent).toContain(deviceLostMessage('휴대폰'))
    expect(within(box).getByRole('link', { name: LABELS_SCREEN_LINK }).getAttribute('href')).toBe('/labels')
  })

  it('연결된 출력 기기면 추가 문장 없음, 출력 기기가 없으면 기다리는 중 문장 그대로', async () => {
    await packingResult(queue({ device: device('other', { name: '휴대폰', live: true }) }))
    expect(screen.queryByRole('note')).toBeNull()
    cleanup()
    await packingResult(queue({ device: null }))
    expect(screen.getByRole('note').textContent).toContain(NO_PRINT_DEVICE_WAITING)
    expect(screen.getByRole('note').textContent).not.toContain('연결되어 있지 않아요')
  })
})

describe('기본 기기 이름 (AC-MOB1-24)', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
  const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  const OTHER_PHONE = 'Mozilla/5.0 (Mobile; rv:120.0) Gecko/120.0 Firefox/120.0'

  it('사용자 에이전트마다 — 아이폰·아이패드 "아이폰", 안드로이드 "안드로이드 폰", 그 밖의 휴대폰 "휴대폰", 아니면 "PC"', () => {
    const name = (userAgent: string, narrow = false) => defaultDeviceName({ userAgent, narrow, otherStation: null })
    expect(name(IPHONE)).toBe('아이폰')
    expect(name(IPAD)).toBe('아이폰')
    expect(name(ANDROID)).toBe('안드로이드 폰')
    expect(name(OTHER_PHONE)).toBe('휴대폰')
    expect(name(PC, true)).toBe('휴대폰')
    expect(name(PC)).toBe('PC')
  })

  it('다른 출력 기기의 이름이 같으면 뒤에 " 2" — 다르거나 없으면 그대로, 결과는 늘 cleanDeviceName을 지난다', () => {
    expect(defaultDeviceName({ userAgent: ANDROID, narrow: false, otherStation: '안드로이드 폰' })).toBe('안드로이드 폰 2')
    expect(defaultDeviceName({ userAgent: ANDROID, narrow: false, otherStation: '  안드로이드 폰​ ' })).toBe('안드로이드 폰 2')
    expect(defaultDeviceName({ userAgent: IPHONE, narrow: false, otherStation: '안드로이드 폰' })).toBe('아이폰')
    expect(defaultDeviceName({ userAgent: PC, narrow: false, otherStation: 'PC' })).toBe('PC 2')
    for (const value of Object.values(DEFAULT_DEVICE_NAMES)) {
      expect(cleanDeviceName(value)).toBe(value)
      expect(cleanDeviceName(`${value} 2`)).toBe(`${value} 2`)
    }
  })
})

describe('아이폰 시험용 프린터 줄 (AC-MOB1-20)', () => {
  it('아이폰·아이패드 사용자 에이전트만, 문장은 글자 그대로', () => {
    expect(isIphone('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true)
    expect(isIphone('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true)
    expect(isIphone('Mozilla/5.0 (Linux; Android 14)')).toBe(false)
    expect(isIphone('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false)
    expect(IPHONE_TEST_PRINTER).toBe('실제 아이폰에선 프린터에 바로 연결할 수 없어요. 라벨 그림을 저장해 출력해 주세요.')
  })
})

describe('음성 안내 창 마지막 줄 (AC-MOB1-11)', () => {
  it('지금 세 줄 뒤에 "방송하는 폰이 아닌 다른 기기…"', () => {
    // MOB1 D-MOB1-07: 줄이 넷이 됐다 · V3 D-V3-17: 바로 등록 한 줄을 더해 다섯 (마지막 줄은 그대로)
    expect(CONSENT_LINES).toHaveLength(5)
    expect(CONSENT_LINES.at(-1)).toBe(CONSENT_OTHER_DEVICE)
    // D-V3-36: 바로 등록을 끈 기기는 I4 첫 줄, 바로 등록 줄 없음 (마지막 줄은 그대로)
    expect(consentLines(false)[0]).toBe('말한 번호·품종·가격을 카드로 보여 줘요. 카드를 확인하고 등록해야 상품이 생겨요.')
    expect(consentLines(false)).toHaveLength(4)
    expect(consentLines(true).slice(0, 2)).toEqual(['번호와 가격이 확실하지 않으면 카드로 보여 드려요. 카드를 확인하고 등록해요.', '번호와 가격이 들리면 바로 등록돼요. 음성 설정에서 끌 수 있어요.'])
    expect(consentLines(false).at(-1)).toBe(CONSENT_OTHER_DEVICE)
    expect(CONSENT_OTHER_DEVICE).toBe('방송하는 폰이 아닌 다른 기기(관리 폰이나 PC)에서 켜 주세요. 방송 앱이 마이크를 쓰는 폰에서는 잘 듣지 못해요.')
  })
})

/** 가짜 Wake Lock (요청·놓기를 센다, 브라우저처럼 release 사건을 보낼 수 있다) */
class FakeWake {
  requests = 0
  releases = 0
  reject = false
  readonly sentinels: { sentinel: WakeSentinelLike; fire: () => void; released: boolean }[] = []
  request = async (): Promise<WakeSentinelLike> => {
    this.requests++
    if (this.reject) throw new Error('NotAllowedError')
    const listeners: (() => void)[] = []
    const entry = {
      released: false,
      fire: () => listeners.forEach((listener) => listener()),
      sentinel: {
        release: async () => {
          if (entry.released) return
          entry.released = true
          this.releases++
          entry.fire()
        },
        addEventListener: (_type: 'release', listener: () => void) => listeners.push(listener),
      },
    }
    this.sentinels.push(entry)
    return entry.sentinel
  }
  get held(): number {
    return this.sentinels.filter((entry) => !entry.released).length
  }
}

class FakeDocument implements VisibilitySource {
  visibilityState: DocumentVisibilityState = 'visible'
  readonly listeners = new Set<() => void>()
  addEventListener(_type: 'visibilitychange', listener: () => void) {
    this.listeners.add(listener)
  }
  removeEventListener(_type: 'visibilitychange', listener: () => void) {
    this.listeners.delete(listener)
  }
  show(state: DocumentVisibilityState) {
    this.visibilityState = state
    for (const listener of [...this.listeners]) listener()
  }
}

describe('음성이 켜진 동안 화면 꺼짐 막기 (AC-MOB1-10)', () => {
  let fake: FakeWake
  let doc: FakeDocument
  beforeEach(() => {
    fake = new FakeWake()
    doc = new FakeDocument()
  })

  it('켜면 1번 요청, 끄면 그 잠금을 놓는다 — 같은 값으로 다시 불러도 더 요청하지 않는다', async () => {
    const wake = new ScreenWake(fake.request, doc)
    wake.set(true)
    wake.set(true)
    await flush()
    expect(fake.requests).toBe(1)
    expect(fake.held).toBe(1)
    wake.set(false)
    await flush()
    expect(fake.releases).toBe(1)
    expect(fake.held).toBe(0)
  })

  it('켜진 채 숨었다(브라우저가 놓음) 다시 보이면 1번 더, 끈 뒤 보이면 요청하지 않는다', async () => {
    const wake = new ScreenWake(fake.request, doc)
    wake.set(true)
    await flush()
    doc.show('hidden')
    fake.sentinels[0]?.fire()
    doc.show('visible')
    await flush()
    expect(fake.requests).toBe(2)
    wake.set(false)
    await flush()
    doc.show('hidden')
    doc.show('visible')
    await flush()
    expect(fake.requests).toBe(2)
  })

  it('숨은 동안 켜면 보일 때 요청한다', async () => {
    doc.visibilityState = 'hidden'
    const wake = new ScreenWake(fake.request, doc)
    wake.set(true)
    await flush()
    expect(fake.requests).toBe(0)
    doc.show('visible')
    await flush()
    expect(fake.requests).toBe(1)
  })

  it('Wake Lock이 없거나 거절되면 조용히 아무 일 없다(던지지 않는다)', async () => {
    const none = new ScreenWake(null, doc)
    expect(() => none.set(true)).not.toThrow()
    fake.reject = true
    const refused = new ScreenWake(fake.request, doc)
    refused.set(true)
    await flush()
    expect(fake.requests).toBe(1)
    expect(() => refused.set(false)).not.toThrow()
  })

  it('요청 중에 끄면 받은 잠금을 바로 놓는다', async () => {
    const wake = new ScreenWake(fake.request, doc)
    wake.set(true)
    wake.set(false)
    await flush()
    expect(fake.held).toBe(0)
  })

  it('출력 기기의 잠금과 따로 — 음성만 꺼도 다른 잠금은 남는다', async () => {
    const station = await fake.request()
    const wake = new ScreenWake(fake.request, doc)
    wake.set(true)
    await flush()
    expect(fake.held).toBe(2)
    wake.set(false)
    await flush()
    expect(fake.held).toBe(1)
    expect(fake.sentinels[0]?.sentinel).toBe(station)
    expect(fake.sentinels[0]?.released).toBe(false)
  })
})

describe('휴대폰 설정의 크롬 확장 칸 (AC-MOB1-16)', () => {
  it('한 줄 안내뿐 — 연결·다시 만들기·끊기·코드·감사 올리기 스위치가 없고 요청을 보내지 않는다(이미 연결·켬이어도)', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const handle: ExtensionHandle = {
      view: { connected: true, connectedAt: '2026-10-19T10:00:00.000Z', message: null, lastChatAt: null, dropped: 0, thanks: { enabled: true } } as never,
      error: null,
      reload: async () => {},
      set: () => {},
    }
    const { container } = render(<ExtensionSettings handle={handle} />)
    await act(async () => {
      await flush()
    })
    expect(container.textContent).toBe(EXTENSION_PHONE_ONLY)
    expect(EXTENSION_PHONE_ONLY).toBe('크롬 확장은 PC 크롬에서 연결하고 설정해요.')
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.queryAllByRole('checkbox')).toEqual([])
    expect(screen.queryAllByRole('switch')).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})
