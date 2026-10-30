// Y1 적대 테스트 (test-domain): 채팅 수집기 (AC-Y1-13·21·25·26·28).
// 기록된 chat 이벤트의 메시지 ID 집합을 가짜 서버가 보낸 것과 비교한다.
// CH-26 이전(YT-SRV): 운영의 채팅 읽기가 공식 API(STREAM·POLL)에서 서버 웹 읽기(수집기 방식 WEB)로 바뀌어(D-YT-SRV-01·10),
// 이 파일의 시험은 world({ chat: 'web' })(가짜 유튜브 웹 + bridgeFakeWeb)로 옮겼다. 단언하던 뜻은 그대로다 —
// 끝낸 뒤 게시된 채팅 기록 0, 끝낸 뒤 10분에 FINISHED, 회차 연결을 끊은 뒤 채팅 기록 0.
// 옛 길 전용 관찰 "열린 스트림 수 0"(fake.openStreams)은 같은 뜻인 "멈춘 뒤 2분 동안 가짜 웹 get_live_chat(poll) 부른 수가 늘지 않음"으로 바꿨다.
// 회차 연결을 끊은 뒤에도 같은 뜻으로 poll이 멈추는지 더했다(끊은 회차를 계속 읽으면 기록은 안 해도 할당 없는 부하·막힘 위험만 남는다).
import { afterEach, describe, expect, it } from 'vitest'
import { NO_LABEL, api, collectors, connect, linked, pass, recordedChatIds, rid, until, webCalls, world, type World } from './helpers.ts'

let w: World | null = null
afterEach(async () => {
  await w?.close()
  w = null
})

describe('수집기 — 서버가 둘일 때 다른 서버에서 한 조작 (AC-Y1-25·28·13, 웹 읽기)', () => {
  it('TD-Y1-006: 수집기가 A에서 도는데 판매자 요청이 B로 가서 방송을 끝내면, 끝낸 뒤 게시된 채팅은 기록하지 않고 10분 뒤 멈춘다', async () => {
    w = await world({ chat: 'web' })
    const c = await connect(w, { publish: false })
    const { b, liveChatId } = await linked(w, c, { settings: NO_LABEL })
    collectors(w).start()
    const fake = w.fake
    const first = fake.addMessage(liveChatId, { author: 'UC_v1', name: '시청자1', text: '안녕하세요' })
    const ww = w
    await until(w, async () => (await recordedChatIds(ww)).includes(first), { step: 200 })
    expect((await api(w.server, c.seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)).body.collector).toMatchObject({ mode: 'WEB' })
    // 같은 DB의 다른 서버(B)가 끝내기 요청을 받는다
    const other = w.sibling('B')
    const ended = await api(other, c.seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: rid('end') })
    expect(ended.status, ended.text).toBe(200)
    await w.timer.advance(1000)
    const late = fake.addMessage(liveChatId, { author: 'UC_v2', name: '시청자2', text: '끝난 뒤 채팅' })
    // A의 수집기가 그 메시지를 받을 시간을 준다 (웹 간격 5초 — 여러 번 부른다)
    const pollsBefore = webCalls(w, 'poll')
    await pass(w, 20_000)
    expect(webCalls(w, 'poll')).toBeGreaterThan(pollsBefore)
    expect(await recordedChatIds(w)).not.toContain(late)
    expect(await recordedChatIds(w)).toEqual([first])
    // 끝낸 뒤 10분이 지나면 멈춘다 (A든 B든)
    for (let i = 0; i < 70; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      await w.timer.advance(10_000)
    }
    const status = await api(w.server, c.seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)
    expect((status.body.collector as { status?: string } | null)?.status).toBe('FINISHED')
    // 멈춘 뒤에는 유튜브 웹 채팅을 더 부르지 않는다 (옛 길: 열린 스트림 0)
    const pollsAtFinish = webCalls(w, 'poll')
    await pass(w, 120_000, 5000)
    expect(webCalls(w, 'poll')).toBe(pollsAtFinish)
    expect(await recordedChatIds(w)).toEqual([first])
  }, 60_000)

  it('TD-Y1-006: 수집기가 A에서 도는데 B에서 회차의 유튜브 연결을 끊으면, 끊은 뒤 채팅은 그 회차에 기록되지 않는다', async () => {
    w = await world({ chat: 'web' })
    const c = await connect(w, { publish: false })
    const { b, liveChatId } = await linked(w, c, { settings: NO_LABEL })
    collectors(w).start()
    const fake = w.fake
    const first = fake.addMessage(liveChatId, { author: 'UC_v1', name: '시청자1', text: '안녕하세요' })
    const ww = w
    await until(w, async () => (await recordedChatIds(ww)).includes(first), { step: 200 })
    const other = w.sibling('B')
    const unlinked = await api(other, c.seller.cookie).post(`/api/broadcasts/${b.id}/youtube/unlink`, {})
    expect(unlinked.status, unlinked.text).toBe(200)
    await w.timer.advance(1000)
    const after = fake.addMessage(liveChatId, { author: 'UC_v2', name: '시청자2', text: '15' })
    await pass(w, 20_000)
    expect(await recordedChatIds(w)).not.toContain(after)
    expect(await recordedChatIds(w)).toEqual([first])
    // 끊은 회차는 더 읽지 않는다 — 임대가 넘어갈 시간(20초)을 넉넉히 준 뒤 2분 동안 poll이 늘지 않는다
    await pass(w, 60_000, 5000)
    const polls = webCalls(w, 'poll')
    await pass(w, 120_000, 5000)
    expect(webCalls(w, 'poll')).toBe(polls)
  }, 60_000)
})
