// Y1 적대 테스트 (test-domain): 채팅 수집기 (AC-Y1-13·21·25·26·28).
// 기록된 chat 이벤트의 메시지 ID 집합을 가짜 서버가 보낸 것과 비교한다.
import { afterEach, describe, expect, it } from 'vitest'
import { NO_LABEL, api, collectors, connect, linked, query, rid, until, world, type World } from './helpers.ts'

let w: World | null = null
afterEach(async () => {
  await w?.close()
  w = null
})

const recordedIds = async (w: World): Promise<string[]> =>
  (await query<{ id: string }>(w, `select body::jsonb->>'id' as id from events where type = 'chat' order by seq`)).map((row) => row.id)

describe('수집기 — 서버가 둘일 때 다른 서버에서 한 조작 (AC-Y1-25·28·13)', () => {
  it('TD-Y1-006: 수집기가 A에서 도는데 판매자 요청이 B로 가서 방송을 끝내면, 끝낸 뒤 게시된 채팅은 기록하지 않고 10분 뒤 멈춘다', async () => {
    w = await world()
    const c = await connect(w, { publish: false })
    const { b, liveChatId } = await linked(w, c, { settings: NO_LABEL })
    collectors(w).start()
    const fake = w.fake
    const first = fake.addMessage(liveChatId, { author: 'UC_v1', name: '시청자1', text: '안녕하세요' })
    const ww = w
    await until(w, async () => (await recordedIds(ww)).includes(first), { step: 200 })
    // 같은 DB의 다른 서버(B)가 끝내기 요청을 받는다
    const other = w.sibling('B')
    const ended = await api(other, c.seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: rid('end') })
    expect(ended.status, ended.text).toBe(200)
    await w.timer.advance(1000)
    const late = fake.addMessage(liveChatId, { author: 'UC_v2', name: '시청자2', text: '끝난 뒤 채팅' })
    // A의 수집기가 그 메시지를 받을 시간을 준다
    await until(w, () => fake.messages(liveChatId).length >= 2, { step: 0 })
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      await w.timer.advance(500)
    }
    expect(await recordedIds(w)).not.toContain(late)
    // 끝낸 뒤 10분이 지나면 멈춘다 (A든 B든 — 스트림이 열려 있지 않다)
    for (let i = 0; i < 70; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      await w.timer.advance(10_000)
    }
    const status = await api(w.server, c.seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)
    expect((status.body.collector as { status?: string } | null)?.status).toBe('FINISHED')
    expect(fake.openStreams.get(liveChatId) ?? 0).toBe(0)
  }, 60_000)

  it('TD-Y1-006: 수집기가 A에서 도는데 B에서 회차의 유튜브 연결을 끊으면, 끊은 뒤 채팅은 그 회차에 기록되지 않는다', async () => {
    w = await world()
    const c = await connect(w, { publish: false })
    const { b, liveChatId } = await linked(w, c, { settings: NO_LABEL })
    collectors(w).start()
    const fake = w.fake
    const first = fake.addMessage(liveChatId, { author: 'UC_v1', name: '시청자1', text: '안녕하세요' })
    const ww = w
    await until(w, async () => (await recordedIds(ww)).includes(first), { step: 200 })
    const other = w.sibling('B')
    const unlinked = await api(other, c.seller.cookie).post(`/api/broadcasts/${b.id}/youtube/unlink`, {})
    expect(unlinked.status, unlinked.text).toBe(200)
    await w.timer.advance(1000)
    const after = fake.addMessage(liveChatId, { author: 'UC_v2', name: '시청자2', text: '15' })
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      await w.timer.advance(500)
    }
    expect(await recordedIds(w)).not.toContain(after)
  }, 60_000)
})
