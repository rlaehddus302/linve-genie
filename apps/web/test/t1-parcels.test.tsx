// 택배 자동 접수 화면 (T1 AC-T1-60~66·80, PARCEL_RULES PC-3·PC-4·PC-8, D-T1-08·D-T1-09·D-T1-13).
// 메뉴 "택배"·주소 /parcels, 세 무리·확인 창·한 번에 접수(요청 하나)·실패한 것만 다시·운송장·접수 취소, 묶음 자세히의 배송지 칸, 설정 "택배", 개인정보처리방침 문단.
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { AddressView, BundleView, ParcelBrief, ParcelDay, ParcelRow, ParcelSettings } from '../src/api/parcel-types.ts'
import { menuLayout, menuAll, menuName } from '../src/lib/menu.ts'
import { addressShape, parcelGroups, parcelLine, retryRows, rowReason } from '../src/lib/parcel-words.ts'
import { menuOf, parseRoute, routePath } from '../src/lib/router.ts'
import { AddressSection } from '../src/components/ParcelParts.tsx'
import { PrivacyPage } from '../src/components/PolicyPages.tsx'
import { FakeEventSource, FakeServer, apiError, flush } from './support.ts'

const D = '2026-10-22'

function brief(patch: Partial<ParcelBrief> = {}): ParcelBrief {
  return {
    state: 'BOOKED',
    carrier: 'FAKE',
    carrierName: '가짜 택배',
    invoice: '900000000001',
    invoiceText: '9000-0000-0001',
    status: '접수됨',
    checkedAt: '2026-10-22T05:30:00.000Z',
    trackUrl: 'http://127.0.0.1:9/track/900000000001',
    reason: null,
    message: null,
    box: '소',
    qty: 2,
    bookedAt: '2026-10-22T05:00:00.000Z',
    cancellable: true,
    ...patch,
  }
}

function row(buyer: string, name: string, patch: Partial<ParcelRow> = {}): ParcelRow {
  return {
    buyer,
    name,
    phoneLast4: null,
    itemCount: 2,
    qty: 2,
    total: 33000,
    payment: 'PAID',
    packing: '포장 완료',
    shipping: 'NONE',
    address: 'CONFIRMED',
    ready: true,
    reason: null,
    message: null,
    box: '소',
    parcel: null,
    ...patch,
  }
}

/** AC-T1-22의 여섯 묶음 */
function sixRows(): ParcelDay {
  return {
    date: D,
    seq: 10,
    blocked: null,
    carrier: { code: 'FAKE', name: '가짜 택배' },
    box: '소',
    ready: [row('UC_A', '김하나')],
    excluded: [
      row('UC_B', '이둘', { ready: false, payment: 'PARTIAL', reason: 'NOT_PAID', message: '입금 완료 전이에요' }),
      row('UC_C', '박셋', { ready: false, packing: '포장 대기', reason: 'NOT_PACKED', message: '포장 전이에요' }),
      row('UC_D', '최넷', { ready: false, address: 'UNCONFIRMED', reason: 'ADDRESS_UNCONFIRMED', message: '배송지를 확인해 주세요' }),
      row('UC_E', '정다섯', { ready: false, shipping: 'PICKUP', reason: 'PICKUP', message: '직접 수령이에요' }),
    ],
    booked: [row('UC_F', '한여섯', { ready: false, reason: 'BOOKED', message: '이미 접수했어요', packing: '배송 완료', parcel: brief() })],
  }
}

let server: FakeServer
let day: ParcelDay

function setup() {
  server
    .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '다육이네' }, loginId: 'shop1', role: 'SELLER', assistant: null } }))
    .on('GET', /^\/api\/parcels\/days$/, () => ({ body: { dates: [{ date: D, ready: 1, booked: 1 }], selected: D } }))
    .on('GET', /^\/api\/parcels\/days\/(\d{4}-\d{2}-\d{2})$/, () => ({ body: day }))
}

beforeEach(() => {
  server = new FakeServer()
  day = sixRows()
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  window.sessionStorage.clear()
  window.localStorage.clear()
  setup()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

async function open(path = `/parcels?date=${D}`) {
  window.history.replaceState(null, '', path)
  render(<App />)
  await screen.findByRole('heading', { name: '택배 접수', level: 1 })
  await screen.findByRole('region', { name: '보낼 수 있어요' })
  await flush()
}

const region = (name: RegExp) => screen.getByRole('region', { name })
const exact = (name: string) => new RegExp(`^${name}$`)

describe('메뉴·주소 (AC-T1-60)', () => {
  it('"택배"는 "설정" 바로 앞(PC·휴대폰 목록 같은 순서), 막대 네 칸 그대로, 보조자에게는 없다', () => {
    const layout = menuLayout({ route: { name: 'home' }, assistant: false, labels: true, review: null, billing: true })
    expect(layout.bar.map(menuName)).toEqual(['방송', '문자찜 입력', '구매자', '정산'])
    expect(layout.more.map(menuName)).toEqual(['입금 확인', '포장', '라벨', '요금', '택배', '설정'])
    expect(menuAll(layout).at(-2)?.key).toBe('parcels')
    const assistant = menuLayout({ route: { name: 'home' }, assistant: true, labels: true, review: null })
    expect(menuAll(assistant).map(menuName)).toEqual(['문자찜 입력'])
  })

  it('실제 날짜를 보고 있었으면 그 날짜로, 리허설이면 날짜 없이', () => {
    const real = menuLayout({ route: { name: 'settlements', date: D, rehearsal: false }, assistant: false, labels: true, review: null })
    expect(routePath(real.more.find((item) => item.key === 'parcels')!.to)).toBe(`/parcels?date=${D}`)
    const rehearsal = menuLayout({ route: { name: 'settlements', date: D, rehearsal: true }, assistant: false, labels: true, review: null })
    expect(routePath(rehearsal.more.find((item) => item.key === 'parcels')!.to)).toBe('/parcels')
  })

  it('/parcels·/parcels?date=·/settings/parcel 읽기·쓰기가 같은 화면이다', () => {
    expect(parseRoute('/parcels')).toEqual({ name: 'parcels' })
    expect(parseRoute('/parcels', `?date=${D}`)).toEqual({ name: 'parcels', date: D })
    expect(parseRoute('/parcels', '?date=2026-13')).toEqual({ name: 'parcels' })
    expect(routePath({ name: 'parcels', date: D })).toBe(`/parcels?date=${D}`)
    expect(menuOf({ name: 'parcels' })).toBe('parcels')
    expect(parseRoute('/settings/parcel')).toEqual({ name: 'settings', section: 'parcel' })
    expect(routePath({ name: 'settings', section: 'parcel' })).toBe('/settings/parcel')
  })

  it('날짜 없이 열면 서버가 고른 날짜를 기록 없이 주소에 적는다', async () => {
    await open('/parcels')
    await waitFor(() => expect(window.location.search).toBe(`?date=${D}`))
    expect(screen.getByRole('combobox', { name: '날짜' })).toHaveProperty('value', D)
  })
})

describe('낱말 (PC-8, D-T1-12)', () => {
  it('"택배: 배송 중 · 9000-0000-0001", 기다림·모름·실패·취소는 문장', () => {
    expect(parcelLine(brief({ status: '배송 중' }))).toBe('택배: 배송 중 · 9000-0000-0001')
    expect(parcelLine(brief({ state: 'PENDING', invoice: null, invoiceText: null, status: null, message: null }))).toBe('택배: 접수 결과를 기다리고 있어요')
    expect(parcelLine(brief({ state: 'UNKNOWN', invoice: null, invoiceText: null, status: null, message: '접수됐는지 아직 몰라요. 잠시 뒤 다시 확인해 주세요.' }))).toBe('택배: 접수됐는지 아직 몰라요. 잠시 뒤 다시 확인해 주세요.')
    expect(parcelLine(brief({ state: 'CANCELLED', status: '접수 취소됨' }))).toBe('택배: 접수 취소됨')
  })

  it('실패한 시도는 "아직 못 보내요"로, 실패·모름은 다시 보낼 줄 — 기다리는 중은 아니다', () => {
    const failed = row('UC_X', '실패', { parcel: brief({ state: 'FAILED', invoice: null, invoiceText: null, status: null, reason: 'ADDRESS', message: '택배사가 주소를 찾지 못했어요. 배송지를 확인해 주세요.' }) })
    const unknown = row('UC_Y', '모름', { ready: false, reason: 'BOOKING', message: '접수 결과를 기다리고 있어요', parcel: brief({ state: 'UNKNOWN', invoice: null, invoiceText: null, status: null, message: '접수됐는지 아직 몰라요. 잠시 뒤 다시 확인해 주세요.' }) })
    const pending = row('UC_Z', '기다림', { ready: false, reason: 'BOOKING', message: '접수 결과를 기다리고 있어요', parcel: brief({ state: 'PENDING', invoice: null, invoiceText: null, status: null }) })
    const groups = parcelGroups({ ready: [row('UC_A', '김하나'), failed], excluded: [unknown, pending], booked: [] })
    expect(groups.ready.map((item) => item.buyer)).toEqual(['UC_A'])
    expect(groups.excluded.map((item) => item.buyer)).toEqual(['UC_X', 'UC_Y', 'UC_Z'])
    expect(retryRows({ ready: [failed], excluded: [unknown, pending] }).map((item) => item.buyer)).toEqual(['UC_X', 'UC_Y'])
    expect(rowReason(failed)).toBe('택배사가 주소를 찾지 못했어요. 배송지를 확인해 주세요.')
    expect(rowReason(unknown)).toBe('접수됐는지 아직 몰라요. 잠시 뒤 다시 확인해 주세요.')
  })
})

describe('택배 화면 (AC-T1-61~64)', () => {
  it('세 무리 — 보낼 수 있어요(기본 고름·상자 크기), 아직 못 보내요(이유 문장), 접수했어요(송장·택배: 접수됨·운송장·취소), 영어 상태값 없음', async () => {
    await open()
    const ready = region(exact('보낼 수 있어요'))
    const pick = within(ready).getByRole('checkbox', { name: '김하나' })
    expect(pick).toHaveProperty('checked', true)
    expect(within(ready).getByRole('combobox', { name: '상자 크기' })).toHaveProperty('value', '소')
    const excluded = region(exact('아직 못 보내요'))
    for (const text of ['입금 완료 전이에요', '포장 전이에요', '배송지를 확인해 주세요', '직접 수령이에요']) expect(within(excluded).getByText(text)).toBeDefined()
    expect(within(excluded).getByRole('link', { name: '배송지 보기' }).getAttribute('href')).toBe(`/settlements?date=${D}&buyer=UC_D`)
    const booked = region(exact('접수했어요'))
    expect(within(booked).getByText('송장 9000-0000-0001')).toBeDefined()
    expect(within(booked).getByText('택배: 접수됨 · 9000-0000-0001')).toBeDefined()
    expect(within(booked).getByText(/마지막 확인/)).toBeDefined()
    expect(within(booked).getByRole('button', { name: '운송장 PDF' })).toBeDefined()
    expect(within(booked).getByRole('button', { name: '접수 취소' })).toBeDefined()
    expect(within(booked).getByRole('button', { name: '운송장 전부 PDF' })).toBeDefined()
    expect(screen.getByText('운송장은 일반 프린터나 100×150 라벨 프린터로 찍어요. 라벨 프린터(B1)로는 찍을 수 없어요.')).toBeDefined()
    const text = document.body.textContent ?? ''
    for (const word of ['PENDING', 'BOOKED', 'NOT_PAID', 'UNCONFIRMED', 'PICKUP', 'FAKE', 'PAID']) expect(text).not.toContain(word)
  })

  it('주 버튼 "N개 택배 접수하기"는 고른 수를 따르고 0개면 잠긴다', async () => {
    day = { ...sixRows(), ready: [row('UC_A', '김하나'), row('UC_G', '오일곱')] }
    await open()
    const main = screen.getByRole('button', { name: '2개 택배 접수하기' })
    expect(main).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('checkbox', { name: '김하나' }))
    expect(screen.getByRole('button', { name: '1개 택배 접수하기' })).toBeDefined()
    fireEvent.click(screen.getByRole('checkbox', { name: '오일곱' }))
    expect(screen.getByRole('button', { name: '0개 택배 접수하기' })).toHaveProperty('disabled', true)
  })

  it('보내는 사람·택배사 없음이면 목록 위 한 문장과 "설정으로", 주 버튼 잠김', async () => {
    day = { ...sixRows(), blocked: { code: 'NO_SENDER', message: '보내는 사람 정보를 먼저 적어 주세요.' } }
    await open()
    expect(screen.getByText('보내는 사람 정보를 먼저 적어 주세요.')).toBeDefined()
    expect(screen.getByRole('link', { name: '설정으로' }).getAttribute('href')).toBe('/settings/parcel')
    expect(screen.getByRole('button', { name: '1개 택배 접수하기' })).toHaveProperty('disabled', true)
  })

  it('확인 창(처음 포커스 "닫기") → "접수하기": 두 번 눌러도 요청 하나, 고른 묶음·상자 크기, 끝나면 다시 읽어 접수함으로', async () => {
    day = { ...sixRows(), ready: [row('UC_A', '김하나'), row('UC_G', '오일곱')] }
    let release: (() => void) | null = null
    server.on('POST', /\/book$/, async (call) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      const items = call.body?.items as { buyer: string }[]
      day = { ...day, ready: [], booked: items.map((item) => row(item.buyer, item.buyer === 'UC_A' ? '김하나' : '오일곱', { parcel: brief() })) }
      return { body: { date: D, results: items.map((item, index) => ({ buyer: item.buyer, ok: true, invoice: `90000000000${String(index + 1)}`, invoiceText: `9000-0000-000${String(index + 1)}` })) } }
    })
    await open()
    fireEvent.change(screen.getAllByRole('combobox', { name: '상자 크기' })[1] as HTMLElement, { target: { value: '중' } })
    fireEvent.click(screen.getByRole('button', { name: '2개 택배 접수하기' }))
    const dialog = screen.getByRole('dialog', { name: '택배 접수' })
    expect(within(dialog).getByText('2개를 택배로 접수할까요?')).toBeDefined()
    expect(document.activeElement?.textContent).toBe('닫기')
    fireEvent.click(within(dialog).getByRole('button', { name: '접수하기' }))
    await flush()
    expect(screen.getByRole('button', { name: '2개 택배 접수하기' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '2개 택배 접수하기' }))
    expect(screen.getByText('택배사에 접수하는 중이에요…')).toBeDefined()
    await act(async () => {
      release?.()
      await flush()
    })
    const calls = server.callsTo('POST', /\/api\/parcels\/days\/2026-10-22\/book$/)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body?.items).toEqual([
      { buyer: 'UC_A', box: '소' },
      { buyer: 'UC_G', box: '중' },
    ])
    expect(typeof calls[0]?.body?.requestId).toBe('string')
    expect(await screen.findByText('2개 접수했어요.')).toBeDefined()
    await waitFor(() => expect(within(region(exact('접수했어요'))).getAllByText('송장 9000-0000-0001')).toHaveLength(2))
  })

  it('일부 실패: 줄마다 문장, "실패한 것만 다시"는 실패·모름만 보낸다(기다리는 중은 빼고)', async () => {
    day = {
      ...sixRows(),
      ready: [row('UC_A', '김하나', { parcel: brief({ state: 'FAILED', invoice: null, invoiceText: null, status: null, reason: 'ADDRESS', message: '택배사가 주소를 찾지 못했어요. 배송지를 확인해 주세요.' }) })],
      excluded: [
        row('UC_C', '박셋', { ready: false, reason: 'BOOKING', message: '접수 결과를 기다리고 있어요', parcel: brief({ state: 'UNKNOWN', invoice: null, invoiceText: null, status: null, message: '접수됐는지 아직 몰라요. 잠시 뒤 다시 확인해 주세요.' }) }),
        row('UC_P', '대기', { ready: false, reason: 'BOOKING', message: '접수 결과를 기다리고 있어요', parcel: brief({ state: 'PENDING', invoice: null, invoiceText: null, status: null, message: null }) }),
      ],
    }
    server.on('POST', /\/book$/, () => ({ body: { date: D, results: [{ buyer: 'UC_A', ok: false, reason: 'ADDRESS', message: '택배사가 주소를 찾지 못했어요. 배송지를 확인해 주세요.' }, { buyer: 'UC_C', ok: true, invoice: '900000000003', invoiceText: '9000-0000-0003' }] } }))
    await open()
    const excluded = region(exact('아직 못 보내요'))
    expect(within(excluded).getByText('택배사가 주소를 찾지 못했어요. 배송지를 확인해 주세요.')).toBeDefined()
    expect(within(excluded).getByText('접수됐는지 아직 몰라요. 잠시 뒤 다시 확인해 주세요.')).toBeDefined()
    expect(screen.getByRole('button', { name: '0개 택배 접수하기' })).toHaveProperty('disabled', true)
    fireEvent.click(within(excluded).getByRole('button', { name: '실패한 것만 다시' }))
    await flush()
    const calls = server.callsTo('POST', /\/book$/)
    expect(calls).toHaveLength(1)
    expect((calls[0]?.body?.items as { buyer: string }[]).map((item) => item.buyer)).toEqual(['UC_A', 'UC_C'])
    expect(await screen.findByText('1개 접수했어요. 1개는 접수하지 못했어요 — 줄마다 이유를 확인해 주세요.')).toBeDefined()
  })

  it('접수 취소: 확인 창(처음 포커스 "닫기") → "취소하기", 집하 뒤면 그 문장이고 줄은 그대로', async () => {
    server.on('POST', /\/cancel$/, () => apiError(409, 'PICKED_UP', '택배사가 이미 가져갔어요. 택배사에 직접 문의해 주세요.'))
    await open()
    const booked = region(exact('접수했어요'))
    fireEvent.click(within(booked).getByRole('button', { name: '접수 취소' }))
    const dialog = screen.getByRole('dialog', { name: '접수 취소' })
    expect(document.activeElement?.textContent).toBe('닫기')
    fireEvent.click(within(dialog).getByRole('button', { name: '취소하기' }))
    expect(await screen.findByText('택배사가 이미 가져갔어요. 택배사에 직접 문의해 주세요.')).toBeDefined()
    expect(server.callsTo('POST', /\/cancel$/)[0]?.body).toMatchObject({ buyer: 'UC_F' })
    expect(within(region(exact('접수했어요'))).getByText('한여섯')).toBeDefined()
  })

  it('다른 기기의 접수(실시간 parcel 알림)면 새로고침 없이 다시 읽는다', async () => {
    await open()
    const before = server.callsTo('GET', /\/api\/parcels\/days\/2026-10-22$/).length
    day = { ...sixRows(), ready: [], booked: [...sixRows().booked, row('UC_A', '김하나', { parcel: brief({ invoice: '900000000002', invoiceText: '9000-0000-0002' }) })] }
    const stream = FakeEventSource.last
    act(() => stream.emit('parcel', { date: D, buyer: 'UC_A' }))
    await flush()
    expect(server.callsTo('GET', /\/api\/parcels\/days\/2026-10-22$/).length).toBeGreaterThan(before)
    expect(await within(region(exact('접수했어요'))).findByText('송장 9000-0000-0002')).toBeDefined()
  })
})

// ── 묶음 자세히의 배송지 칸 (AC-T1-65) ──────────────────────────────────

function addressView(patch: Partial<AddressView> = {}): AddressView {
  return { name: '홍길동', phone: '01012345678', address: '서울특별시 중구 세종대로 110', detail: '101동 202호', zip: '04524', memo: '문 앞에', source: 'BUYER', confirmed: false, updatedAt: '2026-10-22T03:00:00.000Z', ...patch }
}

function bundleOf(patch: Partial<BundleView> = {}): BundleView {
  return { date: D, buyer: 'UC_A', address: null, locked: false, expired: false, row: row('UC_A', '김하나', { address: 'NONE', ready: false, reason: 'NO_ADDRESS', message: '배송지가 없어요' }), ...patch }
}

describe('배송지 칸 (AC-T1-65)', () => {
  let bundle: BundleView
  beforeEach(() => {
    bundle = bundleOf()
    server.on('GET', /\/bundle\?buyer=UC_A$/, () => ({ body: { bundle } }))
  })

  it('없으면 "배송지가 없어요" + "배송지 적기"(여섯 칸, 틀리면 칸마다 문장) + 안내 — 저장하면 판매자가 적었어요', async () => {
    server.on('PUT', /\/address$/, (call) => {
      const address = call.body?.address as Record<string, string>
      if (address.phone !== '01012345678') return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'address.phone', message: '연락처는 010으로 시작하는 숫자로 적어 주세요.' }])
      bundle = bundleOf({ address: addressView({ ...address, source: 'SELLER', confirmed: true }) })
      return { body: { bundle } }
    })
    render(<AddressSection date={D} buyer="UC_A" version="1" />)
    expect(await screen.findByText('배송지가 없어요')).toBeDefined()
    expect(screen.getByText('구매자 확인서 링크에서 구매자가 직접 적을 수도 있어요.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '배송지 적기' }))
    const dialog = screen.getByRole('dialog', { name: '배송지 적기' })
    for (const label of ['받는 분', '연락처', '주소', '상세 주소', '우편번호(몰라도 돼요)', '배송 메모']) expect(within(dialog).getByLabelText(label)).toBeDefined()
    fireEvent.change(within(dialog).getByLabelText('받는 분'), { target: { value: '홍길동' } })
    fireEvent.change(within(dialog).getByLabelText('연락처'), { target: { value: '+82 10' } })
    fireEvent.change(within(dialog).getByLabelText('주소'), { target: { value: '서울특별시 중구 세종대로 110' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByText('연락처는 010으로 시작하는 숫자로 적어 주세요.')).toBeDefined()
    expect(within(dialog).getByLabelText('연락처').getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(within(dialog).getByLabelText('연락처'), { target: { value: '01012345678' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await screen.findByText('판매자가 적었어요')).toBeDefined()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('확인함')).toBeDefined()
    const puts = server.callsTo('PUT', /\/address$/)
    expect(puts[1]?.body).toMatchObject({ buyer: 'UC_A', address: { name: '홍길동', phone: '01012345678', address: '서울특별시 중구 세종대로 110', detail: '', zip: '', memo: '' } })
    // 같은 내용이 아니면 새 요청 번호 (틀린 것을 고쳐 다시 보냄)
    expect(puts[0]?.body?.requestId).not.toBe(puts[1]?.body?.requestId)
  })

  it('구매자가 적은 것: 여섯 칸 전부·출처·"배송지 확인"(고친 시각을 함께), 그 사이 바뀌었으면 문장과 다시 읽기', async () => {
    bundle = bundleOf({ address: addressView() })
    server.on('POST', /\/address\/confirm$/, () => apiError(409, 'ADDRESS_CHANGED', '구매자가 배송지를 바꿨어요. 다시 확인해 주세요.'))
    render(<AddressSection date={D} buyer="UC_A" version="1" />)
    expect(await screen.findByText('구매자가 적었어요')).toBeDefined()
    for (const text of ['홍길동', '010-1234-5678', '서울특별시 중구 세종대로 110', '101동 202호', '04524', '문 앞에', '확인 전']) expect(screen.getByText(text)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '배송지 확인' }))
    expect(await screen.findByText('구매자가 배송지를 바꿨어요. 다시 확인해 주세요.')).toBeDefined()
    expect(server.callsTo('POST', /\/address\/confirm$/)[0]?.body).toMatchObject({ buyer: 'UC_A', updatedAt: '2026-10-22T03:00:00.000Z' })
    await waitFor(() => expect(server.callsTo('GET', /\/bundle\?/).length).toBe(2))
  })

  it('접수한 묶음은 고치기·지우기 없이 "택배 접수를 먼저 취소해 주세요." + 택배 줄', async () => {
    bundle = bundleOf({ address: addressView({ confirmed: true }), locked: true, row: row('UC_A', '김하나', { parcel: brief({ status: '배송 중' }) }) })
    render(<AddressSection date={D} buyer="UC_A" version="1" />)
    expect(await screen.findByText('택배 접수를 먼저 취소해 주세요.')).toBeDefined()
    expect(screen.getByText('택배: 배송 중 · 9000-0000-0001')).toBeDefined()
    expect(screen.queryByRole('button', { name: '고치기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '지우기' })).toBeNull()
  })

  it('지우기는 확인 창 뒤, 직접 수령·합배송은 한 문장', async () => {
    bundle = bundleOf({ address: addressView({ confirmed: true }) })
    server.on('POST', /\/address\/delete$/, () => {
      bundle = bundleOf()
      return { body: { bundle } }
    })
    render(<AddressSection date={D} buyer="UC_A" version="1" />)
    fireEvent.click(await screen.findByRole('button', { name: '지우기' }))
    const dialog = screen.getByRole('dialog', { name: '배송지 지우기' })
    expect(document.activeElement?.textContent).toBe('닫기')
    fireEvent.click(within(dialog).getByRole('button', { name: '지우기' }))
    expect(await screen.findByText('배송지가 없어요')).toBeDefined()
    expect(addressShape(bundleOf({ row: row('UC_A', '김하나', { shipping: 'PICKUP' }) }))).toBe('pickup')
    expect(addressShape(bundleOf({ address: addressView(), row: row('UC_A', '김하나', { shipping: 'COMBINED' }) }))).toBe('combined')
  })
})

// ── 설정 "택배" (AC-T1-66) ──────────────────────────────────────────────

describe('설정 "택배" (AC-T1-66)', () => {
  let parcel: ParcelSettings
  beforeEach(() => {
    parcel = {
      carrier: null,
      carriers: [
        { code: 'FAKE', name: '가짜 택배(시험용)', available: true, note: null },
        { code: 'EPOST', name: '우체국 택배', available: false, note: '준비 중' },
      ],
      customerNoLast4: null,
      sender: null,
      shopName: '다육이네',
      box: '소',
      boxes: ['극소', '소', '중', '대'],
    }
    server
      .on('GET', /^\/api\/settings$/, () => ({ body: { settings: { ...DEFAULT_SETTINGS } } }))
      .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
      .on('GET', /^\/api\/parcels\/settings$/, () => ({ body: { settings: parcel } }))
      .on('PUT', /^\/api\/parcels\/settings$/, (call) => {
        const sender = call.body?.sender as Record<string, string> | undefined
        if (sender !== undefined && sender.phone !== '0311234567') return { status: 400, body: { error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'sender.phone', message: '연락처는 010으로 시작하는 숫자로 적어 주세요.' }] }, codes: ['PHONE_INVALID'] } }
        parcel = { ...parcel, carrier: (call.body?.carrier as 'FAKE' | null) ?? null, box: (call.body?.box as '중') ?? parcel.box, ...(sender === undefined ? {} : { sender: sender as unknown as ParcelSettings['sender'] }), ...(typeof call.body?.customerNo === 'string' ? { customerNoLast4: '5678' } : {}) }
        return { body: { settings: parcel } }
      })
  })

  it('택배사(우체국은 준비 중 — 고를 수 없음)·고객 번호(끝 4자리만)·보내는 사람(이름 기본 = 가게 이름)·상자 크기, 틀리면 칸마다, 저장하면 "저장했어요"', async () => {
    window.history.replaceState(null, '', '/settings/parcel')
    render(<App />)
    const section = await screen.findByRole('region', { name: '택배' })
    const carrier = await within(section).findByRole('combobox', { name: '택배사' })
    const epost = within(carrier).getByRole('option', { name: '우체국 택배 — 준비 중' })
    expect(epost).toHaveProperty('disabled', true)
    expect(within(section).getByLabelText('보내는 사람 이름')).toHaveProperty('value', '다육이네')
    expect([...within(section).getByRole('combobox', { name: '기본 상자 크기' }).querySelectorAll('option')].map((option) => option.textContent)).toEqual(['극소', '소', '중', '대'])
    fireEvent.change(carrier, { target: { value: 'FAKE' } })
    fireEvent.change(within(section).getByLabelText('택배사 고객 번호'), { target: { value: 'C-12345678' } })
    fireEvent.change(within(section).getByLabelText('보내는 사람 연락처'), { target: { value: '031' } })
    fireEvent.change(within(section).getByLabelText('보내는 주소'), { target: { value: '경기도 고양시 덕양구 1' } })
    fireEvent.click(within(section).getByRole('button', { name: '저장' }))
    expect(await within(section).findByText('연락처는 010으로 시작하는 숫자로 적어 주세요.')).toBeDefined()
    fireEvent.change(within(section).getByLabelText('보내는 사람 연락처'), { target: { value: '0311234567' } })
    fireEvent.change(within(section).getByRole('combobox', { name: '기본 상자 크기' }), { target: { value: '중' } })
    fireEvent.click(within(section).getByRole('button', { name: '저장' }))
    expect(await within(section).findByText(/저장했어요/)).toBeDefined()
    expect(within(section).getByText(/저장한 번호 끝 5678/)).toBeDefined()
    expect(within(section).getByLabelText('택배사 고객 번호')).toHaveProperty('value', '')
    const last = server.callsTo('PUT', /\/api\/parcels\/settings$/).at(-1)
    expect(last?.body).toMatchObject({ carrier: 'FAKE', box: '중', customerNo: 'C-12345678', sender: { name: '다육이네', phone: '0311234567', address: '경기도 고양시 덕양구 1', detail: '', zip: '' } })
  })
})

describe('개인정보처리방침 (AC-T1-80)', () => {
  it('택배 배송지 문단: 수집 항목·목적(배송)·제공(택배사)·보관(주문 날짜 + 30일)·초안 표시', () => {
    render(<PrivacyPage />)
    const section = screen.getByRole('region', { name: '13. 택배 배송지' })
    const text = section.textContent ?? ''
    for (const phrase of ['받는 분', '연락처', '주소', '배송 메모', '택배로 보내는 데', '택배사에 보내요', '주문 날짜로부터 30일', '초안']) expect(text).toContain(phrase)
    expect(screen.getByRole('region', { name: '5. 제3자 제공' }).textContent).toContain('택배사')
  })
})
