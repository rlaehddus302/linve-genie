// D-UX4-86 (사용자 지시 2026-11-10 "앱 안에 있는 모든 '방송' 단어 다 라이브로"): 화면 낱말이 바뀌어 기대 글의 '방송'을 '라이브'로(조사 포함) 바꿨다.
// 방송 화면을 나가도 방송 소리를 계속 듣는다 (D-UX3-48, 사용자 지시 2026-11-06 "나가도 계속 듣게").
// 앱 뿌리(KeptStreamAudio)가 마지막으로 연 방송 중인 방송을 붙잡아, 방송 화면이 닫혀도 상태 읽기·"듣는 중" 알림·받아쓴 글을 받을 연결을 그대로 둔다.
// 방송이 끝나면(서버 상태 ended) 놓는다.
import { act, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { configureVoiceStorage } from '../src/lib/voice-preferences.ts'
import { makeWorld } from './screen-support.tsx'
import { flush } from './support.ts'

const STATUS = /^\/api\/broadcasts\/b1\/stream-audio$/
const WATCH = /^\/api\/broadcasts\/b1\/stream-audio\/watch$/

function Shell() {
  const [console, setConsole] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setConsole(false)}>나가기</button>
      {console ? <ConsoleScreen broadcastId="b1" seller onBack={() => {}} /> : <p>다른 화면</p>}
    </>
  )
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('라이브 화면을 나가도 라이브 소리 듣기 (D-UX3-48)', () => {
  it('라이브 화면을 닫아도 서버 상태 읽기·듣는 중 알림이 이어지고 받아쓴 글 연결을 닫지 않으며, 라이브가 끝나면 놓는다', async () => {
    const saved = new Map<string, string>()
    configureVoiceStorage({ getItem: async (key) => saved.get(key) ?? null, setItem: async (key, value) => { saved.set(key, value) }, removeItem: async (key) => { saved.delete(key) } })
    const world = makeWorld()
    let phase = 'listening'
    world.server.on('GET', STATUS, () => ({ body: { phase } }))
    world.server.on('POST', WATCH, () => ({ body: { phase } }))
    world.server.on('POST', /^\/api\/broadcasts\/b1\/voice-ticket/, () => ({ body: { wsUrl: 'ws://test.local/api/voice?ticket=t' } }))
    render(world.wrap(<Shell />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    // 안내 카드 없이 바로 듣기 시작 (D-LV1-16)
    expect(screen.queryByRole('button', { name: '확인하고 듣기' })).toBeNull()
    await waitFor(() => expect(world.server.callsTo('POST', WATCH).length).toBeGreaterThan(0))
    expect(world.services.streamKeep.getKept()?.broadcastId).toBe('b1')
    // 받아쓴 글을 받을 마이크 없는 연결이 열렸다
    await waitFor(() => expect(world.audio.starts.some((start) => !start.capture)).toBe(true))

    // 방송 화면을 나간다
    await act(async () => { screen.getByRole('button', { name: '나가기' }).click(); await flush() })
    expect(screen.queryByTestId('console-screen')).toBeNull()
    const stopsAtLeave = world.audio.stops
    const reads = world.server.callsTo('GET', STATUS).length
    await act(async () => { await wait(1_300) })
    expect(world.server.callsTo('GET', STATUS).length).toBeGreaterThan(reads)
    expect(world.services.streamKeep.getKept()?.broadcastId).toBe('b1')
    expect(world.audio.stops).toBe(stopsAtLeave)

    // 방송이 끝나면 놓는다
    phase = 'ended'
    await act(async () => { await wait(1_300) })
    await waitFor(() => expect(world.services.streamKeep.getKept()).toBeNull())
  }, 15_000)

  it('다시 잇는 중 같은 상태는 머리 오른쪽에만 — 접힌 줄에도, 펼친 카드에도 같은 문장을 또 보이지 않는다 (D-UX3-72·76)', async () => {
    const world = makeWorld()
    world.server.on('GET', STATUS, () => ({ body: { phase: 'reconnecting' } }))
    world.server.on('POST', WATCH, () => ({ body: { phase: 'reconnecting' } }))
    world.server.on('POST', /^\/api\/broadcasts\/b1\/voice-ticket/, () => ({ body: { wsUrl: 'ws://test.local/api/voice?ticket=t' } }))
    render(world.wrap(<Shell />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    // D-UX4-67: 다시 잇는 중은 주황 "재연결 중" 알약 하나 (옛 기대: "방송 소리 다시 잇는 중")
    await waitFor(() => expect(screen.getAllByRole('status', { name: '재연결 중' }).length).toBe(1))
    expect(screen.queryByText('라이브 소리 다시 잇는 중')).toBeNull()
    await act(async () => { screen.getByRole('button', { name: '들린 말 펼치기' }).click(); await flush() })
    // D-UX3-76: 펼쳐도 상태는 한 곳뿐 (사용자 지시 2026-11-09 "위에랑 겹치니까 지우고")
    await waitFor(() => expect(screen.getByRole('button', { name: '들린 말 접기' })).toBeTruthy())
    expect(screen.getAllByRole('status', { name: '재연결 중' }).length).toBe(1)
    expect(screen.queryByText('라이브 소리 다시 잇는 중')).toBeNull()
  }, 15_000)

  it('라이브 소리가 멈추면 화면에 [다시 켜기]·[휴대폰으로 듣기] 단추 없이, 라이브 메뉴의 "라이브 소리 다시 켜기"로 다시 시작한다 (D-UX3-73)', async () => {
    const world = makeWorld()
    world.server.on('GET', STATUS, () => ({ body: { phase: 'stopped' } }))
    world.server.on('POST', WATCH, () => ({ body: { phase: 'stopped' } }))
    world.server.on('POST', /^\/api\/broadcasts\/b1\/stream-audio\/restart$/, () => ({ body: { phase: 'idle' } }))
    world.server.on('POST', /^\/api\/broadcasts\/b1\/voice-ticket/, () => ({ body: { wsUrl: 'ws://test.local/api/voice?ticket=t' } }))
    render(world.wrap(<Shell />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    // D-UX4-67: 멈춤은 빨강 "연결 끊김" (옛 기대: "방송 소리 멈춤")
    await waitFor(() => expect(screen.getAllByRole('status', { name: '연결 끊김' }).length).toBe(1))
    expect(screen.queryByRole('button', { name: '다시 켜기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '휴대폰으로 듣기' })).toBeNull()
    await act(async () => { screen.getByRole('button', { name: '라이브 관리' }).click(); await flush() })
    await act(async () => { screen.getByRole('button', { name: '라이브 소리 다시 켜기' }).click(); await flush() })
    await waitFor(() => expect(world.server.callsTo('POST', /\/stream-audio\/restart$/).length).toBe(1))
  }, 15_000)

  it('"앱을 닫은 동안 서버가 들었어요" 카드는 띄우지 않는다 — 서버가 들은 말이 있어도 (D-UX3-87)', async () => {
    const world = makeWorld()
    world.server.on('GET', STATUS, () => ({ body: { phase: 'listening' } }))
    world.server.on('POST', WATCH, () => ({ body: { phase: 'listening' } }))
    world.server.on('GET', /\/stream-audio\/heard$/, () => ({ body: { entries: [{ at: 1, kind: 'registered', no: 15, price: 10000 }], pending: ['확인할 말'] } }))
    world.server.on('POST', /^\/api\/broadcasts\/b1\/voice-ticket/, () => ({ body: { wsUrl: 'ws://test.local/api/voice?ticket=t' } }))
    render(world.wrap(<Shell />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    await act(async () => { await wait(1_300) })
    expect(screen.queryByText('앱을 닫은 동안 서버가 들었어요')).toBeNull()
    expect(screen.queryByRole('button', { name: '확인했어요' })).toBeNull()
  }, 15_000)

  it('라이브 화면 제목은 "라이브", 라이브 소리를 들으면 머리 오른쪽이 짧게 "듣는 중" (D-UX3-89)', async () => {
    const world = makeWorld()
    world.server.on('GET', STATUS, () => ({ body: { phase: 'listening' } }))
    world.server.on('POST', WATCH, () => ({ body: { phase: 'listening' } }))
    world.server.on('POST', /^\/api\/broadcasts\/b1\/voice-ticket/, () => ({ body: { wsUrl: 'ws://test.local/api/voice?ticket=t' } }))
    render(world.wrap(<Shell />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    expect(screen.getByRole('heading', { name: '라이브' })).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('status', { name: '듣는 중' })).toBeTruthy())
    expect(screen.queryByText('라이브 소리 듣는 중')).toBeNull()
  }, 15_000)
})

