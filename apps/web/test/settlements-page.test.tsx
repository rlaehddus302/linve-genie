// 정산 화면 (AC-S06-30~36, STL-01·02·03·07·09, R-12, D-092, G-ENG-172·173). 실제 코어로 도는 가짜 서버.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { SettlementsPage } from '../src/components/SettlementsPage.tsx'
import type { Route, ScopeRoute } from '../src/lib/router.ts'
import { chat, register } from './engine.ts'
import { EngineServer, PHONE_SENTENCE } from './engine-server.ts'
import { DATE, FakeEventSource, flush } from './support.ts'

let engine: EngineServer

/** 가나: 1부 15번 10,000 + 28번 5,000, 2부 31번 15,000 (= 30,000) · 다라: 7,000 · 마바: 3,000 (3,000 입금) */
const BASE = [
  register(15, '핑크프릴', 10000),
  register(28, '청보석', 5000),
  register(31, '금황', 15000, 'b2'),
  chat('m1', 'c1', '가나', '15'),
  chat('m2', 'c1', '가나', '28'),
  chat('m3', 'c1', '가나', '31', 'b2'),
  register(40, '루비', 7000),
  chat('m5', 'c2', '다라', '40'),
  register(41, '사파이어', 3000),
  chat('m6', 'c3', '마바', '41'),
  { type: 'settlement.payment', buyer: 'c3', date: DATE, amount: 3000 },
]

function Harness({ initial }: { readonly initial: ScopeRoute }) {
  const [route, setRoute] = useState<Route>(initial)
  return route.name === 'settlements' ? <SettlementsPage route={route} navigate={setRoute} /> : null
}

async function open(events: Record<string, unknown>[] = BASE, initial: ScopeRoute = { name: 'settlements', date: DATE, rehearsal: false }) {
  engine = new EngineServer(events)
  vi.stubGlobal('fetch', engine.server.fetch)
  render(<Harness initial={initial} />)
  await flush(10)
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

const cards = () => within(screen.getByRole('list', { name: '정산 묶음' })).getAllByRole('link')

async function openDetail(name: string) {
  fireEvent.click(cards().find((card) => card.textContent?.startsWith(name)) as HTMLElement)
  await flush()
  return screen.getByRole('region', { name: '정산 자세히' })
}

describe('정산 목록 (AC-S06-30)', () => {
  it('요약·상태 낱말·기본 정렬(미입금·부분 입금 먼저, 그다음 이름 순)·거르기·이름 찾기', async () => {
    await open()
    const summary = screen.getByRole('region', { name: '정산 요약' }).textContent ?? ''
    // 가나 34,000 미입금 · 다라 11,000 미입금 · 마바 7,000 중 3,000 부분 입금
    expect(summary).toContain('묶음 3개 · 미입금 2 · 부분 입금 1 · 입금 완료 0 · 과입금 0')
    expect(summary).toContain('최종 금액 합52,000원')
    expect(summary).toContain('받은 금액 합3,000원')
    expect(summary).toContain('남은 금액 합49,000원')
    expect(summary).toContain('환불 필요 합0원')
    expect(cards().map((card) => card.textContent?.slice(0, 2))).toEqual(['가나', '다라', '마바'])
    expect(cards()[0]?.textContent).toBe('가나미입금상품 3개 · 30,000원배송비 4,000원조정 0원최종 34,000원받은 금액 0원')
    expect(cards()[2]?.textContent).toContain('부분 입금')
    // 입금 완료는 뒤로
    engine.write({ type: 'settlement.payment', buyer: 'c1', date: DATE, amount: 34000 })
    await flush(10)
    expect(cards().map((card) => card.textContent?.slice(0, 2))).toEqual(['다라', '마바', '가나'])
    fireEvent.click(screen.getByRole('button', { name: '부분 입금' }))
    expect(cards().map((card) => card.textContent?.slice(0, 2))).toEqual(['마바'])
    fireEvent.click(screen.getByRole('button', { name: '전체' }))
    fireEvent.change(screen.getByLabelText('이름 찾기'), { target: { value: '다' } })
    expect(cards().map((card) => card.textContent?.slice(0, 2))).toEqual(['다라'])
  })

  it('다른 기기의 입금이 바로 반영된다 (알림 → 증분)', async () => {
    await open()
    engine.write({ type: 'settlement.payment', buyer: 'c2', date: DATE, amount: 11000 })
    await flush(10)
    expect(cards().find((card) => card.textContent?.startsWith('다라'))?.textContent).toContain('입금 완료')
  })

  it('리허설 범위면 "리허설 — 실제 정산이 아니에요"', async () => {
    await open(BASE, { name: 'settlements', date: DATE, rehearsal: true })
    expect(screen.getByText('리허설 — 실제 정산이 아니에요')).toBeDefined()
  })
})

describe('정산 자세히 (AC-S06-31)', () => {
  it('방송별 품목·합계, 계산 줄, 받은·남은·환불 필요, 기록(기록한 때 KST)', async () => {
    await open([...BASE, { type: 'settlement.adjust', buyer: 'c1', date: DATE, amount: -1000, reason: '단골 할인' }, { type: 'settlement.payment', buyer: 'c1', date: DATE, amount: 10000, memo: '10/19 국민' }])
    const detail = await openDetail('가나')
    const text = detail.textContent ?? ''
    expect(text).toContain('1부15번 핑크프릴 10,000원28번 청보석 5,000원1부 합계 15,000원')
    expect(text).toContain('2부31번 금황 15,000원2부 합계 15,000원')
    expect(text).toContain('상품 합계 30,000원 + 배송비 4,000원 + 조정 −1,000원 = 최종 33,000원')
    expect(text).toContain('받은 금액 10,000원 · 남은 금액 23,000원 · 환불 필요 0원')
    const records = within(detail).getByRole('region', { name: '정산 기록' })
    expect(within(records).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '할인 1,000원 · 단골 할인 · 기록한 때 10/19 10:00',
      '입금 10,000원 · 10/19 국민 · 기록한 때 10/19 10:00',
    ])
    for (const name of ['입금 적기', '배송비 바꾸기', '할인·추가', '환불 적기']) expect(within(detail).getByRole('button', { name })).toBeDefined()
  })

  it('품목이 없으면 "취소되어 품목이 없어요"와 최종 0원 (받은 금액이 있으면 과입금)', async () => {
    await open([...BASE, { type: 'settlement.payment', buyer: 'c2', date: DATE, amount: 11000 }, { type: 'host.cancel', b: 'b1', no: 40, buyer: 'c2', reason: '시청자 요청' }])
    const detail = await openDetail('다라')
    expect(detail.textContent).toContain('취소되어 품목이 없어요')
    expect(detail.textContent).toContain('= 최종 0원')
    expect(detail.textContent).toContain('과입금(환불 필요 11,000원)')
  })
})

describe('입금·환불 (AC-S06-32·35, G-ENG-172)', () => {
  it('기본값 = 남은 금액 → 그대로 적기는 바로 보냄 → "입금 완료"', async () => {
    await open()
    const detail = await openDetail('가나')
    fireEvent.click(within(detail).getByRole('button', { name: '입금 적기' }))
    const dialog = await screen.findByRole('dialog', { name: '입금 적기' })
    expect((within(dialog).getByLabelText('입금 금액') as HTMLInputElement).value).toBe('34000')
    expect(dialog.textContent).toContain('34,000원')
    expect(dialog.textContent).toContain('입금 날짜는 적은 때로 남아요. 실제 입금일이 다르면 메모에 적어 주세요.')
    fireEvent.click(within(dialog).getByRole('button', { name: '입금 적기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(engine.posts.at(-1)).toMatchObject({ type: 'settlement.payment', buyer: 'c1', date: DATE, amount: 34000 })
    await waitFor(() => expect(screen.getByRole('region', { name: '정산 자세히' }).textContent).toContain('입금 완료'))
  })

  it('남은 금액과 다르면 확인(처음 포커스 "고치기") → 140,000 오타 → 과입금 → 환불로 바로잡기 → 입금 완료', async () => {
    await open([register(15, '핑크프릴', 10000), chat('m1', 'c1', '가나', '15')])
    const detail = await openDetail('가나')
    fireEvent.click(within(detail).getByRole('button', { name: '입금 적기' }))
    let dialog = await screen.findByRole('dialog', { name: '입금 적기' })
    fireEvent.change(within(dialog).getByLabelText('입금 금액'), { target: { value: '140,000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '입금 적기' }))
    dialog = await screen.findByRole('dialog', { name: '입금 금액 확인' })
    expect(dialog.textContent).toContain('남은 금액(14,000원)과 달라요. 140,000원으로 적을까요?')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '고치기' })))
    expect(engine.posts).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: '140,000원 적기' }))
    await waitFor(() => expect(screen.getByRole('region', { name: '정산 자세히' }).textContent).toContain('과입금(환불 필요 126,000원)'))
    fireEvent.click(screen.getByRole('button', { name: '환불 적기' }))
    dialog = await screen.findByRole('dialog', { name: '환불 적기' })
    expect((within(dialog).getByLabelText('환불 금액') as HTMLInputElement).value).toBe('126000')
    expect(dialog.textContent).toContain('입금을 잘못 적었으면 같은 금액을 환불로 적어 바로잡아요.')
    fireEvent.change(within(dialog).getByLabelText('환불 금액'), { target: { value: '140001' } })
    expect(dialog.textContent).toContain('받은 금액(140,000원)보다 많이 환불할 수 없어요.')
    fireEvent.click(within(dialog).getByRole('button', { name: '환불 적기' }))
    await flush()
    expect(engine.posts.filter((post) => post.type === 'settlement.refund')).toHaveLength(0)
    fireEvent.change(within(dialog).getByLabelText('환불 금액'), { target: { value: '126000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '환불 적기' }))
    expect(await within(dialog).findByText('사유를 적어 주세요.')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: '2 입금액 잘못 적음' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '환불 적기' }))
    await waitFor(() => expect(screen.getByRole('region', { name: '정산 자세히' }).textContent).toContain('입금 완료'))
    expect(engine.posts.at(-1)).toMatchObject({ type: 'settlement.refund', buyer: 'c1', amount: 126000, reason: '입금액 잘못 적음' })
  })

  it('금액 칸은 원 단위: 14 → 14원, 1만 4천 → 14,000원, 읽지 못하면 문장', async () => {
    await open()
    fireEvent.click(within(await openDetail('가나')).getByRole('button', { name: '입금 적기' }))
    const dialog = await screen.findByRole('dialog', { name: '입금 적기' })
    const input = within(dialog).getByLabelText('입금 금액')
    fireEvent.change(input, { target: { value: '14' } })
    expect(dialog.textContent).toContain('14원')
    fireEvent.change(input, { target: { value: '1만 4천' } })
    expect(dialog.textContent).toContain('14,000원')
    fireEvent.change(input, { target: { value: '만원쯤' } })
    expect(dialog.textContent).toContain('금액을 14000처럼 적어 주세요.')
    fireEvent.change(within(dialog).getByLabelText('메모(선택)'), { target: { value: '010-1234-5678' } })
    expect(dialog.textContent).toContain(PHONE_SENTENCE)
  })
})

describe('배송비·할인/추가 (AC-S06-33·34, G-ENG-173)', () => {
  it('배송비: 바뀔 값을 미리 보이고(R-12 순서) 바로 보낸다 — 예외가 있으면 "기본 배송비로"', async () => {
    await open()
    const detail = await openDetail('가나')
    fireEvent.click(within(detail).getByRole('button', { name: '배송비 바꾸기' }))
    let dialog = await screen.findByRole('dialog', { name: '배송비 바꾸기' })
    expect(within(dialog).queryByLabelText('기본 배송비로')).toBeNull()
    fireEvent.click(within(dialog).getByLabelText('직접 수령'))
    expect(dialog.textContent).toContain('배송비 4,000원 → 0원, 최종 34,000원 → 30,000원')
    fireEvent.click(within(dialog).getByLabelText('배송비 직접 정함'))
    fireEvent.change(within(dialog).getByLabelText('배송비 금액'), { target: { value: '1000001' } })
    expect(dialog.textContent).toContain('배송비는 0원~1,000,000원으로 적어 주세요.')
    fireEvent.change(within(dialog).getByLabelText('배송비 금액'), { target: { value: '7000' } })
    expect(dialog.textContent).toContain('배송비 4,000원 → 7,000원, 최종 34,000원 → 37,000원')
    fireEvent.click(within(dialog).getByRole('button', { name: '배송비 바꾸기' }))
    await waitFor(() => expect(screen.getByRole('region', { name: '정산 자세히' }).textContent).toContain('배송비 7,000원(배송비 직접 정함)'))
    expect(engine.posts.at(-1)).toMatchObject({ type: 'settlement.shippingOverride', buyer: 'c1', mode: 'FIXED', amount: 7000 })
    fireEvent.click(screen.getByRole('button', { name: '배송비 바꾸기' }))
    dialog = await screen.findByRole('dialog', { name: '배송비 바꾸기' })
    fireEvent.click(within(dialog).getByLabelText('기본 배송비로'))
    expect(dialog.textContent).toContain('배송비 7,000원 → 4,000원')
  })

  it('할인: 금액·사유(숫자 키) → 음수로 보낸다, 0원 아래면 그 문장, 사유의 휴대폰 번호는 막는다', async () => {
    await open()
    const detail = await openDetail('가나')
    fireEvent.click(within(detail).getByRole('button', { name: '할인·추가' }))
    const dialog = await screen.findByRole('dialog', { name: '할인·추가' })
    fireEvent.change(within(dialog).getByLabelText('할인 금액'), { target: { value: '3000' } })
    expect(dialog.textContent).toContain('최종 34,000원 → 31,000원')
    fireEvent.change(within(dialog).getByLabelText('할인 금액'), { target: { value: '50000' } })
    expect(dialog.textContent).toContain('할인이 금액보다 커서 최종 금액은 0원이에요.')
    fireEvent.change(within(dialog).getByLabelText('할인 금액'), { target: { value: '3000' } })
    fireEvent.change(within(dialog).getByLabelText('사유'), { target: { value: '010 1234 5678 단골' } })
    expect(dialog.textContent).toContain(PHONE_SENTENCE)
    fireEvent.change(within(dialog).getByLabelText('사유'), { target: { value: '' } })
    fireEvent.keyDown(within(dialog).getByRole('button', { name: '닫기' }), { key: '1' })
    expect((within(dialog).getByLabelText('사유') as HTMLInputElement).value).toBe('단골 할인')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '할인 적기' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '할인 적기' }))
    await waitFor(() => expect(screen.getByRole('region', { name: '정산 자세히' }).textContent).toContain('조정 −3,000원 = 최종 31,000원'))
    expect(engine.posts.at(-1)).toMatchObject({ type: 'settlement.adjust', buyer: 'c1', amount: -3000, reason: '단골 할인' })
  })
})
