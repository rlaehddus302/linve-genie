// Y1 적대 테스트 (test-domain) 라운드 1: 수정(직전 확인·동의·다시 연결 권한·다른 서버의 조작)이 만든 새 구멍.
// CH-26 이전(YT-SRV): 감사 게시를 단언하는 시험(TD-Y1-014·015·016)은 옛 공식 읽기 world 그대로다(웹 잇기 회차는 공식 채팅 ID가 비어 감사가 올라가지 않음, D-YT-SRV-13 대기).
// 채팅 읽기를 공격하는 '수집기 — 다른 서버에서 유튜브 연결을 끊음'(TD-Y1-006)은 운영 길인 world({ chat: 'web' })로 옮겼다.
// 이 시험만은 스펙이 뜻을 바꿨다: D-Y02 "구글 연결을 끊으면 수집기를 멈춘다"가 읽기에서 빠지고 D-YT-SRV-10·SPEC YT-11 AC9
// "구글 연결 상태(없음·끊김·다시 연결 필요·다른 채널)는 수집을 멈추지 않는다"가 되었다. 그래서 다른 서버(B)에서 구글 연결을 끊어도
// 끊은 뒤 채팅이 한 번(중복 없이) 기록되고 수집기가 LIVE로 남는지를 본다. 회차 연결 끊기(unlink)의 "끊은 뒤 기록 0"은 collector-attacks에 그대로 있다.
import { afterEach, describe, expect, it } from 'vitest'
import { NO_LABEL, api, approve, callback, chat, collectors, connect, drive, linked, outbox, ok, pass, product, query, rows, until, world, writeEvent, type World } from './helpers.ts'

let w: World | null = null
afterEach(async () => {
  await w?.close()
  w = null
})

const recordedIds = async (w: World): Promise<string[]> =>
  (await query<{ id: string }>(w, `select body::jsonb->>'id' as id from events where type = 'chat' order by seq`)).map((row) => row.id)

describe('다시 연결 — 기다리던 감사 (AC-Y1-04·31·37)', () => {
  it('TD-Y1-014(회귀): 다시 연결 필요로 기다리던 실시간 채팅 감사는 같은 채널로 다시 연결하면(게시 권한 함께) 한 번 게시된다', async () => {
    w = await world()
    const c = await connect(w, { publish: 'LIVE_CHAT' })
    const { b } = await linked(w, c, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    w.fake.revokeAll()
    await w.timer.advance(3_600_000)
    await product(w, c, b.id, 15, '핑크프릴', 10000)
    await chat(w, c, b.id, 'r1', 'UC_A', '홍길동', '15')
    await drive(w, outbox(w).runOnce())
    await drive(w, outbox(w).runOnce())
    const waiting = (await rows(w, c, b.date))[0]
    expect([waiting?.state, waiting?.reason]).toEqual(['WAITING', 'RECONNECT'])
    const client = api(w.server, c.seller.cookie)
    w.fake.approval = { account: c.account, channel: c.channel.id }
    const started = await client.post('/api/youtube/connection/start', {})
    expect(await callback(w.server, c.seller.cookie, await approve(started.body.authorizeUrl as string))).toBe('connected')
    for (let i = 0; i < 5; i++) {
      await w.timer.advance(5000)
      await drive(w, outbox(w).runOnce())
    }
    expect(w.fake.posted.map((post) => post.text)).toEqual(['15번 핑크프릴 10,000원 홍길동님 구매 감사합니다'])
    expect((await rows(w, c, b.date))[0]?.state).toBe('SENT')
  }, 60_000)

  it('TD-Y1-015(회귀): 다시 연결에서 게시 권한을 빼고 승인하면 동의가 꺼지고 기다리던 감사는 NO_CONSENT — 게시 0번', async () => {
    w = await world()
    const c = await connect(w, { publish: 'LIVE_CHAT' })
    const { b } = await linked(w, c, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    w.fake.revokeAll()
    await w.timer.advance(3_600_000)
    await product(w, c, b.id, 15, '핑크프릴', 10000)
    await chat(w, c, b.id, 'r1', 'UC_A', '홍길동', '15')
    await drive(w, outbox(w).runOnce())
    await drive(w, outbox(w).runOnce())
    const client = api(w.server, c.seller.cookie)
    w.fake.approval = { account: c.account, channel: c.channel.id, grant: ['https://www.googleapis.com/auth/youtube.readonly'] }
    const started = await client.post('/api/youtube/connection/start', {})
    expect(new URL(started.body.authorizeUrl as string).searchParams.get('scope')).toContain('youtube.force-ssl')
    expect(await callback(w.server, c.seller.cookie, await approve(started.body.authorizeUrl as string))).toBe('connected')
    const connection = (await client.get('/api/youtube/connection')).body.connection as { permissions: { publish: boolean }; consent: { liveChat: { enabled: boolean } } }
    expect([connection.permissions.publish, connection.consent.liveChat.enabled]).toEqual([false, false])
    for (let i = 0; i < 5; i++) {
      await w.timer.advance(5000)
      await drive(w, outbox(w).runOnce())
    }
    expect(w.fake.posted).toEqual([])
    const row = (await rows(w, c, b.date))[0]
    expect([row?.state, row?.reason]).toEqual(['FAILED', 'NO_CONSENT'])
  }, 60_000)
})

describe('발송함 — 200자로 나뉜 묶음의 직전 확인 (AC-Y1-41·42, R-13)', () => {
  it('TD-Y1-016(회귀): 묶음이 두 메시지로 나뉘고 첫 메시지가 응답 없이 10초 걸리는 동안 둘째 메시지의 판매가 취소되면 그 항목은 빠진다', async () => {
    w = await world()
    const c = await connect(w, { publish: 'LIVE_CHAT' })
    const { b } = await linked(w, c, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 10 } })
    const names = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차']
    for (let i = 0; i < names.length; i++) {
      await product(w, c, b.id, 20 + i, '로얄블루턱시도구피', 12000)
      await chat(w, c, b.id, `s${String(i)}`, `UC_${String(i)}`, `시청자${names[i] ?? ''}${names[i] ?? ''}`, String(20 + i))
    }
    await outbox(w).runOnce()
    await w.timer.advance(10_000)
    w.fake.fail('liveChatMessages.insert', { kind: 'hang' })
    const running = outbox(w).runOnce()
    const fake = w.fake
    await until(w, () => fake.calls('liveChatMessages.insert') >= 1)
    // 마지막 항목(29번)은 둘째 메시지에 들어간다 — 첫 메시지가 걸린 동안 취소
    await ok(writeEvent(w, c, { type: 'host.cancel', b: b.id, no: 29, buyer: 'UC_9', reason: '취소' }))
    await drive(w, running)
    const texts = fake.posted.map((post) => post.text)
    expect(texts.length).toBeGreaterThan(0)
    expect(texts.join('\n')).not.toContain('29번')
    const list = await rows(w, c, b.date)
    expect(list.find((row) => row.buyer === 'UC_9')?.state).toBe('SKIPPED')
  }, 60_000)
})

describe('수집기 — 다른 서버에서 유튜브 연결을 끊음 (AC-Y1-06·28 → D-YT-SRV-10, 웹 읽기)', () => {
  it('TD-Y1-006: 수집기가 A에서 도는데 B에서 구글 연결을 끊어도, 끊은 뒤 채팅은 그 회차에 한 번 기록되고 수집은 멈추지 않는다 (D-YT-SRV-10)', async () => {
    w = await world({ chat: 'web' })
    const c = await connect(w, { publish: false })
    const { b, liveChatId } = await linked(w, c, { settings: NO_LABEL })
    collectors(w).start()
    const fake = w.fake
    const first = fake.addMessage(liveChatId, { author: 'UC_v1', name: '시청자1', text: '안녕하세요' })
    const ww = w
    await until(w, async () => (await recordedIds(ww)).includes(first), { step: 200 })
    const other = w.sibling('B')
    const off = await api(other, c.seller.cookie).post('/api/youtube/connection/disconnect', {})
    expect(off.status, off.text).toBe(200)
    expect(((await api(w.server, c.seller.cookie).get('/api/youtube/connection')).body.connection as { status?: string } | null)?.status).not.toBe('CONNECTED')
    await w.timer.advance(1000)
    const after = fake.addMessage(liveChatId, { author: 'UC_v2', name: '시청자2', text: '15' })
    await until(w, async () => (await recordedIds(ww)).includes(after), { step: 200 })
    await pass(w, 20_000)
    expect(await recordedIds(w)).toEqual([first, after])
    const status = await api(w.server, c.seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)
    expect(status.body.collector).toMatchObject({ mode: 'WEB', status: 'LIVE' })
  }, 60_000)
})
