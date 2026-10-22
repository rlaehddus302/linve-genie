// 옵션 없는 상품의 "개수" 칸 (ORD-11 화면, AC-ORD11-01~09, D-STK-01) — 실제 코어로 도는 가짜 서버.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { COUNT_PROBLEM, readCount, shrinkProblem } from '../src/lib/stock.ts'
import { chat, register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { FakeEventSource, flush } from './support.ts'

let engine: EngineServer

function setup(events: Record<string, unknown>[] = [], settings: Record<string, string> = {}) {
  engine = new EngineServer(events, { settings })
  vi.stubGlobal('fetch', engine.server.fetch)
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

async function openConsole() {
  render(<ConsolePage broadcastId="b1" navigate={vi.fn()} />)
  const quick = (await screen.findByLabelText('빠른 입력')) as HTMLInputElement
  await flush(10)
  const count = document.getElementById('quick-count') as HTMLInputElement
  return { quick, count }
}

const enter = (input: HTMLElement, text: string) => {
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

const posts = (type: string) => engine.posts.filter((post) => post.type === type)

describe('개수 글자 읽기 (AC-ORD11-04)', () => {
  it('1~999 정수만 받는다', () => {
    expect(readCount('1')).toBe(1)
    expect(readCount(' 3 ')).toBe(3)
    expect(readCount('999')).toBe(999)
    for (const bad of ['0', '1000', '2.5', '', '  ', '세개', '3개', '-1', '1e2']) expect(readCount(bad)).toBeNull()
  })
})

describe('빠른 입력 줄 옆 개수 칸 (AC-ORD11-01·02·04)', () => {
  it('기본 1, 3으로 두고 Enter → stock 3으로 등록하고 칸은 1로 돌아간다', async () => {
    setup()
    const { quick, count } = await openConsole()
    expect(screen.getByLabelText('개수', { selector: '#quick-count' })).toBe(count)
    expect(count.value).toBe('1')
    expect(count.inputMode).toBe('numeric')
    fireEvent.change(count, { target: { value: '3' } })
    enter(quick, '15 초코과자 3000')
    await waitFor(() => expect(posts('product.register')).toHaveLength(1))
    expect(posts('product.register')[0]).toMatchObject({ no: 15, name: '초코과자', price: 3000, stock: 3 })
    expect(count.value).toBe('1')
    // 다음 상품에 3이 따라가지 않는다
    await waitFor(() => expect(quick.value).toBe(''))
    enter(quick, '16 핑크프릴 10000')
    await waitFor(() => expect(posts('product.register')).toHaveLength(2))
    expect(posts('product.register')[1]).not.toHaveProperty('stock')
    expect(await screen.findByText('3개 중 3개 남음', { selector: '.board-item span' })).toBeDefined()
  })

  it('개수 1이면 stock을 보내지 않는다 (지금 등록과 같다)', async () => {
    setup()
    const { quick } = await openConsole()
    enter(quick, '15 초코과자 3000')
    await waitFor(() => expect(posts('product.register')).toHaveLength(1))
    expect(posts('product.register')[0]).not.toHaveProperty('stock')
  })

  it('줄 끝의 "3개"·"×3"은 개수로 읽지 않는다 — 개수는 칸으로만', async () => {
    setup()
    const { quick } = await openConsole()
    enter(quick, '15 초코과자 3000 3개')
    enter(quick, '16 핑크프릴 8 ×3')
    await flush(20)
    for (const post of posts('product.register')) expect(post).not.toHaveProperty('stock')
  })

  it.each(['0', '1000', '2.5', '', '세개'])('개수 "%s"면 보내지 않고 알린다', async (bad) => {
    setup()
    const { quick, count } = await openConsole()
    fireEvent.change(count, { target: { value: bad } })
    enter(quick, '15 초코과자 3000')
    expect(await screen.findByText(COUNT_PROBLEM)).toBeDefined()
    await flush(10)
    expect(posts('product.register')).toHaveLength(0)
    // 친 줄은 칸에 남는다
    expect(quick.value).toBe('15 초코과자 3000')
    fireEvent.change(count, { target: { value: '2' } })
    expect(screen.queryByText(COUNT_PROBLEM)).toBeNull()
    fireEvent.keyDown(count, { key: 'Enter' })
    await waitFor(() => expect(posts('product.register')).toHaveLength(1))
    expect(posts('product.register')[0]).toMatchObject({ no: 15, stock: 2 })
  })
})

describe('자세히 등록(번호·품종·가격 칸)의 개수 칸 (AC-ORD11-03)', () => {
  it('고치기 칸에도 개수 칸이 있고 3이면 재고 3으로 등록한다', async () => {
    setup()
    const { quick } = await openConsole()
    enter(quick, '15 초코과자')
    const fix = await screen.findByRole('group', { name: '고치기 칸' })
    const field = within(fix).getByLabelText('개수') as HTMLInputElement
    expect(field.value).toBe('1')
    expect(field.inputMode).toBe('numeric')
    fireEvent.change(within(fix).getByLabelText('가격'), { target: { value: '3000' } })
    fireEvent.change(field, { target: { value: '3' } })
    fireEvent.click(within(fix).getByRole('button', { name: '등록' }))
    await waitFor(() => expect(posts('product.register')).toHaveLength(1))
    expect(posts('product.register')[0]).toMatchObject({ no: 15, price: 3000, stock: 3 })
  })
})

describe('상품 "고치기"로 개수 늘림·줄임 (AC-ORD11-05·06·07)', () => {
  const three = [register(15, '초코과자', 3000), chat('m1', 'UC_aaaa1111', '가영', '15'), chat('m2', 'UC_bbbb2222', '나래', '15'), chat('m3', 'UC_cccc3333', '다솜', '15')]

  async function openEdit() {
    const { quick } = await openConsole()
    enter(quick, '15')
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    fireEvent.click(within(detail).getByRole('button', { name: '고치기' }))
    const form = await screen.findByRole('dialog', { name: '15번 고치기' })
    return within(form).getByLabelText('개수') as HTMLInputElement
  }

  it('재고 1·1등 A·대기 B·C에서 3으로 → product.update stock 3, 1등 셋', async () => {
    setup(three)
    const field = await openEdit()
    expect(field.value).toBe('1')
    fireEvent.change(field, { target: { value: '3' } })
    fireEvent.click(within(screen.getByRole('dialog', { name: '15번 고치기' })).getByRole('button', { name: '고치기' }))
    await waitFor(() => expect(posts('product.update')).toHaveLength(1))
    expect(posts('product.update')[0]).toEqual(expect.objectContaining({ type: 'product.update', b: 'b1', no: 15, stock: 3 }))
    expect(posts('product.update')[0]).not.toHaveProperty('price')
    const current = await screen.findByRole('region', { name: '현재 상품' })
    await waitFor(() => expect(within(current).getByText('1등: 가영, 나래, 다솜')).toBeDefined())
    expect(within(current).getByText('3개 중 0개 남음')).toBeDefined()
  })

  it('확정 3명인 상품을 2로 줄이면 보내지 않고 알린다, 3이면 그대로(품절)', async () => {
    setup([...three, { type: 'product.update', b: 'b1', no: 15, stock: 3 }])
    const field = await openEdit()
    expect(field.value).toBe('3')
    fireEvent.change(field, { target: { value: '2' } })
    const form = screen.getByRole('dialog', { name: '15번 고치기' })
    fireEvent.click(within(form).getByRole('button', { name: '고치기' }))
    expect(await within(form).findByText(shrinkProblem(3))).toBeDefined()
    expect(shrinkProblem(3)).toBe('이미 3명이 찜해서 3개보다 적게 줄일 수 없어요. 먼저 찜을 무효로 해 주세요.')
    await flush(10)
    expect(posts('product.update')).toHaveLength(0)
  })

  it('재고 2 이상이면 남은 개수를 보이고, 재고 1이면 붙이지 않는다', async () => {
    setup([register(15, '초코과자', 3000), { type: 'product.update', b: 'b1', no: 15, stock: 3 }, chat('m1', 'UC_aaaa1111', '가영', '15'), register(16, '핑크프릴', 10000)])
    const { quick } = await openConsole()
    const board = await screen.findByRole('region', { name: '상품 보드' })
    expect(within(board).getByText('3개 중 2개 남음')).toBeDefined()
    expect(within(board).getAllByText(/개 남음/)).toHaveLength(1)
    enter(quick, '15')
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    expect(within(detail).getByText('3개 중 2개 남음')).toBeDefined()
  })
})

describe('같은 번호 "고칠까요?"와 개수 (AC-ORD11-08)', () => {
  it('개수 1이면 지금처럼 품종·가격만', async () => {
    setup([register(15, '핑크프릴', 10000)])
    const { quick } = await openConsole()
    enter(quick, '15 핑크프릴 12000')
    const ask = await screen.findByRole('dialog', { name: '15번이 이미 있어요. 고칠까요?' })
    expect(within(ask).queryByText(/개수/)).toBeNull()
    fireEvent.click(within(ask).getByRole('button', { name: '예' }))
    await waitFor(() => expect(posts('product.update')).toHaveLength(1))
    expect(posts('product.update')[0]).toMatchObject({ no: 15, price: 12000 })
    expect(posts('product.update')[0]).not.toHaveProperty('stock')
  })

  it('개수 3이면 "개수 3개로"를 함께 보이고 한 번에 고친다, 칸은 1로', async () => {
    setup([register(15, '핑크프릴', 10000)])
    const { quick, count } = await openConsole()
    fireEvent.change(count, { target: { value: '3' } })
    enter(quick, '15 핑크프릴 12000')
    const ask = await screen.findByRole('dialog', { name: '15번이 이미 있어요. 고칠까요?' })
    expect(within(ask).getByText('개수 3개로 함께 고쳐요.')).toBeDefined()
    expect(count.value).toBe('1')
    fireEvent.click(within(ask).getByRole('button', { name: '예' }))
    await waitFor(() => expect(posts('product.update')).toHaveLength(1))
    expect(posts('product.update')[0]).toMatchObject({ no: 15, price: 12000, stock: 3 })
  })

  it('줄임이 막히면 줄임 문장을 보이고 보내지 않는다', async () => {
    setup([register(15, '핑크프릴', 10000), { type: 'product.update', b: 'b1', no: 15, stock: 3 }, chat('m1', 'UC_a1', '가영', '15'), chat('m2', 'UC_b2', '나래', '15'), chat('m3', 'UC_c3', '다솜', '15')])
    const { quick, count } = await openConsole()
    fireEvent.change(count, { target: { value: '2' } })
    enter(quick, '15 핑크프릴 10000')
    const ask = await screen.findByRole('dialog', { name: '15번이 이미 있어요. 고칠까요?' })
    fireEvent.click(within(ask).getByRole('button', { name: '예' }))
    expect(await within(ask).findByText(shrinkProblem(3))).toBeDefined()
    await flush(10)
    expect(posts('product.update')).toHaveLength(0)
  })
})

describe('옵션 상품은 개수 칸 대신 변형 재고 표 (AC-ORD11-09)', () => {
  const OPTIONS = { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' }
  const SHORTS = { name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }] }

  it('옵션 상품의 "고치기"에는 개수 칸이 없다', async () => {
    setup([{ type: 'product.register', b: 'b1', no: 21, name: '반바지', price: 15000, options: [SHORTS], stocks: { S: 2, M: 1 } }], OPTIONS)
    const { quick } = await openConsole()
    enter(quick, '21')
    const detail = await screen.findByRole('dialog', { name: '21번 자세히' })
    expect(within(detail).queryByText(/개 남음/)).toBeNull()
    fireEvent.click(within(detail).getByRole('button', { name: '고치기' }))
    const form = await screen.findByRole('dialog', { name: '21번 고치기' })
    expect(within(form).queryByLabelText('개수')).toBeNull()
  })

  it('빠른 입력 줄에 옵션을 붙이면 개수 칸이 없어지고 stock을 보내지 않는다', async () => {
    setup([], OPTIONS)
    const { quick } = await openConsole()
    expect(document.getElementById('quick-count')).not.toBeNull()
    fireEvent.change(quick, { target: { value: '21 반바지 15000' } })
    fireEvent.click(screen.getByRole('button', { name: '옵션 추가' }))
    const dialog = await screen.findByRole('dialog', { name: '옵션 추가' })
    fireEvent.click(within(dialog).getByRole('button', { name: '항목 더하기' }))
    fireEvent.change(within(dialog).getByLabelText('항목 1 이름'), { target: { value: '사이즈' } })
    fireEvent.change(within(dialog).getByLabelText('항목 1 선택지 여러 개'), { target: { value: 'S, M' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '항목 1 선택지 한 번에 더하기' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '옵션 넣기' }))
    await screen.findByRole('group', { name: '붙은 옵션' })
    expect(document.getElementById('quick-count')).toBeNull()
    fireEvent.keyDown(quick, { key: 'Enter' })
    await waitFor(() => expect(posts('product.register')).toHaveLength(1))
    expect(posts('product.register')[0]).not.toHaveProperty('stock')
    // 등록 뒤 옵션이 떨어지면 개수 칸이 다시 보인다 (값 1)
    await waitFor(() => expect((document.getElementById('quick-count') as HTMLInputElement | null)?.value).toBe('1'))
  })
})
