// 실제 연결기 감싸개 시험 (N2b-1, AC-N2b-1-02·03·04·21·22·35, D-N2b-1-01·07).
// 라이브러리 tiktok-live-connector 2.1.0의 실제 오류 형·실제 protobuf 디코더·실제 이벤트 내보내기 경로로 확인한다.
// 실제 틱톡·서명 서비스로는 나가지 않는다: 연결 시도는 바깥 연결 막기 장치(setup-outbound-guard.ts)에 걸리고, 이 파일은 센 값을 확인한 뒤 되돌린다.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {
  AlreadyConnectingError,
  AuthenticatedWebSocketConnectionError,
  BaseProtoMessage,
  CommonMessageData,
  ControlEvent,
  deserializeMessage,
  ErrorReason,
  FetchIsLiveError,
  InvalidResponseError,
  InvalidUniqueIdError,
  MissingRoomIdError,
  PremiumFeatureError,
  ProtoMessageFetchResult,
  SignAPIError,
  SignatureMissingTokensError,
  SignatureRateLimitError,
  TikTokLiveConnection,
  User,
  UserOfflineError,
  WebcastChatMessage,
  WebcastControlMessage,
  WebcastLikeMessage,
} from 'tiktok-live-connector'
import { describe, expect, it } from 'vitest'
import {
  classifyWebcastFailure,
  fakeLibraryError,
  libraryWebcast,
  TIKTOK_FAILURE_KINDS,
  TIKTOK_LIBRARY_OPTION_KEYS,
  type LibraryConnectionConstructor,
  type TikTokLibraryOptions,
} from '../src/tiktok/index.ts'
import { installOutboundGuard, TIKTOK_BLOCKED_DOMAINS, hostMatches } from './outbound-guard.ts'
import { chatFields, freshId, rig } from './tiktok-support.ts'

const requireFromServer = createRequire(new URL('../package.json', import.meta.url))
const EMPTY = new Uint8Array(0)

// ── 실제 라이브러리 자료 만들기 (2.1.0 tiktok-schema의 ts-proto 인코더·디코더) ─────────────────────

function chatBytes(fields: { msgId: string; userId: string; uniqueId: string; nickname: string; comment: string; createTime?: string }): Uint8Array {
  const message = WebcastChatMessage.decode(EMPTY)
  const common = CommonMessageData.decode(EMPTY)
  common.method = 'WebcastChatMessage'
  common.msgId = fields.msgId
  common.createTime = fields.createTime ?? '1700000000000'
  const user = User.decode(EMPTY)
  user.userId = fields.userId
  user.uniqueId = fields.uniqueId
  user.nickname = fields.nickname
  user.secUid = 'MS4wLjABAAAArealSecUid'
  message.common = common
  message.user = user
  message.comment = fields.comment
  return WebcastChatMessage.encode(message).finish()
}

function controlBytes(action: number): Uint8Array {
  const message = WebcastControlMessage.decode(EMPTY)
  message.common = CommonMessageData.decode(EMPTY)
  message.action = action
  return WebcastControlMessage.encode(message).finish()
}

function likeBytes(): Uint8Array {
  const message = WebcastLikeMessage.decode(EMPTY)
  message.common = CommonMessageData.decode(EMPTY)
  message.common.msgId = '7301999999999999999'
  message.user = User.decode(EMPTY)
  message.user.userId = '7101'
  return WebcastLikeMessage.encode(message).finish()
}

/** 웹소켓·처음 받기 결과와 같은 ProtoMessageFetchResult를 라이브러리 deserializeMessage로 풀어 만든다 */
function fetchResult(messages: Array<{ type: string; payload: Uint8Array }>): ReturnType<typeof ProtoMessageFetchResult.decode> {
  const result = ProtoMessageFetchResult.decode(EMPTY)
  result.cursor = '1'
  result.messages = messages.map((m) => {
    const base = BaseProtoMessage.decode(EMPTY)
    base.type = m.type
    base.payload = m.payload
    return base
  })
  return deserializeMessage('ProtoMessageFetchResult', Buffer.from(ProtoMessageFetchResult.encode(result).finish()))
}

/** 실제 TikTokLiveConnection — connect()만 바깥 연결 없이 성공으로 바꾼다. 이벤트 내보내기(processProtoMessageFetchResult)는 라이브러리 코드 그대로 */
const constructed: Array<{ uniqueId: string; options: unknown; instance: OfflineLibraryConnection }> = []
class OfflineLibraryConnection extends TikTokLiveConnection {
  constructor(uniqueId: string, options: TikTokLibraryOptions) {
    super(uniqueId, options as never)
    constructed.push({ uniqueId, options, instance: this })
  }
  override async connect() {
    return this.state
  }
  push(messages: Array<{ type: string; payload: Uint8Array }>): Promise<void> {
    return (this as unknown as { processProtoMessageFetchResult(r: unknown): Promise<void> }).processProtoMessageFetchResult(fetchResult(messages))
  }
}
const Offline = OfflineLibraryConnection as unknown as LibraryConnectionConstructor

describe('AC-N2b-1-02 연결기 판·라이선스 고정', () => {
  it('설치된 tiktok-live-connector는 2.1.0, MIT', () => {
    const pkg = JSON.parse(readFileSync(requireFromServer.resolve('tiktok-live-connector/package.json'), 'utf8')) as { version: string; license: string }
    expect(pkg.version).toBe('2.1.0')
    expect(pkg.license).toBe('MIT')
  })

  it('apps/server dependencies에 범위 기호 없는 "2.1.0", 잠금 파일도 2.1.0으로만 풀린다, 직접 의존성은 모두 고정 판', () => {
    const server = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
    expect(server.dependencies['tiktok-live-connector']).toBe('2.1.0')
    for (const [name, spec] of Object.entries({ ...server.dependencies, ...server.devDependencies })) {
      expect(spec === 'workspace:*' || /^[0-9]+\.[0-9]+\.[0-9]+$/.test(spec), `${name}@${spec}`).toBe(true)
    }
    const lock = readFileSync(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8')
    const versions = new Set([...lock.matchAll(/tiktok-live-connector@([0-9][^:('\s]*)/g)].map((m) => m[1]))
    expect([...versions]).toEqual(['2.1.0'])
    expect(lock).toMatch(/tiktok-live-connector:\n\s+specifier: 2\.1\.0\n\s+version: 2\.1\.0/)
  })

  it('이 스프린트로 새로 더한 직접 의존성은 고정 판이고 라이선스가 MIT·ISC·BSD·Apache-2.0 중 하나다', () => {
    // BASE(N2b-1 시작 전)의 직접 의존성. 이 밖의 이름은 이 스프린트(또는 그 뒤)에 더한 것이라 라이선스를 본다
    const BASE_DEPENDENCIES = new Set(['@electric-sql/pglite', '@hono/node-server', '@livejjim/core', '@livejjim/label', 'drizzle-orm', 'hono', 'postgres', '@types/node', 'vitest'])
    const PERMISSIVE = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0'])
    const server = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
    const added = Object.entries({ ...server.dependencies, ...server.devDependencies }).filter(([name]) => !BASE_DEPENDENCIES.has(name))
    expect(added.map(([name]) => name)).toEqual(['tiktok-live-connector'])
    for (const [name, spec] of added) {
      expect(spec, name).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/)
      const pkg = JSON.parse(readFileSync(requireFromServer.resolve(`${name}/package.json`), 'utf8')) as { license?: unknown }
      expect(PERMISSIVE.has(String(pkg.license)), `${name}: ${String(pkg.license)}`).toBe(true)
    }
  })

  it('연결기가 끌고 오는 실행 의존성에도 GPL 계열(AGPL·LGPL 포함)·SSPL 라이선스가 없다', () => {
    // pnpm 배치: .pnpm/<이름>@<판>/node_modules/ 아래에 그 패키지와 그 의존성이 나란히 있다. 진짜 경로를 따라 package.json을 직접 읽는다
    const seen = new Map<string, string>()
    const visit = (dir: string): void => {
      const real = realpathSync(dir)
      const pkg = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8')) as { name: string; version: string; license?: unknown; dependencies?: Record<string, string> }
      const key = `${pkg.name}@${pkg.version}`
      if (seen.has(key)) return
      seen.set(key, typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? null))
      const base = pkg.name.startsWith('@') ? dirname(dirname(real)) : dirname(real)
      for (const dep of Object.keys(pkg.dependencies ?? {})) {
        const next = join(base, dep)
        if (existsSync(join(next, 'package.json'))) visit(next)
      }
    }
    visit(dirname(requireFromServer.resolve('tiktok-live-connector/package.json')))
    expect(seen.get('tiktok-live-connector@2.1.0')).toBe('MIT')
    expect(seen.size).toBeGreaterThan(10)
    for (const [key, license] of seen) {
      expect(license, key).not.toMatch(/GPL|SSPL|null|UNLICENSED/i)
      expect(license, key).toMatch(/MIT|ISC|BSD|Apache-2\.0/)
    }
  })
})

describe('AC-N2b-1-03 라이브러리 생성자 바꿔 끼우기 — 넘기는 값', () => {
  const FORBIDDEN = /session|cookie|auth|login|proxy|header|token|useMobile|agent|ttTargetIdc|webClient|wsClient|signedWebSocketProvider/i

  it('(아이디, 허용 목록 옵션) 두 값만 넘긴다 — 처음·다시 연결 모두, 섞어 넣은 세션·쿠키 키는 닿지 않는다', async () => {
    constructed.length = 0
    const r = rig({ webcast: libraryWebcast({ Connection: Offline }), extra: { sessionId: 'planted', cookie: 'planted', authenticateWs: true } })
    r.conn.start()
    await r.flush()
    expect(r.conn.status().state).toBe('CONNECTED')
    constructed[0]?.instance.emit(ControlEvent.DISCONNECTED, { code: 1006 })
    await r.at(5)
    expect(r.conn.status().state).toBe('CONNECTED')
    expect(constructed).toHaveLength(2)
    for (const call of constructed) {
      expect(call.uniqueId).toBe('seller_kim')
      expect(call.options).toEqual({ processInitialData: false, fetchRoomInfoOnConnect: true, enableExtendedGiftInfo: false })
      for (const key of Object.keys(call.options as object)) {
        expect(TIKTOK_LIBRARY_OPTION_KEYS).toContain(key)
        expect(key).not.toMatch(FORBIDDEN)
      }
      // 라이브러리 안에서도 세션·인증은 기본값(없음) 그대로
      expect(call.instance.options.sessionId).toBeNull()
      expect(call.instance.options.authenticateWs).toBe(false)
      expect(call.instance.options.processInitialData).toBe(false)
      expect(call.instance.options.webClientHeaders).toEqual({})
      expect(call.instance.options.wsClientHeaders).toEqual({})
    }
  })

  it('서명 키를 설정했을 때만 signApiKey를 넘긴다', async () => {
    constructed.length = 0
    const r = rig({ webcast: libraryWebcast({ Connection: Offline }), signKey: 'SIGNKEY-PLANTED-123' })
    r.conn.start()
    await r.flush()
    expect(constructed[0]?.options).toEqual({ processInitialData: false, fetchRoomInfoOnConnect: true, enableExtendedGiftInfo: false, signApiKey: 'SIGNKEY-PLANTED-123' })
  })

  it('라이브러리 생성자는 인자 두 개로만 불린다', async () => {
    const calls: unknown[][] = []
    class Spy {
      constructor(...args: unknown[]) {
        calls.push(args)
      }
      connect() {
        return Promise.resolve({})
      }
      disconnect() {
        return Promise.resolve()
      }
      on() {
        return this
      }
    }
    const r = rig({ webcast: libraryWebcast({ Connection: Spy as unknown as LibraryConnectionConstructor }) })
    r.conn.start()
    await r.flush()
    expect(calls).toEqual([['seller_kim', { processInitialData: false, fetchRoomInfoOnConnect: true, enableExtendedGiftInfo: false }]])
  })
})

describe('AC-N2b-1-21·22 실제 라이브러리 chat 이벤트 → 레코드', () => {
  it('2.1.0 디코더가 낸 WebcastChatMessage(64비트 ID = 10진 문자열)가 글자 그대로 레코드가 된다', async () => {
    const decoded = WebcastChatMessage.decode(chatBytes({ msgId: '9223372036854775807', userId: '7234567890123456789', uniqueId: 'buyer_a', nickname: '홍길동', comment: '15' }))
    expect(typeof decoded.common?.msgId).toBe('string')
    expect(decoded.common?.msgId).toBe('9223372036854775807')
    expect(decoded.user?.userId).toBe('7234567890123456789')
    constructed.length = 0
    const r = rig({ webcast: libraryWebcast({ Connection: Offline }) })
    r.conn.start()
    await r.flush()
    const lib = constructed[0]?.instance
    await lib?.push([
      { type: 'WebcastChatMessage', payload: chatBytes({ msgId: '9223372036854775807', userId: '7234567890123456789', uniqueId: 'Seller_Kim', nickname: ' 김사장 ', comment: '15번' }) },
      { type: 'WebcastLikeMessage', payload: likeBytes() },
      { type: 'WebcastChatMessage', payload: chatBytes({ msgId: '7301000000000000002', userId: '7101000000000000002', uniqueId: 'buyer_b', nickname: '', comment: ' 16 ' }) },
    ])
    expect(r.records).toEqual([
      { platform: 'TIKTOK', commentId: '9223372036854775807', userId: '7234567890123456789', nickname: '김사장', text: '15번', receivedAt: '1970-01-01T00:00:00.000Z', owner: true },
      { platform: 'TIKTOK', commentId: '7301000000000000002', userId: '7101000000000000002', nickname: 'buyer_b', text: ' 16 ', receivedAt: '1970-01-01T00:00:00.000Z', owner: false },
    ])
    expect(r.conn.status().counts).toEqual({ received: 2, duplicates: 0, dropped: 0 })
  })

  it('라이브러리의 방송 끝(제어 메시지)·끊김 이벤트를 그대로 받는다', async () => {
    constructed.length = 0
    const r = rig({ webcast: libraryWebcast({ Connection: Offline }) })
    r.conn.start()
    await r.flush()
    await constructed[0]?.instance.push([{ type: 'WebcastControlMessage', payload: controlBytes(3) }])
    await r.flush()
    expect(r.conn.status()).toMatchObject({ state: 'ENDED', reason: null })
    r.conn.start()
    await r.flush()
    constructed[1]?.instance.emit(ControlEvent.DISCONNECTED, { code: 1006, reason: 'x' })
    await r.flush()
    expect(r.conn.status()).toMatchObject({ state: 'RETRYING', reason: 'NETWORK', missed: true })
    // 닫은 뒤에는 그 라이브러리 연결의 이벤트를 넘기지 않는다
    await constructed[1]?.instance.push([{ type: 'WebcastChatMessage', payload: chatBytes({ msgId: freshId(), userId: '7101', uniqueId: 'a', nickname: 'a', comment: '15' }) }])
    expect(r.records).toEqual([])
  })

  it('제어 메시지: 잠시 멈춤(1)·다시 이어짐(2)은 받는 상태 그대로, 일시 중단(4)은 라이브러리가 방송 끝으로 내보내 ENDED (AC-N2b-1-33)', async () => {
    constructed.length = 0
    const r = rig({ webcast: libraryWebcast({ Connection: Offline }) })
    r.conn.start()
    await r.flush()
    const lib = constructed[0]?.instance
    await lib?.push([{ type: 'WebcastControlMessage', payload: controlBytes(1) }])
    await r.flush()
    expect(r.conn.status()).toMatchObject({ state: 'CONNECTED', reason: null, missed: false })
    await lib?.push([{ type: 'WebcastControlMessage', payload: controlBytes(2) }])
    await lib?.push([{ type: 'WebcastChatMessage', payload: chatBytes({ msgId: freshId(), userId: '7101', uniqueId: 'buyer_a', nickname: 'a', comment: '15' }) }])
    await r.flush()
    expect(r.conn.status()).toMatchObject({ state: 'CONNECTED', reason: null, missed: false })
    expect(r.records).toHaveLength(1)
    await lib?.push([{ type: 'WebcastControlMessage', payload: controlBytes(4) }])
    await r.flush()
    expect(r.conn.status()).toMatchObject({ state: 'ENDED', reason: null, missed: true, nextAttemptAt: null })
  })

  it('감싸개가 닫은 뒤 늦게 성공한 라이브러리 연결은 바로 닫는다', async () => {
    const disconnects: number[] = []
    let release: () => void = () => undefined
    class Slow {
      connect() {
        return new Promise((resolve) => (release = () => resolve({})))
      }
      disconnect() {
        disconnects.push(1)
        return Promise.resolve()
      }
      on() {
        return this
      }
    }
    const client = libraryWebcast({ Connection: Slow as unknown as LibraryConnectionConstructor })('seller_kim', { processInitialData: false, fetchRoomInfoOnConnect: true, enableExtendedGiftInfo: false })
    const pending = client.connect()
    client.disconnect()
    expect(disconnects).toHaveLength(1)
    release()
    await pending
    expect(disconnects).toHaveLength(2)
  })
})

describe('AC-N2b-1-35 라이브러리 오류 → 실패 종류 (대응표의 행마다)', () => {
  const axiosLike = (status: number | null, code?: string) => Object.assign(new Error(status === null ? 'socket hang up' : `Request failed with status code ${String(status)}`), { isAxiosError: true, code, ...(status === null ? {} : { response: { status } }) })
  const rows: Array<[string, unknown, string]> = [
    ['방송 중 아님 UserOfflineError', new UserOfflineError("The requested user isn't online :("), 'NOT_LIVE'],
    ['없는 사용자: 틱톡 API 19881007 user_not_found', new FetchIsLiveError([new Error('Failed to extract the LiveRoom object from SIGI_STATE.'), new InvalidResponseError('API Error 19881007 (user_not_found)'), new Error('Failed to extract Room ID from Euler.')]), 'USER_NOT_FOUND'],
    ['없는 사용자: 아이디 형식 InvalidUniqueIdError', new InvalidUniqueIdError("Missing or invalid value for 'uniqueId'."), 'USER_NOT_FOUND'],
    ['서명 서비스 상태 오류 SignAPIError', new SignAPIError(ErrorReason.SIGN_NOT_200, undefined, undefined, 'Unexpected sign server status 500.'), 'SIGN_FAILED'],
    ['서명 서비스 연결 실패 SignAPIError(CONNECT_ERROR)', new SignAPIError(ErrorReason.CONNECT_ERROR, undefined, undefined, 'Failed to connect to sign server.'), 'SIGN_FAILED'],
    ['서명 서비스 한도 SignatureRateLimitError', new SignatureRateLimitError(undefined, 'Too many connections started, try again later.', { headers: {} } as never), 'SIGN_FAILED'],
    ['서명 토큰 없음 SignatureMissingTokensError', new SignatureMissingTokensError('missing tokens'), 'SIGN_FAILED'],
    ['서명 서비스 유료 기능 PremiumFeatureError', new PremiumFeatureError('You do not have permission from the signature provider to sign this URL.', 'Error fetching the signed TikTok WebSocket'), 'SIGN_FAILED'],
    ['인증 웹소켓 AuthenticatedWebSocketConnectionError', new AuthenticatedWebSocketConnectionError('whitelist'), 'SIGN_FAILED'],
    ['틱톡의 거부 403 (방 정보)', new InvalidResponseError('Failed to fetch room info. Request failed with status code 403', axiosLike(403)), 'BLOCKED'],
    ['틱톡의 요청 한도 429', new FetchIsLiveError([axiosLike(429), axiosLike(null, 'ECONNRESET')]), 'BLOCKED'],
    ['틱톡 확인 문자(차단 문구)', new FetchIsLiveError([new Error('Failed to extract the SIGI_STATE HTML tag, you might be blocked by TikTok.')]), 'BLOCKED'],
    ['틱톡 확인 문자(captcha)', new FetchIsLiveError([new Error('Failed to parse SIGI_STATE into JSON. Are you captcha-blocked by TikTok?')]), 'BLOCKED'],
    ['네트워크 끊김', new FetchIsLiveError([axiosLike(null, 'ECONNRESET'), axiosLike(null, 'ETIMEDOUT')]), 'NETWORK'],
    // 라이브러리 2.1.0 setupWebsocket은 손잡기 실패를 문자열 `Websocket connection failed, ${err}`로 거부한다 (ws 8.x: `Unexpected server response: ${status}`)
    ['웹소켓 손잡기 거부 403(문자열 거부)', `Websocket connection failed, ${String(new Error('Unexpected server response: 403'))}`, 'BLOCKED'],
    ['웹소켓 손잡기 요청 한도 429(문자열 거부)', `Websocket connection failed, ${String(new Error('Unexpected server response: 429'))}`, 'BLOCKED'],
    ['웹소켓 손잡기 오류 객체 안의 403 (cause)', new Error('wrapped', { cause: new Error('Unexpected server response: 403') }), 'BLOCKED'],
    ['문자열 거부 안의 확인 문자 문구', 'Websocket connection failed, Error: captcha required', 'BLOCKED'],
    ['웹소켓 손잡기 500(문자열 거부)', 'Websocket connection failed, Error: Unexpected server response: 500', 'NETWORK'],
    ['웹소켓 손잡기 4030처럼 다른 수(문자열 거부)', 'Websocket connection failed, Error: Unexpected server response: 4030', 'NETWORK'],
    ['웹소켓 실패(문자열 거부)', 'Websocket connection failed, Error: Unexpected server response: 200', 'NETWORK'],
    ['웹소켓 DNS 실패(문자열 거부)', 'Websocket connection failed, Error: getaddrinfo ENOTFOUND webcast16-ws-useast1a.tiktok.com', 'NETWORK'],
    ['웹소켓 시간 초과(문자열 거부)', 'Websocket not responding', 'NETWORK'],
    ['빈 문자열', '', 'NETWORK'],
    ['2,000자 뒤에만 403 문구가 있는 문자열', `${'x'.repeat(2000)}Unexpected server response: 403`, 'NETWORK'],
    ['커서 없음', new InvalidResponseError('Missing cursor in initial fetch response.'), 'NETWORK'],
    ['방 ID 없음', new MissingRoomIdError('Missing roomId.'), 'NETWORK'],
    ['이미 연결 중', new AlreadyConnectingError('Already connecting!'), 'NETWORK'],
    ['그 밖의 서버 오류 500', new FetchIsLiveError([axiosLike(500)]), 'NETWORK'],
    ['모르는 오류', new TypeError('x is not a function'), 'NETWORK'],
    ['예외가 아닌 값 undefined', undefined, 'NETWORK'],
    ['예외가 아닌 값 null', null, 'NETWORK'],
    ['예외가 아닌 값 숫자', 42, 'NETWORK'],
    ['예외가 아닌 값 객체', { weird: true }, 'NETWORK'],
  ]
  for (const [label, error, kind] of rows) {
    it(`${label} → ${kind}`, () => {
      expect(classifyWebcastFailure(error)).toBe(kind)
    })
  }

  it('읽으면 오류가 나는 값·순환 참조·깊은 중첩에도 예외 없이 끝난다', () => {
    const hostile = new Proxy(new Error('x'), {
      get() {
        throw new Error('getter')
      },
      getPrototypeOf() {
        throw new Error('proto')
      },
    })
    expect(classifyWebcastFailure(hostile)).toBe('NETWORK')
    const cyclic = new FetchIsLiveError([]) as FetchIsLiveError & { cause?: unknown }
    ;(cyclic.errors as unknown[]).push(cyclic)
    cyclic.cause = cyclic
    expect(classifyWebcastFailure(cyclic)).toBe('NETWORK')
    let deep: Error = new UserOfflineError('deep')
    for (let i = 0; i < 50; i += 1) deep = new FetchIsLiveError([deep])
    expect(classifyWebcastFailure(deep)).toBe('NETWORK')
  })

  it('가짜 웹캐스트의 실패 값도 같은 코드로 같은 종류가 된다', () => {
    for (const kind of TIKTOK_FAILURE_KINDS) expect(classifyWebcastFailure(fakeLibraryError(kind))).toBe(kind)
  })
})

describe('AC-N2b-1-04 실제 감싸개 + 실제 라이브러리 2.1.0 → 바깥 연결 막기 장치에 걸린다', () => {
  it('seller_kim 연결 시도: 막기 장치가 틱톡·서명 서비스로 가는 시도를 1번 이상 세고, 감싸개는 NETWORK 또는 SIGN_FAILED로 바꾼다', async () => {
    const guard = installOutboundGuard('tiktok', TIKTOK_BLOCKED_DOMAINS)
    const before = guard.blocked()
    const leaks: unknown[] = []
    const onLeak = (error: unknown) => leaks.push(error)
    process.on('unhandledRejection', onLeak)
    process.on('uncaughtException', onLeak)
    try {
      const r = rig({ webcast: libraryWebcast() })
      r.conn.start()
      for (let i = 0; i < 300 && r.conn.status().state === 'CONNECTING'; i += 1) await new Promise((resolve) => setTimeout(resolve, 20))
      const status = r.conn.status()
      expect(status.state).toBe('RETRYING')
      expect(['NETWORK', 'SIGN_FAILED']).toContain(status.lastFailure)
      expect(guard.blocked()).toBeGreaterThan(before)
      r.conn.stop()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(leaks).toEqual([])
    } finally {
      process.off('unhandledRejection', onLeak)
      process.off('uncaughtException', onLeak)
      // 센 값을 확인했으니 되돌린다 — 이 시험 파일이 실패하지 않게
      const hosts = guard.reset()
      expect(hosts.length).toBeGreaterThan(0)
      for (const host of hosts) expect(hostMatches(host, TIKTOK_BLOCKED_DOMAINS)).toBe(true)
    }
  })

  it('나머지 시도는 가짜 웹캐스트로만 — 이 파일의 다른 시험은 막힌 시도가 없다', () => {
    expect(installOutboundGuard('tiktok', TIKTOK_BLOCKED_DOMAINS).blocked()).toBe(0)
    expect(chatFields('1').msgId).toBe('1')
  })
})
