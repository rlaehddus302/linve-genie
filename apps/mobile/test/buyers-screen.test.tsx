// 앱 구매자 (D-APPX-03 — 웹 BuyersPage와 같은 규칙·문구): 그날 1등 찜이 있는 구매자, 자세히(뒤 4자리·확정 상품·정산),
// "문자찜(확인 필요)"은 안내와 합치기가 먼저, 합치기는 서버 미리 보기를 받아 사유와 함께 buyer.merge, 차단은 사유와 함께 대기 뒤.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BuyersScreen } from '../src/screens/BuyersScreen.tsx'
import { makeWorld } from './screen-support.tsx'
import { buyer, claim, fullView, product } from './support.ts'

function world() {
  const w = makeWorld()
  w.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: '2026-10-29', rehearsal: false, seq: 5 }] } }))
  w.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=false)?$/, () => ({
    body: fullView({
      products: [product(15, { winners: ['u1'], winnerClaims: ['c1'] }), product(16, { winners: ['u2'], winnerClaims: ['c2'] })],
      claims: [claim('c1', 15, 'u1'), claim('c2', 16, 'u2')],
      buyers: [buyer('u1', '꽃집언니', { items: ['b1/15'], subtotal: 10_000 }), buyer('u2', '문자찜(확인 필요)', { kind: 'sms', phoneLast4: '5678', items: ['b1/16'], subtotal: 10_000 })],
    }),
  }))
  w.server.on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 30 } }))
  w.server.on('GET', /^\/api\/days\/2026-10-29\/merge-preview/, () => ({
    body: { date: '2026-10-29', rehearsal: false, seq: 5, preview: { from: 'u2', into: 'u1', target: 'u1', blocked: null, bothConfirmed: [], duplicates: [], moving: { items: ['b1/16'], subtotal: 10_000 }, after: { items: ['b1/15', 'b1/16'], subtotal: 20_000 } } },
  }))
  return w
}

describe('BuyersScreen (앱 구매자)', () => {
  it('확인 필요 문자 구매자: 안내 → 합치기(손님이 남는 쪽) → 미리 보기 → 사유와 함께 buyer.merge', async () => {
    const w = world()
    render(w.wrap(<BuyersScreen onBack={() => undefined} />))
    fireEvent.click(await screen.findByRole('button', { name: /^문자찜\(확인 필요\)/ }))
    expect(screen.getByText('누구의 문자인지 찾아 합쳐 주세요.')).toBeTruthy()
    expect(screen.getByText('전화번호: 뒤 4자리 5678')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '다른 구매자와 합치기' }))
    fireEvent.change(screen.getByLabelText('합칠 구매자 찾기'), { target: { value: '꽃집' } })
    fireEvent.click(screen.getByRole('button', { name: '합칠 구매자 꽃집언니' }))
    expect(await screen.findByText('합친 뒤 합계 20,000원')).toBeTruthy()
    expect(screen.getByText(/→ 꽃집언니 \(남는 쪽: 꽃집언니\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '합치기' }))
    expect(await screen.findByText(/사유를 적어 주세요./)).toBeTruthy()
    expect(w.events).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '사유 같은 사람' }))
    fireEvent.click(screen.getByRole('button', { name: '합치기' }))
    await waitFor(() => expect(w.events).toHaveLength(1))
    expect(w.events[0]!.path).toBe('/api/events?date=2026-10-29')
    expect(w.events[0]!.body).toMatchObject({ type: 'buyer.merge', from: 'u2', into: 'u1', reason: '같은 사람' })
  })

  it('차단은 경고와 사유 뒤 대기 시간이 지나야 보낸다', async () => {
    const w = world()
    render(w.wrap(<BuyersScreen onBack={() => undefined} />))
    fireEvent.click(await screen.findByRole('button', { name: /^꽃집언니/ }))
    fireEvent.click(screen.getByRole('button', { name: '차단하기' }))
    expect(screen.getByText(/차단하면 이 사람의 대기·보류 찜이 모두 거절되고/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '사유 장난 주문' }))
    fireEvent.click(screen.getAllByRole('button', { name: '차단하기' }).at(-1)!)
    expect(await screen.findByText(/뒤 보내요: 꽃집언니 차단/)).toBeTruthy()
    await waitFor(() => expect(w.events).toHaveLength(1))
    expect(w.events[0]!.body).toMatchObject({ type: 'host.blockBuyer', buyer: 'u1', reason: '장난 주문' })
  })
})
