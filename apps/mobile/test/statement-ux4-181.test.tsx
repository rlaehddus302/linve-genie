// 정산서 화면 손질 3 (D-UX4-181·182·184, 사용자 지시 2026-11-16):
// - 181 "보내기 버튼은 사진 1 처럼 만들고, 총계는 총액으로 이름 바꿔"
// - 182 "상품명 · 개수 이렇게 한줄로 하고 그 아래에 닉네임을 라이브 화면처럼 금색 캡슐로 감싸 / 구매자별 정산서에서도 닉네임을 … 버튼 모양으로 감싸고, 개수는 … 금액 왼쪽에"
// - 184 "정산 정보를 알려주세요 화면을 따로 만들어서 뒤로가기 스와이프 동작하게 만들어. 지금은 아래팝업처럼 밑에서 올라오고 있다"
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { STATEMENT_SHIPPING_DEFAULT, type StatementInfo } from '../src/lib/broadcast-sales.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { LATER_LABEL } from '../src/screens/StatementInfo.tsx'
import { FOOTER_SIDE, StatementFooter, TOTAL_WORD } from '../src/screens/console/StatementControls.tsx'
import { StatementList } from '../src/screens/console/StatementList.tsx'
import { slideUnder, UNDER_DIM, UNDER_SHIFT } from '../src/screens/console/parts.tsx'
import { Animated } from 'react-native'
import { GUTTER, PALETTE } from '../src/ui/kit/tokens.ts'
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

// 닉네임 바탕 옛 기대(D-UX4-182): 회색 surfaceAlt. 새 기대(D-UX4-189, 사용자 "구매자별 정산서 목록에서 구매자 닉네임 배경 금색으로 해줘"): 금색
it('구매자별 줄: 닉네임은 금색 둥근 네모(단추 모양), 개수는 금액 왼쪽 같은 줄 (D-UX4-182·189)', () => {
  const world = makeWorld()
  render(world.wrap(<StatementList tab="buyers" rows={[{ key: 'u1', no: null, label: '가람', money: 30000, qty: 2 }]} sent={['u1']} rowLabel={row => `${row.label} 정산서`} onRow={() => {}} />))
  const row = screen.getByRole('button', { name: '가람 정산서' })
  const name = within(row).getByTestId('buyer-name')
  expect(name.textContent).toBe('가람')
  expect(getComputedStyle(name).backgroundColor).toBe(rgb(PALETTE.light.goldBg))
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

// D-UX4-194 (사용자 2026-11-16 화면 사진 두 장 "이거 화면 왜이러냐. 고쳐라"): 구매자 정산서가 목록 칸 안에만 떠서
// 바깥 머리(‹ 정산서 · 라이브 기록)가 그대로 남아 ‹가 두 개 보였다 — 정산 정보 화면처럼 머리까지 맨 위 0부터 덮는다
it('구매자 정산서는 바깥 머리까지 덮는다 — 목록 칸 안이 아니라 머리와 같은 틀에 겹친다 (D-UX4-194)', async () => {
  const world = makeWorld()
  world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, date: '2026-11-12', ended: true, endedAt: '2026-11-12T12:00:00.000Z' }] } }))
  world.server.on('GET', /^\/api\/days\/2026-11-12$/, () => ({ body: fullView({ date: '2026-11-12', broadcasts: [{ ...BROADCAST_VIEW, date: '2026-11-12', ended: true, endedAt: '2026-11-12T12:00:00.000Z' }], products: [product(201, { name: '색금', price: 30000 })], claims: [claim('0', 201, '가을여행', { amount: 30000 })], buyers: [buyer('가을여행', '가을여행')] }) }))
  world.server.on('GET', /order-shop$/, () => ({ body: { name: '용용다육' } }))
  world.server.on('GET', /^\/api\/statement-info$/, () => ({ body: { info: { ...EMPTY, bank: '농협', accountNumber: '302-0000-0000-00', accountHolder: '김판매', phone: '010-0000-0000', decided: true } } }))
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  fireEvent.click(await screen.findByRole('button', { name: /^가을여행 정산서/ }))
  const page = await screen.findByRole('dialog', { name: '가을여행 님 정산서' })
  const head = screen.getByRole('heading', { name: '정산서' })
  // 머리와 한 틀(머리의 형제 줄): 목록 칸 안에 들어 있지 않다
  expect(page.parentElement?.contains(head)).toBe(true)
  expect(screen.getByTestId('statement-scroll').parentElement?.contains(page)).toBe(false)
  expect(getComputedStyle(page).position).toBe('absolute')
  expect(getComputedStyle(page).top).toBe('0px')
})

// D-UX4-195 (사용자 2026-11-16 "화면 아직도 이상하다. 사진1이 현재. 사진2처럼 만들어야 하는데." — 사진2는 정산서에서 홈으로 밀어 돌아가는 아이폰 화면 전환):
// 정산서만 혼자 움직이지 않고, 아래 머리·목록이 왼쪽으로 조금 밀리고 어둡게 덮이며, 정산서 왼쪽에 그림자
it('구매자 정산서가 열리면 아래 화면은 왼쪽으로 조금 밀리고 어둡게 덮인다 — 닫히면 제자리 (D-UX4-195)', async () => {
  const world = makeWorld()
  world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, date: '2026-11-12', ended: true, endedAt: '2026-11-12T12:00:00.000Z' }] } }))
  world.server.on('GET', /^\/api\/days\/2026-11-12$/, () => ({ body: fullView({ date: '2026-11-12', broadcasts: [{ ...BROADCAST_VIEW, date: '2026-11-12', ended: true, endedAt: '2026-11-12T12:00:00.000Z' }], products: [product(201, { name: '색금', price: 30000 })], claims: [claim('0', 201, '가을여행', { amount: 30000 })], buyers: [buyer('가을여행', '가을여행')] }) }))
  world.server.on('GET', /order-shop$/, () => ({ body: { name: '용용다육' } }))
  world.server.on('GET', /^\/api\/statement-info$/, () => ({ body: { info: { ...EMPTY, bank: '농협', accountNumber: '302-0000-0000-00', accountHolder: '김판매', phone: '010-0000-0000', decided: true } } }))
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  fireEvent.click(await screen.findByRole('button', { name: /^가을여행 정산서/ }))
  await screen.findByRole('dialog', { name: '가을여행 님 정산서' })
  const under = screen.getByTestId('buyer-page-under')
  // 머리("정산서")와 목록이 함께 밀린다
  expect(under.contains(screen.getByRole('heading', { name: '정산서' }))).toBe(true)
  expect(under.contains(screen.getByTestId('statement-scroll'))).toBe(true)
  // 아래를 덮는 검은 막과 정산서 왼쪽 그림자
  expect(screen.getByTestId('buyer-page-dim')).toBeTruthy()
  expect(getComputedStyle(screen.getByTestId('buyer-page')).boxShadow).not.toBe('')
  fireEvent.click(within(screen.getByRole('dialog', { name: '가을여행 님 정산서' })).getByRole('button', { name: '뒤로' }))
  await waitFor(() => expect(screen.queryByTestId('buyer-page-dim')).toBeNull())
  // 움직임 값은 시험 화면(웹)에 그려지지 않는다 — 밀리는 몫은 계산으로: 다 열리면 너비의 0.3만큼 왼쪽, 닫히면 제자리 · 막은 0 → 0.12
  const at = (value: number) => (slideUnder(new Animated.Value(value), 400).transform[0]!.translateX as unknown as { __getValue: () => number }).__getValue()
  expect(at(1)).toBeCloseTo(-400 * UNDER_SHIFT)
  expect(at(0)).toBeCloseTo(0)
  expect(UNDER_SHIFT).toBe(0.3)
  expect(UNDER_DIM).toBe(0.12)
})

// D-UX4-186 (사용자 2026-11-16 "정산서 상품별에서 닉네임도 개수 옆에 붙여서 한줄로 만들어 …")
// 글자 크기 옛 기대(186): 번호·품종·개수·닉네임·가격 모두 16. 새 기대(D-UX4-188, 사용자 "텍스트 크기 맞추니까 가독성 별로다. 가독성 좋게 다시 맞춰"):
// 품종·가격 16 굵게, 번호·개수·닉네임 14 — 한 줄 칸은 그대로
it('상품별 줄: 번호 · (품종 · 개수, 그 아래 닉네임 캡슐) · 가격 — 번호·가격은 한 줄 가운데, 품종·가격은 크게·번호·개수·닉네임은 한 단계 작게 (D-UX4-188·191·196)', () => {
  const world = makeWorld()
  const buyers = new Map([['k1', ['가람', '나무']]])
  render(world.wrap(<StatementList tab="products" rows={[{ key: 'k1', no: 7, label: '색금', money: 40000, qty: 3 }]} sent={[]} buyers={buyers} rowLabel={row => row.label} />))
  const tags = screen.getByTestId('product-buyers')
  // 품종 글 (첫 자식이 글자 "색금"인 글 칸)
  const name = screen.getByText((_, node) => node?.textContent === '색금 · 3개' && node.firstChild?.nodeType === Node.TEXT_NODE)
  // 닉네임 자리 옛 기대(D-UX4-186): 품종·개수와 같은 가로 칸. 새 기대(D-UX4-191, 사용자 "닉네임 길면 아래로 밀리는 경우가 있어서, 그냥 닉네임은 아래로 내리자"): 아랫줄.
  // 옛 기대(D-UX4-191): 첫 줄(번호 · 품종 · 개수 · 가격) 아래 줄이 번호 밑부터. 새 기대(D-UX4-196, 사용자 "번호, 금액은 2줄로 만들지 마. 닉네임은 상품명 아래에 배치해."):
  // 가로 줄 하나에 번호 · 가운데 세로 칸 · 가격 — 캡슐은 가운데 칸에서 품종 바로 아래, 번호·가격은 줄 가운데
  const main = screen.getByTestId('product-main')
  expect(getComputedStyle(main).flexDirection).toBe('column')
  expect(main.firstElementChild).toBe(name)
  expect(tags.parentElement).toBe(main)
  const line = main.parentElement!
  expect(getComputedStyle(line).flexDirection).toBe('row')
  expect(getComputedStyle(line).alignItems).toBe('center')
  const no = screen.getByTestId('product-no')
  expect(no.parentElement).toBe(line)
  const money = screen.getByText('40,000원')
  expect(line.contains(money)).toBe(true)
  expect(main.contains(money)).toBe(false)
  expect(main.contains(no)).toBe(false)
  const size = (node: Element) => getComputedStyle(node).fontSize
  expect([size(name), size(screen.getByText('40,000원'))]).toEqual(['16px', '16px'])
  const qty = screen.getByText('· 3개')
  // 품종은 개수보다 굵다
  expect(Number(getComputedStyle(name).fontWeight)).toBeGreaterThan(Number(getComputedStyle(qty).fontWeight))
  expect([size(screen.getByText('7번')), size(qty), ...within(tags).getAllByText(/가람|나무/).map(size)]).toEqual(['14px', '14px', '14px', '14px'])
})

// D-UX4-190 (사용자 2026-11-16 "맨 아래 총액, 보내기 있는 영역 너비를 조금 줄여줘"): 옛 기대 양옆 GUTTER → 양쪽 12씩 더 안쪽
it('아래 고정 판은 화면 여백보다 양쪽 12씩 더 안쪽 (D-UX4-190)', () => {
  const world = makeWorld()
  render(world.wrap(<StatementFooter total={30000} qty={2} buyers={1} bottom={12} onSend={() => {}} />))
  const footer = screen.getByTestId('statement-footer')
  expect(FOOTER_SIDE).toBe(GUTTER + 12)
  expect([getComputedStyle(footer).left, getComputedStyle(footer).right]).toEqual([`${FOOTER_SIDE}px`, `${FOOTER_SIDE}px`])
})
