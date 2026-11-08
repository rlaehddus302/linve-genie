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

describe('방송 화면을 나가도 방송 소리 듣기 (D-UX3-48)', () => {
  it('방송 화면을 닫아도 서버 상태 읽기·듣는 중 알림이 이어지고 받아쓴 글 연결을 닫지 않으며, 방송이 끝나면 놓는다', async () => {
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
})
