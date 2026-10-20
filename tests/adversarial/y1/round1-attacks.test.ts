// Y1 적대 테스트 (test-domain) 라운드 1: 수정(직전 확인·동의·다시 연결 권한·다른 서버의 조작)이 만든 새 구멍.
import { afterEach, describe, expect, it } from 'vitest'
import { NO_LABEL, api, approve, callback, chat, collectors, connect, drive, linked, outbox, ok, product, query, rows, until, world, writeEvent, type World } from './helpers.ts'

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

describe('수집기 — 다른 서버에서 유튜브 연결을 끊음 (AC-Y1-06·28)', () => {
  it('TD-Y1-006: 수집기가 A에서 도는데 B에서 유튜브 연결을 끊으면, 끊은 뒤 채팅은 기록되지 않는다', async () => {
    w = await world()
    const c = await connect(w, { publish: false })
    const { liveChatId } = await linked(w, c, { settings: NO_LABEL })
    collectors(w).start()
    const fake = w.fake
    const first = fake.addMessage(liveChatId, { author: 'UC_v1', name: '시청자1', text: '안녕하세요' })
    const ww = w
    await until(w, async () => (await recordedIds(ww)).includes(first), { step: 200 })
    const other = w.sibling('B')
    const off = await api(other, c.seller.cookie).post('/api/youtube/connection/disconnect', {})
    expect(off.status, off.text).toBe(200)
    await w.timer.advance(1000)
    const after = fake.addMessage(liveChatId, { author: 'UC_v2', name: '시청자2', text: '15' })
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      await w.timer.advance(500)
    }
    expect(await recordedIds(w)).not.toContain(after)
  }, 60_000)
})

