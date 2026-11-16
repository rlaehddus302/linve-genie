// D-UX4-147~150 (사용자 2026-11-16, 방송 화면 상품 탭):
// 147 검색칸 지우기(x)는 뒤로 ‹처럼 색만 연해진다 · 148 상품 줄 "37 · 라비홍 · 50,000원" 왼쪽 정렬, [찜 된 것만]은 탭 알약과 다른 걸러 보기 칩 ·
// 149 새 상품 초록 빛 약 5초 · 150 목록 순서(정렬) 고르기 — 찜 된 것만·번호 검색과 함께 걸린다. 도구 줄(ProductToolbar)은 따로 꺼내 쓸 수 있다.
// 손님 이름은 지어낸 이름이다.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FullView } from '@livejjim/web/src/api/types.ts'
import { describe, expect, it } from 'vitest'
import { BuyerNames } from '../src/lib/derive.ts'
import { DEFAULT_PRODUCT_SORT, PRODUCT_SORTS, SORT_TITLE, sortProducts, sortWord, type ProductSort } from '../src/lib/product-sort.ts'
import { fromFull } from '../src/lib/scope-data.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { ConsoleContext, type ConsoleApi } from '../src/screens/console/context.ts'
import { CLAIMED_ONLY, FRESH_FADE_MS, FRESH_HOLD_MS, ProductList, ProductToolbar, rowLine } from '../src/screens/console/ProductBoard.tsx'
import { ClearButton } from '../src/ui/kit/index.ts'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { makeWorld, openSearchField } from './screen-support.tsx'
import { buyer, changes, claim, flush, fullView, product } from './support.ts'

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgb(${String((n >> 16) & 255)}, ${String((n >> 8) & 255)}, ${String(n & 255)})`
}

/** 올린 차례: 30번(id p1) → 7번(p2) → 120번(p3) → 15번(p4). 값은 지어낸 것 */
const BY_ORDER = [
  { id: 'p1', no: 30, price: 20_000 },
  { id: 'p2', no: 7, price: 50_000 },
  { id: 'p3', no: 120, price: 8_000 },
  { id: 'p4', no: 15, price: 20_000 },
] as const

describe('목록 순서 — 순수 정렬 (D-UX4-150)', () => {
  const nos = (sort: ProductSort) => sortProducts(BY_ORDER, sort).map((item) => item.no)

  it('여섯 가지 순서와 이름, 기본은 최근 등록순 (D-UX3-87을 지킨다)', () => {
    expect(DEFAULT_PRODUCT_SORT).toBe('recent')
    expect(PRODUCT_SORTS.map(sortWord)).toEqual(['번호 작은순', '번호 큰순', '최근 등록순', '오래된 등록순', '가격 낮은순', '가격 높은순'])
    expect(nos('no-asc')).toEqual([7, 15, 30, 120])
    expect(nos('no-desc')).toEqual([120, 30, 15, 7])
    expect(nos('recent')).toEqual([15, 120, 7, 30])
    expect(nos('oldest')).toEqual([30, 7, 120, 15])
    // 같은 가격(15번·30번 20,000원)은 번호 작은순
    expect(nos('price-asc')).toEqual([120, 15, 30, 7])
    expect(nos('price-desc')).toEqual([7, 15, 30, 120])
  })

  it('받은 배열은 그대로 두고, 같은 번호는 나중에 올린 상품이 먼저 (늘 같은 차례)', () => {
    const input = [{ id: 'p1', no: 5, price: 1000 }, { id: 'p9', no: 5, price: 1000 }, { id: 'p3', no: 2, price: 1000 }]
    const copy = input.map((item) => item.id)
    expect(sortProducts(input, 'no-asc').map((item) => item.id)).toEqual(['p3', 'p9', 'p1'])
    expect(sortProducts(input, 'price-desc').map((item) => item.id)).toEqual(['p3', 'p9', 'p1'])
    expect(input.map((item) => item.id)).toEqual(copy)
  })

  it('정렬 파일은 시계·난수·화면을 쓰지 않는다', () => {
    const source = readFileSync(join(__dirname, '../src/lib/product-sort.ts'), 'utf8')
    expect(source).not.toMatch(/Date\.now|new Date|Math\.random|react/)
  })
})

describe('상품 줄 첫째 줄·새 상품 빛 (D-UX4-148·149)', () => {
  it('"37 · 라비홍 · 50,000원" — 품종이 없으면 "37 · 50,000원", 개수가 있으면 품종 뒤에', () => {
    expect(rowLine({ no: 37, name: '라비홍', pieces: 1, price: 50_000 })).toBe('37 · 라비홍 · 50,000원')
    expect(rowLine({ no: 37, name: '', pieces: 1, price: 50_000 })).toBe('37 · 50,000원')
    expect(rowLine({ no: 8, name: '채홍', pieces: 3, price: 9_000 })).toBe('8 · 채홍 3개 · 9,000원')
  })

  it('새로 올라온 상품의 초록 빛은 약 5초 보인 뒤 흐려진다 (옛 2.5초)', () => {
    expect(FRESH_HOLD_MS).toBe(5000)
    expect(FRESH_FADE_MS).toBeGreaterThan(0)
    expect(FRESH_FADE_MS).toBeLessThanOrEqual(1500)
  })
})

describe('지우기(x)는 뒤로 ‹처럼 색만 연해진다 (D-UX4-147)', () => {
  it('누르는 동안 동그라미 색만 연해지고, 바탕·크기는 그대로', async () => {
    const p = PALETTE.light
    render(<ClearButton label="상품 번호 검색 지우기" onPress={() => {}} />)
    const button = screen.getByRole('button', { name: '상품 번호 검색 지우기' })
    const circle = () => within(button).getByTestId('clear-circle')
    expect(getComputedStyle(circle()).backgroundColor).toBe(rgb(p.clearCircle))
    const clear = ['', 'transparent', 'rgba(0, 0, 0, 0)']
    expect(clear).toContain(getComputedStyle(button).backgroundColor)
    expect(getComputedStyle(button).transform).not.toMatch(/scale/)
    fireEvent.mouseDown(button, { button: 0, buttons: 1 })
    await waitFor(() => expect(getComputedStyle(circle()).backgroundColor).toBe(rgb(p.clearPressed)))
    expect(clear).toContain(getComputedStyle(button).backgroundColor)
    expect(getComputedStyle(button).transform).not.toMatch(/scale/)
    expect(getComputedStyle(circle()).width).toBe('22px')
    fireEvent.mouseUp(button, { button: 0, buttons: 0 })
    await waitFor(() => expect(getComputedStyle(circle()).backgroundColor).toBe(rgb(p.clearCircle)))
  })

  it('연한 색은 원래 동그라미보다 밝다', () => {
    const luma = (hex: string) => { const n = Number.parseInt(hex.slice(1), 16); return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255) }
    expect(luma(PALETTE.light.clearPressed)).toBeGreaterThan(luma(PALETTE.light.clearCircle))
  })
})

// 화면: 218번(1등·대기)·15번(1등)·16번·150번(찜 없음). 올린 차례 15 → 16 → 218 → 150
const NAMES = ['초록손', '달빛화분', '모래정원']
const VIEW: Partial<FullView> = {
  products: [
    product(15, { id: 'p1', status: 'SOLD', price: 30_000, winners: ['u1'], winnerClaims: ['w15'] }),
    product(16, { id: 'p2', price: 5_000 }),
    product(218, { id: 'p3', status: 'SOLD', price: 12_000, winners: ['u2'], winnerClaims: ['c1'], waitlist: ['u3'], waitlistClaims: ['c2'] }),
    product(150, { id: 'p4', price: 70_000 }),
  ],
  claims: [
    claim('w15', 15, 'u1', { seq: 5 }),
    claim('c1', 218, 'u2', { seq: 10 }),
    claim('c2', 218, 'u3', { status: 'WAITLISTED', seq: 11 }),
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
const rowNos = () => within(screen.getByRole('list', { name: '상품 목록' })).getAllByRole('button').map((row) => Number(/(\d+)번$/.exec(row.getAttribute('aria-label') ?? '')?.[1]))
const sortButton = () => screen.getByRole('button', { name: new RegExp(`^${SORT_TITLE} — `) })
function pickSort(word: string) {
  fireEvent.click(sortButton())
  const choices = screen.getByRole('radiogroup', { name: SORT_TITLE })
  fireEvent.click(within(choices).getByRole('radio', { name: word }))
}
const typePad = (digits: string) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of digits) fireEvent.click(within(pad).getByRole('button', { name: key }))
}

describe('목록 순서 단추·고르는 판 (D-UX4-150)', () => {
  it('단추 글자에 지금 순서가 보이고, 판에서 고르면 목록이 다시 선다', async () => {
    await open(worldWith(VIEW))
    // 기본은 최근 등록순 (D-UX3-87)
    expect(rowNos()).toEqual([150, 218, 16, 15])
    expect(sortButton().getAttribute('aria-label')).toBe(`${SORT_TITLE} — 최근 등록순`)
    expect(sortButton().textContent).toBe('최근 등록순')
    fireEvent.click(sortButton())
    const choices = screen.getByRole('radiogroup', { name: SORT_TITLE })
    expect(within(choices).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual(PRODUCT_SORTS.map(sortWord))
    expect(within(choices).getByRole('radio', { name: '최근 등록순' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(choices).getByRole('radio', { name: '가격 높은순' }))
    expect(rowNos()).toEqual([150, 15, 218, 16])
    expect(sortButton().textContent).toBe('가격 높은순')
    pickSort('최근 등록순')
    expect(rowNos()).toEqual([150, 218, 16, 15])
    pickSort('오래된 등록순')
    expect(rowNos()).toEqual([15, 16, 218, 150])
    pickSort('번호 큰순')
    expect(rowNos()).toEqual([218, 150, 16, 15])
    pickSort('가격 낮은순')
    expect(rowNos()).toEqual([16, 218, 15, 150])
  })

  it('찜 된 것만·번호 검색과 함께 걸린다 — 번호 검색은 같은 번호가 맨 위, 나머지는 고른 순서', async () => {
    await open(worldWith(VIEW))
    pickSort('번호 큰순')
    fireEvent.click(screen.getByRole('switch', { name: CLAIMED_ONLY }))
    expect(rowNos()).toEqual([218, 15])
    fireEvent.click(screen.getByRole('switch', { name: CLAIMED_ONLY }))
    // D-UX4-201: 찾기 칸은 머리 돋보기를 눌러 연다(옛: 늘 보임)
    fireEvent.focus(openSearchField('상품 번호 검색'))
    typePad('15')
    expect(rowNos()).toEqual([15, 150])
    fireEvent.click(screen.getByRole('button', { name: '상품 번호 검색 지우기' }))
    typePad('1')
    expect(rowNos()).toEqual([150, 16, 15])
    fireEvent.click(screen.getByRole('switch', { name: CLAIMED_ONLY }))
    expect(rowNos()).toEqual([15])
  })
})

describe('[찜 된 것만]은 탭 알약과 다른 걸러 보기 칩 (D-UX4-148)', () => {
  it('덜 둥근 테두리 칩 — 끄면 바탕 없이 깔때기, 켜면 옅은 주색 바탕·체크', async () => {
    const p = PALETTE.light
    await open(worldWith(VIEW))
    const tab = screen.getByRole('tablist', { name: '보기' })
    const tabPill = within(tab).getAllByRole('button')[0]!
    const chip = () => screen.getByRole('switch', { name: CLAIMED_ONLY })
    // D-UX4-201로 바뀐 기대 (사용자 "탭도 사진1 스타일로"; 옛: 탭 알약 모양 999): 탭은 테두리·바탕 없는 밑줄 글자, 칩은 10
    expect(['', '0', '0px']).toContain(getComputedStyle(tabPill).borderTopLeftRadius)
    expect(getComputedStyle(chip()).borderTopLeftRadius).toBe('10px')
    expect(within(chip()).getByTestId('chip-funnel')).toBeTruthy()
    expect(within(chip()).queryByTestId('chip-check')).toBeNull()
    expect(getComputedStyle(chip()).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    fireEvent.click(chip())
    expect(chip().getAttribute('aria-checked')).toBe('true')
    expect(within(chip()).getByTestId('chip-check')).toBeTruthy()
    expect(within(chip()).queryByTestId('chip-funnel')).toBeNull()
    expect(getComputedStyle(chip()).backgroundColor).toBe(rgb(p.secondary))
    expect(getComputedStyle(chip()).borderTopColor).toBe(rgb(p.primary))
    // 켜진 탭은 바탕 없이 검정 밑줄이라 다르다 (D-UX4-201 — 옛: 주색 꽉 찬 알약)
    const onTab = tab.querySelector('[aria-selected="true"]')!
    expect(getComputedStyle(onTab).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(within(onTab as HTMLElement).getByTestId('line-tab-bar')).toBeTruthy()
  })
})

describe('도구 줄을 따로 꺼내 쓰기 (D-UX4-150 — 붙는 머리로 옮길 준비)', () => {
  const data = fromFull(fullView(VIEW))
  const api: ConsoleApi = { b: 'b1', data, names: new BuyerNames(data.buyers, data.claims), ended: false, sealed: false, command: async () => ({ date: '2026-10-29', rehearsal: false, seq: 6, type: 'x', changed: false, effects: [] }), select: () => {}, selected: null, labelWords: new Map() }
  const search = { open: () => {}, submit: () => {} }
  const nos = () => within(screen.getByRole('list', { name: '상품 목록' })).getAllByRole('button').map((row) => Number(/(\d+)번$/.exec(row.getAttribute('aria-label') ?? '')?.[1]))

  it('toolbar={false}면 목록만 그리고, sort를 주면 그 순서를 따른다', () => {
    render(<ConsoleContext.Provider value={api}><ProductList toolbar={false} sort="price-asc" onOpen={() => {}} query="" onQuery={() => {}} numberSearch={search} /></ConsoleContext.Provider>)
    expect(screen.queryByTestId('product-toolbar')).toBeNull()
    expect(screen.queryByLabelText('상품 번호 검색')).toBeNull()
    expect(nos()).toEqual([16, 218, 15, 150])
  })

  it('기본은 도구 줄을 안에 그리고 순서를 스스로 든다 — onSort로 바뀐 값을 알린다', () => {
    const told: ProductSort[] = []
    render(<ConsoleContext.Provider value={api}><ProductList onOpen={() => {}} query="" onQuery={() => {}} onClaimedOnly={() => {}} onSort={(sort) => told.push(sort)} numberSearch={search} /></ConsoleContext.Provider>)
    expect(screen.getByTestId('product-toolbar')).toBeTruthy()
    expect(nos()).toEqual([150, 218, 16, 15])      // 기본 최근 등록순 (D-UX3-87)
    pickSort('번호 큰순')
    expect(nos()).toEqual([218, 150, 16, 15])
    expect(told).toEqual(['no-desc'])
  })

  it('ProductToolbar는 상태를 들지 않고 받은 값·setter만 쓴다', () => {
    const calls: string[] = []
    render(<ProductToolbar query="12" onQuery={(value) => calls.push(`q:${value}`)} claimedOnly onClaimedOnly={(on) => calls.push(`c:${String(on)}`)} sort="recent" onSort={(sort) => calls.push(`s:${sort}`)} numberSearch={search} />)
    expect(screen.getByLabelText<HTMLInputElement>('상품 번호 검색').value).toBe('12')
    expect(sortButton().textContent).toBe('최근 등록순')
    fireEvent.click(screen.getByRole('switch', { name: CLAIMED_ONLY }))
    fireEvent.click(screen.getByRole('button', { name: '상품 번호 검색 지우기' }))
    pickSort('가격 낮은순')
    expect(calls).toEqual(['c:false', 'q:', 's:price-asc'])
    // 받은 값이 그대로라 단추 글자도 그대로
    expect(sortButton().textContent).toBe('최근 등록순')
  })
})
