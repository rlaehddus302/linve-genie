// D-UX4-183 (사용자 지시 2026-11-16 "눌렀을 때 뜨는 표도 바깥 스타일처럼 깔끔하게 만들어"):
// 구매자별 정산서 화면은 바깥 정산서(StatementList)처럼 흰 둥근 카드 줄로 그린다 — 번호 · 이름 · 개수 · 금액 → 배송비 → 총 개수·합계.
// 사진(문자 첨부·사진 저장)은 그대로 옛 양식 그림을 찍는다 — 그 그림은 화면 밖에 붙어 있고 읽어 주지 않는다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import Svg from 'react-native-svg'
import type { Claim, Product } from '@livejjim/web/src/api/types.ts'
import { broadcastSales, salesMoney, statementTotals, STATEMENT_SHIPPING_DEFAULT, type StatementInfo } from '../src/lib/broadcast-sales.ts'
import { nativeShareFile, nativeSms, setNativeModules } from '../src/native/index.ts'
import { BuyerOrderPaper } from '../src/screens/console/BuyerOrderPaper.tsx'
import { makeWorld } from './screen-support.tsx'
import { claim, product } from './support.ts'

const INFO: StatementInfo = { bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매', phone: '010-1234-5678', hostName: '홍재라이브', shipping: STATEMENT_SHIPPING_DEFAULT, decided: true }
const BASE = { shop: '용용다육', date: '2026-11-12', buyerName: '가을여행', inset: 0, sealed: false, rehearsal: false } as const

/** 한 손님이 산 상품들 — [번호, 이름, 개수, 금액] */
function orderOf(items: readonly (readonly [number, string, number, number])[]) {
  const products = new Map<string, Product>()
  const claims = new Map<string, Claim>()
  for (const [no, name, qty, amount] of items) {
    const item = product(no, { name })
    products.set(item.key, item)
    const sold = claim(`c${no}`, no, 'A', { qty, amount })
    claims.set(sold.id, sold)
  }
  return broadcastSales(claims, products, 'b1').orders[0]!
}
const TWO = orderOf([[3, '채홍', 1, 12000], [7, '라울', 2, 30000]])

/** 문자 앱·사진 찍기를 가짜로 바꾼다 (시험이 끝나면 되돌린다) */
function devices() {
  const world = makeWorld()
  world.server.on('POST', /receipt-sms\/prepare$/, () => ({ body: { sms: { phone: '01000000000', text: '' } } }))
  const compose = vi.fn(async () => 'cancelled' as const)
  const shareFile = vi.fn(async () => undefined)
  const previous = { sms: nativeSms(), shareFile: nativeShareFile() }
  setNativeModules({ sms: { available: async () => true, compose }, shareFile })
  const snapshot = vi.spyOn(Svg.prototype, 'toDataURL').mockImplementation(cb => cb('iVBORw0KGgo='))
  onTestFinished(() => { snapshot.mockRestore(); setNativeModules(previous) })
  return { world, compose, shareFile, snapshot }
}
const card = () => screen.getByTestId('buyer-statement')

it('카드 줄마다 번호 · 이름 · 개수 · 금액을 보이고, 합계 줄은 배송비를 더한 금액이다', () => {
  const { world } = devices()
  render(world.wrap(<BuyerOrderPaper {...BASE} order={TWO} info={INFO} />))
  const rows = within(card()).getAllByTestId('statement-line')
  expect(rows).toHaveLength(TWO.lines.length)
  TWO.lines.forEach((line, i) => {
    const row = within(rows[i]!)
    expect(row.getByText(`${line.no}번`)).toBeTruthy()
    expect(row.getByText([line.name, line.variant].filter(Boolean).join(' · '))).toBeTruthy()
    expect(row.getByText(`${line.qty}개`)).toBeTruthy()
    expect(row.getByText(salesMoney(line.amount))).toBeTruthy()
  })
  // 상품 합계 42,000원은 5만 원 미만 — 기본 규칙으로 배송비 5,000원
  const { total, shipping } = statementTotals(TWO.subtotal, INFO.shipping)
  expect(shipping).toBe(5000)
  expect(within(screen.getByTestId('statement-shipping')).getByText('5,000원')).toBeTruthy()
  const sum = within(screen.getByTestId('statement-total'))
  expect(sum.getByText(`총 ${TWO.qty}개`)).toBeTruthy()
  expect(sum.getByText(salesMoney(total))).toBeTruthy()
  expect(salesMoney(total)).toBe('47,000원')
  // 줄 순서: 상품 → 배송비 → 합계
  const order = [rows[0]!, rows[1]!, screen.getByTestId('statement-shipping'), screen.getByTestId('statement-total')]
  for (let i = 1; i < order.length; i += 1) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  // 아래 카드: 입금 계좌 · 전화번호 · 방송 이름
  expect(within(screen.getByTestId('statement-account')).getByText('농협 302-9988-7766-11 김판매')).toBeTruthy()
  expect(within(screen.getByTestId('statement-phone')).getByText('010-1234-5678')).toBeTruthy()
  expect(within(screen.getByTestId('statement-host')).getByText('홍재라이브')).toBeTruthy()
  // 화면에는 가게 이름 띠·날짜 머리가 없다 (바깥 정산서처럼)
  expect(within(card()).queryByText('✲용용다육 정산서✲')).toBeNull()
  expect(within(card()).queryByText('2026.11.12')).toBeNull()
})

it('배송비 줄은 받을 때만: 받지 않으면 없고, 무료 기준을 넘으면 "무료"', () => {
  const { world } = devices()
  const off = render(world.wrap(<BuyerOrderPaper {...BASE} order={TWO} info={{ ...INFO, shipping: { charge: false, fee: 0, freeFrom: null } }} />))
  expect(screen.queryByTestId('statement-shipping')).toBeNull()
  expect(within(screen.getByTestId('statement-total')).getByText('42,000원')).toBeTruthy()
  off.unmount()
  const big = orderOf([[3, '채홍', 1, 20000], [7, '라울', 2, 30000]])
  render(world.wrap(<BuyerOrderPaper {...BASE} order={big} info={INFO} />))
  expect(within(screen.getByTestId('statement-shipping')).getByText('무료')).toBeTruthy()
  expect(within(screen.getByTestId('statement-total')).getByText('50,000원')).toBeTruthy()
})

it('계좌·전화번호·방송 이름이 없으면 아래 카드가 없다', () => {
  const { world } = devices()
  render(world.wrap(<BuyerOrderPaper {...BASE} order={TWO} info={{ ...INFO, bank: '', accountNumber: '', accountHolder: '', phone: '', hostName: '' }} />))
  for (const id of ['statement-account', 'statement-phone', 'statement-host']) expect(screen.queryByTestId(id)).toBeNull()
  expect(screen.queryByRole('list', { name: '입금 안내' })).toBeNull()
})

it('사진용 정산서 그림은 화면 밖에 붙어 있고 읽어 주지 않으며, 사진 저장은 그 그림을 찍는다', async () => {
  const { world, shareFile, snapshot } = devices()
  render(world.wrap(<BuyerOrderPaper {...BASE} order={TWO} info={INFO} />))
  const photo = screen.getByTestId('buyer-statement-photo')
  expect(photo.getAttribute('aria-hidden')).toBe('true')
  const svg = photo.querySelector('svg')!
  expect(svg).not.toBeNull()
  // 카드(화면) 안에는 그림이 없다 — 그림은 사진에만
  expect(card().querySelector('svg')).toBeNull()
  expect(card().contains(photo)).toBe(false)
  // 사진 그림은 옛 양식 그대로: 제목 · 합계가 카드와 같은 셈
  const texts = [...svg.querySelectorAll('text')].map(node => node.textContent)
  expect(texts).toEqual(expect.arrayContaining(['✲용용다육 정산서✲', '총 개수', '47,000']))
  fireEvent.click(screen.getByRole('button', { name: '사진 저장' }))
  await waitFor(() => expect(shareFile).toHaveBeenCalledWith(new Uint8Array([137,80,78,71,13,10,26,10]), expect.stringMatching(/^order-2026-11-12-.+-1\.png$/), 'image/png'))
  expect(snapshot).toHaveBeenCalledTimes(1)
})

it('사진이 여러 장이면 화면 카드에는 모든 줄을 보이고, 사진 장은 [이전 장]·[다음 장]으로 고른다', () => {
  const { world } = devices()
  const many = orderOf(Array.from({ length: 25 }, (_, i) => [i + 1, `품종${i + 1}`, 1, 1000] as const))
  render(world.wrap(<BuyerOrderPaper {...BASE} order={many} info={INFO} />))
  expect(within(card()).getAllByTestId('statement-line')).toHaveLength(25)
  expect(screen.getByText('정산서가 길어 사진 2장으로 나눠 보내요.')).toBeTruthy()
  expect(screen.getByText('사진 1/2장')).toBeTruthy()
  const prev = screen.getByRole('button', { name: '이전 장' })
  const next = screen.getByRole('button', { name: '다음 장' })
  expect(prev.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByRole('button', { name: '이 장 문자 보내기' })).toBeTruthy()
  // 사진 첫 장에는 마지막 줄이 없다 — 화면 카드에는 있다
  const svgTexts = () => [...screen.getByTestId('buyer-statement-photo').querySelectorAll('text')].map(node => node.textContent)
  expect(svgTexts()).not.toContain('품종25')
  expect(within(card()).getByText('품종25')).toBeTruthy()
  fireEvent.click(next)
  expect(screen.getByText('사진 2/2장')).toBeTruthy()
  expect(svgTexts()).toContain('품종25')
})

it('손님 닉네임은 글자로만 쓴다 (꺾쇠도 글자)', () => {
  const { world } = devices()
  render(world.wrap(<BuyerOrderPaper {...BASE} buyerName="<b>꽃</b>" order={TWO} info={INFO} />))
  expect(screen.getByRole('list', { name: '<b>꽃</b> 님 정산서' })).toBeTruthy()
  expect(document.querySelector('b')).toBeNull()
})
