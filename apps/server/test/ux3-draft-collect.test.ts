// D-UX3-27: 만드는 중인 방송(방송 화면에 들어오기 전)은 이어 둔 유튜브 채팅을 받지 않는다. 화면에 들어오면 그때부터 받는다
import { afterEach, describe, expect, it } from 'vitest'
import { client, expectOk } from './support.ts'
import { connectSeller, until, youtubeWorld, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) {
    w.server.close()
    await w.server.stop()
    await w.fake.close()
  }
})

async function chatIds(w: YoutubeWorld): Promise<string[]> {
  const rows = await w.database.pglite?.query<{ id: string }>(`select chat_message_id as id from events where type = 'chat' order by seq`)
  return (rows?.rows ?? []).map((row) => row.id)
}

describe('D-UX3-27 만드는 중인 방송은 수집하지 않는다', () => {
  it('draft로 만들고 유튜브를 이어도 채팅 호출이 없다 → /open 뒤에 받는다', async () => {
    const w = await youtubeWorld({ start: Date.parse('2026-10-19T11:00:00Z') })
    worlds.push(w)
    const connected = await connectSeller(w)
    const api = client(w, connected.seller.cookie)
    const b = (await expectOk(api.post('/api/broadcasts', { requestId: 'd27', draft: true }))).body.broadcast as { id: string }
    const live = w.fake.addBroadcast(connected.channel.id, { status: 'live' })
    expect((await api.post(`/api/broadcasts/${b.id}/youtube`, { requestId: 'l27', video: live.videoId })).status).toBe(200)
    w.server.youtube?.collectors.start()
    for (let i = 0; i < 5; i++) await w.timer.advance(10_000)
    w.fake.addMessage(live.liveChatId as string, { id: 'm1', author: 'UCa', name: '가', text: '15', publishedAt: '2026-10-19T11:01:00.000Z' })
    for (let i = 0; i < 5; i++) await w.timer.advance(10_000)
    expect(w.fake.calls('liveChatMessages.streamList') + w.fake.calls('liveChatMessages.list')).toBe(0)
    expect(await chatIds(w)).toEqual([])
    expect((await api.post(`/api/broadcasts/${b.id}/open`, {})).status).toBe(200)
    await until(w, async () => (await chatIds(w)).includes('m1'), { step: 1000, max: 400 })
  })
})
