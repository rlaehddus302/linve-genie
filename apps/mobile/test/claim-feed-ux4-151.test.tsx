// 찜 기록 찾기 칸·도구 줄 따로 쓰기·시각·끝난 라이브에서 누르기 (D-UX4-151~154, 사용자 지시 2026-11-16).
// - 152 찾기 칸 하나에서 번호 또는 닉네임. 지우기 x는 상품 탭 번호 검색칸과 같은 SearchField. 도구 줄(ClaimFeedToolbar)은 따로 그릴 수 있고
//   ClaimFeed는 toolbar={false}면 목록만, query·sort를 주면 그 값으로 그린다(방송 화면이 위에 붙는 머리로 옮길 때).
// - 154 손님 줄 이름 아래 가장 최근 찜 시각(초까지), 끝난·봉인한 라이브에서도 상품이 있는 꼬리표는 눌러 [상품 보기].
// 닉네임은 지어낸 이름만 쓴다.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BuyerNames } from '../src/lib/derive.ts'
import { resetFeedView } from '../src/lib/feed-view.ts'
import { fromFull } from '../src/lib/scope-data.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { ClaimFeed, ClaimFeedToolbar, FEED_NO_MATCH } from '../src/screens/console/ClaimFeed.tsx'
import { ConsoleContext, type ConsoleApi } from '../src/screens/console/context.ts'
import { makeWorld } from './screen-support.tsx'
import { buyer, changes, claim, flush, fullView, product } from './support.ts'

// 화면 하나를 통째로 그리는 시험이라 바쁜 기계에서는 기본 5초를 넘긴다
const SLOW = 60_000

afterEach(() => resetFeedView())

const SAMPLE = {
  products: [
    product(15, { name: '핑크프릴', price: 35_000, status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2'], waitlistClaims: ['c2'] }),
    product(7, { name: '라울', price: 12_000, winners: ['u2'], winnerClaims: ['c4'] }),
  ],
  claims: [
    claim('c1', 15, 'u1', { rankTime: '2026-10-29T11:00:01.000Z' }),
    claim('c2', 15, 'u2', { status: 'WAITLISTED', seq: 11, rankTime: '2026-10-29T11:00:02.000Z' }),
    claim('c3', 88, 's1', { status: 'PENDING', origin: 'sms', productId: null, seq: 12, rankTime: '2026-10-29T11:00:03.000Z' }),
    claim('c4', 7, 'u2', { seq: 13, rankTime: '2026-10-29T11:00:09.000Z' }),
  ],
  buyers: [buyer('u1', '홍길동'), buyer('u2', 'Mint Garden'), buyer('s1', '문자찜', { kind: 'sms', phoneLast4: '0937' })],
} satisfies Parameters<typeof changes>[2]

const labels = (list: HTMLElement) => within(list).getAllByRole('listitem').map((row) => row.getAttribute('aria-label'))

/** 방송 화면 없이 찜 기록만 그릴 때의 범위 자료 */
function feedApi(patch: Partial<Pick<ConsoleApi, 'ended' | 'sealed'>> = {}): ConsoleApi {
  const data = fromFull(fullView({ products: SAMPLE.products, claims: SAMPLE.claims, buyers: SAMPLE.buyers }))
  return { b: 'b1', data, names: new BuyerNames(data.buyers, data.claims), ended: false, sealed: false, command: async (event) => ({ date: '2026-10-29', rehearsal: false, seq: 6, type: String(event.type), changed: true, effects: [] }), select: () => {}, selected: null, labelWords: new Map(), ...patch }
}

describe('방송 화면 찜 기록 찾기 (D-UX4-152)', () => {
  async function openFeed() {
    const world = makeWorld({ products: [product(15), product(7)] })
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5$/, () => ({ body: changes(5, 7, SAMPLE) }))
    await act(async () => {
      world.source().emit('change', { date: '2026-10-29', rehearsal: false, seq: 7, type: 'chat' })
      await flush()
    })
    fireEvent.click(await screen.findByRole('button', { name: '찜 기록' }))
    return within(await screen.findByRole('group', { name: '찜 기록 찾기·정렬' })).getByLabelText('찜 기록 찾기')
  }

  it('D-UX4-159 (사용자 "탭바랑 검색바 … 둘 다 같은 영역에 넣어서 스크롤 올리면 같이 보이게 해"): 상품·찜 기록의 찾기·정렬 줄은 탭 바와 같은 붙는 머리(console-tabs) 안에 있다 — 목록 안에는 없다', async () => {
    const search = await openFeed()
    const tabs = screen.getByTestId('console-tabs')
    expect(tabs.contains(search)).toBe(true)
    expect(screen.getByTestId('console-list').contains(search)).toBe(false)
    // 찾은 글은 목록에 걸린다 (상태는 방송 화면이 든다)
    fireEvent.change(search, { target: { value: '0937' } })
    expect(labels(screen.getByRole('list', { name: '찜 기록' }))).toEqual(['문자-0937 88 보류'])
    // 상품 탭으로 바꾸면 그 자리에 상품 번호 찾기·목록 순서
    fireEvent.click(screen.getByRole('button', { name: /^상품/ }))
    const toolbar = await screen.findByTestId('product-toolbar')
    expect(tabs.contains(toolbar)).toBe(true)
    expect(screen.getByTestId('console-list').contains(toolbar)).toBe(false)
    expect(within(tabs).queryByRole('group', { name: '찜 기록 찾기·정렬' })).toBeNull()
  })

  it('한 칸에서 번호·닉네임을 함께 찾는다 — 숫자는 그 번호를 찜한 손님과 닉네임 속 숫자, 글자는 닉네임 부분 일치(대소문자·띄어쓰기 무시). 맞는 찜이 없으면 알리고, 동그란 x로 한 번에 비운다', async () => {
    const search = await openFeed()
    expect(search.getAttribute('placeholder')).toBe('번호나 닉네임으로 찾기')
    // 비어 있으면 지우기 x가 없다 (상품 탭 검색칸과 같은 부품)
    expect(screen.queryByRole('button', { name: '찜 기록 찾기 지우기' })).toBeNull()
    const list = () => screen.getByRole('list', { name: '찜 기록' })
    expect(labels(list())).toHaveLength(3)

    fireEvent.change(search, { target: { value: '15' } })
    expect(labels(list())).toEqual(['홍길동 15 찜', 'Mint Garden 15 대기 1 · 이미 찜됨 · 1등 홍길동, 7 찜'])
    fireEvent.change(search, { target: { value: '0937' } })
    expect(labels(list())).toEqual(['문자-0937 88 보류'])
    fireEvent.change(search, { target: { value: 'mint garden' } })
    expect(labels(list())).toEqual(['Mint Garden 15 대기 1 · 이미 찜됨 · 1등 홍길동, 7 찜'])
    fireEvent.change(search, { target: { value: 'MINTGAR' } })
    expect(labels(list())).toHaveLength(1)

    fireEvent.change(search, { target: { value: '없는손님' } })
    expect(screen.queryByRole('list', { name: '찜 기록' })).toBeNull()
    expect(screen.getByRole('status', { name: /^찾는 찜이 없어요/ })).toBeTruthy()
    expect(screen.getByText(FEED_NO_MATCH)).toBeTruthy()
    // 도구 줄은 남아 있어 바로 고치거나 지울 수 있다
    fireEvent.click(screen.getByRole('button', { name: '찜 기록 찾기 지우기' }))
    expect((search as HTMLInputElement).value).toBe('')
    expect(labels(list())).toHaveLength(3)
  }, SLOW)

  it('손님 줄 이름 아래에 그 손님이 가장 최근에 찜한 시각이 초까지 보인다 (D-UX4-154)', async () => {
    await openFeed()
    const rows = within(screen.getByRole('list', { name: '찜 기록' })).getAllByRole('listitem')
    // 홍길동 11:00:01Z · 문자-0937 11:00:03Z · Mint Garden 가장 최근 11:00:09Z → 한국 시각
    expect(rows.map((row) => within(row).getByLabelText(/^가장 최근 찜 /).textContent)).toEqual(['20:00:01', '20:00:03', '20:00:09'])
  }, SLOW)

  it('이름순은 한글 이름이 먼저, 영문 이름은 그 뒤 (D-UX4-153)', async () => {
    await openFeed()
    fireEvent.click(screen.getByRole('button', { name: '이름순 정렬' }))
    expect(labels(screen.getByRole('list', { name: '찜 기록' })).map((label) => label?.split(' ')[0])).toEqual(['문자-0937', '홍길동', 'Mint'])
  }, SLOW)
})

describe('도구 줄을 따로 그리기 (ClaimFeedToolbar · ClaimFeed toolbar={false})', () => {
  it('ClaimFeed에 toolbar={false}와 query·sort를 주면 도구 줄 없이 그 값으로 걸러 세운 목록만 그린다', () => {
    render(<ConsoleContext.Provider value={feedApi()}><ClaimFeed toolbar={false} query="15" sort="name" /></ConsoleContext.Provider>)
    expect(screen.queryByRole('group', { name: '찜 기록 찾기·정렬' })).toBeNull()
    expect(screen.queryByLabelText('찜 기록 찾기')).toBeNull()
    expect(labels(screen.getByRole('list', { name: '찜 기록' })).map((label) => label?.split(' ')[0])).toEqual(['홍길동', 'Mint'])
  })

  it('ClaimFeedToolbar는 받은 상태를 그리고 바꾸면 알린다 — 찾기 칸·지우기 x · [최근순 | 이름순] · 글자 [크게 | 작게]', () => {
    const queries: string[] = []
    const sorts: string[] = []
    const { rerender } = render(<ClaimFeedToolbar query="" onQuery={(text) => queries.push(text)} sort="recent" onSort={(sort) => sorts.push(sort)} />)
    expect(screen.queryByRole('button', { name: '찜 기록 찾기 지우기' })).toBeNull()
    fireEvent.change(screen.getByLabelText('찜 기록 찾기'), { target: { value: '홍' } })
    expect(queries).toEqual(['홍'])
    rerender(<ClaimFeedToolbar query="홍" onQuery={(text) => queries.push(text)} sort="name" onSort={(sort) => sorts.push(sort)} />)
    expect((screen.getByLabelText('찜 기록 찾기') as HTMLInputElement).value).toBe('홍')
    expect(screen.getByRole('button', { name: '이름순 정렬' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '찜 기록 찾기 지우기' }))
    expect(queries).toEqual(['홍', ''])
    fireEvent.click(screen.getByRole('button', { name: '최근순 정렬' }))
    expect(sorts).toEqual(['recent'])
    // 단추는 한 줄 (D-UX4-01)
    const bar = screen.getByRole('group', { name: '정렬' }).parentElement as HTMLElement
    expect(getComputedStyle(bar).flexDirection).toBe('row')
    expect(within(bar).getAllByRole('button').map((button) => button.textContent)).toEqual(['최근순', '이름순', '크게', '작게'])
  })

  it('보류 찜 판(only="PENDING")은 그대로: 도구 줄 없이 보류 찜만, 누르지 않는다', () => {
    render(<ConsoleContext.Provider value={feedApi()}><ClaimFeed only="PENDING" /></ConsoleContext.Provider>)
    expect(screen.queryByRole('group', { name: '찜 기록 찾기·정렬' })).toBeNull()
    const list = screen.getByRole('list', { name: '찜 기록' })
    expect(labels(list)).toEqual(['문자-0937 88 보류'])
    expect(within(list).queryByRole('button')).toBeNull()
  })
})

describe('끝난 라이브에서 찜 누르기 (D-UX4-154 — 찜 메뉴 규칙을 따른다)', () => {
  it('끝난 라이브: 상품이 있는 꼬리표만 눌러 [상품 보기] 하나 — 상품이 없는 보류 찜은 누르지 않는다', async () => {
    const opened: string[] = []
    render(<ConsoleContext.Provider value={feedApi({ ended: true })}><ClaimFeed onOpenProduct={(key) => opened.push(key)} onEditProduct={() => {}} /></ConsoleContext.Provider>)
    const list = screen.getByRole('list', { name: '찜 기록' })
    expect(within(list).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['15 찜', '15 대기 1 · 이미 찜됨 · 1등 홍길동', '7 찜'])
    fireEvent.click(within(list).getByRole('button', { name: '15 찜' }))
    const menu = await screen.findByRole('group', { name: '찜 메뉴' })
    // 올리기·고치기·삭제는 끝난 라이브에 없다 (ClaimMenu 규칙)
    expect(within(menu).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['상품 보기'])
    fireEvent.click(within(menu).getByRole('button', { name: '상품 보기' }))
    await waitFor(() => expect(opened).toEqual(['b1/15']))
  })

  it('봉인한 라이브에 [상품 보기]를 열 길이 없으면 아무것도 누르지 않는다', () => {
    render(<ConsoleContext.Provider value={feedApi({ ended: true, sealed: true })}><ClaimFeed /></ConsoleContext.Provider>)
    expect(within(screen.getByRole('list', { name: '찜 기록' })).queryByRole('button')).toBeNull()
  })
})
