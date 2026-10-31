// Y1 적대 테스트 (test-domain): 감사 발송함 — 잘못된 게시·두 번 게시 (AC-Y1-32·33·36·38·39·42).
// 판정은 코어 상태(취소·완료)로, 게시는 가짜 서버가 받은 글로 센다.
import { afterEach, describe, expect, it } from 'vitest'
import { NO_LABEL, api, approve, callback, chat, collectors, connect, drive, eventTypes, linked, outbox, ok, product, rows, until, world, writeEvent, type World } from './helpers.ts'

let w: World | null = null
afterEach(async () => {
  await w?.close()
  w = null
})

describe('발송함 — 보내기 직전 확인은 정말 "직전"이어야 한다 (R-13, AC-Y1-32)', () => {
  it('TD-Y1-001: 같은 방송의 앞 메시지가 응답 없이 10초 걸리는 동안 확정이 풀린 판매는 뒤이어 게시되지 않는다', async () => {
    w = await world()
    const c = await connect(w, { publish: 'LIVE_CHAT' })
    const { b } = await linked(w, c, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, c, b.id, 15, '핑크프릴', 10000)
    await product(w, c, b.id, 16, '라울', 5000)
    await chat(w, c, b.id, 'm15', 'UC_A', '홍길동', '15')
    await chat(w, c, b.id, 'm16', 'UC_B', '김철수', '16')
    // 첫 게시(15번)는 유튜브가 받지 않고 응답도 없다 (타임아웃 10초)
    w.fake.fail('liveChatMessages.insert', { kind: 'hang' })
    const running = outbox(w).runOnce()
    const fake = w.fake
    await until(w, () => fake.calls('liveChatMessages.insert') >= 1)
    // 그 사이 판매자가 16번 김철수의 찜을 취소한다 (확정이 풀림)
    await ok(writeEvent(w, c, { type: 'host.cancel', b: b.id, no: 16, buyer: 'UC_B', reason: '취소' }))
    await drive(w, running)
    // 16번 감사는 이제 취소된 효과다 — 공개 채팅에 "김철수님 구매 감사합니다"가 올라가면 안 된다
    expect(w.fake.posted.map((post) => post.text)).not.toContain('16번 라울 5,000원 김철수님 구매 감사합니다')
    const list = await rows(w, c, b.date)
    expect(list.find((row) => row.buyer === 'UC_B')?.state).toBe('SKIPPED')
  }, 60_000)
})

describe('발송함 — 공개 문구 (AC-Y1-22·33)', () => {
  it('TD-Y1-002(회귀): 줄바꿈·멘션·주소·방향 바꾸기가 든 닉네임과 줄바꿈 든 품종 → 게시 글은 한 줄, @·주소 점이 없다', async () => {
    w = await world()
    const c = await connect(w, { publish: 'LIVE_CHAT' })
    const { b } = await linked(w, c, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, c, b.id, 15, '핑크\n프릴', 10000)
    await chat(w, c, b.id, 'n1', 'UC_N', '@everyone\n‮bit.ly/free 무료', '15')
    await drive(w, outbox(w).runOnce())
    const texts = w.fake.posted.map((post) => post.text)
    expect(texts).toHaveLength(1)
    const text = texts[0] ?? ''
    expect(text).not.toMatch(/[\n\r@＠.]/)
    expect(text).not.toContain('‮')
    expect(text).toBe('15번 핑크 프릴 10,000원 everyone bit·ly/free 무료님 구매 감사합니다')
  }, 60_000)
})

describe('발송함 — 두 번 게시 없음 (AC-Y1-36·38·39)', () => {
  // D-YT-SRV-17 (SPEC v0.1.73 YT-06 세부 "서버로 이은 회차" (3)): "응답을 모르는 게시(시간 초과·연결 끊김·게시 중 서버가 멈춤)는 확인 시간
  // (그 시도의 시간 제한 뒤 30초) 안에 서버 수집기가 그 회차에서 본 우리 글 … 로만 확인한다. 보면 게시됨(게시 보고·잠금), 못 보면 다시 게시하지
  // 않고 UNCONFIRMED … 공식 조회(liveChatMessages.list)는 부르지 않는다". 옛 TD-Y1-003은 수집기 없이 공식 조회로 SENT를 기대했다 — 그 길은
  // 스펙에서 빠졌으므로 두 경우로 나눈다. 지키는 뜻은 같다: 같은 묶음 글은 채팅에 1개(두 번 게시 없음), 게시 보고는 효과마다 1개이고 보았을 때만.
  const batch = '15번 핑크프릴 10,000원 홍길동님, 16번 라울 5,000원 김철수님 구매 감사합니다'
  const setup = async (current: World) => {
    const c = await connect(current, { publish: 'LIVE_CHAT' })
    const { b, liveChatId } = await linked(current, c, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 10 } })
    await product(current, c, b.id, 15, '핑크프릴', 10000)
    await product(current, c, b.id, 16, '라울', 5000)
    await chat(current, c, b.id, 'a1', 'UC_A', '홍길동', '15')
    await chat(current, c, b.id, 'a2', 'UC_B', '김철수', '16')
    await outbox(current).runOnce()
    await current.timer.advance(10_000)
    return { c, b, liveChatId }
  }

  it('TD-Y1-003(회귀, 가): 묶음 메시지를 유튜브가 받고 응답이 없을 때 수집기(서버 웹 읽기)가 그 글을 보면 SENT — 같은 묶음 글 1개, 보고는 효과마다 1개, 공식 조회 0', async () => {
    w = await world({ chat: 'web' })
    const { c, b, liveChatId } = await setup(w)
    const current = w
    collectors(current).start()
    current.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' })
    for (let i = 0; i < 60 && !(await rows(current, c, b.date)).every((row) => row.state === 'SENT'); i++) {
      await drive(current, outbox(current).runOnce())
      await current.timer.advance(1000)
    }
    // 확인 시간이 한참 지나도 그대로 (다시 게시 없음)
    for (let i = 0; i < 3; i++) {
      await current.timer.advance(60_000)
      await drive(current, outbox(current).runOnce())
    }
    await collectors(current).stop()
    expect(current.fake.messages(liveChatId).filter((message) => message.text === batch)).toHaveLength(1)
    expect(current.fake.calls('liveChatMessages.insert')).toBe(1)
    expect(current.fake.calls('liveChatMessages.list')).toBe(0)
    const list = await rows(current, c, b.date)
    expect(list.map((row) => row.state)).toEqual(['SENT', 'SENT'])
    expect((await eventTypes(current)).filter((type) => type === 'effect.thanksSent')).toHaveLength(2)
  }, 60_000)

  it('TD-Y1-003(회귀, 나): 묶음 메시지를 유튜브가 받고 응답이 없는데 수집기가 그 글을 못 보면(수집기 없음) — 다시 게시하지 않고 두 행 모두 UNCONFIRMED, 게시 보고 0, 공식 조회 0', async () => {
    w = await world()
    const { c, b, liveChatId } = await setup(w)
    const current = w
    current.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' })
    for (let i = 0; i < 40 && !(await rows(current, c, b.date)).every((row) => row.state === 'FAILED'); i++) {
      await drive(current, outbox(current).runOnce())
      await current.timer.advance(2000)
    }
    // 다시 시도 시각(2·4·8·16·32초)을 다 넘겨도 자동으로 다시 올리지 않는다
    for (let i = 0; i < 5; i++) {
      await current.timer.advance(60_000)
      await drive(current, outbox(current).runOnce())
    }
    expect(current.fake.messages(liveChatId).filter((message) => message.text === batch)).toHaveLength(1)
    expect(current.fake.calls('liveChatMessages.insert')).toBe(1)
    expect(current.fake.calls('liveChatMessages.list')).toBe(0)
    const list = await rows(current, c, b.date)
    expect(list.map((row) => [row.state, row.reason])).toEqual([
      ['FAILED', 'UNCONFIRMED'],
      ['FAILED', 'UNCONFIRMED'],
    ])
    expect((await eventTypes(current)).filter((type) => type === 'effect.thanksSent')).toHaveLength(0)
  }, 60_000)
})

describe('발송함 — 동의를 끈 뒤에는 자동으로 게시하지 않는다 (AC-Y1-31, D-Y12)', () => {
  // 핵심: 동의를 끈 뒤 자동 게시 0번 (D-Y12). 상태·이유는 D-YT-SRV-17 (SPEC YT-06 세부 "서버로 이은 회차" (3)):
  // 응답을 모르는 게시는 수집기가 본 우리 글로만 확인하고 "못 보면 다시 게시하지 않고 UNCONFIRMED". 옛 기대 NO_CONSENT는 "확인 실패 → 다시 시도
  // 직전 동의 검사"에서 나왔는데, 실시간 채팅에서는 그 다시 시도 길이 없어졌다. 게다가 이 행은 유튜브에 올라갔는지 알 수 없는 상태라
  // "동의하지 않음"(아무것도 안 올림으로 읽힘)보다 "올라갔는지 확인하지 못했어요"(UNCONFIRMED — 판매자가 유튜브에서 보고 고름)가 사실에 맞다.
  // 개발 쪽 AC-Y1-31 시험(apps/server/test/youtube-outbox.test.ts)도 같은 결론이다.
  it('TD-Y1-007: 게시 요청이 응답 없이 확인 중(SENDING)일 때 판매자가 실시간 채팅 동의를 끄면, 확인 시간이 지나도 다시 게시하지 않는다 (게시 요청 1번뿐, UNCONFIRMED)', async () => {
    w = await world()
    const c = await connect(w, { publish: 'LIVE_CHAT' })
    const { b } = await linked(w, c, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, c, b.id, 15, '핑크프릴', 10000)
    await chat(w, c, b.id, 'k1', 'UC_A', '홍길동', '15')
    // 유튜브가 받지 않고 응답도 없다 → 타임아웃 → 확인 중
    w.fake.fail('liveChatMessages.insert', { kind: 'hang' })
    await drive(w, outbox(w).runOnce())
    expect((await rows(w, c, b.date))[0]?.state).toBe('SENDING')
    // 판매자가 자동 게시 동의를 끈다
    const off = await api(w.server, c.seller.cookie).put('/api/youtube/consent', { target: 'LIVE_CHAT', enabled: false })
    expect(off.status, off.text).toBe(200)
    // 확인 시간(30초)이 지나고 다시 시도 시각이 와도 게시하지 않는다
    for (let i = 0; i < 30; i++) {
      await w.timer.advance(2000)
      await drive(w, outbox(w).runOnce())
    }
    for (let i = 0; i < 3; i++) {
      await w.timer.advance(60_000)
      await drive(w, outbox(w).runOnce())
    }
    expect(w.fake.posted).toEqual([])
    expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
    expect(w.fake.calls('liveChatMessages.list')).toBe(0)
    const row = (await rows(w, c, b.date))[0]
    expect([row?.state, row?.reason]).toEqual(['FAILED', 'UNCONFIRMED'])
    expect((await eventTypes(w)).filter((type) => type === 'effect.thanksSent')).toHaveLength(0)
  }, 60_000)
})

describe('연결 — 같은 채널로 다시 연결 (AC-Y1-04·05·31)', () => {
  it('TD-Y1-008: 게시 동의를 켠 판매자가 "다시 연결 필요" 뒤 같은 채널로 다시 연결하면, 동의가 켜져 보이는데 게시 권한이 없는 상태가 되지 않는다', async () => {
    w = await world()
    const c = await connect(w, { publish: 'LIVE_CHAT' })
    await linked(w, c, { settings: NO_LABEL })
    // 사용자가 구글에서 권한을 거둠 → 다음 새로 고침이 invalid_grant → 다시 연결 필요
    w.fake.revokeAll()
    await w.timer.advance(3_600_000)
    await drive(w, outbox(w).runOnce())
    const client = api(w.server, c.seller.cookie)
    await client.get('/api/youtube/live-broadcasts')
    expect(((await client.get('/api/youtube/connection')).body.connection as { status: string }).status).toBe('RECONNECT_NEEDED')
    // 연결 화면의 "다시 연결" (같은 채널)
    w.fake.approval = { account: c.account, channel: c.channel.id }
    const started = await client.post('/api/youtube/connection/start', {})
    expect(await callback(w.server, c.seller.cookie, await approve(started.body.authorizeUrl as string))).toBe('connected')
    const connection = (await client.get('/api/youtube/connection')).body.connection as { status: string; permissions: { publish: boolean }; consent: { liveChat: { enabled: boolean } } }
    expect(connection.status).toBe('CONNECTED')
    // 동의가 켜져 보이면 게시 권한도 있어야 한다 (권한 없이 켜진 동의 = 모든 감사가 조용히 NO_PERMISSION)
    expect(connection.consent.liveChat.enabled && !connection.permissions.publish).toBe(false)
  }, 60_000)
})
