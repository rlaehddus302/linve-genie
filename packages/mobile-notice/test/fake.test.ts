// 가짜 네이티브의 흐름 — 실제 네이티브와 같은 순서: 읽을 앱 → 켜짐 → 꺼내기 → 거르기 → 두 번 막기 → 대기열 → 보내기.
// AC-SMS3-26(무엇을 읽어 보내나)·AC-SMS3-27(다시 보내기)을 가짜 알림·가짜 서버로 확인한다.
import { describe, expect, it } from 'vitest'
import { FAKE_SERVER_FILTERS, createFakeNoticeNative, fakeServerReply, type FakeNoticeReply, type FakeNoticeRequest } from '../src/fake.ts'
import { NOTICE_INTAKE_PATH, createNoticeIntake, isInboxRequest, type InboxRequest, type RawNotice } from '../src/index.ts'

const TOKEN = 'dev_token_0123456789abcdef'
const T0 = 1_761_800_000_000
const SMS_APP = 'com.samsung.android.messaging'

const sms = (over: Partial<RawNotice> = {}, text = '15 홍길동', at = T0 + 1_000): RawNotice => ({
  packageName: SMS_APP,
  whenMs: at,
  postTimeMs: at,
  title: '010-1234-5678',
  text,
  bigText: null,
  messages: [{ timestampMs: at, senderName: '010-1234-5678', senderUri: null, text, fromUser: false }],
  groupSummary: false,
  ongoing: false,
  ...over,
})
const appNotice = (packageName: string, title: string, text: string, at = T0 + 2_000): RawNotice => ({
  packageName,
  whenMs: at,
  postTimeMs: at,
  title,
  text,
  bigText: null,
  messages: null,
  groupSummary: false,
  ongoing: false,
})

type Reply = (request: FakeNoticeRequest) => FakeNoticeReply
const ok: Reply = (request) => fakeServerReply(request.body)

function setup(options: { reply?: Reply; accessGranted?: boolean; platform?: 'android' | 'ios' } = {}) {
  let clock = T0
  let reply = options.reply ?? ok
  const requests: FakeNoticeRequest[] = []
  const fake = createFakeNoticeNative({
    platform: options.platform ?? 'android',
    now: () => clock,
    accessGranted: options.accessGranted ?? true,
    send: async (request) => {
      requests.push(request)
      return reply(request)
    },
  })
  const intake = createNoticeIntake(fake)
  const bodies = () => requests.map((r) => JSON.parse(r.body) as InboxRequest)
  const sentMessages = () => bodies().flatMap((b) => b.messages)
  return {
    fake,
    intake,
    requests,
    bodies,
    sentMessages,
    setReply(next: Reply) {
      reply = next
    },
    tick(ms: number) {
      clock += ms
    },
    async ready() {
      await intake.setToken({ token: TOKEN, serverUrl: 'https://livejjim.example', deviceName: '내 갤럭시' })
      await intake.start()
    },
  }
}

describe('AC-SMS3-26 무엇을 읽어 보내나', () => {
  it('filters를 받은 뒤: 기본 문자 앱 문자·은행 앱 알림만 가고, 메신저·인증번호 문자는 가지 않는다', async () => {
    const t = setup()
    await t.ready()
    expect((await t.intake.getState()).hasFilters).toBe(true)
    expect(await t.fake.post(sms())).toBe(true)
    expect(await t.fake.post(appNotice('com.kakaobank.channel', '입금 35,000원', '홍길동 잔액 1,234,000원'))).toBe(true)
    expect(await t.fake.post(appNotice('com.kakao.talk', '김민지', '내일 봐'))).toBe(false)
    expect(await t.fake.post(sms({}, '[Web발신] 인증번호 123456', T0 + 3_000))).toBe(true)

    const sent = t.sentMessages()
    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({ channel: 'SMS', from: '010-1234-5678', title: null, text: '15 홍길동', receivedAt: T0 + 1_000 })
    expect(sent[1]).toMatchObject({ channel: 'APP', from: 'com.kakaobank.channel', title: '입금 35,000원', text: '홍길동 잔액 1,234,000원' })
    const state = await t.intake.getState()
    expect(state.filtered).toBe(1)
    expect(t.fake.unopened).toBe(1)
    for (const request of t.requests) {
      expect(request.url).toBe(`https://livejjim.example${NOTICE_INTAKE_PATH}`)
      expect(request.headers.Authorization).toBe(`Bearer ${TOKEN}`)
      expect(isInboxRequest(JSON.parse(request.body))).toBe(true)
    }
  })

  it('은행 대표번호 문자는 [Web발신]·승인·결제가 들어도 거르지 않고 보낸다 — 목록 받기 전(기기 사본)·받은 뒤 모두 (D-SMS3-26)', async () => {
    const bank = (from: string, text: string, at: number): RawNotice => sms({ title: from, messages: [{ timestampMs: at, senderName: from, senderUri: null, text, fromUser: false }] }, text, at)
    for (const reply of [() => null, ok] as Reply[]) {
      const t = setup({ reply })
      await t.ready()
      await t.fake.post(bank('1588-9999', '[Web발신] 홍길동 입금 14,000원 잔액 50,000원', T0 + 1_000))
      await t.fake.post(bank('15993333', '[Web발신] 승인 12,000원 출금 잔액 38,000원', T0 + 2_000))
      await t.fake.post(bank('1588 1111', '[Web발신] 결제 3,000원 잔액 35,000원', T0 + 3_000))
      // 흉내·국외·목록 밖 번호는 그대로 거른다
      await t.fake.post(bank('+82 1588-9999', '[Web발신] 홍길동 입금 14,000원', T0 + 4_000))
      await t.fake.post(bank('1588-0000', '[Web발신] 승인 1,000원', T0 + 5_000))
      await t.fake.post(bank('010-1234-5678', '(광고) 봄맞이', T0 + 6_000))
      const texts = [...t.fake.queued, ...t.sentMessages()].map((m) => m.text)
      expect(new Set(texts)).toEqual(new Set(['[Web발신] 홍길동 입금 14,000원 잔액 50,000원', '[Web발신] 승인 12,000원 출금 잔액 38,000원', '[Web발신] 결제 3,000원 잔액 35,000원']))
      expect((await t.intake.getState()).filtered).toBe(3)
    }
  })

  it('서버가 준 bankNumbers를 저장해 쓴다 — 목록에 없는 번호의 은행 문자는 거른다', async () => {
    const t = setup({ reply: (r) => fakeServerReply(r.body, { ...FAKE_SERVER_FILTERS, bankNumbers: ['15881234'] }) })
    await t.ready()
    await t.fake.post(sms({ title: '1588-1234', messages: null }, '[Web발신] 홍길동 입금 1,000원', T0 + 1_000))
    await t.fake.post(sms({ title: '1588-9999', messages: null }, '[Web발신] 김민지 입금 2,000원', T0 + 2_000))
    expect(t.sentMessages().map((m) => m.from)).toEqual(['1588-1234'])
  })

  it('filters를 받기 전이면 문자만 — 은행 앱 알림은 열지도 않는다', async () => {
    const t = setup({ reply: () => null })
    await t.ready()
    expect((await t.intake.getState()).hasFilters).toBe(false)
    expect(await t.fake.post(appNotice('com.kakaobank.channel', '입금 35,000원', '홍길동'))).toBe(false)
    expect(await t.fake.post(sms())).toBe(true)
    expect(t.fake.queued.map((m) => m.channel)).toEqual(['SMS'])
    expect(t.fake.unopened).toBe(1)
    // 목록 받기 전에도 R-26 3 사본으로 인증번호 문자는 거른다
    await t.fake.post(sms({}, '인증번호 123456', T0 + 5_000))
    expect(t.fake.queued).toHaveLength(1)
  })

  it('목록 받기 전 연결이 되면 0건 요청으로 filters부터 받는다', async () => {
    const t = setup()
    await t.ready()
    expect(t.bodies()[0]).toEqual({ device: '내 갤럭시', messages: [] })
    expect((await t.intake.getState()).bankApps).toEqual([...FAKE_SERVER_FILTERS.bankApps])
  })

  it('기본 문자 앱이 아닌 문자 앱 알림은 읽지 않는다', async () => {
    const t = setup()
    await t.ready()
    expect(await t.fake.post(sms({ packageName: 'com.google.android.apps.messaging' }))).toBe(false)
    t.fake.setDefaultSmsPackage('com.google.android.apps.messaging')
    expect(await t.fake.post(sms({ packageName: 'com.google.android.apps.messaging' }))).toBe(true)
    expect(t.sentMessages()).toHaveLength(1)
  })

  it('서버가 skipWords·bankApps를 바꿔 주면 저장해서 그대로 거른다(영문 대소문자 무시)', async () => {
    const t = setup({ reply: (r) => fakeServerReply(r.body, { skipWords: ['SALE'], bankApps: ['viva.republica.toss'], bankNumbers: [] }) })
    await t.ready()
    await t.fake.post(sms({}, 'Big sale 15번', T0 + 1_000))
    expect(await t.fake.post(appNotice('com.kakaobank.channel', '입금', '1원'))).toBe(false)
    expect(await t.fake.post(appNotice('viva.republica.toss', '입금', '1원'))).toBe(true)
    expect(t.sentMessages().map((m) => m.from)).toEqual(['viva.republica.toss'])
    // 앱을 껐다 켜도 저장한 목록이 남는다
    t.fake.reboot()
    t.setReply(() => null)
    expect(await t.fake.post(appNotice('viva.republica.toss', '입금', '2원', T0 + 9_000))).toBe(true)
  })

  it('꺼져 있거나 알림 읽기가 꺼져 있으면 문자 앱 알림도 열지 않는다', async () => {
    const t = setup()
    await t.intake.setToken({ token: TOKEN, serverUrl: 'https://livejjim.example', deviceName: '폰' })
    expect(await t.fake.post(sms())).toBe(false)
    await t.intake.start()
    t.fake.setAccess(false)
    expect(await t.fake.post(sms())).toBe(false)
    expect(t.sentMessages()).toHaveLength(0)
  })
})

describe('AC-SMS3-27 다시 보내기', () => {
  it('응답 없음·5xx면 같은 id로 대기열에 두고 다시 보낸다', async () => {
    const t = setup()
    await t.ready()
    t.setReply(() => null)
    await t.fake.post(sms())
    const id = t.fake.queued[0]?.id
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect((await t.intake.getState()).lastError).toBe('NETWORK')
    t.setReply(() => 503)
    expect((await t.intake.flush()).stoppedBy).toBe('SERVER')
    t.setReply(ok)
    expect(await t.intake.flush()).toEqual({ sent: 1, pending: 0, stoppedBy: null })
    const tries = t.bodies().filter((b) => b.messages.length > 0).map((b) => b.messages[0]?.id)
    expect(tries).toEqual([id, id, id])
  })

  it('429면 1분 동안 보내지 않고, 1분 뒤 같은 id로 다시', async () => {
    const t = setup()
    await t.ready()
    t.setReply(() => 429)
    await t.fake.post(sms())
    const before = t.requests.length
    t.setReply(ok)
    await t.fake.post(sms({}, '16 김민지', T0 + 2_000))
    expect(await t.intake.flush()).toMatchObject({ sent: 0, pending: 2, stoppedBy: 'BUSY' })
    expect(t.requests.length).toBe(before)
    t.tick(60_000)
    expect(await t.intake.flush()).toEqual({ sent: 2, pending: 0, stoppedBy: null })
  })

  it('401이면 보내기를 멈추고 "받기 열쇠를 다시 넣어 주세요" — 새 토큰에서 같은 id로 다시', async () => {
    const t = setup()
    await t.ready()
    t.setReply(() => 401)
    await t.fake.post(sms())
    await t.fake.post(sms({}, '16 김민지', T0 + 2_000))
    const state = await t.intake.getState()
    expect(state.tokenRejected).toBe(true)
    expect(state.pending).toBe(2)
    const { noticeStatusLine } = await import('../src/index.ts')
    expect(noticeStatusLine(state)).toBe('받기 열쇠를 다시 넣어 주세요')
    const tried = t.requests.length
    expect((await t.intake.flush()).stoppedBy).toBe('TOKEN')
    expect(t.requests.length).toBe(tried)
    t.setReply(ok)
    await t.intake.setToken({ token: 'new_token_0123456789abcdef', serverUrl: 'https://livejjim.example', deviceName: '내 갤럭시' })
    expect((await t.intake.getState()).pending).toBe(0)
  })

  it('앱을 껐다 켜도 대기열은 남는다', async () => {
    const t = setup()
    await t.ready()
    t.setReply(() => null)
    await t.fake.post(sms())
    t.fake.reboot()
    expect(t.fake.queued).toHaveLength(1)
    t.setReply(ok)
    await t.fake.connect()
    expect(t.fake.queued).toHaveLength(0)
    expect(t.sentMessages().filter((m) => m.text === '15 홍길동')).toHaveLength(2)
    expect(new Set(t.sentMessages().map((m) => m.id)).size).toBe(1)
  })

  it('대기열은 최대 1,000건 — 넘으면 오래된 것부터 버리고 버린 건수를 "보내지 못하고 버린 알림" 줄로 보인다 (D-SMS3-28)', async () => {
    const t = setup()
    await t.ready()
    t.setReply(() => null)
    for (let i = 0; i < 1_003; i++) await t.fake.post(sms({}, `${i + 1} 홍길동`, T0 + i * 1_000))
    const state = await t.intake.getState()
    expect(state.pending).toBe(1_000)
    expect(state.dropped).toBe(3)
    expect(t.fake.queued[0]?.text).toBe('4 홍길동')
    const { noticeDroppedLine } = await import('../src/index.ts')
    expect(noticeDroppedLine(state)).toBe('보내지 못하고 버린 알림이 3건 있어요. 은행 앱에서 입금을 확인해 주세요')
  })

  it('같은 알림이 고쳐 다시 뜨면(알림 갱신·떠 있는 알림 다시 훑기) 같은 id — 두 번 보내지 않는다', async () => {
    const t = setup()
    await t.ready()
    await t.fake.post(sms())
    const first = sms()
    const updated = sms({
      whenMs: T0 + 9_000,
      messages: [...(first.messages ?? []), { timestampMs: T0 + 9_000, senderName: '010-1234-5678', senderUri: null, text: '16 홍길동', fromUser: false }],
    })
    await t.fake.post(updated)
    await t.fake.connect([updated])
    const sent = t.sentMessages()
    expect(sent.map((m) => m.text)).toEqual(['15 홍길동', '16 홍길동'])
    expect((await t.intake.getState()).duplicates).toBe(3)
  })

  it('같은 손님의 새 문자로 알림이 갱신되면(같은 알림 자리·새 본문) id가 달라 새 문자로 보낸다 — 받은 시각이 같아도 (AC-SMS3-27은 본문이 같을 때)', async () => {
    const t = setup()
    await t.ready()
    // 메시지 스타일이 아닌 문자 앱: 알림 시각(when)을 처음 문자 시각 그대로 두고 본문만 바꾸는 경우
    await t.fake.post(sms({ messages: null }, '15 홍길동', T0 + 1_000))
    await t.fake.post(sms({ messages: null }, '16 홍길동', T0 + 1_000))
    // 메시지 스타일: 같은 시각에 두 통
    await t.fake.post(sms({ messages: [{ timestampMs: T0 + 5_000, senderName: '010-1234-5678', senderUri: null, text: '17 홍길동', fromUser: false }] }, '17 홍길동', T0 + 5_000))
    await t.fake.post(sms({ messages: [{ timestampMs: T0 + 5_000, senderName: '010-1234-5678', senderUri: null, text: '18 홍길동', fromUser: false }] }, '18 홍길동', T0 + 5_000))
    // 본문까지 같은 것이 다시 뜨면 그때만 같은 id
    await t.fake.post(sms({ messages: null }, '16 홍길동', T0 + 1_000))
    const sent = t.sentMessages()
    expect(sent.map((m) => m.text)).toEqual(['15 홍길동', '16 홍길동', '17 홍길동', '18 홍길동'])
    expect(new Set(sent.map((m) => m.id)).size).toBe(4)
    expect((await t.intake.getState()).duplicates).toBe(1)
  })

  it('20건씩 묶어 보내고, 결과 SAVED·DUPLICATE·IGNORED를 센다', async () => {
    const t = setup()
    await t.ready()
    t.setReply(() => null)
    for (let i = 0; i < 25; i++) await t.fake.post(sms({}, `${i + 1} 홍길동`, T0 + i * 1_000))
    let n = 0
    t.setReply((r) => fakeServerReply(r.body, FAKE_SERVER_FILTERS, () => (['SAVED', 'DUPLICATE', 'IGNORED'] as const)[n++ % 3] ?? 'SAVED'))
    expect(await t.intake.flush()).toMatchObject({ pending: 0, stoppedBy: null })
    const batches = t.bodies().filter((b) => b.messages.length > 0).slice(-2)
    expect(batches.map((b) => b.messages.length)).toEqual([20, 5])
    const state = await t.intake.getState()
    expect(state.sent + state.ignored + state.duplicates).toBe(25)
    expect(state.ignored).toBe(8)
  })

  it('400이면 한 건씩 다시 보내 틀린 한 건만 버린다', async () => {
    const t = setup()
    await t.ready()
    t.setReply(() => null)
    for (let i = 0; i < 3; i++) await t.fake.post(sms({}, `${i + 1} 홍길동`, T0 + i * 1_000))
    t.setReply((r) => {
      const body = JSON.parse(r.body) as InboxRequest
      return body.messages.some((m) => m.text === '2 홍길동') ? 400 : fakeServerReply(r.body)
    })
    expect(await t.intake.flush()).toEqual({ sent: 2, pending: 0, stoppedBy: null })
    expect((await t.intake.getState()).rejected).toBe(1)
  })

  it('413도 한 건씩 다시 보내고, 받지 않은 건수가 상태 줄에 "서버가 받지 않음"으로 보인다 — 본문은 남기지 않는다', async () => {
    const t = setup()
    await t.ready()
    t.setReply(() => null)
    for (let i = 0; i < 4; i++) await t.fake.post(sms({}, `${i + 1} 홍길동`, T0 + i * 1_000))
    t.setReply((r) => {
      const body = JSON.parse(r.body) as InboxRequest
      return body.messages.some((m) => m.text === '2 홍길동' || m.text === '4 홍길동') ? 413 : fakeServerReply(r.body)
    })
    expect(await t.intake.flush()).toEqual({ sent: 2, pending: 0, stoppedBy: null })
    const state = await t.intake.getState()
    expect(state.rejected).toBe(2)
    const { noticeCountLine } = await import('../src/index.ts')
    expect(noticeCountLine(state)).toContain('서버가 받지 않음 2건')
    expect(JSON.stringify(state)).not.toContain('홍길동')
  })

  it('403(받기 꺼짐)이면 토큰을 버리지 않고 대기열을 지킨다 — 10분 동안은 묻지 않고, 10분 뒤 0건 요청으로 다시 보고 켜졌으면 같은 id로 보낸다 (D-SMS3-27)', async () => {
    const t = setup()
    await t.ready()
    t.setReply(() => 403)
    await t.fake.post(sms())
    const state = await t.intake.getState()
    expect(state).toMatchObject({ tokenRejected: false, inboxOff: true, hasToken: true, pending: 1, rejected: 0, lastError: 'OFF' })
    const { noticeStatusLine } = await import('../src/index.ts')
    expect(noticeStatusLine(state)).toBe('웹 설정에서 휴대폰 알림 받기가 꺼져 있어요. 켜면 모아 둔 알림을 보내요')
    const tried = t.requests.length
    // 10분 안에 온 새 알림은 담기만 하고 서버에 묻지 않는다
    t.tick(599_999)
    await t.fake.post(sms({}, '16 김민지', T0 + 2_000))
    expect(t.requests.length).toBe(tried)
    expect(t.fake.queued).toHaveLength(2)
    // 10분이 지나면 0건 요청으로 먼저 본다 — 아직 꺼져 있으면 대기열을 싣지 않는다
    t.tick(1)
    await t.fake.post(sms({}, '17 이수진', T0 + 3_000))
    expect(t.bodies().slice(tried).map((b) => b.messages.length)).toEqual([0])
    expect((await t.intake.getState()).inboxOff).toBe(true)
    // 웹에서 다시 켰다 — 10분 뒤 0건 요청이 200이면 모아 둔 것을 받은 차례대로 같은 id로 보낸다
    const ids = t.fake.queued.map((m) => m.id)
    t.setReply(ok)
    t.tick(600_000)
    await t.fake.post(sms({}, '18 박지민', T0 + 4_000))
    expect(t.bodies().slice(tried + 1).map((b) => b.messages.length)).toEqual([0, 4])
    expect(t.sentMessages().map((m) => m.id).slice(-4).slice(0, 3)).toEqual(ids)
    expect(await t.intake.getState()).toMatchObject({ inboxOff: false, pending: 0, lastError: null, tokenRejected: false })
  })

  it('403(받기 꺼짐) 뒤 앱을 열면(지금 보내기·켜기) 10분을 기다리지 않고 바로 다시 본다', async () => {
    const t = setup()
    await t.ready()
    t.setReply(() => 403)
    await t.fake.post(sms())
    expect((await t.intake.flush()).stoppedBy).toBe('OFF')
    t.setReply(ok)
    expect(await t.intake.flush()).toEqual({ sent: 1, pending: 0, stoppedBy: null })
    expect((await t.intake.getState()).inboxOff).toBe(false)
  })

  it('401만 토큰 거절이다 — 403 뒤에 401이 오면 그때 "받기 열쇠를 다시 넣어 주세요"', async () => {
    const t = setup()
    await t.ready()
    t.setReply(() => 403)
    await t.fake.post(sms())
    t.setReply(() => 401)
    expect((await t.intake.flush()).stoppedBy).toBe('TOKEN')
    const state = await t.intake.getState()
    expect(state.tokenRejected).toBe(true)
    expect(state.pending).toBe(1)
    const { noticeStatusLine } = await import('../src/index.ts')
    expect(noticeStatusLine(state)).toBe('받기 열쇠를 다시 넣어 주세요')
  })

  it('500(잠깐의 서버 오류)이면 묶음을 지우지 않고 같은 id로 다시 보낸다 (D-SMS3-31)', async () => {
    const t = setup()
    await t.ready()
    t.setReply(() => 500)
    await t.fake.post(sms())
    await t.fake.post(sms({}, '16 김민지', T0 + 2_000))
    expect(await t.intake.getState()).toMatchObject({ pending: 2, lastError: 'SERVER', rejected: 0, tokenRejected: false, inboxOff: false })
    const ids = t.fake.queued.map((m) => m.id)
    t.setReply(ok)
    expect(await t.intake.flush()).toEqual({ sent: 2, pending: 0, stoppedBy: null })
    expect(t.bodies().filter((b) => b.messages.length > 0).map((b) => b.messages.map((m) => m.id))).toEqual([ids.slice(0, 1), ids, ids])
  })

  it('filters를 받기 전에는 재부팅·다시 연결해도 은행 앱 알림을 열지 않고, 받은 뒤에야 연다', async () => {
    const t = setup({ reply: () => null })
    await t.ready()
    t.fake.reboot()
    const bank = appNotice('com.kakaobank.channel', '입금 35,000원', '홍길동')
    await t.fake.connect([bank])
    expect(t.fake.queued).toHaveLength(0)
    expect(t.fake.unopened).toBe(1)
    t.setReply(ok)
    await t.intake.flush()
    expect((await t.intake.getState()).hasFilters).toBe(true)
    expect(await t.fake.post(bank)).toBe(true)
    expect(t.sentMessages().map((m) => m.channel)).toEqual(['APP'])
  })
})

describe('아이폰 단축어 "라이브지니에 문자 보내기"', () => {
  it('켜기·토큰 전에는 넣지 않고, 넣으면 channel SMS로 보낸다(거를 낱말은 보내지 않음)', async () => {
    const t = setup({ platform: 'ios' })
    expect(await t.fake.runShortcut({ sender: '010-1234-5678', body: '15 홍길동' })).toBe('off')
    await t.intake.start()
    expect(await t.fake.runShortcut({ sender: '010-1234-5678', body: '15 홍길동' })).toBe('noToken')
    await t.intake.setToken({ token: TOKEN, serverUrl: 'https://livejjim.example', deviceName: '아이폰' })
    expect(await t.fake.runShortcut({ sender: '010-1234-5678', body: '15 홍길동' })).toBe('sent')
    expect(await t.fake.runShortcut({ sender: '010-1234-5678', body: '15 홍길동' })).toBe('duplicate')
    expect(await t.fake.runShortcut({ sender: '1588-0000', body: '[Web발신] 결제 승인' })).toBe('filtered')
    // 은행 대표번호 문자는 거르지 않는다 (D-SMS3-26)
    expect(await t.fake.runShortcut({ sender: '1588-9999', body: '[Web발신] 홍길동 입금 14,000원' })).toBe('sent')
    expect(await t.fake.runShortcut({ sender: '', body: '  ' })).toBe('empty')
    expect(t.sentMessages()).toEqual([
      expect.objectContaining({ channel: 'SMS', from: '010-1234-5678', title: null, text: '15 홍길동' }),
      expect.objectContaining({ channel: 'SMS', from: '1588-9999', title: null, text: '[Web발신] 홍길동 입금 14,000원' }),
    ])
    expect(t.bodies().every((b) => b.device === '아이폰')).toBe(true)
  })
})
