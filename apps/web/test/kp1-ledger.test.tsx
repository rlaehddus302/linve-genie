// KP1 손님 장부 웹 (CR-2~CR-7, AC-KP1-04·07·08·11·13~16): 꼬리표 받기 차례·훅·꼬리표 모양, 설정 "손님 관리" 장부 칸,
// 묶음 자세히 "지난 주문 배송지", 손님 자세히 장부 칸·지우기, 손님 엑셀 창. 서버 계약은 harness/sprints/KP1/contract.md §3·§4 — 가짜 서버가 그 모양으로 답한다.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { BundleView, ParcelRow } from '../src/api/parcel-types.ts'
import { ChatBadgeMark } from '../src/components/ChatBadges.tsx'
import { CustomerLedgerSection, linkedLine } from '../src/components/CustomerLedger.tsx'
import { CustomerSettingsSection } from '../src/components/CustomerSettings.tsx'
import { CustomersXlsxDialog } from '../src/components/CustomersXlsxDialog.tsx'
import { AddressSection } from '../src/components/ParcelParts.tsx'
import { SaveBarArea } from '../src/components/SaveBar.tsx'
import {
  BADGE_BATCH,
  BADGE_GAP_MS,
  BadgeQueue,
  CONSOLE_BADGES_HELP,
  CONSOLE_BADGES_LABEL,
  LEDGER_MONTHS_LABEL,
  PREFILL_TITLE,
  XLSX_CONTACT_LABEL,
  XLSX_CONTACT_WARNING,
  badgeSpokenOf,
  badgeTone,
  badgesPath,
  chatBuyers,
  customersEventWhat,
  customersXlsxPath,
  useChatBadges,
  type BadgesView,
  type ChatBadges,
  type ChatBadgesDeps,
  type CustomerLedgerView,
  type LedgerSettings,
} from '../src/lib/ledger.ts'
import type { EventSourceLike } from '../src/lib/stream.ts'
import { DATE, FakeEventSource, FakeServer, apiError, flush } from './support.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  onUnauthorized(null)
})

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

/** 가짜 시계에서 약속을 풀어 준다 */
async function settle() {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

// ── 순수 ──────────────────────────────────────────────────────────────

describe('꼬리표 받기 차례 (CR-7, AC-KP1-16)', () => {
  it('새 구매자만 50명씩, 받기 사이 4초 이상, 물은 구매자는 다시 묻지 않는다', () => {
    const queue = new BadgeQueue()
    const many = Array.from({ length: 60 }, (_, i) => `UC_${String(i)}`)
    expect(queue.add(many)).toBe(true)
    const first = queue.next(0)
    expect(first.kind === 'ask' ? first.buyers.length : -1).toBe(BADGE_BATCH)
    expect(queue.next(1_000)).toEqual({ kind: 'wait', ms: BADGE_GAP_MS - 1_000 })
    const second = queue.next(BADGE_GAP_MS)
    expect(second.kind === 'ask' ? second.buyers : []).toEqual(many.slice(50))
    expect(queue.next(BADGE_GAP_MS * 3)).toEqual({ kind: 'idle' })
    // 이미 물은 구매자는 다시 줄에 서지 않는다
    expect(queue.add(many)).toBe(false)
    expect(queue.add(['UC_new', 'UC_new'])).toBe(true)
    expect(queue.next(BADGE_GAP_MS * 3)).toEqual({ kind: 'ask', buyers: ['UC_new'] })
    // 다시 켬: 물은 구매자를 다시 줄에 세운다
    queue.reset()
    const again = queue.next(BADGE_GAP_MS * 5)
    expect(again.kind === 'ask' ? again.buyers.length : -1).toBe(BADGE_BATCH)
  })

  it('조회 주소는 buyer 여러 개(겹치면 하나), 받기 주소는 contact=0|1', () => {
    expect(badgesPath(DATE, ['UC_A', 'ig:하나 둘', 'UC_A'])).toBe(`/api/days/${DATE}/customer-badges?buyer=UC_A&buyer=ig%3A%ED%95%98%EB%82%98+%EB%91%98`)
    expect(customersXlsxPath(false)).toBe('/api/customers.xlsx?contact=0')
    expect(customersXlsxPath(true)).toBe('/api/customers.xlsx?contact=1')
  })

  it('채팅 구매자: 방송자 본인 글·빈 채널을 빼고 처음 나온 순서', () => {
    expect(
      chatBuyers([
        { channel: 'UC_B', owner: false },
        { channel: 'UC_SELF', owner: true },
        { channel: '', owner: false },
        { channel: 'UC_A', owner: false },
        { channel: 'UC_B', owner: false },
      ]),
    ).toEqual(['UC_B', 'UC_A'])
  })

  it('꼬리표 색·읽기 문장·알림 종류', () => {
    expect(badgeTone('입금 늦음 주의')).toBe('caution')
    expect(badgeTone('단골 · 누적 125,000원')).toBe('regular')
    expect(badgeTone('처음')).toBe('first')
    expect(badgeSpokenOf({ text: '단골 · 누적 125,000원', spoken: null })).toBe('손님: 단골, 누적 125,000원')
    expect(badgeSpokenOf({ text: '처음', spoken: '손님: 처음' })).toBe('손님: 처음')
    expect(customersEventWhat('{"what":"settings"}')).toBe('settings')
    expect(customersEventWhat('{"what":"ledger"}')).toBe('ledger')
    expect(customersEventWhat('nope')).toBeNull()
  })
})

// ── 꼬리표 그리기 ────────────────────────────────────────────────────

describe('채팅 줄 꼬리표 (CR-7, AC-KP1-14)', () => {
  it('글자 + 화면 읽기 문장, 누르는 것이 아니다 — 글이 없으면 그리지 않는다. 닉네임 같은 글은 HTML로 읽지 않는다', () => {
    const { container, rerender } = render(<ChatBadgeMark badge={{ buyer: 'UC_B', text: '단골 · 누적 125,000원', spoken: '손님: 단골, 누적 125,000원' }} />)
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('단골 · 누적 125,000원')
    expect(container.querySelector('.sr-only')?.textContent).toBe('손님: 단골, 누적 125,000원')
    expect(container.querySelector('.tag-regular')).not.toBeNull()
    expect(container.querySelector('button')).toBeNull()
    rerender(<ChatBadgeMark badge={{ buyer: 'UC_A', text: '입금 늦음 주의', spoken: '손님: 입금 늦음 주의' }} />)
    expect(container.querySelector('.tag-caution')).not.toBeNull()
    rerender(<ChatBadgeMark badge={{ buyer: 'UC_D', text: null, spoken: null }} />)
    expect(container.textContent).toBe('')
    rerender(<ChatBadgeMark badge={{ buyer: 'UC_X', text: '<b>x</b>', spoken: null }} />)
    expect(container.querySelector('b')).toBeNull()
  })
})

// ── 꼬리표 받기 훅 ──────────────────────────────────────────────────

class FakeStream implements EventSourceLike {
  readyState = 1
  onopen = null
  onerror = null
  closed = false
  readonly #listeners = new Map<string, ((event: MessageEvent) => void)[]>()
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener])
  }
  close(): void {
    this.closed = true
  }
  emit(type: string, data: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(new MessageEvent(type, { data: JSON.stringify(data) }))
  }
}

function harness(options: { settings?: () => Promise<LedgerSettings>; badges?: (buyers: readonly string[]) => Promise<BadgesView> } = {}) {
  const asked: string[][] = []
  let settingsCalls = 0
  const stream = new FakeStream()
  const deps: ChatBadgesDeps = {
    fetchSettings: () => {
      settingsCalls += 1
      return options.settings?.() ?? Promise.resolve({ months: 12, consoleBadges: true })
    },
    fetchBadges: (_date, buyers) => {
      asked.push([...buyers])
      return options.badges?.(buyers) ?? Promise.resolve({ show: true, badges: buyers.map((buyer) => ({ buyer, text: buyer === 'UC_B' ? '단골 · 누적 125,000원' : buyer === 'UC_A' ? '입금 늦음 주의' : null, spoken: null })) })
    },
    openStream: () => stream,
    now: () => Date.now(),
  }
  const seen: ChatBadges[] = []
  function Probe({ buyers, rehearsal = false }: { readonly buyers: readonly string[]; readonly rehearsal?: boolean }) {
    seen.push(useChatBadges(DATE, rehearsal, buyers, deps))
    return null
  }
  return { asked, stream, seen, Probe, settingsCalls: () => settingsCalls }
}

describe('useChatBadges (CR-7, AC-KP1-14~16)', () => {
  it('새 채팅 구매자를 모아 4초 이상 간격 50명씩, 받은 구매자는 다시 묻지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const h = harness()
    const first = ['UC_A', 'UC_B', ...Array.from({ length: 58 }, (_, i) => `UC_${String(i)}`)]
    const { rerender } = render(<h.Probe buyers={first} />)
    await settle()
    expect(h.asked.length).toBe(1)
    expect(h.asked[0]?.length).toBe(50)
    expect(h.seen.at(-1)?.badges.get('UC_B')?.text).toBe('단골 · 누적 125,000원')
    expect(h.seen.at(-1)?.badges.get('UC_A')?.text).toBe('입금 늦음 주의')
    // 새 구매자가 와도 4초 전이면 기다린다
    rerender(<h.Probe buyers={[...first, 'UC_new']} />)
    await settle()
    expect(h.asked.length).toBe(1)
    await act(async () => {
      vi.advanceTimersByTime(BADGE_GAP_MS)
    })
    await settle()
    expect(h.asked.length).toBe(2)
    expect(h.asked[1]).toEqual([...first.slice(50), 'UC_new'])
    // 이미 받은 구매자만 다시 나오면 묻지 않는다
    rerender(<h.Probe buyers={[...first, 'UC_new', 'UC_A']} />)
    await act(async () => {
      vi.advanceTimersByTime(BADGE_GAP_MS * 3)
    })
    await settle()
    expect(h.asked.length).toBe(2)
    expect(h.seen.at(-1)?.show).toBe(true)
  })

  it('조회가 실패하면 꼬리표 없이 조용히 — 그 구매자는 다시 묻지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const h = harness({ badges: () => Promise.reject(new Error('서버 오류')) })
    const { rerender } = render(<h.Probe buyers={['UC_A']} />)
    await settle()
    expect(h.asked.length).toBe(1)
    expect(h.seen.at(-1)?.badges.size).toBe(0)
    expect(h.seen.at(-1)?.show).toBe(true)
    rerender(<h.Probe buyers={['UC_A']} />)
    await act(async () => {
      vi.advanceTimersByTime(BADGE_GAP_MS * 2)
    })
    await settle()
    expect(h.asked.length).toBe(1)
  })

  it('설정을 받지 못하면(D-KP1-40) 알 때까지 꼬리표와 1등 옆 주의를 숨긴다', async () => {
    const h = harness({ settings: () => Promise.reject(new Error('서버 오류')), badges: () => Promise.reject(new Error('서버 오류')) })
    render(<h.Probe buyers={['UC_A']} />)
    await settle()
    expect(h.seen.at(-1)?.show).toBe(false)
    expect(h.seen.at(-1)?.badges.size).toBe(0)
  })

  it('리허설이면 아무것도 부르지 않는다', async () => {
    const h = harness()
    render(<h.Probe buyers={['UC_A', 'UC_B']} rehearsal />)
    await settle()
    expect(h.asked.length).toBe(0)
    expect(h.settingsCalls()).toBe(0)
    expect(h.seen.at(-1)?.badges.size).toBe(0)
  })

  it('설정이 꺼지면 꼬리표와 1등 옆 주의를 숨기고(show=false) 묻지 않는다 — 알림으로 다시 켜지면 다시 묻는다 (AC-KP1-15)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    let on = true
    const h = harness({
      settings: () => Promise.resolve({ months: 12, consoleBadges: on }),
      badges: (buyers) => Promise.resolve({ show: on, badges: buyers.map((buyer) => ({ buyer, text: on ? '처음' : null, spoken: on ? '손님: 처음' : null })) }),
    })
    render(<h.Probe buyers={['UC_C']} />)
    await settle()
    expect(h.seen.at(-1)?.badges.get('UC_C')?.text).toBe('처음')
    // 끔 → 알림 → 바로 숨김
    on = false
    await act(async () => {
      h.stream.emit('customers', { what: 'settings' })
    })
    await settle()
    expect(h.seen.at(-1)?.show).toBe(false)
    expect(h.seen.at(-1)?.badges.size).toBe(0)
    // 다시 켬 → 다시 묻는다
    on = true
    await act(async () => {
      h.stream.emit('customers', { what: 'settings' })
    })
    await act(async () => {
      vi.advanceTimersByTime(BADGE_GAP_MS)
    })
    await settle()
    expect(h.seen.at(-1)?.show).toBe(true)
    expect(h.asked.length).toBe(2)
    expect(h.seen.at(-1)?.badges.get('UC_C')?.text).toBe('처음')
    // 장부 알림은 설정을 다시 받지 않는다
    const before = h.settingsCalls()
    await act(async () => {
      h.stream.emit('customers', { what: 'ledger' })
    })
    await settle()
    expect(h.settingsCalls()).toBe(before)
  })
})

// ── 설정 "손님 관리" 장부 칸 ─────────────────────────────────────────

describe('설정 "손님 관리" 장부 칸 (CR-3·CR-7, AC-KP1-15)', () => {
  it('보관 기간 넷(1년 기본)·방송 화면에 손님 표시(켬)와 설명, 바꾸면 저장 막대 하나로 PUT 둘 다', async () => {
    let ledger: LedgerSettings = { months: 12, consoleBadges: true }
    const server = new FakeServer()
      .on('GET', /^\/api\/customer-settings$/, () => ({ body: { settings: { regularCount: 3, regularAmount: 100_000, waitDays: 3 } } }))
      .on('GET', /^\/api\/ledger-settings$/, () => ({ body: { settings: ledger } }))
      .on('PUT', /^\/api\/ledger-settings$/, (call) => {
        ledger = call.body as unknown as LedgerSettings
        return { body: { settings: ledger } }
      })
    vi.stubGlobal('fetch', server.fetch)
    render(
      <SaveBarArea>
        <section className="settings-section">
          <h2>손님 관리</h2>
          <CustomerSettingsSection />
        </section>
      </SaveBarArea>,
    )
    await flush(8)
    const group = screen.getByRole('group', { name: LEDGER_MONTHS_LABEL })
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((radio) => radio.labels?.[0]?.textContent)).toEqual(['6개월', '1년', '2년', '3년'])
    expect(radios.map((radio) => radio.checked)).toEqual([false, true, false, false])
    const toggle = screen.getByRole('checkbox', { name: CONSOLE_BADGES_LABEL }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(screen.getByText(CONSOLE_BADGES_HELP)).toBeDefined()

    fireEvent.click(toggle)
    fireEvent.click(within(group).getByRole('radio', { name: '6개월' }))
    expect(screen.getByText('저장하지 않은 칸: 손님 관리')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await flush(8)
    expect(server.callsTo('PUT', /^\/api\/ledger-settings$/).map((call) => call.body)).toEqual([{ months: 6, consoleBadges: false }])
    expect(server.callsTo('PUT', /^\/api\/customer-settings$/)).toHaveLength(0)
    expect(screen.getByText('바꾼 칸이 없어요.')).toBeDefined()
  })

  it('거절되면 칸 아래 서버 문장', async () => {
    const server = new FakeServer()
      .on('GET', /^\/api\/customer-settings$/, () => ({ body: { settings: { regularCount: 3, regularAmount: 100_000, waitDays: 3 } } }))
      .on('GET', /^\/api\/ledger-settings$/, () => ({ body: { settings: { months: 12, consoleBadges: true } } }))
      .on('PUT', /^\/api\/ledger-settings$/, () => apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'months', message: '보관 기간을 다시 골라 주세요.' }]))
    vi.stubGlobal('fetch', server.fetch)
    render(
      <SaveBarArea>
        <CustomerSettingsSection />
      </SaveBarArea>,
    )
    await flush(8)
    fireEvent.click(screen.getByRole('radio', { name: '3년' }))
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await flush(8)
    expect(screen.getByText('보관 기간을 다시 골라 주세요.')).toBeDefined()
  })
})

// ── 묶음 자세히 "지난 주문 배송지" ────────────────────────────────────

const ROW: ParcelRow = {
  buyer: 'UC_A',
  name: '홍길동',
  phoneLast4: null,
  itemCount: 1,
  qty: 1,
  total: 12_000,
  payment: 'PAID',
  packing: '포장 전',
  shipping: 'FIXED',
  address: 'UNCONFIRMED',
  ready: false,
  reason: 'ADDRESS_UNCONFIRMED',
  message: '배송지를 확인해 주세요.',
  box: '60',
  parcel: null,
}

const PREFILL = { ledgerId: 'l'.repeat(32), updatedAt: '2026-10-18T01:00:00.000Z', name: '홍길동', phone: '01012345678', address: '서울시 중구 세종대로 1', detail: '101호', zip: '04524' }

describe('묶음 자세히 "지난 주문 배송지예요 — 확인해 주세요" (CR-4, AC-KP1-04·08)', () => {
  it('다섯 칸 + [배송지 확인] → 장부 확인 요청, 동의 칸 없음. [고치기]는 장부 다섯 칸을 채운 양식(메모 빈칸)', async () => {
    let bundle: BundleView = { date: DATE, buyer: 'UC_A', address: null, locked: false, expired: false, row: ROW, ledger: PREFILL }
    const server = new FakeServer()
      .on('GET', /^\/api\/parcels\/days\/[^/]+\/bundle/, () => ({ body: { bundle } }))
      .on('POST', /^\/api\/parcels\/days\/[^/]+\/address\/ledger$/, () => {
        bundle = { ...bundle, ledger: null, address: { name: PREFILL.name, phone: PREFILL.phone, address: PREFILL.address, detail: PREFILL.detail, zip: PREFILL.zip, memo: '', source: 'SELLER', confirmed: true, updatedAt: '2026-10-19T01:00:00.000Z' }, row: { ...ROW, address: 'CONFIRMED' } }
        return { body: { bundle } }
      })
    vi.stubGlobal('fetch', server.fetch)
    render(<AddressSection date={DATE} buyer="UC_A" version="1" />)
    await flush(8)
    const block = screen.getByRole('region', { name: PREFILL_TITLE })
    expect(within(block).getByText(PREFILL_TITLE)).toBeDefined()
    for (const text of ['홍길동', '010-1234-5678', '서울시 중구 세종대로 1', '101호', '04524']) expect(within(block).getByText(text)).toBeDefined()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByText('배송지가 없어요', { exact: false })).toBeNull()

    // 고치기: 장부 다섯 칸을 채운 양식, 동의 칸 없음
    fireEvent.click(within(block).getByRole('button', { name: '고치기' }))
    const dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText('받는 분') as HTMLInputElement).value).toBe('홍길동')
    expect((within(dialog).getByLabelText('배송 메모') as HTMLInputElement).value).toBe('')
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))

    fireEvent.click(within(block).getByRole('button', { name: '배송지 확인' }))
    await flush(8)
    const sent = server.callsTo('POST', /address\/ledger$/)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.body).toMatchObject({ buyer: 'UC_A', ledgerId: PREFILL.ledgerId, updatedAt: PREFILL.updatedAt })
    expect(typeof sent[0]?.body?.requestId).toBe('string')
    expect(screen.queryByRole('region', { name: PREFILL_TITLE })).toBeNull()
    expect(screen.getByText('확인함')).toBeDefined()
  })

  it('장부가 지워졌다는 알림이 오면 다시 받아 칸이 사라진다', async () => {
    let ledger: typeof PREFILL | null = PREFILL
    const server = new FakeServer().on('GET', /^\/api\/parcels\/days\/[^/]+\/bundle/, () => ({ body: { bundle: { date: DATE, buyer: 'UC_A', address: null, locked: false, expired: false, row: ROW, ledger } } }))
    vi.stubGlobal('fetch', server.fetch)
    render(<AddressSection date={DATE} buyer="UC_A" version="1" />)
    await flush(8)
    expect(screen.getByRole('region', { name: PREFILL_TITLE })).toBeDefined()
    ledger = null
    await act(async () => {
      for (const source of FakeEventSource.instances) source.emit('customers', { what: 'ledger' })
    })
    await flush(8)
    expect(screen.queryByRole('region', { name: PREFILL_TITLE })).toBeNull()
  })
})

// ── 손님 자세히 장부 칸 ─────────────────────────────────────────────

const LEDGER_VIEW: CustomerLedgerView = {
  ledgerId: 'c'.repeat(32),
  name: '홍*동',
  phoneLast4: '5678',
  keepUntil: '2027-10-19',
  consentDate: '2026-10-19',
  linked: [{ label: '유튜브 홍길동(끝 1234)', linkedAt: '2026-10-31T03:00:00.000Z' }],
}

describe('손님 자세히 장부 칸 (CR-3·CR-5, AC-KP1-07·11)', () => {
  it('"이 손님이 직접 이은 계정: …" 한 줄', () => {
    expect(linkedLine(LEDGER_VIEW.linked, '2026-10-31')).toBe('이 손님이 직접 이은 계정: 유튜브 홍길동(끝 1234) · 10월 31일(토)')
    expect(linkedLine([], '2026-10-31')).toBeNull()
  })

  it('가린 이름·끝 4자리·보관 끝나는 날, [장부에서 지우기] → 확인 → 지움', async () => {
    const server = new FakeServer().on('POST', /^\/api\/customers\/[^/]+\/ledger\/delete$/, () => ({ body: { ledger: null } }))
    vi.stubGlobal('fetch', server.fetch)
    const deleted = vi.fn()
    render(<CustomerLedgerSection customerId="cust1" ledger={LEDGER_VIEW} today="2026-10-31" onDeleted={deleted} />)
    expect(screen.getByText('홍*동')).toBeDefined()
    expect(screen.getByText('끝 5678')).toBeDefined()
    expect(screen.getByText('이 손님이 직접 이은 계정: 유튜브 홍길동(끝 1234) · 10월 31일(토)')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '장부에서 지우기' }))
    expect(server.calls).toHaveLength(0)
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '지우기' }))
    await flush(8)
    expect(server.callsTo('POST', /ledger\/delete$/).map((call) => call.body)).toEqual([{ ledgerId: LEDGER_VIEW.ledgerId }])
    expect(deleted).toHaveBeenCalledTimes(1)
    expect(screen.getByText('장부에서 지웠어요.')).toBeDefined()
  })

  it('이미 지운 장부(409)면 서버 문장', async () => {
    const server = new FakeServer().on('POST', /ledger\/delete$/, () => apiError(409, 'NO_LEDGER', '이미 지운 장부예요.'))
    vi.stubGlobal('fetch', server.fetch)
    render(<CustomerLedgerSection customerId="cust1" ledger={LEDGER_VIEW} today="2026-10-31" onDeleted={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: '장부에서 지우기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '지우기' }))
    await flush(8)
    expect(screen.getByText('이미 지운 장부예요.')).toBeDefined()
  })
})

// ── 손님 엑셀 창 ─────────────────────────────────────────────────────

describe('손님 엑셀 창 (CR-6, AC-KP1-13)', () => {
  it('처음엔 빈 "연락처·주소도 넣기" → contact=0, 고르면 경고 한 줄 → contact=1', async () => {
    const server = new FakeServer()
    const paths: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
      if (path.startsWith('/api/customers.xlsx')) {
        paths.push(path)
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': "attachment; filename*=UTF-8''%EC%86%90%EB%8B%98-2026-10-31.xlsx" } })
      }
      return server.fetch(input, init)
    })
    render(<CustomersXlsxDialog onClose={() => undefined} />)
    const box = screen.getByRole('checkbox', { name: XLSX_CONTACT_LABEL }) as HTMLInputElement
    expect(box.checked).toBe(false)
    expect(screen.queryByText(XLSX_CONTACT_WARNING)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '받기' }))
    await flush(8)
    fireEvent.click(box)
    expect(screen.getByText(XLSX_CONTACT_WARNING)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '받기' }))
    await flush(8)
    expect(paths).toEqual(['/api/customers.xlsx?contact=0', '/api/customers.xlsx?contact=1'])
  })
})
