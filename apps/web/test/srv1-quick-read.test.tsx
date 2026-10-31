// SRV1 빠른 입력은 서버가 읽는다 (D-APP-24, acceptance 약속 2·3, AC-SRV1-04·06, APP-05 AC10·AC11).
// - 미리 보기는 서버 읽기 입구의 답이다: 가격 단위 천원 방송에서 `15 핑크프릴 20` → "등록하면: 15번 핑크프릴 20,000원"
// - 등록 본문은 친 원문(text) — 번호·품종·가격 칸 없이. 서버가 같은 함수로 다시 읽어 15번 20,000원 하나를 기록한다
// - 읽기 입구가 답하지 않으면 미리 보기 줄은 비고(앞 글의 옛 답도 없음), Enter 줄은 "저장하지 못했어요"로 남고 연결이 돌아오면 같은 원문·같은 요청 번호로 한 번만
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, flush } from './support.ts'

let engine: EngineServer

beforeEach(() => {
  engine = new EngineServer([], { settings: { 'price.unit': 'THOUSAND' } })
  vi.stubGlobal('fetch', engine.server.fetch)
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
  return quick
}

const registerCalls = () => engine.server.callsTo('POST', /^\/api\/events$/).filter((call) => call.body?.type === 'product.register')
const willRegister = () => (document.querySelector('.quick-will-register') as HTMLElement).textContent

describe('빠른 입력 미리 보기·등록은 서버 읽기 (AC-SRV1-04)', () => {
  it('천원 방송 "15 핑크프릴 20": 미리 보기는 서버 답, 등록 본문은 친 원문, 15번 20,000원 하나', async () => {
    const quick = await openConsole()
    fireEvent.change(quick, { target: { value: '15 핑크프릴 20' } })
    // 답이 오기 전에는 비어 있다 (기기는 읽지 않는다)
    expect(willRegister()).toBe('')
    await waitFor(() => expect(willRegister()).toBe('등록하면: 15번 핑크프릴 20,000원'))
    const reads = engine.server.reads.map((call) => call.body)
    expect(reads.at(-1)).toEqual({ kind: 'quick', text: '15 핑크프릴 20' })
    expect(engine.server.reads.at(-1)?.path).toBe('/api/broadcasts/b1/read')
    fireEvent.keyDown(quick, { key: 'Enter' })
    await waitFor(() => expect(registerCalls()).toHaveLength(1))
    const body = registerCalls()[0]?.body ?? {}
    expect(body).toMatchObject({ type: 'product.register', b: 'b1', text: '15 핑크프릴 20' })
    expect(body).not.toHaveProperty('no')
    expect(body).not.toHaveProperty('price')
    expect(body).not.toHaveProperty('name')
    expect(await screen.findByText('15번을 등록했어요')).toBeDefined()
    expect(engine.posts.at(-1)).toMatchObject({ no: 15, name: '핑크프릴', price: 20000 })
  })
})

describe('읽기 입구가 답하지 않을 때 (AC-SRV1-06, APP-05 AC11)', () => {
  it('미리 보기 줄은 비고 옛 답이 남지 않는다 → Enter는 "저장하지 못했어요" → 연결이 돌아오면 같은 원문·같은 요청 번호로 한 번만 등록', async () => {
    const quick = await openConsole()
    fireEvent.change(quick, { target: { value: '14 금황 5' } })
    await waitFor(() => expect(willRegister()).toBe('등록하면: 14번 금황 5,000원'))
    engine.server.readDown = true
    engine.down = true
    fireEvent.change(quick, { target: { value: '15 핑크프릴 20' } })
    // 앞 글(14 금황 5)의 옛 답은 보이지 않고, 지금 글의 답은 오지 않는다
    expect(willRegister()).toBe('')
    await flush(20)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(willRegister()).toBe('')
    fireEvent.keyDown(quick, { key: 'Enter' })
    expect(await screen.findByText('저장하지 못했어요: 15 핑크프릴 20', {}, { timeout: 6000 })).toBeDefined()
    expect(registerCalls()).toHaveLength(0)
    // 연결이 돌아옴
    engine.server.readDown = false
    engine.down = false
    for (const stream of FakeEventSource.instances) if (!stream.closed) stream.emit('ready', { scopes: [{ date: DATE, rehearsal: false, seq: engine.seq }] })
    for (const stream of FakeEventSource.instances) if (!stream.closed) stream.emit('ready', { scopes: [{ date: DATE, rehearsal: false, seq: engine.seq }] })
    await waitFor(() => expect(registerCalls().length).toBeGreaterThan(0), { timeout: 6000 })
    await flush(20)
    const sent = registerCalls().map((call) => call.body ?? {})
    expect(sent.every((body) => body.text === '15 핑크프릴 20')).toBe(true)
    expect(new Set(sent.map((body) => body.requestId)).size).toBe(1)
    expect(engine.posts.filter((post) => post.type === 'product.register' && post.no === 15)).toHaveLength(1)
    await waitFor(() => expect(screen.queryByText(/저장하지 못했어요/)).toBeNull())
  }, 20_000)
})
