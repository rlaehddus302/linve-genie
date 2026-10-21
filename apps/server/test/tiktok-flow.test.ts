// 틱톡 댓글 흐름·끄기·동의·서명 키·로그·가짜 웹캐스트 통합 시험 (N2b-1, AC-N2b-1-03·23·24·40·41·42·50·51·60·61).
import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatLog } from '../src/log.ts'
import {
  createTikTokConnection,
  denyAllTikTokConsent,
  FakeTikTokClock,
  FakeWebcast,
  readTikTokSettings,
  TIKTOK_LIBRARY_OPTION_KEYS,
  tiktokConnectionMemorySize,
} from '../src/tiktok/index.ts'
import { chatFields, freshId, rig, SEC, targetOf } from './tiktok-support.ts'

const HOUR = 3600

const leaks: unknown[] = []
const onLeak = (error: unknown): void => {
  leaks.push(error)
}
beforeEach(() => {
  leaks.length = 0
  process.on('unhandledRejection', onLeak)
  process.on('uncaughtException', onLeak)
})
afterEach(() => {
  process.off('unhandledRejection', onLeak)
  process.off('uncaughtException', onLeak)
  expect(leaks).toEqual([])
})

describe('AC-N2b-1-03 읽기만 — 연결 객체의 조작·넘기는 옵션', () => {
  it('연결 객체가 가진 조작은 start·stop·status뿐이다', () => {
    const { conn } = rig()
    expect(Object.keys(conn).sort()).toEqual(['start', 'status', 'stop'])
    for (const key of Object.keys(conn)) expect(typeof (conn as unknown as Record<string, unknown>)[key]).toBe('function')
    expect(Object.getPrototypeOf(conn)).toBe(Object.prototype)
    expect(Object.isFrozen(conn)).toBe(true)
  })

  it('클라이언트에 넘기는 값은 (아이디, 허용 목록 옵션) — 입력 객체에 섞인 세션·쿠키 키는 닿지 않는다 (처음·다시 연결 모두)', async () => {
    const r = rig({ extra: { sessionId: 'planted', cookie: 'sessionid=planted', authenticateWs: true, useMobile: true, wsClientHeaders: { Cookie: 'planted' } } })
    r.fake.failNext('NETWORK')
    r.conn.start()
    await r.at(5)
    expect(r.fake.handles).toHaveLength(2)
    for (const handle of r.fake.handles) {
      expect(handle.uniqueId).toBe('seller_kim')
      expect(handle.options).toEqual({ processInitialData: false, fetchRoomInfoOnConnect: true, enableExtendedGiftInfo: false })
      for (const key of Object.keys(handle.options)) expect(TIKTOK_LIBRARY_OPTION_KEYS).toContain(key)
      expect(JSON.stringify(handle.options)).not.toContain('planted')
    }
  })
})

describe('AC-N2b-1-23 중복 기억 (연결 객체)', () => {
  it('다시 연결을 넘어 기억한다: 끊김 전 댓글 ID를 다시 보내면 레코드 없이 duplicates +1', async () => {
    const r = rig()
    r.conn.start()
    await r.flush()
    const id = freshId()
    r.fake.last?.chat(chatFields(id))
    r.fake.last?.drop()
    await r.at(5)
    expect(r.conn.status().state).toBe('CONNECTED')
    r.fake.last?.chat(chatFields(id, { comment: '16' }))
    expect(r.records.map((x) => x.commentId)).toEqual([id])
    expect(r.conn.status().counts).toEqual({ received: 1, duplicates: 1, dropped: 0 })
    expect(tiktokConnectionMemorySize(r.conn)).toBe(1)
  })

  it('판매자 둘의 연결 객체가 같은 방송에 붙으면 같은 댓글이 각자에게 한 번씩', async () => {
    const fake = new FakeWebcast().account('seller_kim', 'LIVE')
    const clock = new FakeTikTokClock(0)
    const a = rig({ fake, clock, sellerId: 'seller-a' })
    const b = rig({ fake, clock, sellerId: 'seller-b' })
    a.conn.start()
    b.conn.start()
    await a.flush()
    const id = freshId()
    fake.broadcast('seller_kim', chatFields(id))
    fake.broadcast('seller_kim', chatFields(id))
    expect(a.records.map((x) => x.commentId)).toEqual([id])
    expect(b.records.map((x) => x.commentId)).toEqual([id])
    expect(a.conn.status().counts.duplicates).toBe(1)
    expect(b.conn.status().counts.duplicates).toBe(1)
  })
})

describe('AC-N2b-1-24 도착 시각·순서·이전 댓글·버린 연결', () => {
  it('receivedAt = 받은 순간의 주입한 시계 (UTC ISO 밀리초), createTime은 쓰지 않는다', async () => {
    const start = Date.UTC(2026, 9, 20, 11, 0, 0, 0)
    const r = rig({ clock: new FakeTikTokClock(start) })
    r.conn.start()
    await r.flush()
    await r.clock.advance(1234)
    r.fake.last?.chat(chatFields(freshId(), { createTime: '1' }))
    await r.clock.advance(1)
    r.fake.last?.chat(chatFields(freshId(), { createTime: '99999999999999' }))
    expect(r.records.map((x) => x.receivedAt)).toEqual(['2026-10-20T11:00:01.234Z', '2026-10-20T11:00:01.235Z'])
  })

  it('들어온 순서대로 하나씩, 콜백이 예외를 던져도(동기·비동기) 다음 댓글은 넘어간다 (로그 코드 하나, 내용 없음)', async () => {
    let n = 0
    const r = rig({
      onRecord: () => {
        n += 1
        if (n === 1) throw new Error('PLANTED-TEXT-15 sync')
        if (n === 2) return Promise.reject(new Error('PLANTED-TEXT-15 async'))
        return undefined
      },
    })
    r.conn.start()
    await r.flush()
    const ids = [freshId(), freshId(), freshId()]
    for (const id of ids) r.fake.last?.chat(chatFields(id))
    await r.flush()
    expect(r.records.map((x) => x.commentId)).toEqual(ids)
    expect(r.conn.status().state).toBe('CONNECTED')
    const failed = r.logs.filter((l) => l.code === 'TIKTOK_RECORD_FAILED')
    expect(failed).toHaveLength(2)
    for (const record of failed) expect(Object.keys(record).sort()).toEqual(['code', 'errorKind', 'level'])
  })

  it('CONNECTED 전에 온 댓글, 버린 시도·이전 연결 손잡이로 온 댓글은 내보내지 않는다', async () => {
    const r = rig()
    r.fake.hold()
    r.conn.start()
    await r.flush()
    const pending = r.fake.last
    pending?.chat(chatFields(freshId()))
    await r.at(20)
    pending?.chat(chatFields(freshId()))
    r.fake.hold(false)
    await r.at(25)
    const current = r.fake.last
    current?.drop()
    await r.flush()
    current?.chat(chatFields(freshId()))
    pending?.chat(chatFields(freshId()))
    await r.at(35)
    expect(r.conn.status().state).toBe('CONNECTED')
    pending?.chat(chatFields(freshId()))
    current?.chat(chatFields(freshId()))
    expect(r.records).toEqual([])
    expect(r.conn.status().counts).toEqual({ received: 0, duplicates: 0, dropped: 0 })
    r.fake.last?.chat(chatFields(freshId()))
    expect(r.records).toHaveLength(1)
  })

  it('processInitialData는 언제나 false — 연결 때 최근 댓글 묶음을 켜도 레코드가 되지 않는다', async () => {
    const r = rig()
    r.fake.recentComments([chatFields(freshId()), chatFields(freshId())])
    r.fake.failNext('NETWORK')
    r.conn.start()
    await r.at(5)
    expect(r.conn.status().state).toBe('CONNECTED')
    for (const handle of r.fake.handles) expect(handle.options.processInitialData).toBe(false)
    expect(r.records).toEqual([])
    // 같은 묶음을 받는 클라이언트(processInitialData를 켠 연결)라면 내보냈을 것이다 — 가짜가 실제로 묶음을 낸다는 확인
    const probe = new FakeWebcast().account('x', 'LIVE').recentComments([chatFields(freshId())])
    const client = probe.factory('x', { processInitialData: true } as never)
    const got: unknown[] = []
    client.on('chat', (event) => got.push(event))
    await client.connect()
    expect(got).toHaveLength(1)
  })

  it('stop()이 돌아온 뒤에는 어떤 레코드도 콜백에 가지 않는다 (콜백 안에서 stop()을 불러도)', async () => {
    const holder: { stop?: () => void } = {}
    const r = rig({ onRecord: () => holder.stop?.() })
    holder.stop = () => r.conn.stop()
    r.conn.start()
    await r.flush()
    const handle = r.fake.last
    for (let i = 0; i < 5; i += 1) handle?.chat(chatFields(freshId()))
    expect(r.records).toHaveLength(1)
    expect(r.conn.status().state).toBe('STOPPED')
  })
})

describe('AC-N2b-1-40 운영자 전체 끄기', () => {
  it('LIVEJJIM_TIKTOK_BETA 읽기: on만 켬, 이상한 값은 끔 + 경고 코드 (값은 담지 않는다)', () => {
    for (const value of [undefined, '', 'off', ' OFF ']) expect(readTikTokSettings({ LIVEJJIM_TIKTOK_BETA: value })).toMatchObject({ beta: false, warning: null })
    expect(readTikTokSettings({})).toMatchObject({ beta: false, warning: null, signKey: null })
    for (const value of ['on', ' ON ', 'On']) expect(readTikTokSettings({ LIVEJJIM_TIKTOK_BETA: value })).toMatchObject({ beta: true, warning: null })
    for (const value of ['true', '1', 'yes', 'enable', 'onn', 'planted-xyz']) {
      const settings = readTikTokSettings({ LIVEJJIM_TIKTOK_BETA: value })
      expect(settings).toMatchObject({ beta: false, warning: 'TIKTOK_BETA_INVALID' })
      expect(JSON.stringify(settings)).not.toContain(value === '1' ? '"1"' : value)
      expect(inspect(settings)).not.toContain('planted')
    }
    expect(formatLog({ level: 'warn', code: 'TIKTOK_BETA_INVALID' })).not.toContain('planted')
  })

  for (const beta of [undefined, '', 'off', 'planted-xyz']) {
    it(`끈 상태(${String(beta)})의 start() → OFF/OPERATOR_OFF, 시도 0, 동의 확인 안 함, 다시 시도 없음`, async () => {
      const r = rig({ beta })
      r.conn.start()
      expect(r.conn.status()).toMatchObject({ state: 'OFF', reason: 'OPERATOR_OFF', message: '지금은 틱톡 연결을 쓸 수 없어요. 댓글을 직접 넣어 주세요.' })
      await r.at(HOUR)
      expect(r.fake.attempts).toBe(0)
      expect(r.fake.created).toBe(0)
      expect(r.consentCalls).toEqual([])
      expect(r.clock.pendingTimers).toBe(0)
    })
  }

  it('설정을 넘기지 않으면 꺼짐', async () => {
    const fake = new FakeWebcast().account('seller_kim', 'LIVE')
    const conn = createTikTokConnection({ sellerId: 's', target: targetOf('seller_kim'), webcast: fake.factory, onRecord: () => undefined, consent: async () => true, clock: new FakeTikTokClock(), log: () => undefined })
    conn.start()
    expect(conn.status()).toMatchObject({ state: 'OFF', reason: 'OPERATOR_OFF' })
    expect(fake.attempts).toBe(0)
  })
})

describe('AC-N2b-1-41 판매자 동의 자리', () => {
  it('(가) 기본 구현은 모두 거절 → OFF/NO_CONSENT, 시도 0', async () => {
    expect(await denyAllTikTokConsent('seller-1')).toBe(false)
    const r = rig({ consent: 'default' })
    r.conn.start()
    await r.flush()
    expect(r.conn.status()).toMatchObject({ state: 'OFF', reason: 'NO_CONSENT', message: '틱톡 연결이 꺼져 있어요. 안내를 읽고 동의하면 켤 수 있어요.' })
    await r.at(HOUR)
    expect(r.fake.attempts).toBe(0)
  })

  it('(나) 허용 → 연결 (판매자 ID로 확인)', async () => {
    const r = rig({ sellerId: 'seller-77' })
    r.conn.start()
    await r.flush()
    expect(r.conn.status().state).toBe('CONNECTED')
    expect(r.consentCalls).toEqual(['seller-77'])
  })

  it('(다) 처음엔 허용, 첫 실패 뒤 거절 → t=5 다시 시도 때 OFF/NO_CONSENT, 시도 1, 그 뒤 시도 없음', async () => {
    let allow = true
    const r = rig({ consent: async () => allow })
    r.fake.failNext('NETWORK')
    r.conn.start()
    await r.flush()
    expect(r.conn.status().state).toBe('RETRYING')
    allow = false
    await r.at(5)
    expect(r.conn.status()).toMatchObject({ state: 'OFF', reason: 'NO_CONSENT', nextAttemptAt: null })
    expect(r.fake.attempts).toBe(1)
    expect(r.consentCalls).toHaveLength(2)
    await r.at(HOUR)
    expect(r.fake.attempts).toBe(1)
    expect(r.clock.pendingTimers).toBe(0)
  })

  it('(라) 확인 함수가 예외(동기·거부)·true가 아닌 값 → OFF/NO_CONSENT', async () => {
    const checks = [
      () => {
        throw new Error('sync')
      },
      () => Promise.reject(new Error('async')),
      async () => 'yes' as unknown as boolean,
      async () => 1 as unknown as boolean,
    ]
    for (const consent of checks) {
      const r = rig({ consent })
      r.conn.start()
      await r.flush()
      expect(r.conn.status()).toMatchObject({ state: 'OFF', reason: 'NO_CONSENT' })
      expect(r.fake.attempts).toBe(0)
    }
  })

  it('(마) 판매자 A만 허용하는 확인 함수로 판매자 B의 연결 → OFF/NO_CONSENT', async () => {
    const onlyA = async (sellerId: string) => sellerId === 'seller-a'
    const a = rig({ sellerId: 'seller-a', consent: onlyA })
    const b = rig({ sellerId: 'seller-b', consent: onlyA })
    a.conn.start()
    b.conn.start()
    await a.flush()
    expect(a.conn.status().state).toBe('CONNECTED')
    expect(b.conn.status()).toMatchObject({ state: 'OFF', reason: 'NO_CONSENT' })
    expect(b.fake.attempts).toBe(0)
  })

  it('(바) 확인이 20초 안에 끝나지 않음 → 20초에 OFF/NO_CONSENT, 늦은 허용에도 연결하지 않는다', async () => {
    let release: (allowed: boolean) => void = () => undefined
    const r = rig({ consent: () => new Promise<boolean>((resolve) => (release = resolve)) })
    r.conn.start()
    await r.clock.advanceTo(20 * SEC - 1)
    expect(r.conn.status().state).toBe('CONNECTING')
    await r.at(20)
    expect(r.conn.status()).toMatchObject({ state: 'OFF', reason: 'NO_CONSENT' })
    release(true)
    await r.at(HOUR)
    expect(r.fake.attempts).toBe(0)
    expect(r.conn.status()).toMatchObject({ state: 'OFF', reason: 'NO_CONSENT' })
  })

  it('동의는 연결 중에 다시 확인하지 않는다 (연결 시도마다 한 번)', async () => {
    const r = rig()
    r.conn.start()
    await r.at(HOUR)
    expect(r.consentCalls).toHaveLength(1)
  })
})

describe('AC-N2b-1-42 서명 서비스 키', () => {
  const KEY = 'SIGNKEY-PLANTED-123'

  it('있으면 옵션 signApiKey로만 넘기고, 없으면 그 키를 넣지 않는다', async () => {
    const withKey = rig({ signKey: `  ${KEY}  ` })
    withKey.conn.start()
    await withKey.flush()
    expect(withKey.fake.last?.options).toEqual({ processInitialData: false, fetchRoomInfoOnConnect: true, enableExtendedGiftInfo: false, signApiKey: KEY })
    const without = rig({ signKey: '   ' })
    without.conn.start()
    await without.flush()
    expect(without.fake.last && 'signApiKey' in without.fake.last.options).toBe(false)
    expect(readTikTokSettings({ LIVEJJIM_TIKTOK_SIGN_API_KEY: ' ' }).signKey).toBeNull()
  })

  it('키가 연결·실패·상태 조회·상태 알림·로그·오류 결과 어디에도 나오지 않는다 (설정 결과를 문자열로 바꿔도 가림)', async () => {
    const settings = readTikTokSettings({ LIVEJJIM_TIKTOK_BETA: 'on', LIVEJJIM_TIKTOK_SIGN_API_KEY: KEY })
    for (const text of [String(settings.signKey), JSON.stringify(settings), inspect(settings, { depth: 5, showHidden: true }), `${String(settings.signKey)}`]) expect(text).not.toContain(KEY)
    const r = rig({ signKey: KEY })
    r.fake.failNext('SIGN_FAILED')
    r.conn.start()
    await r.at(5)
    r.fake.last?.emit('error', { info: 'x', exception: new Error(KEY) })
    r.fake.last?.drop()
    await r.at(HOUR)
    const seen = JSON.stringify([r.conn.status(), r.statuses, r.logs, r.logs.map(formatLog)])
    expect(seen).not.toContain(KEY)
  })
})

describe('AC-N2b-1-50 로그 — 정해진 코드만, 심은 값 0번', () => {
  it('연결·심은 댓글·심은 오류로 실패·콜백 예외·stop() 뒤 로그에 심은 값과 판매자 틱톡 아이디가 없다', async () => {
    const PLANTED = ['PLANTED-TEXT-15', 'PLANTED-NICK', '7999999999999999991', 'planted_viewer', 'seller_kim']
    const plantedError = Object.assign(new Error('PLANTED-TEXT-15 PLANTED-NICK 7999999999999999991 planted_viewer seller_kim'), { name: 'seller_kim' })
    let first = true
    const fake = new FakeWebcast().account('seller_kim', 'LIVE')
    const r = rig({
      fake,
      webcast: (uniqueId, options) => {
        if (first) {
          first = false
          return { connect: () => Promise.reject(plantedError), disconnect: () => undefined, on: () => undefined }
        }
        return fake.factory(uniqueId, options)
      },
      onRecord: () => {
        throw plantedError
      },
      onStatus: () => Promise.reject(plantedError),
    })
    r.conn.start()
    await r.at(5)
    expect(r.conn.status().state).toBe('CONNECTED')
    fake.last?.chat({ msgId: freshId(), userId: '7999999999999999991', uniqueId: 'planted_viewer', nickname: 'PLANTED-NICK', comment: 'PLANTED-TEXT-15' })
    fake.last?.emit('error', { info: 'PLANTED-TEXT-15', exception: plantedError })
    r.conn.stop()
    await r.flush()
    expect(r.records).toHaveLength(1)
    const output = [...r.logs.map(formatLog), JSON.stringify(r.logs)].join('\n')
    expect(r.logs.length).toBeGreaterThan(0)
    for (const value of PLANTED) expect(output).not.toContain(value)
    for (const record of r.logs) for (const key of Object.keys(record)) expect(['level', 'code', 'errorKind', 'count']).toContain(key)
  })
})

describe('AC-N2b-1-51 상태에 원본 자료가 남지 않는다', () => {
  it('상태 조회·알림에는 댓글 본문·닉네임·아이디·원본 자료가 없다', async () => {
    const r = rig()
    r.conn.start()
    await r.flush()
    r.fake.last?.chat({ msgId: freshId(), userId: '7101', uniqueId: 'buyer_zz', nickname: '닉네임자리', comment: '본문자리' })
    const text = JSON.stringify([r.conn.status(), r.statuses])
    for (const value of ['buyer_zz', '닉네임자리', '본문자리', 'secUid', 'MS4wLjABAAAAfakeSecUid', 'seller_kim']) expect(text).not.toContain(value)
  })
})

describe('AC-N2b-1-60 가짜 웹캐스트', () => {
  it('계정(방송 중·방송 전·없음)과 실패 종류 넣기', async () => {
    const fake = new FakeWebcast().account('live_one', 'LIVE').account('offline_one', 'OFFLINE').account('gone_one', 'MISSING')
    const outcomes: string[] = []
    for (const id of ['live_one', 'offline_one', 'gone_one', 'unknown_one']) {
      const r = rig({ fake, target: id })
      r.conn.start()
      await r.flush()
      outcomes.push(`${r.conn.status().state}/${String(r.conn.status().reason)}`)
    }
    expect(outcomes).toEqual(['CONNECTED/null', 'RETRYING/NOT_LIVE', 'STOPPED/USER_NOT_FOUND', 'STOPPED/USER_NOT_FOUND'])
    for (const kind of ['NETWORK', 'NOT_LIVE', 'USER_NOT_FOUND', 'BLOCKED', 'SIGN_FAILED'] as const) {
      const r = rig()
      r.fake.failNext(kind)
      r.conn.start()
      await r.flush()
      expect(r.conn.status().lastFailure).toBe(kind)
    }
  })

  it('연결 시도 붙잡기와 나중에 실패, 댓글이 아닌 이벤트, 관찰 값', async () => {
    const r = rig()
    r.fake.hold()
    r.conn.start()
    await r.flush()
    expect(r.fake.last?.state).toBe('pending')
    r.fake.last?.fail('BLOCKED')
    await r.flush()
    expect(r.conn.status()).toMatchObject({ state: 'RETRYING', reason: 'BLOCKED' })
    r.fake.hold(false)
    await r.at(5)
    const handle = r.fake.last
    expect(handle?.state).toBe('open')
    for (const event of ['gift', 'like', 'member', 'follow', 'share', 'emote', 'roomUser', 'linkMicBattle', 'social', 'questionNew', 'envelope', 'barrage', 'controlMessage']) {
      handle?.emit(event, { common: { msgId: freshId() }, user: { userId: '7101', uniqueId: 'buyer_a' }, comment: '15', giftId: 1 })
    }
    expect(r.records).toEqual([])
    expect(r.conn.status().counts).toEqual({ received: 0, duplicates: 0, dropped: 0 })
    expect({ attempts: r.fake.attempts, created: r.fake.created, open: r.fake.openCount, max: r.fake.maxOpen }).toEqual({ attempts: 2, created: 2, open: 1, max: 1 })
    r.conn.stop()
    expect(r.fake.closes).toBe(1)
    expect(r.fake.openCount).toBe(0)
  })
})

describe('AC-N2b-1-61 많은 댓글 (NFR-04)', () => {
  it('서로 다른 댓글 10,000개(50개씩 몰아 보내기)에 이미 보낸 ID 1,000개·댓글이 아닌 이벤트 1,000개를 섞어도 빠짐·두 번 0, 순서 그대로', async () => {
    const r = rig()
    r.conn.start()
    await r.flush()
    const handle = r.fake.last
    const sent: string[] = []
    let dup = 0
    let other = 0
    for (let batch = 0; batch < 200; batch += 1) {
      for (let i = 0; i < 50; i += 1) {
        const id = freshId()
        sent.push(id)
        handle?.chat(chatFields(id, { userId: String(7101000000000000000n + BigInt(sent.length)), comment: String(sent.length % 50) }))
      }
      for (let k = 0; k < 5; k += 1) {
        const old = sent[(batch * 37 + k * 11) % sent.length] ?? sent[0] ?? ''
        handle?.chat(chatFields(old))
        dup += 1
        handle?.emit(k % 2 === 0 ? 'gift' : 'like', { common: { msgId: freshId() }, user: { userId: '7101' }, comment: '15' })
        other += 1
      }
      await r.flush()
    }
    expect({ dup, other }).toEqual({ dup: 1000, other: 1000 })
    expect(r.records).toHaveLength(10_000)
    expect(r.records.map((x) => x.commentId)).toEqual(sent)
    expect(new Set(r.records.map((x) => x.commentId)).size).toBe(10_000)
    expect(r.conn.status().counts).toEqual({ received: 10_000, duplicates: 1_000, dropped: 0 })
  })
})
