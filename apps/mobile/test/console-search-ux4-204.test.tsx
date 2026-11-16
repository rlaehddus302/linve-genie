// D-UX4-204 (사용자 지시 2026-11-16 토스 검색 화면 사진 "그리고 검색 눌렀을 때 별도 화면으로 넘어가서 사진4처럼 넘어가."):
// 기기에서는 라이브 화면 머리 돋보기가 따로 쌓인 찾기 화면(/console/<방송>/search?kind=)을 연다. 그 화면은 ‹ · 가운데 제목 · 회색 찾기 칸 · 결과 줄.
// 상품은 앱 숫자판으로 번호를 찾고, 결과를 누르면 라이브 화면에 그 상품을 열라고 알리고(show) 돌아간다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { ConsoleSearchScreen, PRODUCT_SEARCH_LABEL, SEARCH_PAGE_NAME } from '../src/screens/console/ConsoleSearch.tsx'
import { FEED_SEARCH_LABEL } from '../src/screens/console/ClaimFeed.tsx'
import { useConsoleSignals, type ConsoleSignal } from '../src/screens/console/scope.tsx'
import { makeWorld } from './screen-support.tsx'
import { buyer, claim, fullView, product } from './support.ts'

const typePad = (digits: string) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of digits) fireEvent.click(within(pad).getByRole('button', { name: key }))
}

function Listen({ onSignal }: { readonly onSignal: (signal: ConsoleSignal) => void }) {
  useConsoleSignals('b1', onSignal)
  return null
}

it('경로가 있으면 머리 돋보기는 찾기 화면을 연다 — 라이브 화면 안에 찾기 칸·숫자판을 그리지 않는다', async () => {
  const world = makeWorld({ products: [product(12), product(31)] })
  const openSearch = vi.fn()
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} openSearch={openSearch} />))
  fireEvent.click(await screen.findByTestId('console-search'))
  expect(openSearch).toHaveBeenCalledWith('products')
  expect(screen.queryByRole('textbox', { name: '상품 번호 검색' })).toBeNull()
  expect(screen.queryByRole('group', { name: '숫자판' })).toBeNull()
})

it('상품 찾기 화면: 제목 · 회색 찾기 칸 · 숫자판이 열린 채 시작, 번호로 좁히고 누르면 라이브 화면에 그 상품을 열라고 알리고 돌아간다', async () => {
  const world = makeWorld({ products: [product(12, { name: '창금' }), product(123, { name: '퍼플' }), product(31, { name: '색금' })] })
  const onBack = vi.fn()
  const signals: ConsoleSignal[] = []
  render(world.wrap(<><Listen onSignal={(signal) => signals.push(signal)} /><ConsoleSearchScreen broadcastId="b1" kind="products" onBack={onBack} /></>))
  // 범위 자료를 받기 전에도 같은 이름의 화면(불러오는 중)이 있다 — 찾기 칸이 나온 뒤의 화면을 본다
  await screen.findByLabelText(PRODUCT_SEARCH_LABEL)
  const page = screen.getByRole('main', { name: SEARCH_PAGE_NAME.products })
  expect(within(page).getByText(SEARCH_PAGE_NAME.products)).toBeTruthy()
  expect(within(page).getByLabelText(PRODUCT_SEARCH_LABEL)).toBeTruthy()
  expect(within(page).getByTestId('console-search-pad')).toBeTruthy()
  typePad('12')
  await waitFor(() => expect(within(page).queryByRole('button', { name: '상품 자세히 — 31번' })).toBeNull())
  expect(within(page).getByRole('button', { name: '상품 자세히 — 12번' })).toBeTruthy()
  expect(within(page).getByRole('button', { name: '상품 자세히 — 123번' })).toBeTruthy()
  fireEvent.click(within(page).getByRole('button', { name: '상품 자세히 — 123번' }))
  expect(signals).toEqual([{ kind: 'show', key: 'b1/123' }])
  expect(onBack).toHaveBeenCalledTimes(1)
})

it('찜 기록 찾기 화면: 휴대폰 키보드 칸(숫자판 없음)으로 닉네임을 찾는다', async () => {
  const world = makeWorld({ products: [product(5, { name: '창금' }), product(6, { name: '퍼플' })] })
  world.server.on('GET', /^\/api\/days\/2026-10-29$/, () => ({ body: fullView({ seq: world.seq, products: [product(5, { name: '창금' }), product(6, { name: '퍼플' })], claims: [claim('0', 5, '가을여행'), claim('1', 6, '겨울바다')], buyers: [buyer('가을여행', '가을여행'), buyer('겨울바다', '겨울바다')] }) }))
  render(world.wrap(<ConsoleSearchScreen broadcastId="b1" kind="feed" onBack={() => {}} />))
  await screen.findByLabelText(FEED_SEARCH_LABEL)
  const page = screen.getByRole('main', { name: SEARCH_PAGE_NAME.feed })
  expect(within(page).queryByTestId('console-search-pad')).toBeNull()
  const list = () => within(page).getByRole('list', { name: '찜 기록' })
  await waitFor(() => expect(list().textContent).toContain('겨울바다'))
  fireEvent.change(within(page).getByLabelText(FEED_SEARCH_LABEL), { target: { value: '가을' } })
  await waitFor(() => expect(list().textContent).not.toContain('겨울바다'))
  expect(list().textContent).toContain('가을여행')
})

it('앱 경로: 라이브 화면·라이브 기록이 돋보기를 /console/<방송>/search?kind= 로 잇는다', () => {
  for (const file of ['app/console/[id]/index.tsx', 'app/console/[id]/record.tsx']) {
    expect(readFileSync(join(process.cwd(), file), 'utf8')).toContain("openSearch={(kind) => router.push({ pathname: '/console/[id]/search', params: { id, kind } })}")
  }
  expect(readFileSync(join(process.cwd(), 'app/console/[id]/search.tsx'), 'utf8')).toContain('ConsoleSearchScreen')
})
