// 채팅 의심 표시 (D-V3-129): 방송 중 판매자 화면이 서버의 의심 목록을 읽어 그 번호 줄에 "채팅은 81번을 찾아요 …"를 보인다. 등록은 바꾸지 않는다.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { makeWorld } from './screen-support.tsx'
import { flush, product } from './support.ts'

describe('채팅 의심 표시', () => {
  it('의심 목록의 번호 줄에만 문장이 붙고, 다른 줄에는 없다', async () => {
    const world = makeWorld({ products: [product(82, { name: '녹금', price: 50_000 }), product(80, { name: '황도', price: 30_000 })] })
    world.server.on('GET', /^\/api\/broadcasts\/b1\/voice-doubts$/, () => ({ body: { doubts: [{ no: 82, suspected: 81, count: 4, text: '채팅은 81번을 찾아요 (4명). 번호를 확인해 주세요.' }] } }))
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    const note = await screen.findByRole('note', { name: '번호 확인 — 82번' })
    expect(within(note).getByText('채팅은 81번을 찾아요 (4명). 번호를 확인해 주세요.')).toBeTruthy()
    expect(screen.queryByRole('note', { name: '번호 확인 — 80번' })).toBeNull()
  })
})
