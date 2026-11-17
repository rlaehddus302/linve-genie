// D-RETRO-23 (개선 계획표 A8, 11월 12일 라이브 복기 9.2): 아직 상품이 없는 번호에 손님 찜이 기다리면 방송 화면이 눈에 띄게 알린다 —
// D-ALERTFLOAT-01(사용자 지시 2026-11-17)로 옛 탭 바 밑 주황 상자 + 번호 알약 → 오른쪽 아래 빨간 알림 "등록 안 된 번호에 찜 n건 ›".
// 번호가 하나면 누르는 대로 그 번호가 채워진 상품 추가, 여럿이면 번호 판에서 골라 연다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { FullView } from '@livejjim/web/src/api/types.ts'
import { describe, expect, it } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { ASK_ADD, ASK_NO, ASK_PRICE, startOfAdd } from '../src/screens/console/ProductAdd.tsx'
import { ProductAddScreen } from '../src/screens/console/StackScreens.tsx'
import { unlistedFloatText } from '../src/screens/console/AlertFloat.tsx'
import { UNLISTED_LABEL, unlistedNumbers, unlistedPillLabel } from '../src/screens/console/UnlistedClaims.tsx'
import { fromFull } from '../src/lib/scope-data.ts'
import { makeWorld } from './screen-support.tsx'
import { buyer, changes, claim, flush, fullView, product } from './support.ts'

const waiting = (id: string, no: number, buyerId: string, seq: number) => claim(id, no, buyerId, { status: 'PENDING', productId: null, price: null, amount: null, confirmVersion: null, seq })
const slot = (no: number, claims: string[], buyers: string[], b = 'b1') => ({ product: `${b}/${String(no)}`, broadcast: b, no, buyers, claims })

/** 397번에 1건(먼저), 313번에 2건이 기다리고, 15번은 상품이 있다 */
const VIEW: Partial<FullView> = {
  products: [product(15)],
  claims: [waiting('c3', 397, 'u3', 12), waiting('c4', 313, 'u4', 14), waiting('c5', 313, 'u5', 15)],
  pending: [slot(313, ['c4', 'c5'], ['u4', 'u5']), slot(397, ['c3'], ['u3'])],
  buyers: [buyer('u3', '박철수'), buyer('u4', '이민수'), buyer('u5', '최지우')],
}

function worldWith(view: Partial<FullView>) {
  const world = makeWorld({ products: view.products ?? [] })
  world.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=true)?$/, () => ({ body: fullView({ seq: world.seq, ...view }) }))
  world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=(\d+)/, (call) => ({ body: changes(Number(/since=(\d+)/.exec(call.path)?.[1] ?? 5), world.seq, {}) }))
  return world
}
async function open(world: ReturnType<typeof makeWorld>, props: { openAdd?: () => void; openAddAt?: (no: number) => void } = {}) {
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} {...props} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
}
/** 빨간 알림을 누르고 번호 판에서 그 번호를 고른다 */
async function pickNumber(no: number) {
  fireEvent.click(screen.getByRole('button', { name: unlistedFloatText(3) }))
  const list = await screen.findByRole('list', { name: UNLISTED_LABEL })
  fireEvent.click(within(list).getByRole('button', { name: unlistedPillLabel(no) }))
}
const typePad = (digits: string) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of digits) fireEvent.click(within(pad).getByRole('button', { name: key }))
}

describe('등록 안 된 번호의 찜 알림 (D-RETRO-23, 개선 계획표 A8)', () => {
  it('아직 상품이 없는 번호의 보류 찜만, 가장 오래 기다린 번호부터 센다 — 상품이 있는 번호·다른 라이브는 뺀다', () => {
    const data = fromFull(fullView({
      ...VIEW,
      claims: [...(VIEW.claims ?? []), waiting('c6', 15, 'u3', 16), waiting('c7', 50, 'u3', 5)],
      pending: [...(VIEW.pending ?? []), slot(15, ['c6'], ['u3']), slot(50, ['c7'], ['u3'], 'b2'), slot(77, [], [])],
    }))
    expect(unlistedNumbers(data, 'b1')).toEqual([{ no: 397, count: 1 }, { no: 313, count: 2 }])
    expect(unlistedNumbers(data, 'b2')).toEqual([{ no: 50, count: 1 }])
    expect(unlistedNumbers(fromFull(fullView({ products: [product(15)] })), 'b1')).toEqual([])
  })

  // D-ALERTFLOAT-01 (옛 기대: 탭 바 밑 주황 상자 + 번호 알약 — D-TABS-02): 오른쪽 아래 빨간 알림 하나, 탭 바 밑 알림 묶음에는 없다
  it('오른쪽 아래 빨간 알림 "등록 안 된 번호에 찜 3건"이 뜨고, 누르면 번호 판에 오래 기다린 번호부터 — 닉네임은 그리지 않는다', async () => {
    await open(worldWith(VIEW))
    expect(unlistedFloatText(3)).toBe('등록 안 된 번호에 찜 3건')
    const float = screen.getByTestId('alert-float')
    const alert = within(float).getByRole('button', { name: unlistedFloatText(3) })
    expect(alert.textContent).toBe('등록 안 된 번호에 찜 3건')
    expect(within(screen.getByTestId('console-notices')).queryByText(/등록 안 된 번호/)).toBeNull()
    fireEvent.click(alert)
    const list = await screen.findByRole('list', { name: UNLISTED_LABEL })
    expect(within(list).getAllByRole('button').map((row) => row.getAttribute('aria-label'))).toEqual(['397번 상품 추가', '313번 상품 추가'])
    expect(within(list).getByRole('button', { name: unlistedPillLabel(313) }).textContent).toBe('313번찜 2건')
    expect(list.textContent).not.toContain('박철수')
  })

  it('기다리는 찜이 없으면 알림이 없다', async () => {
    await open(worldWith({ products: [product(15)] }))
    expect(screen.queryByTestId('alert-float')).toBeNull()
  })

  it('번호가 하나뿐이면 알림을 누르는 대로 그 번호가 채워진 상품 추가가 열린다', async () => {
    await open(worldWith({ products: [product(15)], claims: [waiting('c3', 397, 'u3', 12)], pending: [slot(397, ['c3'], ['u3'])], buyers: [buyer('u3', '박철수')] }))
    fireEvent.click(screen.getByRole('button', { name: unlistedFloatText(1) }))
    const page = await screen.findByRole('dialog', { name: '상품 추가' })
    expect(within(page).getByRole('button', { name: '번호 397번 고치기' })).toBeTruthy()
  })

  it('번호 판에서 번호를 누르면 그 번호가 채워진 상품 추가가 가격부터 열리고, 그대로 추가하면 그 번호로 등록한다', async () => {
    const world = worldWith(VIEW)
    await open(world)
    await pickNumber(397)
    const page = await screen.findByRole('dialog', { name: '상품 추가' })
    expect(within(page).getByRole('button', { name: '번호 397번 고치기' })).toBeTruthy()
    expect(within(page).getByRole('status', { name: ASK_PRICE })).toBeTruthy()
    typePad('40000')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    for (const line of ['397번', '40,000원', ASK_ADD]) expect(within(page).getByText(line)).toBeTruthy()
    fireEvent.click(within(page).getByRole('button', { name: '추가하기' }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.register', b: 'b1', noText: '397', priceText: '40000원', name: '' })
  })

  it('번호 판으로 열었다 닫고 (+)로 열면 번호 칸은 비어 있다', async () => {
    await open(worldWith(VIEW))
    await pickNumber(313)
    const first = await screen.findByRole('dialog', { name: '상품 추가' })
    // 채워진 번호는 눌러서 고칠 수 있다 — 뒤로 가면 번호 칸
    fireEvent.click(within(first).getByRole('button', { name: '번호 313번 고치기' }))
    expect(within(first).getByRole('status', { name: '번호 313번' })).toBeTruthy()
    fireEvent.click(within(first).getByRole('button', { name: '뒤로' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '상품 추가' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const again = await screen.findByRole('dialog', { name: '상품 추가' })
    expect(within(again).getByRole('status', { name: ASK_NO })).toBeTruthy()
  })

  it('기기에서는 번호를 실어 쌓인 상품 추가 경로를 연다 — 겹쳐 그리지 않는다', async () => {
    const opened: (number | 'plain')[] = []
    await open(worldWith(VIEW), { openAdd: () => opened.push('plain'), openAddAt: (no) => opened.push(no) })
    await pickNumber(397)
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    expect(opened).toEqual([397, 'plain'])
    expect(screen.queryByRole('dialog', { name: '상품 추가' })).toBeNull()
    const route = readFileSync(join(import.meta.dirname, '../app/console/[id]/index.tsx'), 'utf8')
    expect(route).toContain("openAddAt={(no) => router.push({ pathname: '/console/[id]/add', params: { id, no: String(no) } })}")
    expect(readFileSync(join(import.meta.dirname, '../app/console/[id]/add.tsx'), 'utf8')).toContain('startNo')
  })

  it('쌓인 상품 추가 화면도 번호를 채워 가격부터 연다', async () => {
    const world = worldWith(VIEW)
    render(world.wrap(<><ConsoleScreen broadcastId="b1" seller onBack={() => {}} openAdd={() => {}} openAddAt={() => {}} /><ProductAddScreen broadcastId="b1" onBack={() => {}} startNo={397} /></>))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    const page = await screen.findByRole('main', { name: '상품 추가' })
    expect(within(page).getByRole('button', { name: '번호 397번 고치기' })).toBeTruthy()
    expect(within(page).getByRole('status', { name: ASK_PRICE })).toBeTruthy()
  })

  it('채워 여는 번호: 쓸 수 있으면 가격부터, 그사이 상품이 생겼으면 번호 칸에 채운 채로, 숫자가 아니거나 한도 밖이면 빈 번호 칸', () => {
    expect(startOfAdd(undefined, 999, false)).toEqual({ step: 'no', no: '' })
    expect(startOfAdd(397, 999, false)).toEqual({ step: 'price', no: '397' })
    expect(startOfAdd(397, 999, true)).toEqual({ step: 'no', no: '397' })
    expect(startOfAdd(1000, 999, false)).toEqual({ step: 'no', no: '' })
    expect(startOfAdd(10_000, null, false)).toEqual({ step: 'no', no: '' })
    expect(startOfAdd(0, 999, false)).toEqual({ step: 'no', no: '' })
    expect(startOfAdd(1.5, 999, false)).toEqual({ step: 'no', no: '' })
  })
})
