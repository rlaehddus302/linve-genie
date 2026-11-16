// D-UX4-198 (사용자 지시 2026-11-16 "화면 저렇게 넘어가면 안 된다. 왜 이렇게 했는가? 아이폰 기본적인 화면으로 해라."):
// 기기에서는 구매자 정산서를 손으로 그린 겹친 화면이 아니라 진짜 쌓인 경로(/console/<방송>/statement?buyer=)로 연다.
// 모두에게 보내기 차례는 statement-queue로 목록과 쌓인 화면이 함께 본다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { STATEMENT_SHIPPING_DEFAULT, type StatementInfo } from '../src/lib/broadcast-sales.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { BuyerStatementScreen, sendAllFinished } from '../src/screens/console/BuyerStatement.tsx'
import { endSendQueue, sendQueueNote, sendQueueOf, startSendQueue } from '../src/screens/console/statement-queue.ts'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST, BROADCAST_VIEW, buyer, claim, fullView, product } from './support.ts'

const INFO: StatementInfo = { bank: '농협', accountNumber: '302-0000-0000-00', accountHolder: '김판매', phone: '010-0000-0000', hostName: '', shipping: STATEMENT_SHIPPING_DEFAULT, decided: true }
const ENDED = { date: '2026-11-12', ended: true, endedAt: '2026-11-12T12:00:00.000Z' }

function endedWorld() {
  const world = makeWorld()
  world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, ...ENDED }] } }))
  world.server.on('GET', /^\/api\/days\/2026-11-12$/, () => ({ body: fullView({ date: '2026-11-12', broadcasts: [{ ...BROADCAST_VIEW, ...ENDED }], products: [product(201, { name: '색금', price: 30000 }), product(202, { name: '퍼플', price: 20000 })], claims: [claim('0', 201, '가을여행', { amount: 30000 }), claim('1', 202, '겨울', { amount: 20000 })], buyers: [buyer('가을여행', '가을여행'), buyer('겨울', '겨울')] }) }))
  world.server.on('GET', /order-shop$/, () => ({ body: { name: '용용다육' } }))
  world.server.on('GET', /^\/api\/statement-info$/, () => ({ body: { info: INFO } }))
  return world
}

it('경로가 있으면 구매자 줄을 눌러 쌓인 화면을 연다 — 겹친 화면을 그리지 않는다 (D-UX4-198)', async () => {
  const world = endedWorld()
  const openStatement = vi.fn()
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} openStatement={openStatement} />))
  fireEvent.click(await screen.findByRole('button', { name: /^가을여행 정산서/ }))
  expect(openStatement).toHaveBeenCalledWith('가을여행')
  expect(screen.queryByRole('dialog', { name: '가을여행 님 정산서' })).toBeNull()
  expect(screen.queryByTestId('buyer-page-dim')).toBeNull()
})

it('쌓인 구매자 정산서 화면: 큰 제목 "닉네임 님 정산서"와 주문한 상품, 뒤로는 onBack (D-UX4-198)', async () => {
  const world = endedWorld()
  const onBack = vi.fn()
  render(world.wrap(<BuyerStatementScreen broadcastId="b1" buyer="가을여행" onBack={onBack} onBuyer={() => {}} />))
  const page = await screen.findByRole('main', { name: '가을여행 님 정산서' })
  // 화면 카드와 화면 밖 사진 그림 모두 이 손님 상품만
  expect((await within(page).findAllByText('색금')).length).toBeGreaterThan(0)
  expect(within(page).queryAllByText('퍼플')).toHaveLength(0)
  fireEvent.click(within(page).getByRole('button', { name: '뒤로' }))
  expect(onBack).toHaveBeenCalled()
})

it('모두에게 보내기 차례: 쌓인 화면이 다음 손님으로 넘기고, 끝나면 목록에 한 줄을 남기고 돌아간다 (D-UX4-198)', async () => {
  const world = endedWorld()
  startSendQueue('b1', ['가을여행', '겨울'])
  const onBuyer = vi.fn()
  const onBack = vi.fn()
  const view = render(world.wrap(<BuyerStatementScreen broadcastId="b1" buyer="가을여행" onBack={onBack} onBuyer={onBuyer} />))
  await screen.findByRole('main', { name: '가을여행 님 정산서' })
  fireEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))
  expect(onBuyer).toHaveBeenCalledWith('겨울')
  view.rerender(world.wrap(<BuyerStatementScreen broadcastId="b1" buyer="겨울" onBack={onBack} onBuyer={onBuyer} />))
  await screen.findByRole('main', { name: '겨울 님 정산서' })
  // 마지막 손님은 [건너뛰고 마치기]
  fireEvent.click(await screen.findByRole('button', { name: '건너뛰고 마치기' }))
  await waitFor(() => expect(onBack).toHaveBeenCalled())
  expect(sendQueueOf('b1')).toBeNull()
  expect(sendQueueNote('b1')).toBe(sendAllFinished(2, 0))
  endSendQueue('b1')
})

it('구매자 정산서 경로 파일은 쌓인 화면을 그리고 다음 손님은 같은 화면에서 바꾼다 (D-UX4-198)', () => {
  const route = readFileSync(join(process.cwd(), 'app/console/[id]/statement.tsx'), 'utf8')
  expect(route).toContain('BuyerStatementScreen')
  expect(route).toContain('router.setParams({ buyer: next })')
  for (const file of ['index.tsx', 'record.tsx']) {
    const source = readFileSync(join(process.cwd(), 'app/console/[id]', file), 'utf8')
    expect(source).toContain("pathname: '/console/[id]/statement'")
  }
})
