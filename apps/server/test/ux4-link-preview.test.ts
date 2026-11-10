// D-UX4-08 잇기 전 미리 보기: 방송 제목·채널 이름만 읽고 아무것도 넣지 않는다. 처음이든 아니든 화면이 이 값으로 확인 창을 띄운다.
import { afterEach, describe, expect, it } from 'vitest'
import { addSeller, client, createBroadcast } from './support.ts'
import { errorOf, webWorld, type WebWorld } from './youtube-web-support.ts'

const worlds: WebWorld[] = []
afterEach(async () => {
  const closing = worlds.splice(0)
  for (const item of closing) {
    item.server.close()
    await item.server.stop()
  }
  for (const item of new Set(closing.map((w) => w.web))) await item.close()
  for (const item of closing) await item.google?.close()
})
const world = async () => {
  const w = await webWorld()
  worlds.push(w)
  return w
}

describe('D-UX4-08 유튜브 잇기 전 미리 보기', () => {
  it('제목·채널 이름을 돌려주고 연결은 만들지 않는다. 확인하고 잇은 채널도 다음 회차에 다시 미리 볼 수 있다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    const video = w.web.addVideo({ channelId: 'UC_GUPPY', channelTitle: '구피네', title: '오늘의 다육이 라이브' })
    const b1 = await createBroadcast(w, seller)
    const preview = await api.post(`/api/youtube/preview`, { video: `https://youtu.be/${video.videoId}` })
    expect(preview.status, preview.text).toBe(200)
    // D-UX4-116: 확인 팝업의 채널 사진용 채널 ID가 더해졌다 (옛 기대 { title, channelTitle })
    expect(preview.body).toEqual({ title: '오늘의 다육이 라이브', channelTitle: '구피네', channelId: 'UC_GUPPY' })
    expect((await api.get(`/api/broadcasts/${b1.id}/youtube`)).body).toMatchObject({ link: null })
    expect((await api.post(`/api/broadcasts/${b1.id}/youtube`, { requestId: 'l1', video: video.videoId, confirmInvited: true })).status).toBe(200)
    // 확인해 이은 채널이어도 다음에 다시 미리 본다(처음이든 아니든 확인 창)
    expect((await api.post(`/api/youtube/preview`, { video: video.videoId })).body).toEqual({ title: '오늘의 다육이 라이브', channelTitle: '구피네', channelId: 'UC_GUPPY' })
  })

  it('틀린 주소 400, 끝난 방송 409(잇기와 같은 코드), 로그인 안 하면 401', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const other = await addSeller(w)
    const api = client(w, seller.cookie)
    expect((await api.post(`/api/youtube/preview`, { video: 'https://example.com/x' })).status).toBe(400)
    const ended = w.web.addVideo({ state: 'ended' })
    expect(errorOf((await api.post(`/api/youtube/preview`, { video: ended.videoId })).body).code).toBe('NO_LIVE_CHAT')
    const live = w.web.addVideo()
    expect((await client(w, other.cookie).post(`/api/youtube/preview`, { video: live.videoId })).status).toBe(200)
    expect((await client(w, null).post(`/api/youtube/preview`, { video: live.videoId })).status).toBe(401)
  })
})

describe('D-UX4-119 이을 때 방송 제목을 남긴다 (관리/라이브 연결이 제목을 늦게 보이던 문제)', () => {
  it('이은 기록이 방송 제목을 돌려준다 — 연결 화면이 유튜브를 다시 읽지 않아도 된다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    const video = w.web.addVideo({ channelTitle: '미강다육', title: '<b>11월 10일</b> 신상입고' })
    const b1 = await createBroadcast(w, seller)
    const linked = await api.post(`/api/broadcasts/${b1.id}/youtube`, { requestId: 't1', video: video.videoId, confirmInvited: true })
    expect(linked.status, linked.text).toBe(200)
    expect((linked.body as { link: Record<string, unknown> }).link).toMatchObject({ broadcastTitle: '<b>11월 10일</b> 신상입고', broadcastChannelTitle: '미강다육' })
    // 다시 받아도 같은 제목 (기록에서)
    expect(((await api.get(`/api/broadcasts/${b1.id}/youtube`)).body as { link: Record<string, unknown> }).link).toMatchObject({ broadcastTitle: '<b>11월 10일</b> 신상입고' })
  })
})
