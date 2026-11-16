// 정산서 화면 손질 3 (D-UX4-181·182·184, 사용자 지시 2026-11-16):
// - 181 "보내기 버튼은 사진 1 처럼 만들고, 총계는 총액으로 이름 바꿔"
// - 182 "상품명 · 개수 이렇게 한줄로 하고 그 아래에 닉네임을 라이브 화면처럼 금색 캡슐로 감싸 / 구매자별 정산서에서도 닉네임을 … 버튼 모양으로 감싸고, 개수는 … 금액 왼쪽에"
// - 184 "정산 정보를 알려주세요 화면을 따로 만들어서 뒤로가기 스와이프 동작하게 만들어. 지금은 아래팝업처럼 밑에서 올라오고 있다"
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { STATEMENT_SHIPPING_DEFAULT, type StatementInfo } from '../src/lib/broadcast-sales.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { LATER_LABEL } from '../src/screens/StatementInfo.tsx'
import { StatementFooter, TOTAL_WORD } from '../src/screens/console/StatementControls.tsx'
import { StatementList } from '../src/screens/console/StatementList.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST, BROADCAST_VIEW, buyer, claim, fullView, product } from './support.ts'

const EMPTY: StatementInfo = { bank: '', accountNumber: '', accountHolder: '', phone: '', hostName: '', shipping: STATEMENT_SHIPPING_DEFAULT, decided: false }
const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

// 옛 기대(D-UX4-181): [보내기] 안에 둥근 세모 종이비행기. 새 기대(D-UX4-185, 사용자 "그냥 아이콘 빼라"): 아이콘 없이 글자만
it('[보내기]는 아이콘 없이 글자만, 왼쪽 글은 "총액" (D-UX4-181·185)', () => {
  const world = makeWorld()
  render(world.wrap(<StatementFooter total={30000} qty={2} buyers={1} bottom={12} onSend={() => {}} />))
  expect(TOTAL_WORD).toBe('총액')
  expect(screen.getByTestId('statement-total').textContent).toContain('총액')
  expect(screen.getByTestId('statement-total').textContent).not.toContain('총계')
  const button = screen.getByTestId('statement-send-button')
  expect(button.querySelector('svg')).toBeNull()
  expect(button.textContent).toBe('보내기')
})

it('상품별 줄: "상품명 · n개" 한 줄, 그 아래 산 구매자마다 금색 캡슐 (D-UX4-182)', () => {
  const world = makeWorld()
  const buyers = new Map([['k1', ['가람', '<나무>']]])
  render(world.wrap(<StatementList tab="products" rows={[{ key: 'k1', no: 7, label: '색금', money: 40000, qty: 3 }]} sent={[]} buyers={buyers} rowLabel={row => row.label} />))
  // 이름과 개수가 한 글 줄 (옛: 이름 줄 아래에 개수 줄)
  expect(screen.getByText((_, node) => node?.tagName !== undefined && node.textContent === '색금 · 3개' && node.parentElement?.textContent !== '색금 · 3개')).toBeTruthy()
  const tags = within(screen.getByTestId('product-buyers')).getAllByRole('listitem')
  expect(tags.map(tag => tag.textContent)).toEqual(['가람', '<나무>'])
  // 라이브 화면 찜 꼬리표와 같은 금색
  for (const tag of tags) expect(getComputedStyle(tag).backgroundColor).toBe(rgb(PALETTE.light.goldBg))
})

it('구매자별 줄: 닉네임은 회색 둥근 네모(단추 모양), 개수는 금액 왼쪽 같은 줄 (D-UX4-182)', () => {
  const world = makeWorld()
  render(world.wrap(<StatementList tab="buyers" rows={[{ key: 'u1', no: null, label: '가람', money: 30000, qty: 2 }]} sent={['u1']} rowLabel={row => `${row.label} 정산서`} onRow={() => {}} />))
  const row = screen.getByRole('button', { name: '가람 정산서' })
  const name = within(row).getByTestId('buyer-name')
  expect(name.textContent).toBe('가람')
  expect(getComputedStyle(name).backgroundColor).toBe(rgb(PALETTE.light.surfaceAlt))
  // 캡슐(pill)이 아니라 단추 같은 둥근 네모
  expect(getComputedStyle(name).borderTopLeftRadius).not.toBe('999px')
  const qty = within(row).getByTestId('buyer-qty')
  expect(qty.textContent).toBe('2개')
  // 개수는 줄의 바로 아래 칸(금액과 같은 줄)이고 금액보다 앞(왼쪽)
  expect(qty.parentElement).toBe(row)
  const money = within(row).getByText('30,000원')
  expect(qty.compareDocumentPosition(money) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(row).getByText('보냄')).toBeTruthy()
})

it('정산 정보는 아래 판이 아니라 머리까지 덮는 다음 화면 — 뒤로(밀기와 같은 닫기)는 [나중에]와 같다 (D-UX4-184)', async () => {
  const world = makeWorld()
  const names = ['가을여행']
  world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, date: '2026-11-12', ended: true, endedAt: '2026-11-12T12:00:00.000Z' }] } }))
  world.server.on('GET', /^\/api\/days\/2026-11-12$/, () => ({ body: fullView({ date: '2026-11-12', broadcasts: [{ ...BROADCAST_VIEW, date: '2026-11-12', ended: true, endedAt: '2026-11-12T12:00:00.000Z' }], products: [product(201, { name: '색금', price: 30000 })], claims: [claim('0', 201, '가을여행', { amount: 30000 })], buyers: names.map(name => buyer(name, name)) }) }))
  world.server.on('GET', /order-shop$/, () => ({ body: { name: '용용다육' } }))
  world.server.on('GET', /^\/api\/statement-info$/, () => ({ body: { info: EMPTY } }))
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={() => {}} />))
  const page = await screen.findByRole('dialog', { name: '정산 정보' })
  // 판(Modal)이 아니라 정산서 화면 안에 겹쳐 그린 화면: 머리("정산서" 제목)와 같은 틀 안, 위를 0부터 덮는다
  expect(page.parentElement?.contains(screen.getByRole('heading', { name: '정산서' }))).toBe(true)
  expect(getComputedStyle(page).position).toBe('absolute')
  expect(getComputedStyle(page).top).toBe('0px')
  expect(within(page).getByRole('button', { name: LATER_LABEL })).toBeTruthy()
  // 머리 뒤로 단추 = 밀어 닫기와 같은 닫기
  fireEvent.click(within(page).getByRole('button', { name: '뒤로' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '정산 정보' })).toBeNull())
  expect(screen.getByRole('list', { name: '구매자별 정산' })).toBeTruthy()
})
