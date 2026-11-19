// 지난 주문 같이 보내기 (D-STMT-CARRY-01) · 정산서 배송비 바꾸기 (D-STMT-SHIP-01), 판매자 요청 2026-11-20
// "예전 2만 원 오늘 3만 원 주문했으면 묶어서 배송하면 5만 원이니까 배송비 무료" · "정산서에서 바로 배송비를 수정 … 무료로 수정하거나 내가 원하는 금액으로"
import Svg from 'react-native-svg'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { Settlement } from '@livejjim/web/src/api/types.ts'
import { dressSales, orderTotals, paperOrder, pastOrdersWord, STATEMENT_SHIPPING_DEFAULT, type PastOrder, type StatementCarry } from '../src/lib/broadcast-sales.ts'
import { CARRY_BUTTON, CARRY_DROP_BUTTON, CARRY_SENT_BUTTON, CARRY_SENT_QUESTION, CREDIT_WORD, WAITING_TAG, carriedNote, waitingNote } from '../src/lib/statement-carries.ts'
import { nativeShareFile, setNativeModules } from '../src/native/index.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { FREE_BUTTON, RULE_BUTTON, SAVE_BUTTON, STATEMENT_SHIPPING_TITLE } from '../src/screens/console/StatementShippingEdit.tsx'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST, buyer, changes, claim, fullView, product } from './support.ts'

const DATE = '2026-11-20'
const PAST: PastOrder = { date: '2026-11-15', buyer: '다육맘', qty: 1, subtotal: 20000, received: 25000,
  lines: [{ key: '2026-11-15|b0/3', no: 3, name: '핑크프릴', variant: null, qty: 1, amount: 20000, round: '11.15' }] }

it('지난 주문을 붙인 한 장: 줄·개수·상품 금액을 합치고, 배송비는 합친 금액(5만 원 → 무료), 지난 날짜에 받은 돈은 뺀다', () => {
  const today = { id: '다육맘', lines: [{ key: 'b1/1', no: 1, name: '라울', variant: null, qty: 1, amount: 30000 }], qty: 1, subtotal: 30000 }
  expect(orderTotals(today, STATEMENT_SHIPPING_DEFAULT)).toMatchObject({ charged: true, shipping: 5000, total: 35000, credit: 0, overridden: false })
  const [dressed] = dressSales({ orders: [today] }, [{ buyer: '다육맘', carried: [PAST], waiting: [] }], () => undefined).orders
  const one = paperOrder(dressed!)
  expect(one.lines.map(line => line.no)).toEqual([1, 3])
  expect(one).toMatchObject({ qty: 2, subtotal: 50000, credit: 25000 })
  expect(orderTotals(one, STATEMENT_SHIPPING_DEFAULT)).toMatchObject({ shipping: 0, total: 25000, ruleShipping: 0 })
  // 이 손님 배송비를 따로 정했으면(엔진 예외) 그 값 — 규칙 배송비는 [정해진 대로]에 보인다
  const fixed = dressSales({ orders: [today] }, [], () => ({ shipping: 6000, shippingOverride: 'FIXED' as const })).orders[0]!
  expect(orderTotals(paperOrder(fixed), STATEMENT_SHIPPING_DEFAULT)).toMatchObject({ shipping: 6000, total: 36000, ruleShipping: 5000, overridden: true })
  // 받지 않는 설정이어도 따로 정한 배송비는 줄이 있다
  expect(orderTotals(paperOrder(fixed), { charge: false, fee: 0, freeFrom: null })).toMatchObject({ charged: true, shipping: 6000 })
  expect(pastOrdersWord([PAST])).toBe('지난 11.15 주문 1개 · 20,000원')
})

const settlementOf = (patch: Partial<Settlement> = {}): Settlement => ({
  buyer: '다육맘', date: DATE, items: ['b1/1'], subtotal: 30000, shipping: 5000, shippingOverride: null, adjustments: 0, total: 35000, received: 0, refundDue: 0, payment: 'UNPAID', records: [], ...patch,
})

function setup(start: StatementCarry[], settlement: Settlement = settlementOf()) {
  const world = makeWorld()
  const products = [product(1, { name: '라울', price: 30000 })]
  const claims = [claim('1', 1, '다육맘', { amount: 30000 })]
  let current = start
  let shipping = settlement
  world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, date: DATE }] } }))
  world.server.on('GET', new RegExp(`^/api/days/${DATE}$`), () => ({ body: fullView({ date: DATE, seq: 5, products, claims, buyers: [buyer('다육맘', '다육맘')], settlements: [shipping] }) }))
  world.server.on('GET', /order-shop$/, () => ({ body: { name: '용용다육' } }))
  world.server.on('GET', /statement-joins$/, () => ({ body: { groups: [] } }))
  world.server.on('GET', /statement-carries$/, () => ({ body: { buyers: current } }))
  world.server.on('POST', /statement-carries$/, call => {
    const body = call.body as { kind: string }
    current = body.kind === 'carry' ? [{ buyer: '다육맘', carried: [PAST], waiting: [] }] : body.kind === 'drop' ? [{ buyer: '다육맘', carried: [], waiting: [PAST] }] : []
    return { body: { buyers: current } }
  })
  // 범위 seq는 전체 조회(5)에서 쓸 때마다 하나씩 — 증분 조회는 바뀐 정산을 준다
  let seq = 5
  world.server.on('POST', /^\/api\/events/, call => {
    const body = call.body as { mode: string; amountText?: string }
    shipping = body.mode === 'DEFAULT' ? settlementOf() : settlementOf({ shippingOverride: 'FIXED', shipping: Number(body.amountText) })
    seq += 1
    return { body: { date: DATE, rehearsal: false, seq, type: 'settlement.shippingOverride', changed: true, effects: [] } }
  })
  world.server.on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=\\d+$`), call => ({ body: { ...changes(Number(/since=(\d+)/.exec(call.path)?.[1]), seq, { settlements: [shipping] }), date: DATE } }))
  const previous = nativeShareFile()
  setNativeModules({ shareFile: vi.fn(async () => undefined) })
  const snapshot = vi.spyOn(Svg.prototype, 'toDataURL').mockImplementation(cb => cb('iVBORw0KGgo='))
  onTestFinished(() => { setNativeModules({ shareFile: previous }); snapshot.mockRestore() })
  return world
}

it('목록에 지난 주문 꼬리표, 정산서 위에 알림 → [같이 보내기]면 지난 상품 줄 · 배송비 무료 · 받은 돈 빼기, [빼기]·[이미 보냈어요]', async () => {
  const world = setup([{ buyer: '다육맘', carried: [], waiting: [{ ...PAST, received: 0 }] }])
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={() => {}} />))
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^다육맘 정산서 .* · ${WAITING_TAG}$`) }))
  expect(await screen.findByText(waitingNote([PAST]))).toBeTruthy()
  expect(screen.getByTestId('statement-shipping').getAttribute('aria-label')).toBe('배송비 5,000원')
  fireEvent.click(screen.getByRole('button', { name: CARRY_BUTTON }))
  await waitFor(() => expect(world.server.callsTo('POST', /statement-carries$/)).toHaveLength(1))
  expect(world.server.callsTo('POST', /statement-carries$/)[0]!.body).toMatchObject({ kind: 'carry', buyer: '다육맘', past: [{ date: '2026-11-15', buyer: '다육맘' }] })
  expect(await screen.findByText(carriedNote([PAST]))).toBeTruthy()
  const paper = screen.getByTestId('buyer-statement')
  expect(within(paper).getByText('11.15 3번')).toBeTruthy()
  expect(screen.getByTestId('statement-subtotal').getAttribute('aria-label')).toBe('상품 금액 50,000원')
  expect(screen.getByTestId('statement-shipping').getAttribute('aria-label')).toBe('배송비 무료')
  expect(screen.getByTestId('statement-credit').getAttribute('aria-label')).toBe(`${CREDIT_WORD} −25,000원`)
  expect(screen.getByTestId('buyer-total').getAttribute('aria-label')).toBe('총액 25,000원 · 총 2개')
  // 사진 그림도 같은 값
  const svgTexts = [...document.querySelectorAll('[data-testid="buyer-statement-photo"] svg text')].map(node => node.textContent)
  expect(svgTexts).toEqual(expect.arrayContaining(['11.15 3', '무료', '−25,000', '25,000']))

  fireEvent.click(screen.getByRole('button', { name: CARRY_DROP_BUTTON }))
  expect(await screen.findByText(waitingNote([PAST]))).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: CARRY_SENT_BUTTON }))
  const ask = await screen.findByRole('dialog', { name: CARRY_SENT_QUESTION })
  fireEvent.click(within(ask).getByRole('button', { name: CARRY_SENT_BUTTON }))
  await waitFor(() => expect(screen.queryByTestId('statement-carry')).toBeNull())
  expect(world.server.callsTo('POST', /statement-carries$/).map(call => (call.body as { kind: string }).kind)).toEqual(['carry', 'drop', 'sent'])
}, 15_000)

it('배송비 [바꾸기] → [무료]·숫자판으로 이 손님 배송비를 정하고(엔진 배송비 예외), [정해진 대로]로 되돌린다', async () => {
  const world = setup([])
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={() => {}} />))
  fireEvent.click(await screen.findByRole('button', { name: /^다육맘 정산서/ }))
  fireEvent.click(await screen.findByTestId('statement-shipping-edit-button'))
  let page = await screen.findByRole('main', { name: STATEMENT_SHIPPING_TITLE })
  expect(within(page).getByText('정해진 대로면 5,000원')).toBeTruthy()
  // 처음 칸은 지금 배송비 — 지우고 6,000원
  const pad = within(page).getByRole('group', { name: '숫자판' })
  for (const key of ['지우기', '지우기', '지우기', '지우기', '6', '0', '0', '0']) fireEvent.click(within(pad).getByRole('button', { name: key }))
  fireEvent.click(within(page).getByRole('button', { name: SAVE_BUTTON }))
  await waitFor(() => expect(world.server.callsTo('POST', /^\/api\/events/)).toHaveLength(1))
  expect(world.server.callsTo('POST', /^\/api\/events/)[0]!.body).toMatchObject({ type: 'settlement.shippingOverride', buyer: '다육맘', date: DATE, mode: 'FIXED', amountText: '6000' })
  await waitFor(() => expect(screen.getByTestId('statement-shipping').getAttribute('aria-label')).toBe('배송비 6,000원 · 이 손님만'))
  expect(screen.getByTestId('buyer-total').getAttribute('aria-label')).toBe('총액 36,000원 · 총 1개')

  // [무료]
  fireEvent.click(screen.getByTestId('statement-shipping-edit-button'))
  page = await screen.findByRole('main', { name: STATEMENT_SHIPPING_TITLE })
  fireEvent.click(within(page).getByRole('button', { name: FREE_BUTTON }))
  fireEvent.click(within(page).getByRole('button', { name: SAVE_BUTTON }))
  await waitFor(() => expect(screen.getByTestId('statement-shipping').getAttribute('aria-label')).toBe('배송비 무료 · 이 손님만'))
  expect(world.server.callsTo('POST', /^\/api\/events/)[1]!.body).toMatchObject({ mode: 'FIXED', amountText: '0' })

  // 되돌리기
  fireEvent.click(screen.getByTestId('statement-shipping-edit-button'))
  page = await screen.findByRole('main', { name: STATEMENT_SHIPPING_TITLE })
  fireEvent.click(within(page).getByRole('button', { name: RULE_BUTTON }))
  await waitFor(() => expect(screen.getByTestId('statement-shipping').getAttribute('aria-label')).toBe('배송비 5,000원'))
  expect(world.server.callsTo('POST', /^\/api\/events/)[2]!.body).toMatchObject({ mode: 'DEFAULT' })
}, 15_000)
