import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import Svg from 'react-native-svg'
import { broadcastSales, shippingFor, statementShipping, statementTotals, STATEMENT_SHIPPING_DEFAULT, type StatementInfo } from '../src/lib/broadcast-sales.ts'
import { nativeShareFile, nativeSms, setNativeModules } from '../src/native/index.ts'
import { BuyerOrderPaper } from '../src/screens/console/BuyerOrderPaper.tsx'
import { makeWorld } from './screen-support.tsx'
import { claim, product } from './support.ts'

const item = product(15, { name: '5개' })
const sold = claim('1', 15, 'A', { qty: 2, amount: 40000 })
const order = broadcastSales(new Map([[sold.id, sold]]), new Map([[item.key, item]]), 'b1').orders[0]!
const orderOf = (amount: number) => broadcastSales(new Map([[sold.id, { ...sold, amount }]]), new Map([[item.key, item]]), 'b1').orders[0]!

const INFO: StatementInfo = { bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매', phone: '010-1234-5678', hostName: '홍재라이브', shipping: STATEMENT_SHIPPING_DEFAULT, decided: true }
const BASE = { shop: '용용다육', date: '2026-11-12', buyerName: '가을여행', inset: 0, sealed: false, rehearsal: false } as const

/** 문자 앱·사진 찍기를 가짜로 바꾼다 (시험이 끝나면 되돌린다) */
function devices(result: 'sent' | 'cancelled' | 'unknown' = 'cancelled') {
  const world = makeWorld()
  world.server.on('POST', /receipt-sms\/prepare$/, () => ({ body: { sms: { phone: '01000000000', text: '다른 방송이 합쳐진 날짜별 금액' } } }))
  const compose = vi.fn(async () => result)
  const shareFile = vi.fn(async () => undefined)
  const previous = { sms: nativeSms(), shareFile: nativeShareFile() }
  setNativeModules({ sms: { available: async () => true, compose }, shareFile })
  const snapshot = vi.spyOn(Svg.prototype, 'toDataURL').mockImplementation(cb => cb('iVBORw0KGgo='))
  onTestFinished(() => { snapshot.mockRestore(); setNativeModules(previous) })
  return { world, compose, shareFile, snapshot }
}
const texts = () => [...document.querySelectorAll('svg text')].map(node => node.textContent)

it('세트는 낱개 수량을 세고 세트 판매가는 한 번씩만 합산한다. 5만원부터 무료 배송이다', () => {
  expect(order).toMatchObject({ subtotal: 40000, qty: 10, lines: [{ name: '5개 세트', qty: 10, amount: 40000 }] })
  expect([49999,50000,50001].map(shippingFor)).toEqual([5000,0,0])
})

// D-RETRO-60: 배송비는 판매자가 정한 규칙대로 — 기본값은 5만 원 미만 5,000원. 금액은 정수 원
it('배송비는 정한 규칙대로 붙는다: 49,999원은 받고 50,000원부터 무료, 받지 않으면 0원', () => {
  expect([49999, 50000].map(subtotal => statementShipping(subtotal, STATEMENT_SHIPPING_DEFAULT))).toEqual([5000, 0])
  expect(statementTotals(49999, STATEMENT_SHIPPING_DEFAULT)).toEqual({ charged: true, shipping: 5000, total: 54999 })
  expect(statementTotals(50000, STATEMENT_SHIPPING_DEFAULT)).toEqual({ charged: true, shipping: 0, total: 50000 })
  expect(statementTotals(49999, { charge: true, fee: 3000, freeFrom: null })).toEqual({ charged: true, shipping: 3000, total: 52999 })
  expect(statementTotals(49999, { charge: false, fee: 0, freeFrom: null })).toEqual({ charged: false, shipping: 0, total: 49999 })
  expect(statementTotals(null, STATEMENT_SHIPPING_DEFAULT)).toEqual({ charged: true, shipping: null, total: null })
})

// 옛 기대: 작은 "주문서"와 가게 이름 · "상품명" 열 · 상품 합계 → 배송비 → 총 주문 금액("5,000원", "45,000원"), 단추 "주문서 문자 보내기", 문자 글 "…님 주문서".
// 새 기대(D-RETRO-61, 판매자 양식 2026-11-12): 제목 "✲가게 정산서✲" · 방송 이름 · 손님 님 · 날짜(YYYY.MM.DD) · 번호/종자/개수/가격(원) 표(₩) · 배송비 줄 · 총 개수 줄 · 계좌 · 전화번호
it('구매자 정산서는 판매자 양식대로 그리고, 문자에는 그 그림과 배송비 포함 금액·입금 계좌를 넣는다', async () => {
  const { world, compose } = devices()
  render(world.wrap(<BuyerOrderPaper {...BASE} order={order} info={INFO} />))
  for (const text of ['✲용용다육 정산서✲', '홍재라이브', '가을여행 님', '2026.11.12', '번호', '종자', '개수', '가격(원)', '15', '5개 세트', '10', '40,000', '배송비', '5,000', '총 개수', '개', '45,000', '계좌', '농협 302-9988-7766-11 김판매', '전화번호', '010-1234-5678']) {
    expect(texts(), text).toContain(text)
  }
  // ₩ 기호: 상품 줄 · 배송비 줄 · 총 개수 줄
  expect(texts().filter(text => text === '₩')).toHaveLength(3)
  // 줄 순서: 상품 → 배송비 → 총 개수 → 계좌 → 전화번호
  const order_ = ['5개 세트', '배송비', '총 개수', '계좌', '전화번호'].map(text => texts().indexOf(text))
  expect(order_).toEqual([...order_].sort((a, b) => a - b))
  // 옛 기대(D-RETRO-62): 화면에 보이는 그림은 하나뿐이고 그 그림을 찍어 보낸다.
  // 새 기대(D-UX4-183): 화면은 카드 줄이고, 그림은 사진용 하나 — 화면 밖에 붙어 있고 읽어 주지 않는다. 그 그림을 찍어 보낸다
  expect(document.querySelectorAll('svg')).toHaveLength(1)
  expect(document.querySelector('svg')!.closest('[aria-hidden="true"]')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '문자 보내기' }))
  await waitFor(() => expect(compose).toHaveBeenCalledWith('01000000000', '[용용다육] 2026-11-12 가을여행님 정산서\n배송비 포함 45,000원\n입금 계좌 농협 302-9988-7766-11 김판매', expect.objectContaining({ mimeType: 'image/png', bytes: new Uint8Array([137,80,78,71,13,10,26,10]) })))
})

it('배송비 경계: 상품 합계 49,999원이면 5,000원을 더하고 50,000원이면 무료로 적는다', () => {
  const { world } = devices()
  const low = render(world.wrap(<BuyerOrderPaper {...BASE} order={orderOf(49999)} info={INFO} />))
  expect(texts()).toEqual(expect.arrayContaining(['49,999', '배송비', '5,000', '54,999']))
  low.unmount()
  render(world.wrap(<BuyerOrderPaper {...BASE} order={orderOf(50000)} info={INFO} />))
  expect(texts()).toEqual(expect.arrayContaining(['배송비', '무료']))
  expect(texts()).not.toContain('5,000')
  // 상품 줄과 총 개수 줄이 같은 금액
  expect(texts().filter(text => text === '50,000')).toHaveLength(2)
})

it('배송비를 받지 않는 설정이면 배송비 줄이 없고 합계에 더하지 않는다', async () => {
  const { world, compose } = devices()
  render(world.wrap(<BuyerOrderPaper {...BASE} order={order} info={{ ...INFO, shipping: { charge: false, fee: 0, freeFrom: null } }} />))
  expect(texts()).not.toContain('배송비')
  expect(texts().filter(text => text === '40,000')).toHaveLength(2)
  expect(texts().filter(text => text === '₩')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '문자 보내기' }))
  await waitFor(() => expect(compose).toHaveBeenCalledWith('01000000000', expect.stringContaining('정산서\n합계 40,000원'), expect.anything()))
})

it('계좌·전화번호·방송 이름을 넣지 않았으면 그 줄을 빼고 만든다', async () => {
  const { world, compose } = devices()
  render(world.wrap(<BuyerOrderPaper {...BASE} order={order} info={{ ...INFO, bank: '', accountNumber: '', accountHolder: '', phone: '', hostName: '' }} />))
  for (const gone of ['계좌', '전화번호', '홍재라이브']) expect(texts()).not.toContain(gone)
  expect(texts()).toContain('총 개수')
  fireEvent.click(screen.getByRole('button', { name: '문자 보내기' }))
  await waitFor(() => expect(compose).toHaveBeenCalledWith('01000000000', '[용용다육] 2026-11-12 가을여행님 정산서\n배송비 포함 45,000원', expect.anything()))
})

// 절대 규칙 8 (D-UX4-01): 단추 둘은 위아래로 쌓지 않고 한 줄 — 옛: [문자 보내기] 아래에 [사진 저장]
// 옛 제목 "…사진 저장은 화면의 그림을 그대로 내보낸다" → D-UX4-183: 화면은 카드 줄, 사진은 화면 밖에 붙여 둔 정산서 그림을 찍는다
it('단추는 좌우 한 줄: 왼쪽 [사진 저장] · 오른쪽 [문자 보내기], 사진 저장은 정산서 그림을 찍어 내보낸다', async () => {
  const { world, shareFile, snapshot } = devices()
  render(world.wrap(<BuyerOrderPaper {...BASE} order={order} info={INFO} />))
  const save = screen.getByRole('button', { name: '사진 저장' })
  const sms = screen.getByRole('button', { name: '문자 보내기' })
  expect(save.parentElement?.parentElement).toBe(sms.parentElement?.parentElement)
  expect(save.compareDocumentPosition(sms) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(save)
  await waitFor(() => expect(shareFile).toHaveBeenCalledWith(new Uint8Array([137,80,78,71,13,10,26,10]), expect.stringMatching(/^order-2026-11-12-.+-1\.png$/), 'image/png'))
  expect(snapshot).toHaveBeenCalledTimes(1)
})

// D-RETRO-64: 연속 보내기 — 보내면 보낸 손님으로 적고 다음 손님으로
it('연속 보내기: 아이폰은 보내면 바로 다음 손님으로, [건너뛰기]는 보내지 않고 넘어간다', async () => {
  const { world, compose } = devices('sent')
  const next = vi.fn()
  const onSent = vi.fn()
  render(world.wrap(<BuyerOrderPaper {...BASE} order={order} info={INFO} onSent={onSent} queue={{ position: 2, total: 5, last: false, next }} />))
  expect(screen.getByText('모두에게 보내기 · 5명 가운데 2번째')).toBeTruthy()
  const skip = screen.getByRole('button', { name: '건너뛰기' })
  const sms = screen.getByRole('button', { name: '문자 보내기' })
  expect(skip.parentElement?.parentElement).toBe(sms.parentElement?.parentElement)
  expect(skip.compareDocumentPosition(sms) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(sms)
  await waitFor(() => expect(next).toHaveBeenCalledTimes(1))
  expect(compose).toHaveBeenCalledTimes(1)
  expect(onSent).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
  expect(next).toHaveBeenCalledTimes(2)
  expect(onSent).toHaveBeenCalledTimes(1)
})

it('연속 보내기: 안드로이드는 보냈는지 알 수 없어 [다음 손님]을 눌러야 넘어가고, 문자 창을 닫으면(취소) 그대로 둔다', async () => {
  const android = devices('unknown')
  const next = vi.fn()
  const onSent = vi.fn()
  const first = render(android.world.wrap(<BuyerOrderPaper {...BASE} order={order} info={INFO} onSent={onSent} queue={{ position: 1, total: 2, last: false, next }} />))
  fireEvent.click(screen.getByRole('button', { name: '문자 보내기' }))
  expect(await screen.findByText('문자 앱을 열었어요. 보냈으면 다음 손님으로 넘어가 주세요.')).toBeTruthy()
  expect(onSent).toHaveBeenCalledTimes(1)
  expect(next).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '다시 보내기' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다음 손님' }))
  expect(next).toHaveBeenCalledTimes(1)
  first.unmount()

  const cancelled = devices('cancelled')
  const stay = vi.fn()
  const notSent = vi.fn()
  render(cancelled.world.wrap(<BuyerOrderPaper {...BASE} order={order} info={INFO} onSent={notSent} queue={{ position: 2, total: 2, last: true, next: stay }} />))
  fireEvent.click(screen.getByRole('button', { name: '문자 보내기' }))
  await waitFor(() => expect(cancelled.compose).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByRole('button', { name: '문자 보내기' }).getAttribute('aria-busy')).not.toBe('true'))
  expect(notSent).not.toHaveBeenCalled()
  expect(stay).not.toHaveBeenCalled()
  // 마지막 손님이면 건너뛰기가 마치기다
  expect(screen.getByRole('button', { name: '건너뛰고 마치기' })).toBeTruthy()
})
