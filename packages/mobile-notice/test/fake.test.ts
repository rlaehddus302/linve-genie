// 가짜 네이티브의 흐름 — 실제 네이티브와 같은 순서: 허용 앱 → 켜짐 → 꺼내기 → 거르기 → 두 번 막기 → 대기열 → 보내기.
import { describe, expect, it } from 'vitest'
import { createFakeNoticeNative, type FakeNoticeRequest } from '../src/fake.ts'
import { NOTICE_INTAKE_PATH, createNoticeIntake, isNoticeEnvelope, type RawNotice } from '../src/index.ts'

const TOKEN = 'dev_token_0123456789abcdef'
const T0 = 1_761_800_000_000

const sms = (over: Partial<RawNotice> = {}): RawNotice => ({
  packageName: 'com.samsung.android.messaging',
  whenMs: T0 + 1_000,
  postTimeMs: T0 + 1_000,
  title: '김민지',
  text: '찜 3번',
  bigText: null,
  messages: [{ timestampMs: T0 + 1_000, senderName: '김민지', senderUri: 'tel:010-1234-5678', text: '찜 3번', fromUser: false }],
  groupSummary: false,
  ongoing: false,
  ...over,
})

function setup(options: { status?: () => number | null; accessGranted?: boolean } = {}) {
  let clock = T0
  const requests: FakeNoticeRequest[] = []
  const fake = createFakeNoticeNative({
    platform: 'android',
    now: () => clock,
    accessGranted: options.accessGranted ?? true,
    send: async (request) => {
      requests.push(request)
      return options.status ? options.status() : 202
    },
  })
  const intake = createNoticeIntake(fake)
  return {
    fake,
    intake,
    requests,
    tick(ms: number) {
      clock += ms
    },
    async ready() {
      await intake.setToken({ token: TOKEN, serverUrl: 'https://livejjim.example', deviceId: 'phone-a' })
      await intake.start()
    },
  }
}

describe('허용한 앱만 연다', () => {
  it('다른 앱 알림은 내용을 열지 않고 버린다(건수에도 안 잡힘)', async () => {
    const { fake, intake, ready } = setup()
    await ready()
    const opened = await fake.post(sms({ packageName: 'com.kakao.talk', title: '친구', text: '비밀 이야기' }))
    expect(opened).toBe(false)
    expect(fake.unopened).toBe(1)
    expect(fake.sentEnvelopes).toEqual([])
    expect((await intake.getState()).pending).toBe(0)
  })
  it('은행 앱은 판매자가 고른 것만', async () => {
    const { fake, intake, ready } = setup()
    await ready()
    const bank: RawNotice = { packageName: 'com.kbstar.kbbank', whenMs: T0 + 5_000, postTimeMs: T0 + 5_000, title: '입금 35,000원', text: '홍길동', bigText: null, messages: null, groupSummary: false, ongoing: false }
    expect(await fake.post(bank)).toBe(false)
    await intake.setAllowedPackages(['com.kbstar.kbbank'])
    expect(await fake.post(bank)).toBe(true)
    expect(fake.sentEnvelopes).toHaveLength(1)
    expect(fake.sentEnvelopes[0]).toMatchObject({ kindHint: 'bank', sourceType: 'app_package', source: 'com.kbstar.kbbank', body: '입금 35,000원\n홍길동' })
  })
  it('꺼져 있으면 문자 앱 알림도 열지 않는다', async () => {
    const { fake, intake } = setup()
    await intake.setToken({ token: TOKEN, serverUrl: 'https://livejjim.example', deviceId: 'phone-a' })
    expect(await fake.post(sms())).toBe(false)
    expect(fake.sentEnvelopes).toEqual([])
  })
})

describe('보내기 — 약속 모양 봉투, Bearer 머리글', () => {
  it('문자찜 한 건 → 봉투 한 개', async () => {
    const { fake, requests, ready, tick } = setup()
    await ready()
    tick(2_000)
    await fake.post(sms())
    expect(requests).toHaveLength(1)
    const request = requests[0] as FakeNoticeRequest
    expect(request.url).toBe(`https://livejjim.example${NOTICE_INTAKE_PATH}`)
    expect(request.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' })
    const envelope = JSON.parse(request.body) as unknown
    expect(isNoticeEnvelope(envelope)).toBe(true)
    expect(envelope).toMatchObject({ kindHint: 'sms', sourceType: 'sms_number', source: '01012345678', body: '찜 3번', receivedAtMs: T0 + 1_000, sentAtMs: T0 + 2_000, deviceId: 'phone-a' })
  })
  it('같은 알림이 다시 떠도(대화 기록 포함 갱신) 두 번 보내지 않는다', async () => {
    const { fake, intake, ready } = setup()
    await ready()
    await fake.post(sms())
    const second = sms({
      messages: [
        { timestampMs: T0 + 1_000, senderName: '김민지', senderUri: 'tel:010-1234-5678', text: '찜 3번', fromUser: false },
        { timestampMs: T0 + 9_000, senderName: '김민지', senderUri: 'tel:010-1234-5678', text: '5번도요', fromUser: false },
      ],
    })
    await fake.post(second)
    await fake.post(second)
    expect(fake.sentEnvelopes.map((e) => e.body)).toEqual(['찜 3번', '5번도요'])
    // 두 번째 알림의 '찜 3번' 1건 + 세 번째 알림의 두 건 = 3건을 막았다
    expect((await intake.getState()).duplicates).toBe(3)
  })
  it('인증번호·광고는 기기에서 거르고 건수만 센다', async () => {
    const { fake, intake, ready } = setup()
    await ready()
    await fake.post(sms({ messages: [{ timestampMs: T0 + 1_000, senderName: '1588-0000', senderUri: null, text: '[Web발신] 인증번호 [482913]', fromUser: false }] }))
    await fake.post(sms({ messages: [{ timestampMs: T0 + 2_000, senderName: '1588-0000', senderUri: null, text: '(광고) 가을 세일', fromUser: false }] }))
    expect(fake.sentEnvelopes).toEqual([])
    expect((await intake.getState()).filtered).toBe(2)
  })
  it('서버 규칙으로 바꿀 수 있다 (기본 규칙은 빠진다)', async () => {
    const { fake, intake, ready } = setup()
    await ready()
    await intake.setFilterRules([{ id: 'out', field: 'body', op: 'contains', value: '출금' }])
    await fake.post(sms({ messages: [{ timestampMs: T0 + 1_000, senderName: '1588-0000', senderUri: null, text: '출금 10,000원', fromUser: false }] }))
    await fake.post(sms({ messages: [{ timestampMs: T0 + 2_000, senderName: '1588-0000', senderUri: null, text: '인증번호 1234', fromUser: false }] }))
    expect(fake.sentEnvelopes.map((e) => e.body)).toEqual(['인증번호 1234'])
  })
})

describe('대기열 — 끊김·서버 오류·토큰', () => {
  it('인터넷이 끊기면 모아 두었다가 지금 보내기로 받은 차례대로 보낸다', async () => {
    let online = false
    const { fake, intake, ready, requests } = setup({ status: () => (online ? 201 : null) })
    await ready()
    await fake.post(sms({ messages: [{ timestampMs: T0 + 3_000, senderName: '박', senderUri: null, text: '찜 2번', fromUser: false }] }))
    await fake.post(sms({ messages: [{ timestampMs: T0 + 1_000, senderName: '김', senderUri: null, text: '찜 1번', fromUser: false }] }))
    let state = await intake.getState()
    expect(state).toMatchObject({ pending: 2, lastError: 'NETWORK', sent: 0 })
    online = true
    const result = await intake.flush()
    expect(result).toEqual({ sent: 2, pending: 0, stoppedBy: null })
    expect(fake.sentEnvelopes.map((e) => e.body)).toEqual(['찜 1번', '찜 2번'])
    state = await intake.getState()
    expect(state).toMatchObject({ pending: 0, lastError: null, sent: 2 })
    expect(requests.length).toBeGreaterThan(2)
  })
  it('토큰이 없으면 모아만 두고, 넣으면 바로 보낸다', async () => {
    const { fake, intake } = setup()
    await intake.start()
    await fake.post(sms())
    expect(await intake.flush()).toEqual({ sent: 0, pending: 1, stoppedBy: 'NO_TOKEN' })
    await intake.setToken({ token: TOKEN, serverUrl: 'https://livejjim.example', deviceId: 'phone-a' })
    expect((await intake.flush()).pending).toBe(0)
    expect(fake.sentEnvelopes).toHaveLength(1)
  })
  it('401·403이면 보내기를 멈추고 대기열을 지키다가 새 토큰에서 다시', async () => {
    let status = 401
    const { fake, intake, ready } = setup({ status: () => status })
    await ready()
    await fake.post(sms())
    expect(await intake.getState()).toMatchObject({ tokenRejected: true, pending: 1, lastError: 'TOKEN' })
    expect(await intake.flush()).toMatchObject({ stoppedBy: 'TOKEN', pending: 1 })
    status = 202
    await intake.setToken({ token: `${TOKEN}_new`, serverUrl: 'https://livejjim.example', deviceId: 'phone-a' })
    expect(await intake.flush()).toMatchObject({ pending: 0 })
    expect(await intake.getState()).toMatchObject({ tokenRejected: false, sent: 1 })
  })
  it('409는 이미 받은 것 — 지우되 보냄 건수엔 안 넣는다. 422는 버리고 서버가 받지 않음 건수', async () => {
    const statuses = [409, 422]
    const { fake, intake, ready } = setup({ status: () => statuses.shift() ?? 202 })
    await ready()
    await fake.post(sms())
    await fake.post(sms({ messages: [{ timestampMs: T0 + 2_000, senderName: '김', senderUri: null, text: '찜 9번', fromUser: false }] }))
    expect(await intake.getState()).toMatchObject({ pending: 0, sent: 0, rejected: 1 })
  })
  it('5xx는 다시 보낼 것으로 남긴다', async () => {
    const { fake, intake, ready } = setup({ status: () => 503 })
    await ready()
    await fake.post(sms())
    expect(await intake.getState()).toMatchObject({ pending: 1, lastError: 'SERVER' })
  })
  it('대기열이 넘치면 더 담지 않고 건수만 센다', async () => {
    const fake = createFakeNoticeNative({ platform: 'android', now: () => T0, queueMax: 1, send: async () => null })
    const intake = createNoticeIntake(fake)
    await intake.setToken({ token: TOKEN, serverUrl: 'https://livejjim.example', deviceId: 'phone-a' })
    await intake.start()
    await fake.post(sms())
    await fake.post(sms({ messages: [{ timestampMs: T0 + 2_000, senderName: '김', senderUri: null, text: '찜 9번', fromUser: false }] }))
    expect(await intake.getState()).toMatchObject({ pending: 1, dropped: 1 })
  })
})

describe('재부팅 뒤 이어받기', () => {
  it('대기열·본 열쇠·설정이 남고, 서비스가 다시 붙으면 떠 있는 알림을 훑어 못 보낸 것만 보낸다', async () => {
    let online = false
    const { fake, intake, ready } = setup({ status: () => (online ? 202 : null) })
    await ready()
    await intake.setAllowedPackages(['com.kbstar.kbbank'])
    await fake.post(sms())
    fake.reboot()
    expect(await intake.getState()).toMatchObject({ enabled: true, connected: false, pending: 1, bankPackages: ['com.kbstar.kbbank'], hasToken: true })
    online = true
    const missed = sms({ messages: [{ timestampMs: T0 + 30_000, senderName: '이', senderUri: null, text: '찜 4번', fromUser: false }] })
    await fake.connect([sms(), missed])
    expect(fake.sentEnvelopes.map((e) => e.body)).toEqual(['찜 3번', '찜 4번'])
    expect(await intake.getState()).toMatchObject({ connected: true, pending: 0, duplicates: 1 })
  })
})

describe('아이폰 단축어 "라이브지니에 넣기"', () => {
  it('켜기·토큰 전에는 넣지 않고, 넣으면 sms_number로 보낸다', async () => {
    let clock = T0
    const fake = createFakeNoticeNative({ platform: 'ios', now: () => clock })
    const intake = createNoticeIntake(fake)
    expect(await fake.runShortcut({ sender: '010-1234-5678', body: '찜 7번', kind: 'sms' })).toBe('off')
    await intake.start()
    expect(await fake.runShortcut({ sender: '010-1234-5678', body: '찜 7번', kind: 'sms' })).toBe('noToken')
    await intake.setToken({ token: TOKEN, serverUrl: 'https://livejjim.example', deviceId: 'iphone-a' })
    expect(await fake.runShortcut({ sender: '010-1234-5678', body: '찜 7번', kind: 'sms' })).toBe('sent')
    clock += 10_000
    expect(await fake.runShortcut({ sender: '010-1234-5678', body: '찜 7번', kind: 'sms' })).toBe('duplicate')
    expect(await fake.runShortcut({ sender: '15889999', body: '[KB] 입금 35,000원 홍길동', kind: 'bank' })).toBe('sent')
    expect(await fake.runShortcut({ sender: '15880000', body: '인증번호 123456', kind: 'sms' })).toBe('filtered')
    expect(await fake.runShortcut({ sender: '15880000', body: '  ', kind: 'sms' })).toBe('empty')
    expect(fake.sentEnvelopes.map((e) => [e.kindHint, e.sourceType, e.source])).toEqual([
      ['sms', 'sms_number', '01012345678'],
      ['bank', 'sms_number', '15889999'],
    ])
    const state = await intake.getState()
    expect(state).toMatchObject({ platform: 'ios', access: 'shortcut', connected: false, batteryOptimized: null })
  })
})
