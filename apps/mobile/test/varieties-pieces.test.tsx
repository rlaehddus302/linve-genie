// 품종 후보 단추 (D-VARIETY-01)와 상품 개수 (D-PIECES-01) — 사용자 메모 2026-11-13, 개선 계획 E1·E6·B7:
// - 상품을 누르면 자세히에 품종 후보 단추 한 줄(일꾼이 들은 이름 → 이 방송 최근 → 자주 판 품종). 누르면 품종 칸이 열리며 그 이름이 들어가고 [확인]으로 저장
// - 품종 칸 아래 개수 칸 [−] n개 [+]. "채홍 3개"라고 적어도 개수로 나눈다. 가격은 묶음 하나의 값 그대로. 1이면 상품 줄에 개수가 보이지 않는다
// - 상품 추가의 품종 단계에도 같은 단추·개수 칸, 확인 카드에는 일꾼이 들은 품종 단추
// 단추는 가로 한 줄(넘치면 가로로 민다), 둘 이상이면 위아래로 쌓지 않는다 (절대 규칙 8). 품종 이름은 흔한 이름만.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Product } from '@livejjim/web/src/api/types.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { BuyerNames, nameOf } from '../src/lib/derive.ts'
import { fromFull } from '../src/lib/scope-data.ts'
import { confirmEvent, otherNames } from '../src/lib/tentative.ts'
import { forgetVarietyLists, localRecent, readVarietyLists, varietyChoices } from '../src/lib/varieties.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { ConsoleContext, type ConsoleApi } from '../src/screens/console/context.ts'
import { ProductAddFlow } from '../src/screens/console/ProductAdd.tsx'
import { rowName } from '../src/screens/console/ProductBoard.tsx'
import { EDIT_DONE, editPlan } from '../src/screens/console/ProductEdit.tsx'
import { CONFIRM_AS_IS, TentativePanel } from '../src/screens/console/TentativeCard.tsx'
import { PIECES_MORE, VARIETY_ROW } from '../src/screens/console/VarietyChips.tsx'
import { makeWorld } from './screen-support.tsx'
import { changes, flush, fullView, product } from './support.ts'

type World = ReturnType<typeof makeWorld>
type Mark = NonNullable<Product['tentative']>
const mark = (patch: Partial<Mark> = {}): Mark => ({ by: 'WORKER', reasons: ['NAME_UNSURE'], candidates: { no: [], price: [], name: [] }, seq: 4, at: '2026-10-29T11:00:00.000Z', ...patch })

afterEach(() => forgetVarietyLists())

async function open(world: World) {
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
}
async function openDetail(world: World, no: number) {
  await open(world)
  world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=(\d+)/, (call) => ({ body: changes(Number(/since=(\d+)/.exec(call.path)?.[1] ?? 5), world.seq, {}) }))
  fireEvent.click(within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: `상품 자세히 — ${String(no)}번` }))
  return screen.findByRole('group', { name: '상품 자세히' })
}
const chipNames = (root: HTMLElement) => within(within(root).getByRole('group', { name: VARIETY_ROW })).getAllByRole('button').map((button) => button.getAttribute('aria-label'))

describe('품종 후보 고르기 (D-VARIETY-01)', () => {
  it('차례: 일꾼이 들은 이름 → 이 방송 최근 → 자주 판 것, 겹치지 않게, 지금 품종은 빼고, 12개까지', () => {
    expect(varietyChoices({ heard: ['채홍 '], recent: ['라울', '채홍', '핑크프릴'], frequent: ['라울', '청옥', '핑크프릴'], current: '핑크프릴' })).toEqual(['채홍', '라울', '청옥'])
    expect(varietyChoices({ recent: Array.from({ length: 20 }, (_, i) => `품종${String(i)}`), frequent: [] })).toHaveLength(12)
    expect(readVarietyLists({ recent: ['라울', 3, ' '], frequent: '라울' })).toEqual({ recent: ['라울'], frequent: [] })
    expect(readVarietyLists(null)).toEqual({ recent: [], frequent: [] })
    const products = [product(1, { name: '라울' }), product(2, { name: '채홍' }), product(3, { name: '라울' })].map((item, i) => ({ ...item, id: `p${String(i + 1)}` }))
    expect(localRecent(products, 'b1')).toEqual(['라울', '채홍'])
  })

  it('상품을 누르면 자세히에 단추 한 줄 — 누르면 품종 칸이 열리며 그 이름이 들어가고, [확인]을 눌러야 저장된다', async () => {
    const world = makeWorld({ products: [product(15, { name: '핑크프릴', price: 12_000 }), product(16, { name: '라울' })] })
    world.server.on('GET', /^\/api\/broadcasts\/b1\/varieties$/, () => ({ body: { recent: ['라울', '핑크프릴'], frequent: ['채홍', '라울'] } }))
    const detail = await openDetail(world, 15)
    await waitFor(() => expect(chipNames(detail)).toContain('채홍'))
    const row = within(detail).getByRole('group', { name: VARIETY_ROW })
    expect(getComputedStyle(row.firstElementChild as HTMLElement).flexDirection).toBe('row')
    expect(chipNames(detail)).not.toContain('핑크프릴')
    fireEvent.click(within(row).getByRole('button', { name: '채홍' }))
    const sheet = screen.getByTestId('product-sheet')
    const input = within(sheet).getByRole<HTMLInputElement>('textbox', { name: '품종' })
    expect(input.value).toBe('채홍')
    expect(world.events).toHaveLength(0)
    fireEvent.click(within(sheet).getByRole('button', { name: EDIT_DONE }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', no: 15, name: '채홍' })
  })

  it('서버에 닿지 못해도 이 방송의 상품으로 단추를 만든다', async () => {
    const world = makeWorld({ products: [product(1, { name: '라울' }), product(2, { name: '채홍' })] })
    const detail = await openDetail(world, 2)
    expect(chipNames(detail)).toEqual(['라울'])
  })

  // D-UX4-209: 방송 화면 확인 카드가 없어져 같은 확정 칸(TentativePanel)을 바로 그린다
  it('확정 칸: 일꾼이 품종을 여러 가지로 들었으면 품종 단추 — 고른 품종으로 확정한다', async () => {
    const data = fromFull(fullView({ products: [product(313, { status: 'READY', name: '채홍', price: 10_000, tentative: mark({ candidates: { no: [], price: [], name: ['채홍', '청옥'] } }) })] }))
    const sent: Record<string, unknown>[] = []
    const api: ConsoleApi = { b: 'b1', data, names: new BuyerNames(data.buyers, data.claims), ended: false, sealed: false, command: async (event) => { sent.push({ ...event }); return { date: '2026-10-29', rehearsal: false, seq: 6, type: String(event.type), changed: true, effects: [] } }, select: () => {}, selected: null, labelWords: new Map() }
    render(<ConsoleContext.Provider value={api}><TentativePanel product={data.products.get('b1/313')!} /></ConsoleContext.Provider>)
    const card = screen.getByRole('group', { name: '확인 중 — 313번' })
    expect(chipNames(card)).toEqual(['채홍', '청옥'])
    fireEvent.click(within(card).getByRole('button', { name: '청옥' }))
    expect(within(card).getByTestId('tentative-values').textContent).toBe('313번 청옥 10,000원')
    fireEvent.click(within(card).getByRole('button', { name: `${CONFIRM_AS_IS} — 313번` }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ type: 'product.confirm', b: 'b1', no: 313, price: 10_000, name: '청옥' })
    expect(otherNames({ name: '채홍', tentative: mark({ candidates: { no: [], price: [], name: ['채홍', ' 청옥', '청옥'] } }) })).toEqual(['청옥'])
    expect(confirmEvent({ broadcast: 'b1', no: 1, name: '채홍', price: 100 }, { name: '라울' })).toMatchObject({ name: '라울' })
  })
})

describe('상품 개수 (D-PIECES-01)', () => {
  it('상품 줄·정산 글은 품종 옆에 "3개", 1이면 품종 그대로', () => {
    expect(rowName({ name: '채홍', pieces: 3 })).toBe('채홍 3개')
    expect(rowName({ name: '채홍' })).toBe('채홍')
    expect(nameOf({ name: '', pieces: 2 })).toBe('품종 미입력 2개')
  })

  it('고칠 값: 개수 칸 값, 품종 칸의 "채홍 3개"는 품종과 개수로 나눈다(개수 칸을 건드렸으면 그 값), 같은 값은 안 바꿈', () => {
    const base = { no: 66, name: '채홍', price: 20_000 }
    expect(editPlan(base, {}, 3)).toEqual({ no: null, name: null, price: null, pieces: 3 })
    expect(editPlan(base, { name: '채홍 3개' })).toEqual({ no: null, name: null, price: null, pieces: 3 })
    expect(editPlan(base, { name: '라울 2개' }, 4)).toEqual({ no: null, name: '라울', price: null, pieces: 4 })
    expect(editPlan({ ...base, pieces: 3 }, {}, 3)).toEqual({ no: null, name: null, price: null })
    expect(editPlan({ ...base, pieces: 3 }, {}, 1)).toEqual({ no: null, name: null, price: null, pieces: 1 })
  })

  it('수정창: 품종 칸 아래 [−] n개 [+] — 늘리고 [확인]을 누르면 개수만 고친다. 가격은 그대로', async () => {
    const world = makeWorld({ products: [product(66, { name: '채홍', price: 20_000 })] })
    const detail = await openDetail(world, 66)
    fireEvent.click(within(detail).getByRole('button', { name: '품종 고치기' }))
    const sheet = screen.getByTestId('product-sheet')
    const stepper = within(sheet).getByRole('group', { name: '개수' })
    expect(within(stepper).getByTestId('pieces-value').textContent).toBe('1개')
    fireEvent.click(within(stepper).getByRole('button', { name: PIECES_MORE }))
    fireEvent.click(within(stepper).getByRole('button', { name: PIECES_MORE }))
    expect(within(stepper).getByTestId('pieces-value').textContent).toBe('3개')
    expect(within(sheet).getByTestId('pieces-preview').textContent).toContain('채홍 3개')
    fireEvent.click(within(sheet).getByRole('button', { name: EDIT_DONE }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', no: 66, pieces: 3 })
  })

  it('상품 목록 줄에 "채홍 3개"', async () => {
    const world = makeWorld({ products: [product(66, { name: '채홍', price: 20_000, pieces: 3 }), product(67, { name: '라울' })] })
    await open(world)
    const list = screen.getByRole('list', { name: '상품 목록' })
    expect(within(list).getByText('채홍 3개')).toBeTruthy()
    expect(within(list).getByText('라울')).toBeTruthy()
  })

  // D-ADDPIECES-01 (사용자 지시 2026-11-17 "품종 입력 받을 때 버튼이 너무 많아서 난잡하다. 개수는 그 다음에"): 옛 기대는 품종 단계에 개수 칸
  it('상품 추가: 품종 단계에 단추·[손글씨로 적을게요]·맨 아래 [품종 없이 넘어가기], 개수는 다음 단계 — "채홍 3개"로 적어도 품종 채홍·개수 3, 가격은 친 값 그대로', async () => {
    const data = fromFull(fullView({ products: [{ ...product(1, { name: '라울' }), id: 'p1' }] }))
    const sent: Record<string, unknown>[] = []
    const api: ConsoleApi = { b: 'b1', data, names: new BuyerNames(data.buyers, data.claims), ended: false, sealed: false, command: async (event) => { sent.push({ ...event }); return { date: '2026-10-29', rehearsal: false, seq: 6, type: String(event.type), changed: true, effects: [] } }, select: () => {}, selected: null, labelWords: new Map() }
    const added: string[] = []
    render(<ConsoleContext.Provider value={api}><ProductAddFlow askName onAdded={(key) => added.push(key)} /></ConsoleContext.Provider>)
    const pad = () => screen.getByRole('group', { name: '숫자판' })
    for (const key of '66') fireEvent.click(within(pad()).getByRole('button', { name: key }))
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    for (const key of '20000') fireEvent.click(within(pad()).getByRole('button', { name: key }))
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    const input = screen.getByLabelText<HTMLInputElement>('어떤 품종인가요?')
    // 품종 단계에는 개수 칸이 없고, [품종 없이 넘어가기]가 맨 아래(품종 후보 줄 뒤)
    expect(screen.queryByRole('group', { name: '개수' })).toBeNull()
    const skip = screen.getByRole('button', { name: '품종 없이 넘어가기' })
    expect(screen.getByRole('group', { name: VARIETY_ROW }).compareDocumentPosition(skip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 단추를 누르면 칸에 들어간다
    fireEvent.click(within(screen.getByRole('group', { name: VARIETY_ROW })).getByRole('button', { name: '라울' }))
    expect(input.value).toBe('라울')
    fireEvent.change(input, { target: { value: '채홍 3개' } })
    expect(screen.queryByRole('button', { name: '품종 없이 넘어가기' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    // 개수 단계: "몇 개인가요?" — 품종 칸의 3개를 이어받고, 위에 번호·가격·품종(채홍)
    expect(screen.getByText('몇 개인가요?')).toBeTruthy()
    expect(screen.getByRole('button', { name: '품종 채홍 고치기' })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: '개수' })).getByTestId('pieces-value').textContent).toBe('3개')
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    const lines = await screen.findByTestId('add-confirm-lines')
    expect(Array.from(lines.children).map((line) => line.textContent)).toEqual(['66번', '20,000원', '채홍 3개'])
    fireEvent.click(screen.getByRole('button', { name: '추가하기' }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ type: 'product.register', b: 'b1', noText: '66', priceText: '20000원', name: '채홍', pieces: 3 })
  })
})
