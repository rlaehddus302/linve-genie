// 손님 정보 문자 화면 (ORD-14, D-REAL-11): 바로 넣은 문자는 "넣었어요"와 [닫기], 모르는 문자는 [무시]·[손님 고르기](좌우),
// 손님을 골라 칸을 고쳐 [넣기]하면 apply 요청. 주문 탭 [고객 정보 받기]는 확인할 것이 있으면 작은 점(D-UX4-125 — 옛 정산 탭 위 줄).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BuyerInfoScreen, type BuyerInfoCard } from '../src/screens/BuyerInfoScreen.tsx'
import { SettleScreen } from '../src/screens/SettleScreen.tsx'
import { clearCached } from '../src/lib/cached-get.ts'
import { ordersView, withOrders } from './order-support.ts'
import { makeWorld } from './screen-support.tsx'

const card = (patch: Partial<BuyerInfoCard>): BuyerInfoCard => ({
  id: 'bi_00000000-0000-0000-0000-000000000001',
  status: 'OPEN',
  auto: false,
  receivedAt: '2026-10-31T12:00:00.000Z',
  last4: '3333',
  text: '초록이 / 이영희 / 경기도 수원시 팔달구 효원로 299, 102호',
  nickname: null,
  name: '이영희',
  phone: '01022223333',
  address: '경기도 수원시 팔달구 효원로 299',
  detail: '102호',
  candidates: [
    { date: '2026-10-31', buyer: 'UC_GREEN1', label: '초록이 (끝 REN1)' },
    { date: '2026-10-31', buyer: 'UC_GREEN2', label: '초록이 (끝 REN2)' },
  ],
  applied: null,
  message: '맞는 손님이 여럿이에요. 손님을 골라 주세요.',
  ...patch,
})

function world(cards: BuyerInfoCard[]) {
  const w = makeWorld()
  const posts: { path: string; body: Record<string, unknown> | null }[] = []
  w.server.on('GET', /^\/api\/buyer-info$/, () => ({ body: { cards, buyers: cards.flatMap((item) => item.candidates) } }))
  w.server.on('POST', /^\/api\/buyer-info\/.+\/(apply|dismiss)$/, (call) => {
    posts.push({ path: call.path, body: call.body })
    return { body: { id: 'x' } }
  })
  return { w, posts }
}

describe('ORD-14 손님 정보 문자 화면', () => {
  it('모르는 문자: [무시]·[손님 고르기] → 손님 골라 [넣기]', async () => {
    const { w, posts } = world([card({})])
    render(w.wrap(<BuyerInfoScreen onBack={() => undefined} />))
    expect(await screen.findByText('맞는 손님이 여럿이에요. 손님을 골라 주세요.')).toBeTruthy()
    expect(screen.getByText('무시')).toBeTruthy()
    fireEvent.click(screen.getByText('손님 고르기'))
    fireEvent.click(await screen.findByText(/초록이 \(끝 REN2\)/))
    fireEvent.click(screen.getByText('넣기'))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]?.path).toBe('/api/buyer-info/bi_00000000-0000-0000-0000-000000000001/apply')
    expect(posts[0]?.body).toEqual({ date: '2026-10-31', buyer: 'UC_GREEN2', name: '이영희', phone: '01022223333', address: '경기도 수원시 팔달구 효원로 299', detail: '102호' })
  })

  it('바로 넣은 문자: "넣었어요"와 손님 이름, [닫기]', async () => {
    const { w, posts } = world([card({ status: 'APPLIED', auto: true, applied: { date: '2026-10-31', buyer: 'UC_NARAE', label: '나래' }, message: '배송지를 넣었어요. 정산에서 배송지를 확인해 주세요.' })])
    render(w.wrap(<BuyerInfoScreen onBack={() => undefined} />))
    expect(await screen.findByText('넣었어요')).toBeTruthy()
    fireEvent.click(screen.getByText('닫기'))
    await waitFor(() => expect(posts.map((post) => post.path)).toEqual(['/api/buyer-info/bi_00000000-0000-0000-0000-000000000001/dismiss']))
  })

  // D-UX4-125 (사용자 지시 2026-11-11 '주문 탭 수정 사항 … 고객 정보 받기 … 3개 버튼 맨 위 영역에')로 바뀐 기대:
  // 옛 "정산 탭 위 줄(BuyerInfoBanner): 확인할 것이 있으면 '손님 정보 문자 n건 확인해 주세요', 없으면 그리지 않는다"
  // → 새 "주문 탭 맨 위 [고객 정보 받기]에 작은 점과 '확인할 문자 n건'(읽어 주는 이름), 없으면 점 없이 단추 이름만"
  it('주문 탭 [고객 정보 받기]: 확인할 것이 있으면 점, 없으면 단추만', async () => {
    const { w } = world([card({}), card({ id: 'bi_2', status: 'APPLIED' })])
    withOrders(w, ordersView([]))
    const { unmount } = render(w.wrap(<SettleScreen nav={{ openBuyerInfo: () => undefined }} />))
    expect(await screen.findByRole('button', { name: '고객 정보 받기 · 확인할 문자 1건' })).toBeTruthy()
    expect(screen.getByTestId('top-button-dot')).toBeTruthy()
    unmount()
    clearCached()
    const quiet = world([card({ status: 'APPLIED' })])
    withOrders(quiet.w, ordersView([]))
    render(quiet.w.wrap(<SettleScreen nav={{ openBuyerInfo: () => undefined }} />))
    await waitFor(() => expect(quiet.w.server.callsTo('GET', /^\/api\/buyer-info$/).length).toBeGreaterThan(0))
    expect(await screen.findByRole('button', { name: '고객 정보 받기' })).toBeTruthy()
    expect(screen.queryByTestId('top-button-dot')).toBeNull()
  })
})
