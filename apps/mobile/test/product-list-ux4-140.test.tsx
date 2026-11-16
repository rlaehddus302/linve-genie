// D-UX4-140~143 (사용자 메모 11-13 방송 뒤, 개선 계획 E2·E4): 방송 화면 상품 목록 —
// 140 매출은 맨 위 한 줄이 아니라 아래 (+) 왼쪽 캡슐 · 141 [찜 된 것만] 걸러 보기 · 142 대기가 차 대기 밖이 된 찜도 보이기(판정은 그대로) · 143 번호 검색칸 [검색] → 지우기(x).
// 손님 이름은 지어낸 이름이다.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { FullView } from '@livejjim/web/src/api/types.ts'
import { describe, expect, it } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { CLAIMED_ONLY, NO_CLAIMED_YET } from '../src/screens/console/ProductBoard.tsx'
import { OUTSIDE_DIM, OUTSIDE_NOTE, outsideBuyers, outsideTitle } from '../src/screens/console/OutsideWait.tsx'
import { fromFull } from '../src/lib/scope-data.ts'
import { fitTags } from '../src/lib/product-tags.ts'
import { makeWorld, openSearchField } from './screen-support.tsx'
import { buyer, changes, claim, flush, fullView, product } from './support.ts'

const NAMES = ['초록손', '달빛화분', '모래정원', '아침이슬', '솔잎바람', '작은숲', '돌틈새싹', '물방울집', '구름화분']
const ids = NAMES.map((_, index) => `u${String(index + 1)}`)
const soldOut = (id: string, buyerId: string, seq: number) => claim(id, 218, buyerId, { status: 'REJECTED', reason: 'SOLD_OUT', seq, confirmVersion: null })

/** 218번: 찜 9개 — 1등 1 · 대기 5(대기 인원 5) · 대기 밖 3. 15번은 1등 하나, 16번은 찜 없음 */
const VIEW: Partial<FullView> = {
  products: [
    product(15, { status: 'SOLD', winners: ['u1'], winnerClaims: ['w15'] }),
    product(16),
    product(218, { status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'], waitlist: ids.slice(1, 6), waitlistClaims: ['c2', 'c3', 'c4', 'c5', 'c6'] }),
  ],
  claims: [
    claim('w15', 15, 'u1', { seq: 5 }),
    claim('c1', 218, 'u1', { seq: 10 }),
    ...[2, 3, 4, 5, 6].map((n) => claim(`c${String(n)}`, 218, `u${String(n)}`, { status: 'WAITLISTED', seq: 10 + n })),
    soldOut('c7', 'u7', 17), soldOut('c8', 'u8', 18), soldOut('c9', 'u9', 19),
    // 이미 대기에 있는 손님의 두 번째 찜·다른 까닭으로 끝난 찜은 대기 밖이 아니다
    soldOut('c10', 'u2', 20),
    claim('c11', 218, 'u7', { status: 'REJECTED', reason: 'NOT_ON_SALE', seq: 21, confirmVersion: null }),
  ],
  buyers: NAMES.map((name, index) => buyer(`u${String(index + 1)}`, name)),
}

function worldWith(view: Partial<FullView>) {
  const world = makeWorld({ products: view.products ?? [] })
  world.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=true)?$/, () => ({ body: fullView({ seq: world.seq, ...view }) }))
  world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=(\d+)/, (call) => ({ body: changes(Number(/since=(\d+)/.exec(call.path)?.[1] ?? 5), world.seq, {}) }))
  return world
}
async function open(world: ReturnType<typeof makeWorld>) {
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
}
const rowLabels = () => within(screen.getByRole('list', { name: '상품 목록' })).getAllByRole('button').map((row) => row.getAttribute('aria-label'))
const typePad = (digits: string) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of digits) fireEvent.click(within(pad).getByRole('button', { name: key }))
}

describe('매출 캡슐 (D-UX4-140)', () => {
  it('매출은 탭 바 위 한 줄이 아니라 상품 탭 아래 (+) 왼쪽 캡슐이고, 누르면 정산 내역서가 열린다', async () => {
    await open(worldWith(VIEW))
    const scroll = screen.getByTestId('console-scroll')
    // 옛 자리(탭 바 위 알림 줄 오른쪽)에는 없다
    expect(within(scroll).queryByText(/현재 매출/)).toBeNull()
    const pill = screen.getByTestId('sales-pill')
    // 1등 찜 두 개(15번·218번 각 10,000원)
    expect(pill.getAttribute('aria-label')).toBe('현재 매출 20,000원')
    expect(pill.textContent).toBe('현재 매출 20,000원 ›')
    const fab = screen.getByRole('button', { name: '상품 추가' })
    // (+) 단추보다 왼쪽(오른쪽 끝에서 더 멀다), 같은 바닥 높이 묶음
    expect(parseFloat(getComputedStyle(pill).right)).toBeGreaterThan(parseFloat(getComputedStyle(fab).right))
    expect(getComputedStyle(pill).position).toBe('absolute')
    fireEvent.click(pill)
    // 옛 기대: 제목 "정산 내역서". 새 기대(D-UX4-170, 사용자 지시 2026-11-16 "화면 제목 \"정산서\"로 바꿔"): "정산서"
    expect(await screen.findByText('정산서')).toBeTruthy()
  })

  it('숫자판을 연 동안·다른 탭에서는 (+)처럼 캡슐도 숨는다', async () => {
    await open(worldWith(VIEW))
    // D-UX4-201: 찾기 칸은 머리 돋보기를 눌러 연다(옛: 늘 보임)
    fireEvent.focus(openSearchField('상품 번호 검색'))
    expect(screen.queryByTestId('sales-pill')).toBeNull()
    fireEvent.pointerUp(screen.getByRole('list', { name: '상품 목록' }))
    expect(screen.getByTestId('sales-pill')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '찜 기록' }))
    expect(screen.queryByTestId('sales-pill')).toBeNull()
  })
})

describe('찜 된 것만 (D-UX4-141)', () => {
  it('켜면 찜이 하나라도 있는 상품만, 끄면 모두 — 번호 검색과 함께 걸러진다', async () => {
    await open(worldWith(VIEW))
    expect(rowLabels()).toHaveLength(3)
    const toggle = screen.getByRole('switch', { name: CLAIMED_ONLY })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByRole('switch', { name: CLAIMED_ONLY }).getAttribute('aria-checked')).toBe('true')
    expect(rowLabels()).toEqual(['상품 자세히 — 218번', '상품 자세히 — 15번'])
    // D-UX4-201: 찾기 칸은 머리 돋보기를 눌러 연다(옛: 늘 보임)
    fireEvent.focus(openSearchField('상품 번호 검색'))
    typePad('1')
    expect(rowLabels()).toEqual(['상품 자세히 — 15번'])
    fireEvent.click(screen.getByRole('button', { name: '상품 번호 검색 지우기' }))
    fireEvent.click(screen.getByRole('switch', { name: CLAIMED_ONLY }))
    expect(rowLabels()).toHaveLength(3)
  })

  it('찜 된 상품이 없으면 "찜 된 상품이 아직 없어요"', async () => {
    await open(worldWith({ products: [product(16), product(17)], claims: [], buyers: [] }))
    fireEvent.click(screen.getByRole('switch', { name: CLAIMED_ONLY }))
    expect(screen.getByText(NO_CLAIMED_YET)).toBeTruthy()
    expect(screen.queryByRole('list', { name: '상품 목록' })).toBeNull()
  })
})

describe('대기 밖 찜 (D-UX4-142, 218번 찜 9개인데 6개만 보임)', () => {
  it('대기가 차 품절로 끝난 찜의 손님만, 찜이 온 순서대로 — 이미 1등·대기인 손님·다른 까닭은 뺀다', () => {
    const data = fromFull(fullView(VIEW))
    expect(outsideBuyers(data, data.products.get('b1/218')!)).toEqual(['u7', 'u8', 'u9'])
    expect(outsideBuyers(data, data.products.get('b1/15')!)).toEqual([])
  })

  it('상품 줄에 9명이 모두 보이고, 대기 밖 3명은 흐린 꼬리표다', async () => {
    await open(worldWith(VIEW))
    const tags = within(screen.getByRole('list', { name: '218번 찜한 손님' })).getAllByRole('listitem')
    expect(tags.map((tag) => tag.textContent)).toEqual(NAMES)
    const outside = tags.filter((tag) => tag.getAttribute('aria-label')?.endsWith('대기 밖'))
    expect(outside.map((tag) => tag.textContent)).toEqual(['돌틈새싹', '물방울집', '구름화분'])
    // D-UX4-206로 바뀐 기대 (사용자 "찜 들어오면 예전처럼 닉네임에 금색 배경이나 회색 배경 넣어" — 꼬리표로 되돌림; D-UX4-201은 회색 글 한 줄이었다): 대기 밖은 흐린(투명도) 꼬리표
    for (const tag of outside) expect(getComputedStyle(tag).opacity).toBe(String(OUTSIDE_DIM))
    expect(['', '1']).toContain(getComputedStyle(tags[1]!).opacity)
  })

  it('상품 자세히: 1등·대기 알약은 그대로 6개, "대기 밖 3명 ›"을 누르면 흐린 이름 3개가 펼쳐진다 — 판정 요청은 보내지 않는다', async () => {
    const world = worldWith(VIEW)
    const writes: unknown[] = []
    world.server.on('POST', /^\/api\/events/, (call) => {
      writes.push(call.body)
      return { body: { seq: world.seq } }
    })
    await open(world)
    fireEvent.click(screen.getByRole('button', { name: '상품 자세히 — 218번' }))
    const detail = await screen.findByRole('group', { name: '상품 자세히' })
    expect(within(within(detail).getByRole('list', { name: '218번 찜·대기' })).getAllByRole('button')).toHaveLength(6)
    const more = within(detail).getByRole('button', { name: outsideTitle(3) })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.textContent).toBe('대기 밖 3명 ›')
    expect(within(detail).queryByText(OUTSIDE_NOTE)).toBeNull()
    fireEvent.click(more)
    expect(within(detail).getByText(OUTSIDE_NOTE)).toBeTruthy()
    const list = within(detail).getByRole('list', { name: '218번 대기 밖 3명' })
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['돌틈새싹', '물방울집', '구름화분'])
    // 흐린 이름은 누를 수 없다(이미 끝난 찜)
    expect(within(list).queryAllByRole('button')).toHaveLength(0)
    expect(Number(getComputedStyle(list).opacity)).toBeLessThan(1)
    fireEvent.click(within(detail).getByRole('button', { name: outsideTitle(3) }))
    expect(within(detail).queryByRole('list', { name: '218번 대기 밖 3명' })).toBeNull()
    expect(writes).toEqual([])
  })

  it('대기 밖 찜이 없는 상품 자세히에는 그 줄이 없다', async () => {
    await open(worldWith(VIEW))
    fireEvent.click(screen.getByRole('button', { name: '상품 자세히 — 15번' }))
    const detail = await screen.findByRole('group', { name: '상품 자세히' })
    expect(within(detail).queryByRole('button', { name: /대기 밖/ })).toBeNull()
  })
})

// D-UX4-206 (사용자 "찜 들어오면 예전처럼 닉네임에 금색 배경이나 회색 배경 넣어. 줄 넘어가지 않게 +2 이런 식으로 표시하고"):
// 1등은 금색 캡슐, 대기는 회색 캡슐 — 한 줄만(넘치는 손님은 [+N], 어림이 틀려도 줄바꿈 없이 캡슐 글이 줄어든다)
describe('상품 줄 손님 캡슐 (D-UX4-206)', () => {
  it('1등 금색 · 대기 회색 캡슐, 줄을 넘기지 않는 한 줄', async () => {
    await open(worldWith(VIEW))
    const list = screen.getByRole('list', { name: '218번 찜한 손님' })
    const tags = within(list).getAllByRole('listitem')
    expect(getComputedStyle(tags[0]!).backgroundColor).toBe('rgb(248, 227, 163)')
    const waiting = tags.find((tag) => !(tag.getAttribute('aria-label') ?? '').endsWith('대기 밖') && getComputedStyle(tag).backgroundColor !== 'rgb(248, 227, 163)')
    expect(waiting === undefined ? '' : getComputedStyle(waiting).backgroundColor).toBe('rgb(229, 232, 235)')
    expect(getComputedStyle(list).flexWrap).toBe('nowrap')
    expect([getComputedStyle(list).overflowX, getComputedStyle(list).overflowY]).toEqual(['hidden', 'hidden'])
  })

  it('한 줄에 다 안 들어가면 들어가는 만큼만 놓고 [+N]', () => {
    const tags = Array.from({ length: 9 }, (_, index) => ({ kind: index < 1 ? 'win' as const : 'wait' as const, text: `손님이름${String(index)}` }))
    const fit = fitTags(tags, 200, 14)
    expect(fit.shown.length).toBeGreaterThan(0)
    expect(fit.shown.length + fit.more).toBe(9)
    expect(fit.more).toBeGreaterThan(0)
  })
})

// D-UX4-207 (사용자 "상품 목록에서 아직 찜이 없어요 뜰 때랑 찜 들어올 때랑 높이가 다르다"): 품종 아랫줄은 찜 없음 글이든 손님 캡슐이든 같은 높이 칸
describe('상품 줄 아랫줄 높이 (D-UX4-207)', () => {
  it('"아직 찜이 없어요" 칸과 손님 캡슐 칸이 같은 최소 높이·같은 위아래 여백', async () => {
    await open(worldWith(VIEW))
    const empty = screen.getAllByTestId('product-row-empty')[0]!.parentElement!
    const buyers = screen.getByRole('list', { name: '218번 찜한 손님' })
    for (const key of ['minHeight', 'marginTop', 'marginBottom'] as const) expect(getComputedStyle(empty)[key], key).toBe(getComputedStyle(buyers)[key])
    expect(getComputedStyle(buyers).minHeight).toBe('24px')
  })
})
