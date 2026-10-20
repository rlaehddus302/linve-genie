// AC-Y1-10~13 방송 잇기 (YT-02, D-Y03): 내 라이브 목록, 주소 읽기, 잇기 조건, 끊기·다시 잇기
import { afterEach, describe, expect, it } from 'vitest'
import { addSeller, client, createBroadcast } from './support.ts'
import { connectSeller, youtubeWorld, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
async function world(): Promise<YoutubeWorld> {
  const created = await youtubeWorld()
  worlds.push(created)
  return created
}
afterEach(async () => {
  for (const item of worlds.splice(0)) {
    item.server.close()
    await item.server.stop()
    await item.fake.close()
  }
})

describe('AC-Y1-10 내 라이브 목록', () => {
  it('연결한 채널의 진행 중·예정 방송만 (끝난 방송·다른 채널 방송 없음), 이어진 회차, 할당량에 셈', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const live = w.fake.addBroadcast(connected.channel.id, { title: '오늘 방송', status: 'live' })
    const upcoming = w.fake.addBroadcast(connected.channel.id, { title: '내일 방송', status: 'upcoming', scheduledStartTime: '2026-10-20T11:00:00.000Z' })
    w.fake.addBroadcast(connected.channel.id, { title: '지난 방송', status: 'complete' })
    const other = w.fake.addChannel(w.fake.addAccount(), '남의 채널')
    w.fake.addBroadcast(other.id, { title: '남의 방송', status: 'live' })
    const b = await createBroadcast(w, connected.seller)
    const api = client(w, connected.seller.cookie)
    expect((await api.post(`/api/broadcasts/${b.id}/youtube`, { requestId: 'link-1', video: live.videoId })).status).toBe(200)
    const response = await api.get('/api/youtube/live-broadcasts')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const items = response.body.broadcasts as { videoId: string; title: string; status: string; scheduledStartTime: string | null; linkedBroadcast: string | null }[]
    expect(items.map((item) => [item.title, item.status, item.linkedBroadcast])).toEqual([
      ['오늘 방송', 'LIVE', b.id],
      ['내일 방송', 'UPCOMING', null],
    ])
    expect(items[1]).toMatchObject({ videoId: upcoming.videoId, scheduledStartTime: '2026-10-20T11:00:00.000Z' })
    const quota = (await api.get('/api/youtube/quota')).body.quota as { methods: { method: string; calls: number }[] }
    expect(quota.methods.find((method) => method.method === 'liveBroadcasts.list')?.calls).toBe(1)
  })

  it('연결 안 됨이면 부르지 않고 코드로', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const response = await client(w, seller.cookie).get('/api/youtube/live-broadcasts')
    expect(response.status).toBe(409)
    expect(response.body).toEqual({ error: { code: 'YOUTUBE_NOT_CONNECTED', message: '유튜브 채널을 먼저 연결해 주세요.' } })
    expect(w.fake.calls('liveBroadcasts.list')).toBe(0)
  })
})

describe('AC-Y1-11 주소 읽기 API', () => {
  it('유튜브를 부르지 않고 영상 ID를 돌려준다. 그 밖은 "유튜브 방송 주소를 확인해 주세요."', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    expect((await api.post('/api/youtube/parse-video', { video: 'https://youtu.be/dQw4w9WgXcQ?si=x' })).body).toEqual({ videoId: 'dQw4w9WgXcQ' })
    const bad = await api.post('/api/youtube/parse-video', { video: 'https://vimeo.com/1' })
    expect(bad.status).toBe(400)
    expect(bad.body).toMatchObject({ error: { code: 'INVALID_VIDEO_URL', message: '유튜브 방송 주소를 확인해 주세요.' } })
    expect(w.fake.calls()).toBe(0)
  })
})

describe('AC-Y1-12 잇기 조건', () => {
  it('하나라도 아니면 잇지 않고 문장을 준다', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const api = client(w, connected.seller.cookie)
    const live = w.fake.addBroadcast(connected.channel.id, { status: 'live' })
    const noChat = w.fake.addBroadcast(connected.channel.id, { status: 'live', chat: false })
    const ended = w.fake.addBroadcast(connected.channel.id, { status: 'complete' })
    const others = w.fake.addBroadcast(w.fake.addChannel(w.fake.addAccount(), '남').id, { status: 'live' })
    const b = await createBroadcast(w, connected.seller)
    const link = (target: string, video: string, requestId: string) => api.post(`/api/broadcasts/${target}/youtube`, { requestId, video })
    // 남의·없는 회차는 404
    const stranger = await addSeller(w)
    const strangerB = await createBroadcast(w, stranger)
    expect((await link(strangerB.id, live.videoId, 'r1')).status).toBe(404)
    expect((await link('b_none', live.videoId, 'r2')).status).toBe(404)
    // 리허설
    const rehearsal = await createBroadcast(w, connected.seller, { rehearsal: true })
    expect((await link(rehearsal.id, live.videoId, 'r3')).body).toEqual({ error: { code: 'REHEARSAL_LINK', message: '리허설 방송에는 유튜브 방송을 이을 수 없어요.' } })
    // 주소
    expect((await link(b.id, 'https://vimeo.com/x', 'r4')).body).toMatchObject({ error: { code: 'INVALID_VIDEO_URL', message: '유튜브 방송 주소를 확인해 주세요.' } })
    // 남의 채널 방송
    expect((await link(b.id, others.videoId, 'r5')).body).toEqual({ error: { code: 'NOT_MY_CHANNEL', message: '내 채널의 방송만 연결할 수 있어요.' } })
    // 채팅 없음·끝남
    expect((await link(b.id, noChat.videoId, 'r6')).body).toEqual({ error: { code: 'NO_LIVE_CHAT', message: '채팅을 받을 수 없는 방송이에요. 끝났거나 채팅이 꺼져 있어요.' } })
    expect((await link(b.id, ended.videoId, 'r7')).body).toEqual({ error: { code: 'NO_LIVE_CHAT', message: '채팅을 받을 수 없는 방송이에요. 끝났거나 채팅이 꺼져 있어요.' } })
    // 잇는다 — 같은 요청 번호로 두 번 보내도 한 번만
    const first = await link(b.id, `https://www.youtube.com/live/${live.videoId}`, 'r8')
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ link: { videoId: live.videoId, channelId: connected.channel.id }, collector: { status: 'STARTING', recorded: 0, skippedBeforeLink: 0 } })
    expect((await link(b.id, live.videoId, 'r8')).body).toEqual(first.body)
    // 이미 이어져 있다
    expect((await link(b.id, live.videoId, 'r9')).body).toEqual({ error: { code: 'ALREADY_LINKED', message: '이 방송에는 이미 유튜브 방송이 이어져 있어요. 먼저 연결을 끊어 주세요.' } })
    // 그 영상이 끝나지 않은 다른 회차에 이어져 있다
    const b2 = await createBroadcast(w, connected.seller)
    expect((await link(b2.id, live.videoId, 'r10')).body).toEqual({ error: { code: 'VIDEO_IN_USE', message: '이미 다른 방송에 이어진 유튜브 방송이에요.' } })
    // 끝난 회차
    expect((await api.post(`/api/broadcasts/${b2.id}/end`, { requestId: 'end-b2' })).status).toBe(200)
    const live2 = w.fake.addBroadcast(connected.channel.id, { status: 'live' })
    expect((await link(b2.id, live2.videoId, 'r11')).body).toEqual({ error: { code: 'BROADCAST_ENDED', message: '끝난 방송에는 유튜브 방송을 이을 수 없어요.' } })
    // 잇기는 엔진 이벤트가 아니다 (이력에 없다)
    const history = (await api.get(`/api/days/${b.date}/history`)).body.events as { type: string }[]
    expect(history.map((event) => event.type)).toEqual(['broadcast.start', 'broadcast.start', 'broadcast.end'])
  })

  it('연결 안 됨·다시 연결 필요면 그 코드', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await createBroadcast(w, seller)
    const response = await client(w, seller.cookie).post(`/api/broadcasts/${b.id}/youtube`, { requestId: 'x1', video: 'dQw4w9WgXcQ' })
    expect(response.body).toMatchObject({ error: { code: 'YOUTUBE_NOT_CONNECTED' } })
  })
})

describe('AC-Y1-13 끊기·다시 잇기', () => {
  it('끊으면 수집기가 멈추고, 다른(또는 같은) 유튜브 방송을 다시 이을 수 있다', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const api = client(w, connected.seller.cookie)
    const live = w.fake.addBroadcast(connected.channel.id, { status: 'live' })
    const b = await createBroadcast(w, connected.seller)
    expect((await api.post(`/api/broadcasts/${b.id}/youtube`, { requestId: 'l1', video: live.videoId })).status).toBe(200)
    expect((await api.post(`/api/broadcasts/${b.id}/youtube/unlink`, {})).body).toEqual({ link: null, collector: null })
    expect((await api.get(`/api/broadcasts/${b.id}/youtube`)).body).toEqual({ link: null, collector: null })
    expect((await api.post(`/api/broadcasts/${b.id}/youtube/unlink`, {})).body).toMatchObject({ error: { code: 'NOT_LINKED', message: '이어진 유튜브 방송이 없어요.' } })
    const again = await api.post(`/api/broadcasts/${b.id}/youtube`, { requestId: 'l2', video: live.videoId })
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ collector: { status: 'STARTING', recorded: 0 } })
  })
})
