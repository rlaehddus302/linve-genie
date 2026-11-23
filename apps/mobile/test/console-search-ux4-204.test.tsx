// D-UX4-204 (사용자 지시 2026-11-16 토스 검색 화면 사진 "그리고 검색 눌렀을 때 별도 화면으로 넘어가서 사진4처럼 넘어가."):
// 기기에서는 라이브 화면 머리 돋보기가 따로 쌓인 찾기 화면(/console/<방송>/search)을 연다. 그 화면은 ‹ · 가운데 제목 · 회색 찾기 칸 · 결과.
// D-UX4-205로 바뀐 기대 (사용자 "검색은 상품 검색이든 찜 검색이든 하나로 통합해서 다 보여주면 돼. 번호, 품종, 닉네임으로 검색되게 하면 되겠지."):
// 옛(D-UX4-204 첫 모양): 상품 찾기(앱 숫자판)와 찜 기록 찾기(키보드)가 따로였다. 이제 한 칸(휴대폰 키보드)에서 번호·품종·닉네임으로 상품과 찜 기록을 함께 찾는다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { ConsoleSearchScreen, KEYS_TO_DIGITS, KEYS_TO_TEXT, RECENT_CLEAR, RECENT_TITLE, SEARCH_EMPTY, SEARCH_LABEL, SEARCH_NO_MATCH, SEARCH_PAGE_NAME } from '../src/screens/console/ConsoleSearch.tsx'
import { addRecentSearch, getRecentSearches, parseRecentSearches, resetRecentSearches, RECENT_SEARCHES_KEY, RECENT_SEARCHES_MAX, wireRecentSearches, withRecentSearch } from '../src/lib/recent-searches.ts'
import { feedRowMatches, productMatches } from '../src/screens/console/console-search.ts'
import { useConsoleSignals, type ConsoleSignal } from '../src/screens/console/scope.tsx'
import { makeWorld } from './screen-support.tsx'
import { buyer, claim, fullView, product } from './support.ts'

afterEach(() => resetRecentSearches())

function Listen({ onSignal }: { readonly onSignal: (signal: ConsoleSignal) => void }) {
  useConsoleSignals('b1', onSignal)
  return null
}

const PRODUCTS = [product(12, { name: '창금', winners: ['가을여행'] }), product(123, { name: '퍼플하트' }), product(31, { name: '색금', winners: ['겨울바다'] })]

function searchWorld() {
  const world = makeWorld({ products: PRODUCTS })
  world.server.on('GET', /^\/api\/days\/2026-10-29$/, () => ({ body: fullView({ seq: world.seq, products: PRODUCTS, claims: [claim('0', 12, '가을여행'), claim('1', 31, '겨울바다')], buyers: [buyer('가을여행', '가을여행'), buyer('겨울바다', '겨울바다')] }) }))
  return world
}

async function openPage(world: ReturnType<typeof makeWorld>, onBack: () => void = () => {}) {
  const signals: ConsoleSignal[] = []
  render(world.wrap(<><Listen onSignal={(signal) => signals.push(signal)} /><ConsoleSearchScreen broadcastId="b1" onBack={onBack} /></>))
  // 범위 자료를 받기 전에도 같은 이름의 화면(불러오는 중)이 있다 — 찾기 칸이 나온 뒤의 화면을 본다
  const field = await screen.findByLabelText(SEARCH_LABEL)
  const page = within(screen.getByRole('main', { name: SEARCH_PAGE_NAME }))
  return { page, signals, type: (text: string) => fireEvent.change(field, { target: { value: text } }) }
}

type Page = Awaited<ReturnType<typeof openPage>>['page']
const productButtons = (page: Page) => page.queryAllByRole('button', { name: /^상품 자세히 — / }).map((node) => node.getAttribute('aria-label'))
const feedText = (page: Page) => page.getByRole('list', { name: '찜 기록' }).textContent

describe('하나로 찾기 조건 (D-UX4-205)', () => {
  const nameOf = (id: string) => id
  const nos = (query: string) => PRODUCTS.filter((item) => productMatches(item, query, nameOf)).map((item) => item.no)
  it('상품: 번호 앞부분 · 품종 · 찜한 닉네임, 빈 글은 아무것도 아니다', () => {
    expect(nos('12')).toEqual([12, 123])
    expect(nos(' 금')).toEqual([12, 31])
    expect(nos('겨울')).toEqual([31])
    expect(nos('')).toEqual([])
  })
  it('찜 기록 줄: 닉네임 · 찜한 번호 · 찜한 상품의 품종', () => {
    const row = { buyer: '가을여행', nos: [{ no: 12 }] } as unknown as Parameters<typeof feedRowMatches>[0]
    const names = (no: number) => (no === 12 ? '창금' : '')
    expect(feedRowMatches(row, '가을', names)).toBe(true)
    expect(feedRowMatches(row, '12', names)).toBe(true)
    expect(feedRowMatches(row, '창금', names)).toBe(true)
    expect(feedRowMatches(row, '퍼플', names)).toBe(false)
    expect(feedRowMatches(row, ' ', names)).toBe(false)
  })
})

describe('찾기 화면 (D-UX4-204·205)', () => {
  it('경로가 있으면 머리 돋보기는 찾기 화면을 연다 — 라이브 화면 안에 찾기 칸·숫자판을 그리지 않는다', async () => {
    const world = makeWorld({ products: [product(12), product(31)] })
    const openSearch = vi.fn()
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} openSearch={openSearch} />))
    fireEvent.click(await screen.findByRole('button', { name: '검색 열기' }))
    expect(openSearch).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('상품 번호 검색')).toBeNull()
    expect(screen.queryByRole('group', { name: '숫자판' })).toBeNull()
  })

  it('돋보기는 상품·찜 탭이 아닌 탭(채팅·문자)에서도 보인다 (D-UX4-211)', async () => {
    const world = makeWorld({ products: [product(12)] })
    const openSearch = vi.fn()
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} openSearch={openSearch} />))
    await screen.findByRole('button', { name: '검색 열기' })
    fireEvent.click(screen.getByRole('button', { name: '채팅·문자' }))
    fireEvent.click(await screen.findByRole('button', { name: '검색 열기' }))
    expect(openSearch).toHaveBeenCalledTimes(1)
  })

  it('찾기 칸은 숫자 키패드로 열리고, 오른쪽 [한글]로 글자 키보드, [숫자]로 다시 숫자 키패드 (D-UX4-212)', async () => {
    const { page } = await openPage(searchWorld())
    const field = page.getByLabelText(SEARCH_LABEL)
    expect(field.getAttribute('inputmode')).toBe('numeric')
    fireEvent.click(page.getByRole('button', { name: '한글 키보드로 바꾸기' }))
    expect(page.getByLabelText(SEARCH_LABEL).getAttribute('inputmode') ?? 'text').toBe('text')
    expect(page.getByText(KEYS_TO_DIGITS)).toBeTruthy()
    fireEvent.click(page.getByRole('button', { name: '숫자 키보드로 바꾸기' }))
    expect(page.getByLabelText(SEARCH_LABEL).getAttribute('inputmode')).toBe('numeric')
    expect(page.getByText(KEYS_TO_TEXT)).toBeTruthy()
  })

  it('제목 "검색" · 회색 찾기 칸 하나(숫자판 없음) · 빈 칸이면 안내만', async () => {
    const { page } = await openPage(searchWorld())
    expect(page.getByText(SEARCH_PAGE_NAME)).toBeTruthy()
    expect(page.queryByRole('group', { name: '숫자판' })).toBeNull()
    // 빈 칸 안내는 토스 그림 + 두 줄, 찾기 칸 아래 고정 자리 (D-SEARCH-EMPTY-01)
    expect(page.getByTestId('search-hint').textContent).toBe(SEARCH_EMPTY)
    expect(page.getByTestId('search-hint-glyph')).toBeTruthy()
    expect(SEARCH_EMPTY).toBe('상품 번호·품명이나\n닉네임을 검색해보세요.')
    expect(productButtons(page)).toEqual([])
  })

  it('번호로: 그 번호로 시작하는 상품(같은 번호 맨 위)과 그 번호를 찜한 손님', async () => {
    const { page, type } = await openPage(searchWorld())
    type('12')
    await waitFor(() => expect(productButtons(page)).toEqual(['상품 자세히 — 12번', '상품 자세히 — 123번']))
    expect(page.getByTestId('search-products').textContent).toContain('상품 2')
    expect(feedText(page)).toContain('가을여행')
    expect(feedText(page)).not.toContain('겨울바다')
  })

  it('품종으로: 품종에 그 글이 든 상품과 그 상품을 찜한 손님', async () => {
    const { page, type } = await openPage(searchWorld())
    type('색금')
    await waitFor(() => expect(productButtons(page)).toEqual(['상품 자세히 — 31번']))
    expect(feedText(page)).toContain('겨울바다')
  })

  it('닉네임으로: 그 손님이 찜한 상품과 그 손님의 찜 기록, 결과를 누르면 라이브 화면에 그 상품을 열라고 알리고 돌아간다', async () => {
    const onBack = vi.fn()
    const { page, type, signals } = await openPage(searchWorld(), onBack)
    type('가을')
    await waitFor(() => expect(productButtons(page)).toEqual(['상품 자세히 — 12번']))
    expect(feedText(page)).toContain('가을여행')
    fireEvent.click(page.getByRole('button', { name: '상품 자세히 — 12번' }))
    expect(signals).toEqual([{ kind: 'show', key: 'b1/12' }])
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('맞는 것이 없으면 한 번만 그림과 "검색한 내용을 찾을 수 없어요."', async () => {
    const { page, type } = await openPage(searchWorld())
    type('없는이름')
    await waitFor(() => expect(page.getByText(SEARCH_NO_MATCH)).toBeTruthy())
    // 토스 사진처럼 같은 그림 아래 한 줄 (D-SEARCH-EMPTY-02)
    expect(SEARCH_NO_MATCH).toBe('검색한 내용을 찾을 수 없어요.')
    expect(page.getByTestId('search-no-match').textContent).toBe(SEARCH_NO_MATCH)
    expect(within(page.getByTestId('search-no-match')).getByTestId('search-hint-glyph')).toBeTruthy()
    expect(page.queryByTestId('search-products')).toBeNull()
    expect(page.queryByTestId('search-feed')).toBeNull()
  })

  it('앱 경로: 라이브 화면·라이브 기록이 돋보기를 /console/<방송>/search 로 잇는다', () => {
    for (const file of ['app/console/[id]/index.tsx', 'app/console/[id]/record.tsx']) {
      expect(readFileSync(join(process.cwd(), file), 'utf8')).toContain("openSearch={() => router.push({ pathname: '/console/[id]/search', params: { id } })}")
    }
    expect(readFileSync(join(process.cwd(), 'app/console/[id]/search.tsx'), 'utf8')).toContain('ConsoleSearchScreen')
  })
})

describe('최근 검색어 (D-SEARCH-RECENT-01)', () => {
  it('맨 앞에 더하고 같은 글은 앞으로, 빈칸은 하나로, 많아야 10개 · 깨진 저장 값은 버린다', () => {
    expect(withRecentSearch(['창금', '12'], '  12 ')).toEqual(['12', '창금'])
    expect(withRecentSearch(['창금'], '가을  여행')).toEqual(['가을 여행', '창금'])
    expect(withRecentSearch(['창금'], '   ')).toEqual(['창금'])
    const many = Array.from({ length: 12 }, (_, index) => String(index)).reduce<readonly string[]>((list, text) => withRecentSearch(list, text), [])
    expect(many).toHaveLength(RECENT_SEARCHES_MAX)
    expect(many[0]).toBe('11')
    expect(parseRecentSearches('{깨짐')).toEqual([])
    expect(parseRecentSearches(JSON.stringify(['창금', 3, '창금', ' 12 ']))).toEqual(['창금', '12'])
  })

  it('앱 저장소에서 되살리고, 남길 때마다 쓴다', async () => {
    const saved = new Map<string, string>([[RECENT_SEARCHES_KEY, JSON.stringify(['창금'])]])
    await wireRecentSearches({ getItem: async (key) => saved.get(key) ?? null, setItem: async (key, value) => { saved.set(key, value) } })
    expect(getRecentSearches()).toEqual(['창금'])
    addRecentSearch('가을')
    expect(JSON.parse(saved.get(RECENT_SEARCHES_KEY) ?? '[]')).toEqual(['가을', '창금'])
  })

  it('결과를 눌러 열거나 [검색]을 누르면 남고, 빈 칸이면 안내 대신 최근 검색어 — 누르면 그 글로 찾는다', async () => {
    const first = await openPage(searchWorld())
    expect(first.page.queryByTestId('recent-searches')).toBeNull()
    first.type('가을')
    await waitFor(() => expect(productButtons(first.page)).toEqual(['상품 자세히 — 12번']))
    fireEvent.click(first.page.getByRole('button', { name: '상품 자세히 — 12번' }))
    expect(getRecentSearches()).toEqual(['가을'])
    first.type('색금')
    fireEvent.keyDown(screen.getByLabelText(SEARCH_LABEL), { key: 'Enter', code: 'Enter', keyCode: 13 })
    expect(getRecentSearches()).toEqual(['색금', '가을'])
    first.type('')
    const recent = within(first.page.getByRole('group', { name: RECENT_TITLE }))
    expect(first.page.queryByTestId('search-hint')).toBeNull()
    expect(recent.getAllByTestId('recent-search').map((node) => node.textContent)).toEqual(['색금', '가을'])
    fireEvent.click(recent.getByRole('button', { name: '최근 검색어 가을' }))
    await waitFor(() => expect(productButtons(first.page)).toEqual(['상품 자세히 — 12번']))
    expect((screen.getByLabelText(SEARCH_LABEL) as HTMLInputElement).value).toBe('가을')
  })

  it('[전체 삭제]를 누르면 모두 지우고 다시 안내', async () => {
    addRecentSearch('창금')
    const { page } = await openPage(searchWorld())
    fireEvent.click(page.getByRole('button', { name: `${RECENT_TITLE} ${RECENT_CLEAR}` }))
    expect(getRecentSearches()).toEqual([])
    expect(page.getByTestId('search-hint').textContent).toBe(SEARCH_EMPTY)
  })
})
