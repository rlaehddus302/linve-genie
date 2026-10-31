// 빠른 입력 등록을 연결이 돌아와 저절로 다시 보낼 때 (SA-MOB2-03·TE-MOB2-006·RA-MOB2-06, D-MOB2-14 — D-MOB2-10의 "요청 0"을 대신함, D-MOB2-07, SPEC UX-06).
// 화면에 그 번호가 있는지 미리 보지 않고 처음 요청 번호로 한 번 보내 서버 답으로 판단한다:
// - changed: false(다른 기기가 먼저 등록 — 다시 이어지기 전에 알았든 뒤에 알든) → "고칠까요?" 창 없이 실패 줄을 내리고 빠른 입력칸 아래
//   role="status"에 "연결이 돌아와 보내려 했지만 n번이 이미 있어 등록하지 않았어요.", 붙인 옵션이 있었으면 "붙인 옵션은 n번에 넣지 않고 뗐어요…".
//   개수 칸·붙인 옵션은 되살리지 않는다. 다른 기기의 상품은 그대로.
// - changed: true(응답만 잃은 자기 등록 — 서버가 처음 결과를 돌려줌) → 평소 등록 성공과 같다("연결이 돌아와 보냈어요: n번을 등록했어요"), 안내 두 줄 없음.
// 판매자가 "다시 보내기"를 직접 누르면 지금처럼 "고칠까요?" 창.
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

const AUTO_NOTE = "연결이 돌아오면 저절로 다시 보내요. 바로 보내려면 '다시 보내기'를 눌러도 돼요."

/** 이 줄의 등록 요청들 (같은 요청 번호인지 본다). SRV1(D-APP-24): 빠른 입력 등록 본문은 친 원문(text)이라 그 줄의 번호로 고른다 — 옛 기대는 본문 no */
const registerPosts = (no: number) =>
  engine.server.callsTo('POST', /^\/api\/events/).filter((call) => call.body?.type === 'product.register' && (call.body.no === no || (typeof call.body.text === 'string' && call.body.text.startsWith(`${String(no)} `))))

/** 끊긴 채 등록 → 실패 줄 (D-MOB2-16 (2) 문장) */
async function failWhileDown(quick: HTMLInputElement, line: string) {
  engine.down = true
  enter(quick, line)
  expect(await screen.findByText(`저장하지 못했어요: ${line}`, {}, { timeout: 6000 })).toBeDefined()
  expect(screen.getByText(AUTO_NOTE)).toBeDefined()
  expect(screen.queryByText(/다시 보내기를 눌러 주세요/)).toBeNull()
}

const board = () => screen.getByRole('region', { name: '상품 보드' })
const boardItem = (no: number) => within(board()).queryByRole('button', { name: new RegExp(`^${String(no)}번`) })

/** 끊긴 채 등록 → 실패 줄 → 다른 기기가 같은 번호 등록. early면 다시 이어지기 전에 알림으로 화면도 앎, 아니면 화면은 모름(끊긴 동안) */
async function failThenOtherDevice(quick: HTMLInputElement, line: string, no: number, early: boolean) {
  await failWhileDown(quick, line)
  engine.down = false
  if (early) {
    engine.write(register(no, '청보석', 20000))
    await waitFor(() => expect(boardItem(no)).not.toBeNull())
  } else {
    engine.writeQuietly(register(no, '청보석', 20000))
    await flush(10)
    expect(boardItem(no)).toBeNull()
  }
}

describe('저절로 다시 보낸 빠른 입력 등록에 서버가 "이미 있음"(changed: false)이면 창 없이 한 줄 안내 (SA-MOB2-03·TE-MOB2-006, D-MOB2-14)', () => {
  for (const early of [true, false]) {
    const order = early ? '다른 기기 등록을 다시 이어지기 전에 앎' : '다른 기기 등록을 다시 이어진 뒤에 앎'
    it(`옵션 없음 · ${order}: 처음 요청 번호로 요청 1, "연결이 돌아와 보내려 했지만 15번이 이미 있어 등록하지 않았어요." — "고칠까요?" 창·옵션 안내 없음, 15번 청보석 그대로`, async () => {
      setup()
      const { quick } = await openConsole()
      reconnect() // 첫 연결
      await failThenOtherDevice(quick, '15 핑크프릴 10000', 15, early)
      const firstId = registerPosts(15)[0]?.body?.requestId
      expect(typeof firstId).toBe('string')
      const before = registerPosts(15).length
      reconnect() // 다시 이어짐
      const note = await screen.findByText(existsOnResendWords(15))
      expect(note.getAttribute('role')).toBe('status')
      expect(note.textContent).toBe('연결이 돌아와 보내려 했지만 15번이 이미 있어 등록하지 않았어요.')
      await flush(10)
      const sent = registerPosts(15).slice(before)
      expect(sent.length).toBe(1)
      expect(sent[0]?.body?.requestId).toBe(firstId)
      expect(screen.queryByText(/저장하지 못했어요/)).toBeNull()
      expect(screen.queryByText(/연결이 돌아와 보냈어요/)).toBeNull()
      expect(screen.queryByText(/붙인 옵션은/)).toBeNull()
      // 화면이 따라잡은 뒤에도 창이 저절로 열리지 않고, 다른 기기의 15번은 그대로
      await waitFor(() => expect(boardItem(15)).not.toBeNull())
      await flush(10)
      expect(screen.queryByRole('dialog', { name: '15번이 이미 있어요. 고칠까요?' })).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(boardItem(15)?.textContent).toContain('청보석')
      expect(boardItem(15)?.textContent).not.toContain('핑크프릴')
      // 다음 빠른 입력 등록을 하면 안내를 내린다
      enter(quick, '16 금황 5000')
      await waitFor(() => expect(screen.queryByText(existsOnResendWords(15))).toBeNull())
    }, 15_000)

    it(`붙인 옵션 줄 · ${order}: 한 줄 안내와 함께 "붙인 옵션은 21번에 넣지 않고 뗐어요…" — 요청 1, 붙인 옵션은 되살리지 않음`, async () => {
      setup(OPTIONS)
      const { quick } = await openConsole()
      reconnect()
      await attachSizes()
      await failThenOtherDevice(quick, '21 반바지 15000', 21, early)
      const before = registerPosts(21).length
      reconnect()
      expect(await screen.findByText(existsOnResendWords(21))).toBeDefined()
      expect(screen.getByText(/붙인 옵션은 21번에 넣지 않고 뗐어요/).getAttribute('role')).toBe('status')
      await flush(10)
      expect(registerPosts(21).length - before).toBe(1)
      await waitFor(() => expect(boardItem(21)).not.toBeNull())
      await flush(10)
      expect(screen.queryByRole('dialog', { name: '21번이 이미 있어요. 고칠까요?' })).toBeNull()
      expect(screen.queryByText(/저장하지 못했어요/)).toBeNull()
      expect(screen.queryByText('옵션: 사이즈 S/M/L · 변형 3개')).toBeNull()
    }, 15_000)
  }

  it('판매자가 "다시 보내기"를 직접 누르면 지금처럼 "고칠까요?" 창 — 한 줄 안내는 없다', async () => {
    setup()
    const { quick } = await openConsole()
    reconnect()
    await failThenOtherDevice(quick, '15 핑크프릴 10000', 15, true)
    fireEvent.click(screen.getByRole('button', { name: '다시 보내기' }))
    expect(await screen.findByRole('dialog', { name: '15번이 이미 있어요. 고칠까요?' })).toBeDefined()
    expect(screen.queryByText(existsOnResendWords(15))).toBeNull()
  }, 15_000)
})

describe('응답만 잃은 자기 등록을 저절로 다시 보내면 평소 등록 성공과 같다 (RA-MOB2-06, D-MOB2-14 (1))', () => {
  it('옵션 없음: 서버는 기록했지만 응답을 잃음 → 따라잡기로 15번이 보여도 같은 요청 번호로 한 번 보내 "연결이 돌아와 보냈어요: 15번을 등록했어요" — "이미 있어"·옵션 안내 없음, 기록 하나', async () => {
    setup()
    const { quick } = await openConsole()
    reconnect()
    engine.loseReply = true
    enter(quick, '15 핑크프릴 10000')
    expect(await screen.findByText('저장하지 못했어요: 15 핑크프릴 10000', {}, { timeout: 6000 })).toBeDefined()
    expect(screen.getByText(AUTO_NOTE)).toBeDefined()
    engine.loseReply = false
    // 서버에는 기록돼 따라잡기로 15번이 보인다 (자기 등록)
    await waitFor(() => expect(boardItem(15)).not.toBeNull())
    const firstId = registerPosts(15)[0]?.body?.requestId
    const before = registerPosts(15).length
    reconnect()
    expect(await screen.findByText('연결이 돌아와 보냈어요: 15번을 등록했어요')).toBeDefined()
    expect(screen.getByRole('button', { name: '15번 등록 되돌리기' })).toBeDefined()
    const sent = registerPosts(15).slice(before)
    expect(sent.length).toBe(1)
    expect(sent[0]?.body?.requestId).toBe(firstId)
    // 서버 기록은 하나 (같은 요청 번호)
    expect(engine.posts.filter((post) => post.type === 'product.register' && post.no === 15).length).toBe(1)
    expect(screen.queryByText(existsOnResendWords(15))).toBeNull()
    expect(screen.queryByText(/붙인 옵션은/)).toBeNull()
    expect(screen.queryByText(/저장하지 못했어요/)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(boardItem(15)?.textContent).toContain('핑크프릴')
  }, 15_000)

  it('붙인 옵션 줄: 응답만 잃은 자기 등록 → 평소 성공, "옵션을 넣지 않고 뗐어요" 없음 — 처음 요청에 옵션이 함께 들어갔다', async () => {
    setup(OPTIONS)
    const { quick } = await openConsole()
    reconnect()
    await attachSizes()
    engine.loseReply = true
    enter(quick, '21 반바지 15000')
    expect(await screen.findByText('저장하지 못했어요: 21 반바지 15000', {}, { timeout: 6000 })).toBeDefined()
    engine.loseReply = false
    await waitFor(() => expect(boardItem(21)).not.toBeNull())
    reconnect()
    expect(await screen.findByText('연결이 돌아와 보냈어요: 21번을 등록했어요')).toBeDefined()
    const recorded = engine.posts.filter((post) => post.type === 'product.register' && post.no === 21)
    expect(recorded.length).toBe(1)
    expect(Array.isArray(recorded[0]?.options)).toBe(true)
    expect(screen.queryByText(existsOnResendWords(21))).toBeNull()
    expect(screen.queryByText(/붙인 옵션은/)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  }, 15_000)
})
