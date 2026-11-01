// 앱 입금 확인 (D-APPX-01 — 웹 DepositsPage와 같은 규칙·문구): 확인 필요 사유·제안 → 확정 판(바뀔 상태) → confirm 요청(남은 금액·기억하기),
// 묶음 금액이 바뀌었으면 서버 문장, 무시·되돌리기는 한 번 더 묻는다, 붙여넣기는 미리 보기 뒤 넣는다.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BundleView, DepositView } from '@livejjim/web/src/api/deposit-types.ts'
import { DepositsScreen } from '../src/screens/DepositsScreen.tsx'
import { makeWorld } from './screen-support.tsx'

const bundle: BundleView = { date: '2026-10-29', buyer: 'u1', name: '다육맘', total: 14_000, received: 0, remaining: 14_000, payment: 'UNPAID', refundDue: 0, after: { payment: 'PAID', received: 14_000, refundDue: 0 }, beforeSale: false, canRemember: true }
const review: DepositView = {
  no: 7,
  source: { id: 's1', kind: 'PASTE', label: '' },
  at: '2026-10-29T12:03:15.000Z',
  precision: 'second',
  amount: 14_000,
  name: '이영희',
  status: 'REVIEW',
  applied: null,
  receivedAt: '2026-10-29T12:03:20.000Z',
  handledAt: null,
  review: { reason: 'NAME_MISMATCH', twin: null, suggestions: [bundle], preselect: null },
}

function world() {
  const w = makeWorld()
  const posts: { path: string; body: Record<string, unknown> | null }[] = []
  w.server.on('GET', /^\/api\/deposits\/count$/, () => ({ body: { review: 1 } }))
  w.server.on('GET', /^\/api\/deposits\?status=REVIEW/, () => ({ body: { deposits: [review], more: false, review: 1 } }))
  w.server.on('GET', /^\/api\/deposits\?status=AUTO_APPLIED%2CAPPLIED/, () => ({ body: { deposits: [{ ...review, no: 8, status: 'AUTO_APPLIED', applied: { date: '2026-10-29', buyer: 'u2', buyerName: '초록손', seq: 9, auto: true }, review: undefined }], more: false, review: 1 } }))
  w.server.on('POST', /^\/api\/deposits\//, (call) => {
    posts.push({ path: call.path, body: call.body })
    return { body: { deposit: { no: 7, status: 'APPLIED', applied: { date: '2026-10-29', buyer: 'u1', buyerName: '다육맘', seq: 10 } } } }
  })
  return { w, posts }
}

describe('DepositsScreen (앱 입금 확인)', () => {
  it('확인 필요: 사유 문장 → 제안 묶음 → 확정 판(미입금 → 입금 완료) → confirm(남은 금액·기억하기)', async () => {
    const { w, posts } = world()
    render(w.wrap(<DepositsScreen onBack={() => undefined} />))
    expect(await screen.findByText('금액은 맞는데 이름이 달라요')).toBeTruthy()
    expect(screen.getByText('10/29 21:03:15 · 붙여넣기 · 입금 번호 7')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '이 묶음으로 확정 — 다육맘 · 2026년 10월 29일 묶음 · 남은 금액 14,000원' }))
    expect(screen.getByText('다육맘 · 2026년 10월 29일 묶음 · 14,000원 입금 · 미입금 → 입금 완료')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '확정하기' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]!.path).toBe('/api/deposits/7/confirm')
    expect(posts[0]!.body).toMatchObject({ date: '2026-10-29', buyer: 'u1', remaining: 14_000, remember: true })
    expect(typeof posts[0]!.body?.['requestId']).toBe('string')
    expect(await screen.findByText('입금 번호 7을 다육맘 묶음에 적었어요.')).toBeTruthy()
  })

  it('묶음 금액이 바뀌었으면(BUNDLE_CHANGED) 서버 문장을 보이고 다시 보내지 않는다', async () => {
    const { w, posts } = world()
    w.server.on('POST', /^\/api\/deposits\/7\/confirm$/, (call) => {
      posts.push({ path: call.path, body: call.body })
      return { status: 409, body: { error: { code: 'BUNDLE_CHANGED', message: '그사이 묶음 금액이 바뀌었어요. 다시 골라 주세요.' } } }
    })
    render(w.wrap(<DepositsScreen onBack={() => undefined} />))
    fireEvent.click(await screen.findByRole('button', { name: /^이 묶음으로 확정/ }))
    fireEvent.click(screen.getByRole('button', { name: '확정하기' }))
    expect(await screen.findByText('그사이 묶음 금액이 바뀌었어요. 다시 골라 주세요.')).toBeTruthy()
    expect(posts).toHaveLength(1)
  })

  it('무시는 한 번 묻고, 확인함의 되돌리기는 환불 기록 문장으로 묻는다', async () => {
    const { w, posts } = world()
    render(w.wrap(<DepositsScreen onBack={() => undefined} />))
    fireEvent.click(await screen.findByRole('button', { name: '무시하기' }))
    expect(posts).toHaveLength(0)
    fireEvent.click(screen.getAllByRole('button', { name: '무시하기' }).at(-1)!)
    await waitFor(() => expect(posts.map((post) => post.path)).toEqual(['/api/deposits/7/ignore']))
    fireEvent.click(screen.getByRole('button', { name: '자동 확인됨·확인함' }))
    fireEvent.click(await screen.findByRole('button', { name: '되돌리기' }))
    expect(screen.getByText('초록손 · 10월 29일 묶음에 적은 14,000원 입금을 되돌려요. 같은 금액의 환불 기록이 남고 이 입금은 확인 필요로 돌아가요.')).toBeTruthy()
  })
})
