// D-UX4-204 (사용자 지시 2026-11-16 토스 검색 화면 사진 "그리고 검색 눌렀을 때 별도 화면으로 넘어가서 사진4처럼 넘어가."):
// 기기에서는 라이브 화면 머리 돋보기가 따로 쌓인 찾기 화면(/console/<방송>/search)을 연다. 그 화면은 ‹ · 가운데 제목 · 회색 찾기 칸 · 결과.
// D-UX4-205로 바뀐 기대 (사용자 "검색은 상품 검색이든 찜 검색이든 하나로 통합해서 다 보여주면 돼. 번호, 품종, 닉네임으로 검색되게 하면 되겠지."):
// 옛(D-UX4-204 첫 모양): 상품 찾기(앱 숫자판)와 찜 기록 찾기(키보드)가 따로였다. 이제 한 칸(휴대폰 키보드)에서 번호·품종·닉네임으로 상품과 찜 기록을 함께 찾는다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { ConsoleSearchScreen, SEARCH_EMPTY, SEARCH_LABEL, SEARCH_NO_MATCH, SEARCH_PAGE_NAME } from '../src/screens/console/ConsoleSearch.tsx'
import { feedRowMatches, productMatches } from '../src/screens/console/console-search.ts'
import { useConsoleSignals, type ConsoleSignal } from '../src/screens/console/scope.tsx'
import { makeWorld } from './screen-support.tsx'
import { buyer, claim, fullView, product } from './support.ts'

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

  it('제목 "검색" · 회색 찾기 칸 하나(숫자판 없음) · 빈 칸이면 안내만', async () => {
    const { page } = await openPage(searchWorld())
    expect(page.getByText(SEARCH_PAGE_NAME)).toBeTruthy()
    expect(page.queryByRole('group', { name: '숫자판' })).toBeNull()
    expect(page.getByText(SEARCH_EMPTY)).toBeTruthy()
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

  it('맞는 것이 없으면 한 번만 "찾는 결과가 없어요"', async () => {
    const { page, type } = await openPage(searchWorld())
    type('없는이름')
    await waitFor(() => expect(page.getByText(SEARCH_NO_MATCH)).toBeTruthy())
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
