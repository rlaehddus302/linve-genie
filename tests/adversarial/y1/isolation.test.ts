// Y1 적대 테스트 (test-domain): 판매자 격리 (AC-Y1-71). 통과한 공격을 회귀로 남긴다.
// 판매자 B의 세션으로 판매자 A의 회차·발송함 행·수집기에 손대면 404이고 아무것도 바뀌지 않는다.
import { afterEach, describe, expect, it } from 'vitest'
import { NO_LABEL, addSeller, api, chat, connect, drive, linked, outbox, product, rid, rows, world, type World } from './helpers.ts'

let w: World | null = null
afterEach(async () => {
  await w?.close()
  w = null
})

describe('판매자 격리 (AC-Y1-71)', () => {
  it('TD-Y1-013(회귀): B가 A의 회차 잇기·끊기·수집기 다시 시작·발송함 재전송을 하면 404, A의 연결·행은 그대로', async () => {
    w = await world()
    const a = await connect(w, { publish: 'LIVE_CHAT' })
    const { b, liveChatId } = await linked(w, a, { settings: NO_LABEL })
    await product(w, a, b.id, 15, '핑크프릴', 10000)
    await chat(w, a, b.id, 'i1', 'UC_A', '홍길동', '15')
    w.fake.fail('liveChatMessages.insert', { status: 403, reason: 'forbidden' })
    await drive(w, outbox(w).runOnce())
    const failed = (await rows(w, a, b.date))[0]
    expect(failed?.state).toBe('FAILED')
    const bSeller = await addSeller(w)
    const other = api(w.server, bSeller.cookie)
    expect((await other.get(`/api/broadcasts/${b.id}/youtube`)).status).toBe(404)
    expect((await other.post(`/api/broadcasts/${b.id}/youtube`, { requestId: rid('x'), video: liveChatId.replace('chat_', '') })).status).toBe(404)
    expect((await other.post(`/api/broadcasts/${b.id}/youtube/unlink`, {})).status).toBe(404)
    expect((await other.post(`/api/broadcasts/${b.id}/youtube/collector/restart`, {})).status).toBe(404)
    expect((await other.post(`/api/outbox/${String(failed?.id)}/resend`, { requestId: rid('rs') })).status).toBe(404)
    expect((await other.get(`/api/days/${b.date}/outbox`)).body.rows).toEqual([])
    expect((await other.get(`/api/days/${b.date}/youtube-notices`)).body.notices).toEqual([])
    const linkA = await api(w.server, a.seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)
    expect((linkA.body.link as { videoId?: string } | null)?.videoId).toBe(liveChatId.replace('chat_', ''))
    expect((await rows(w, a, b.date))[0]?.state).toBe('FAILED')
  }, 60_000)
})
