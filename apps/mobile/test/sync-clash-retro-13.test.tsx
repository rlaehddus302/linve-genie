// 거의 동시에 넣은 손 등록 알림 (11월 12일 라이브 복기 6.3 "313번", 개선 계획표 G5, D-RETRO-13 · 화면은 D-RETRO-94):
// 내 손 등록이 "이미 있는 번호"로 아무 일도 없었고 서버가 두 값(syncClash)을 돌려주면, 둘을 보여 고르게 한다 —
// 왼쪽 [그 값 두기] · 오른쪽 [내 값으로 바꾸기]. 확정된 찜이 있으면 가격 적용 범위 물음(D-RETRO-20)을 그대로 탄다.
// 그 번호가 확인 중이면 고른 값으로 확정까지 한다. 다른 계정의 가게 이름은 글자로만 그린다.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Changes, FullView, Product } from '@livejjim/web/src/api/types.ts'
import { describe, expect, it } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { SAME_NUMBER_SHOW } from '../src/screens/console/ProductAdd.tsx'
import { PRICE_SCOPE_ALL, PRICE_SCOPE_NEW, priceScopeAsk } from '../src/screens/console/ProductEdit.tsx'
import { SYNC_KEEP, SYNC_KEEP_CONFIRM, SYNC_MINE, SYNC_MINE_CONFIRM, clashMine, clashTitle, readSyncClash, shownFrom } from '../src/screens/console/SyncClash.tsx'
import { makeWorld } from './screen-support.tsx'
import { buyer, changes, claim, flush, fullView, product } from './support.ts'

type World = ReturnType<typeof makeWorld>

const CLASH = { no: 313, tried: { name: '빅뱅', price: 30_000 }, current: { name: '빅뱅', price: 10_000, from: '비트다육' }, agoMs: 900 }

/** 내 손 등록(313번)은 "바뀐 것 없음" + 두 값으로 답하고, 따라잡으면 다른 계정이 넣은 313번이 와 있다 */
function clashWorld(arrived: Product, extra: Partial<Changes> = {}, syncClash: unknown = CLASH): World {
  const world = makeWorld({ products: [] })
  world.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=true)?$/, () => ({ body: fullView({ seq: world.seq } satisfies Partial<FullView>) }))
  world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=(\d+)/, (call) => ({ body: changes(Number(/since=(\d+)/.exec(call.path)?.[1] ?? 5), world.seq, world.seq > 5 ? { products: [arrived], ...extra } : {}) }))
  world.server.on('POST', /^\/api\/events/, (call) => {
    world.events.push(call)
    world.seq += 1
    const register = call.body?.type === 'product.register'
    return { body: { date: '2026-10-29', rehearsal: false, seq: world.seq, type: String(call.body?.type), changed: !register, effects: [], ...(register ? { syncClash } : {}) } }
  })
  return world
}
const typePad = (digits: string) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of digits) fireEvent.click(within(pad).getByRole('button', { name: key }))
}
/** 방송 화면을 열고 313번 30,000원을 손으로 추가한다 */
async function addMine(world: World) {
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
  fireEvent.click(screen.getByTestId('add-product'))
  const page = await screen.findByRole('dialog', { name: '상품 추가' })
  typePad('313')
  fireEvent.click(within(page).getByRole('button', { name: '다음' }))
  typePad('30000')
  fireEvent.click(within(page).getByRole('button', { name: '다음' }))
  fireEvent.click(within(page).getByRole('button', { name: '추가하기' }))
  await waitFor(() => expect(world.events).toHaveLength(1))
  expect(world.events[0]?.body).toMatchObject({ type: 'product.register', noText: '313', priceText: '30000원' })
  return page
}
/** 두 단추가 같은 줄(좌우)에 있고 왼쪽이 먼저다 */
function expectSideBySide(left: HTMLElement, right: HTMLElement) {
  const row = left.parentElement?.parentElement
  expect(row).toBeTruthy()
  expect(right.parentElement?.parentElement).toBe(row)
  expect(getComputedStyle(row!).flexDirection).toBe('row')
  expect(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

describe('동시에 넣은 손 등록 알림 (D-RETRO-13·94, 개선 계획표 G5)', () => {
  it('두 값을 보여 준다 — "방금 다른 계정(가게)이 n번을 … 넣었어요. 내가 넣으려던 값은 …" · 왼쪽 [그 값 두기] · 오른쪽 [내 값으로 바꾸기]', async () => {
    const world = clashWorld(product(313, { name: '빅뱅', price: 10_000 }))
    await addMine(world)
    const ask = await screen.findByRole('alertdialog', { name: '방금 다른 계정(비트다육)이 313번을 빅뱅 10,000원으로 넣었어요.' })
    expect(within(ask).getByText('내가 넣으려던 값은 빅뱅 30,000원이에요.')).toBeTruthy()
    expect(within(ask).getAllByRole('button').map((button) => button.textContent)).toEqual([SYNC_KEEP, SYNC_MINE])
    expect(SYNC_KEEP).toBe('그 값 두기')
    expect(SYNC_MINE).toBe('내 값으로 바꾸기')
    expectSideBySide(within(ask).getByRole('button', { name: SYNC_KEEP }), within(ask).getByRole('button', { name: SYNC_MINE }))
    // 묻는 동안에는 더 보내지 않는다
    expect(world.events).toHaveLength(1)
  })

  it('[내 값으로 바꾸기]는 품종·가격을 고친다 (가격은 "원"을 붙인 원문) — 확정된 찜이 없으면 묻지 않고, 상품 추가를 닫는다', async () => {
    const world = clashWorld(product(313, { name: '빅뱅', price: 10_000 }))
    await addMine(world)
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: SYNC_MINE }))
    await waitFor(() => expect(world.events).toHaveLength(2))
    expect(world.events[1]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', noText: '313', priceText: '30000원', name: '빅뱅' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '상품 추가' })).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('[그 값 두기]는 아무것도 더 보내지 않고 상품 추가를 닫는다', async () => {
    const world = clashWorld(product(313, { name: '빅뱅', price: 10_000 }))
    await addMine(world)
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: SYNC_KEEP }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '상품 추가' })).toBeNull())
    await flush()
    expect(world.events).toHaveLength(1)
  })

  it('팝업 바깥을 누르면 아무것도 보내지 않고 상품 추가에 남는다 — 그 번호 상품과 [그 상품 보기]가 보인다', async () => {
    const world = clashWorld(product(313, { name: '빅뱅', price: 10_000 }))
    const page = await addMine(world)
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: '팝업 닫기' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(world.events).toHaveLength(1)
    expect(within(page).getByText('지금 313번은 빅뱅 10,000원이에요.')).toBeTruthy()
    expect(within(page).getByRole('button', { name: SAME_NUMBER_SHOW })).toBeTruthy()
  })

  it('그 상품에 확정된 찜이 있으면 가격 적용 범위를 그대로 묻는다 (D-RETRO-20) — [찜한 손님도]면 그 찜에도 적용하게 보낸다', async () => {
    const world = clashWorld(product(313, { name: '빅뱅', price: 10_000, winners: ['u1'], winnerClaims: ['c1'] }), { claims: [claim('c1', 313, 'u1', { price: 10_000, amount: 10_000 })], buyers: [buyer('u1', '홍길동')] })
    await addMine(world)
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: SYNC_MINE }))
    const scope = await screen.findByRole('alertdialog', { name: priceScopeAsk(1) })
    expect(within(scope).getByText('313번 빅뱅 · 10,000원 → 30,000원')).toBeTruthy()
    expect(within(scope).getAllByRole('button').map((button) => button.textContent)).toEqual([PRICE_SCOPE_NEW, PRICE_SCOPE_ALL])
    expect(world.events).toHaveLength(1)
    fireEvent.click(within(scope).getByRole('button', { name: PRICE_SCOPE_ALL }))
    await waitFor(() => expect(world.events).toHaveLength(2))
    expect(world.events[1]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', noText: '313', priceText: '30000원', name: '빅뱅', applyTo: 'UNPAID_CLAIMS' })
  })

  it('그 번호가 확인 중이면 단추가 [그 값으로 확정 | 내 값으로 확정] — 내 값은 고친 뒤 확정을, 그 값은 그대로 확정을 보낸다', async () => {
    const held = product(313, { name: '빅뱅', price: 10_000, status: 'READY', tentative: { by: 'SYNC', reasons: ['OTHER_ACCOUNT', 'PENDING_CLAIMS'], candidates: { no: [], price: [], name: [] }, seq: 6, at: '2026-10-29T11:00:00.000Z' } })
    const world = clashWorld(held)
    await addMine(world)
    const ask = await screen.findByRole('alertdialog')
    expect(within(ask).getAllByRole('button').map((button) => button.textContent)).toEqual([SYNC_KEEP_CONFIRM, SYNC_MINE_CONFIRM])
    fireEvent.click(within(ask).getByRole('button', { name: SYNC_MINE_CONFIRM }))
    await waitFor(() => expect(world.events).toHaveLength(3))
    expect(world.events[1]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', noText: '313', priceText: '30000원', name: '빅뱅' })
    expect(world.events[2]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 313 })
  })

  it('확인 중일 때 [그 값으로 확정]은 그 값 그대로 확정을 보낸다', async () => {
    const held = product(313, { name: '빅뱅', price: 10_000, status: 'READY', tentative: { by: 'SYNC', reasons: ['OTHER_ACCOUNT'], candidates: { no: [], price: [], name: [] }, seq: 6, at: '2026-10-29T11:00:00.000Z' } })
    const world = clashWorld(held)
    await addMine(world)
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: SYNC_KEEP_CONFIRM }))
    await waitFor(() => expect(world.events).toHaveLength(2))
    expect(world.events[1]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 313, price: 10_000, name: '빅뱅' })
  })

  it('가게 이름은 글자로만 그린다 — 꺾쇠 글도 그대로 글자이고, 줄바꿈·제어 문자는 빈칸으로, 긴 이름은 자른다', async () => {
    const world = clashWorld(product(313, { name: '빅뱅', price: 10_000 }), {}, { ...CLASH, current: { ...CLASH.current, from: '<b>굵은가게</b>\n<img src=x onerror=alert(1)>' } })
    await addMine(world)
    const ask = await screen.findByRole('alertdialog')
    expect(ask.textContent).toContain('방금 다른 계정(<b>굵은가게</b> <img src=x onerror…)이 313번을')
    expect(ask.querySelector('b')).toBeNull()
    expect(ask.querySelector('img')).toBeNull()
    expect(shownFrom('  가게\u0000\t이름\r\n둘  ')).toBe('가게 이름 둘')
    expect(shownFrom('가'.repeat(40))).toBe(`${'가'.repeat(30)}…`)
    expect(shownFrom('   ')).toBeNull()
    expect(shownFrom(null)).toBeNull()
    expect(shownFrom(12)).toBeNull()
  })

  it('가게 이름을 모르면 "다른 계정"만, 품종이 비어 있으면 가격만 — 응답 모양이 다르면 알림을 띄우지 않는다', () => {
    const plain = readSyncClash({ syncClash: { no: 7, tried: { name: '', price: 30_000 }, current: { name: '', price: 10_000, from: null }, agoMs: 10 } })
    expect(plain).not.toBeNull()
    expect(clashTitle(plain!)).toBe('방금 다른 계정이 7번을 10,000원으로 넣었어요.')
    expect(clashMine(plain!)).toBe('내가 넣으려던 값은 30,000원이에요.')
    expect(readSyncClash({ changed: false })).toBeNull()
    expect(readSyncClash(null)).toBeNull()
    expect(readSyncClash({ syncClash: 'x' })).toBeNull()
    expect(readSyncClash({ syncClash: { no: '7', tried: { name: '', price: 1 }, current: { name: '', price: 2 } } })).toBeNull()
    expect(readSyncClash({ syncClash: { no: 7, tried: { name: '', price: '30000' }, current: { name: '', price: 2 } } })).toBeNull()
    expect(readSyncClash({ syncClash: { no: 7, tried: { name: '', price: 1 } } })).toBeNull()
  })
})
