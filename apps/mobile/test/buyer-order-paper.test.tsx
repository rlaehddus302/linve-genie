import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import Svg from 'react-native-svg'
import { broadcastSales, shippingFor } from '../src/lib/broadcast-sales.ts'
import { nativeSms, setNativeModules } from '../src/native/index.ts'
import { BuyerOrderPaper } from '../src/screens/console/BuyerOrderPaper.tsx'
import { makeWorld } from './screen-support.tsx'
import { claim, product } from './support.ts'

const item = product(15, { name: '5개' })
const sold = claim('1', 15, 'A', { qty: 2, amount: 40000 })
const order = broadcastSales(new Map([[sold.id, sold]]), new Map([[item.key, item]]), 'b1').orders[0]!

it('세트는 낱개 수량을 세고 세트 판매가는 한 번씩만 합산한다. 5만원부터 무료 배송이다', () => {
  expect(order).toMatchObject({ subtotal: 40000, qty: 10, lines: [{ name: '5개 세트', qty: 10, amount: 40000 }] })
  expect([49999,50000,50001].map(shippingFor)).toEqual([5000,0,0])
})

it('구매자 주문서와 문자 사진에 방송별 주문과 배송비 포함 금액을 표시한다', async () => {
  const world = makeWorld()
  world.server.on('POST', /receipt-sms\/prepare$/, () => ({ body: { sms: { phone: '01000000000', text: '다른 방송이 합쳐진 날짜별 금액' } } }))
  const compose = vi.fn(async () => 'cancelled' as const)
  const previous = nativeSms()
  setNativeModules({ sms: { available: async () => true, compose } })
  const snapshot = vi.spyOn(Svg.prototype, 'toDataURL').mockImplementation(cb => cb('iVBORw0KGgo='))
  try {
    render(world.wrap(<BuyerOrderPaper {...{ order, shop: '용용다육', date: '2026-11-12', buyerName: '가을여행', inset: 0, sealed: false, rehearsal: false }} />))
    for (const text of ['용용다육','2026-11-12','5개 세트','10','5,000원','45,000원']) expect(screen.getByText(text)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '주문서 문자 보내기' }))
    await waitFor(() => expect(compose).toHaveBeenCalledWith('01000000000', '[용용다육] 2026-11-12 가을여행님 주문서\n배송비 포함 45,000원', expect.objectContaining({ mimeType: 'image/png', bytes: new Uint8Array([137,80,78,71,13,10,26,10]) })))
  } finally { snapshot.mockRestore(); setNativeModules({ sms: previous }) }
})
