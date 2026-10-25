// 빠른 입력 등록을 연결이 돌아와 저절로 다시 보내기 직전 그 번호가 이미 있으면 (SA-MOB2-03, D-MOB2-10, D-MOB2-07, SPEC UX-06 MOB2 세부).
// 보내지 않고(요청 0) 실패 줄을 내린 뒤 빠른 입력칸 아래 role="status"에 "연결이 돌아와 보내려 했지만 n번이 이미 있어 등록하지 않았어요.",
// 붙인 옵션 줄이 있었으면 "붙인 옵션은 n번에 넣지 않고 뗐어요…"도. 판매자가 "다시 보내기"를 직접 누르면 지금처럼 "고칠까요?" 창.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { existsOnResendWords } from '../src/lib/resend-board.ts'
import { register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, flush } from './support.ts'

const OPTIONS = { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } as const

let engine: EngineServer

function setup(settings: Record<string, string> = {}) {
  engine = new EngineServer([], { settings })
  vi.stubGlobal('fetch', engine.server.fetch)
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

async function openConsole() {
  render(<ConsolePage broadcastId="b1" navigate={() => {}} />)
  const quick = (await screen.findByLabelText('빠른 입력')) as HTMLInputElement
  await flush(10)
  return { quick }
}

const enter = (input: HTMLElement, text: string) => {
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

/** 실시간 연결이 (다시) 이어짐 — 두 번째부터 저절로 다시 보내기 (D-MOB2-07) */
const reconnect = () => {
  for (const stream of FakeEventSource.instances) if (!stream.closed) stream.emit('ready', { scopes: [{ date: DATE, rehearsal: false, seq: engine.seq }] })
}

const eventPosts = () => engine.server.callsTo('POST', /^\/api\/events/).length

async function attachSizes() {
  fireEvent.click(screen.getByRole('button', { name: '옵션 추가' }))
  const dialog = await screen.findByRole('dialog', { name: '옵션 추가' })
  fireEvent.click(within(dialog).getByRole('button', { name: '항목 더하기' }))
  fireEvent.change(within(dialog).getByLabelText('항목 1 이름'), { target: { value: '사이즈' } })
  fireEvent.change(within(dialog).getByLabelText('항목 1 선택지 여러 개'), { target: { value: 'S, M, L' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '항목 1 선택지 한 번에 더하기' }))
  fireEvent.click(within(dialog).getByRole('button', { name: '옵션 넣기' }))
  expect(await screen.findByText('옵션: 사이즈 S/M/L · 변형 3개')).toBeDefined()
}

/** 끊긴 채 등록 → 실패 줄 → 다른 기기가 같은 번호 등록(알림으로 화면도 앎) */
async function failThenOtherDevice(quick: HTMLInputElement, line: string, no: number) {
  engine.down = true
  enter(quick, line)
  expect(await screen.findByText(/저장하지 못했어요/, {}, { timeout: 6000 })).toBeDefined()
  expect(screen.getByText('연결이 돌아오면 저절로 다시 보내요.')).toBeDefined()
  engine.down = false
  engine.write(register(no, '청보석', 20000))
  await waitFor(() => expect(within(screen.getByRole('region', { name: '상품 보드' })).getByRole('button', { name: new RegExp(`^${String(no)}번`) })).toBeDefined())
}

describe('저절로 다시 보낼 빠른 입력 등록의 번호가 이미 있으면 보내지 않고 한 줄 안내 (SA-MOB2-03, D-MOB2-10)', () => {
  it('옵션 없음: 요청 0, 실패 줄을 내리고 "연결이 돌아와 보내려 했지만 15번이 이미 있어 등록하지 않았어요." — "고칠까요?" 창·옵션 안내는 없다', async () => {
    setup()
    const { quick } = await openConsole()
    reconnect() // 첫 연결
    await failThenOtherDevice(quick, '15 핑크프릴 10000', 15)
    const before = eventPosts()
    reconnect() // 다시 이어짐
    const note = await screen.findByText(existsOnResendWords(15))
    expect(note.getAttribute('role')).toBe('status')
    expect(note.textContent).toBe('연결이 돌아와 보내려 했지만 15번이 이미 있어 등록하지 않았어요.')
    await flush(10)
    expect(eventPosts()).toBe(before)
    expect(screen.queryByText(/저장하지 못했어요/)).toBeNull()
    expect(screen.queryByRole('dialog', { name: '15번이 이미 있어요. 고칠까요?' })).toBeNull()
    expect(screen.queryByText(/붙인 옵션은/)).toBeNull()
    // 다음 빠른 입력 등록을 하면 안내를 내린다
    enter(quick, '16 금황 5000')
    await waitFor(() => expect(screen.queryByText(existsOnResendWords(15))).toBeNull())
  }, 15_000)

  it('붙인 옵션 줄: 한 줄 안내와 함께 "붙인 옵션은 21번에 넣지 않고 뗐어요…" — 요청 0', async () => {
    setup(OPTIONS)
    const { quick } = await openConsole()
    reconnect()
    await attachSizes()
    await failThenOtherDevice(quick, '21 반바지 15000', 21)
    const before = eventPosts()
    reconnect()
    expect(await screen.findByText(existsOnResendWords(21))).toBeDefined()
    expect(screen.getByText(/붙인 옵션은 21번에 넣지 않고 뗐어요/).getAttribute('role')).toBe('status')
    await flush(10)
    expect(eventPosts()).toBe(before)
    expect(screen.queryByRole('dialog', { name: '21번이 이미 있어요. 고칠까요?' })).toBeNull()
    expect(screen.queryByText(/저장하지 못했어요/)).toBeNull()
  }, 15_000)

  it('판매자가 "다시 보내기"를 직접 누르면 지금처럼 "고칠까요?" 창 — 한 줄 안내는 없다', async () => {
    setup()
    const { quick } = await openConsole()
    reconnect()
    await failThenOtherDevice(quick, '15 핑크프릴 10000', 15)
    fireEvent.click(screen.getByRole('button', { name: '다시 보내기' }))
    expect(await screen.findByRole('dialog', { name: '15번이 이미 있어요. 고칠까요?' })).toBeDefined()
    expect(screen.queryByText(existsOnResendWords(15))).toBeNull()
  }, 15_000)
})
