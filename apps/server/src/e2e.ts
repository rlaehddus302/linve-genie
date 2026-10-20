// E2E용 서버 기동 (AC-S05-91, AC-S05-64, AC-S06-73). 실제 비밀값·네트워크·도커가 필요 없다. 127.0.0.1에서만 연다.
// - 메모리 PGlite + 마이그레이션, 그 자리에서 만든 시험용 마스터 키, 시험용 판매자 계정 하나(apps/server/e2e/account.json의 시험 값).
// - 선택: 상품 500·채팅 1만 건을 채운 실제 범위(오늘, KST), 화면의 방송자 조치 대기 시간 줄이기 신호(GET /api/client-config), 리허설 생성기 시험 속도.
// - 채우기는 기록 경로(ScopeWriter)를 그대로 탄다: 상품은 product.register(조치자 서버), 채팅은 가짜 채팅 생성기의 메시지(조치자 수집기).
// - I3 시험용 선택(AC-I3-93 — 운영 시작 main에는 없다): 유튜브 할당량 예산 줄이기, 발송함 시간 줄이기, 화면 폴더(같은 출처로 화면을 함께 냄),
//   시험용 조작 경로 /_e2e/*(새 판매자 계정·봉인 시험 날짜·지금 봉인) — 이 기동에서만 앞에 붙는다(서버 앱에는 없다).
import { randomBytes, randomInt } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { Hono } from 'hono'
import { createSellerAccount } from './accounts.ts'
import { isValidDate } from '@livejjim/core'
import { openPglite, type Database } from './db/database.ts'
import { ChatMaker, generatorView } from './generator.ts'
import { createNodeServer } from './node-server.ts'
import { generateMasterKey, type PasswordCost } from './secrets.ts'
import { createServer, type LivejjimServer } from './server.ts'
import { findAccountByLogin } from './store.ts'
import { kstDate, systemClock, type Clock } from './time.ts'
import type { Draft } from './writer.ts'
import { FakeGoogle } from './youtube/fake-google.ts'
import type { OutboxTiming } from './youtube/outbox.ts'

/** 시험용 판매자 계정 (저장소의 픽스처 파일 — 실제 비밀값이 아니다) */
export const E2E_ACCOUNT_FILE = new URL('../e2e/account.json', import.meta.url)

export interface E2eAccount {
  readonly shopName: string
  readonly loginId: string
  readonly password: string
}

export function readE2eAccount(): E2eAccount {
  const parsed = JSON.parse(readFileSync(E2E_ACCOUNT_FILE, 'utf8')) as Record<string, unknown>
  const { shopName, loginId, password } = parsed
  if (typeof shopName !== 'string' || typeof loginId !== 'string' || typeof password !== 'string') throw new TypeError('E2E 계정 파일을 확인해 주세요.')
  return { shopName, loginId, password }
}

export interface FillOptions {
  /** 범위 날짜 (기본 서버 시계의 KST 오늘) */
  readonly date?: string
  /** 상품 수 (기본 500) */
  readonly products?: number
  /** 채팅 수 (기본 10,000 — 다시 보낸 사본은 세지 않는다) */
  readonly chats?: number
  /** 채팅 시드 (기본 20261019) */
  readonly seed?: number
}

export interface FillResult {
  readonly date: string
  readonly broadcast: string
  readonly products: number
  readonly chats: number
  readonly seq: number
}

const BATCH = 250

/**
 * 실제 범위에 방송 하나를 만들고 상품·채팅을 채운다 (AC-S05-64 규모). 한 트랜잭션에 여러 이벤트를 쓰는 기록 경로라 seq는 빈틈 없이 이어진다
 */
export async function fillScope(server: LivejjimServer, sellerId: string, options: FillOptions & { readonly clock?: Clock } = {}): Promise<FillResult> {
  const clock = options.clock ?? systemClock
  const date = options.date ?? kstDate(clock.now())
  const productCount = options.products ?? 500
  const chatCount = options.chats ?? 10_000
  const created = await server.service.createBroadcast(sellerId, { kind: 'server' }, `e2e-fill-${date}-${String(clock.now())}`, { date, title: '채운 방송' })
  if (created.kind !== 'ok') throw new Error('채울 방송을 만들지 못했다')
  const b = created.result.event.b as string
  const write = async (drafts: (ctx: { state: Parameters<typeof generatorView>[0] }) => Draft[]) => {
    const outcome = await server.writer.write({ sellerId, date, rehearsal: false, createScope: false, requestId: null, build: (ctx) => drafts(ctx) })
    if (outcome.kind !== 'ok') throw new Error(`채우기 기록 실패: ${outcome.kind}`)
    return outcome
  }
  for (let start = 1; start <= productCount; start += BATCH) {
    const end = Math.min(productCount, start + BATCH - 1)
    await write(() => {
      const drafts: Draft[] = []
      for (let no = start; no <= end; no++) {
        drafts.push({ fields: { type: 'product.register', b, no, name: `상품${String(no)}`, price: 10_000 + (no % 10) * 1000 }, actor: { kind: 'server' } })
      }
      return drafts
    })
  }
  const maker = new ChatMaker(b, options.seed ?? 20_261_019, 0)
  const used = new Set<string>()
  let made = 0
  while (made < chatCount) {
    const want = Math.min(BATCH, chatCount - made)
    await write(({ state }) => {
      const view = generatorView(state, b)
      if (view === null) throw new Error('채울 방송이 없다')
      const drafts: Draft[] = []
      while (drafts.length < want) {
        const { chat } = maker.next(view)
        if (used.has(chat.id)) continue // 다시 보낸 사본은 채우기에서 뺀다 (한 트랜잭션 안의 같은 메시지 ID)
        used.add(chat.id)
        drafts.push({ fields: { type: 'chat', ...chat }, actor: { kind: 'collector' }, chat: { b, id: chat.id } })
      }
      return drafts
    })
    made += want
  }
  const runtime = await server.writer.read(sellerId, date)
  return { date, broadcast: b, products: productCount, chats: made, seq: runtime.seq }
}

export interface E2eOptions {
  /** 화면 주소 (상태를 바꾸는 요청의 Origin, 기본 http://localhost:5173) */
  readonly appOrigin?: string
  /** 채우기 (없으면 채우지 않는다) */
  readonly fill?: FillOptions
  /** 화면의 방송자 조치 대기 시간 (밀리초, 0~5000, 기본 5000) */
  readonly hostActionDelayMs?: number
  /** 리허설 생성기 시험 속도 (1~1000, 기본 1) */
  readonly generatorSpeed?: number
  /** 시험 안에서 빠르게 (비밀번호 해시 비용) */
  readonly passwordCost?: PasswordCost
  /**
   * 가짜 구글·유튜브 서버와 함께 띄운다 (AC-Y1-81, D-Y13). 127.0.0.1의 그 포트(0이면 빈 포트)에서 열고 서버가 그 주소를 쓴다.
   * 돌아오는 주소는 화면 주소를 거친다(<화면>/api/youtube/oauth/callback — 화면이 /api를 서버로 넘긴다), 연결 뒤 화면 주소는 <화면>/settings/youtube.
   * 워커(수집기·발송함·봉인)를 함께 돌린다
   */
  readonly youtube?: { readonly port?: number; readonly returnUrl?: string; readonly pollingIntervalMillis?: number; readonly quotaBudget?: number }
  /** 발송함 시간 줄이기 (확인하지 못한 감사가 30초 안에 — AC-I3-93) */
  readonly outboxFast?: boolean
  /** 화면 빌드 폴더 — 서버가 같은 출처로 함께 낸다 (AC-I3-70) */
  readonly webDir?: string
}

/** E2E의 발송함 시간 (게시 응답 3초 · 확인 시간 5초 · 끝 조회 간격 2초 · 다시 시도 0.5·1·2…초) */
export const E2E_OUTBOX_TIMING: OutboxTiming = { postTimeoutMs: 3000, confirmWindowMs: 5000, lookupIntervalMs: 2000, retryBaseMs: 250 }

/** 시험용 새 판매자 계정의 비밀번호 (시험 값 — 실제 비밀이 아니다) */
export const E2E_NEW_SELLER_PASSWORD = 'e2e-pass-1234'

const LOWER = 'abcdefghjkmnpqrstuvwxyz'
const lowerId = (length: number) => Array.from({ length }, () => LOWER[randomInt(LOWER.length)]).join('')

/** 날짜 문자열에서 며칠 빼기 (KST 날짜) */
function daysBefore(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) - days * 24 * 60 * 60 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * 시험용 조작 경로 (AC-I3-93 — E2E 기동에서만 서버 앱 앞에 붙는다, 127.0.0.1에서만 열린다). JSON POST, 세션 필요 없음:
 * - POST /_e2e/sellers {} → { loginId, password, shopName } — 방송이 하나도 없는 새 판매자 계정 (마법사·보조자 시험)
 * - POST /_e2e/dates { loginId, kind: 'sealed'|'sealSoon'|'youtube', date? } → { date, broadcast } — 그 날짜에 실제 방송·상품 하나·유튜브 채팅 하나(봉인 대상),
 *   sealed면 바로 봉인. 날짜 기본값: sealed 오늘 − 31일, sealSoon 오늘 − 24일(봉인 6일 전), youtube 오늘 − 3일
 * - POST /_e2e/seal { loginId, date } → { sealed } — 그 날짜(실제 범위)를 지금 봉인 (열린 화면이 봉인되는 시험)
 * 그 밖의 요청은 서버 앱으로 그대로 (요청 정보 env도 — 로그인 IP 한도)
 */
export function e2eControl(server: LivejjimServer, database: Database, masterKey: Buffer, passwordCost?: PasswordCost): Hono {
  const control = new Hono()
  const read = async (request: Request): Promise<Record<string, unknown>> => {
    try {
      const parsed: unknown = JSON.parse((await request.text()) || '{}')
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  const sellerOf = async (body: Record<string, unknown>): Promise<string | null> => {
    const loginId = body.loginId
    if (typeof loginId !== 'string') return null
    return (await findAccountByLogin(database.db, loginId.trim().toLowerCase()))?.sellerId ?? null
  }
  control.post('/_e2e/sellers', async (c) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const loginId = `e2e-${lowerId(10)}`
      const shopName = `새 가게 ${lowerId(4)}`
      const created = await createSellerAccount(database.db, masterKey, { shopName, loginId, password: E2E_NEW_SELLER_PASSWORD }, passwordCost === undefined ? {} : { passwordCost })
      if (created.ok) return c.json({ loginId, password: E2E_NEW_SELLER_PASSWORD, shopName })
    }
    return c.json({ error: 'seller' }, 500)
  })
  control.post('/_e2e/dates', async (c) => {
    const body = await read(c.req.raw)
    const sellerId = await sellerOf(body)
    const kind = body.kind
    if (sellerId === null || (kind !== 'sealed' && kind !== 'sealSoon' && kind !== 'youtube')) return c.json({ error: 'input' }, 400)
    const today = kstDate(Date.now())
    const date = typeof body.date === 'string' && isValidDate(body.date) ? body.date : daysBefore(today, kind === 'sealed' ? 31 : kind === 'sealSoon' ? 24 : 3)
    const tag = randomBytes(6).toString('base64url').replace(/[^A-Za-z]/g, 'x')
    const created = await server.service.createBroadcast(sellerId, { kind: 'server' }, `e2e-date-${tag}`, { date, title: '지난 방송' })
    if (created.kind !== 'ok' && created.kind !== 'duplicate') return c.json({ error: 'broadcast' }, 500)
    const result = created.kind === 'ok' ? created.result : created.result
    const b = (result?.event as { b?: unknown } | undefined)?.b
    if (typeof b !== 'string') return c.json({ error: 'broadcast' }, 500)
    await server.service.writeEvent(sellerId, { kind: 'server' }, `e2e-product-${tag}`, { type: 'product.register', b, no: 1, name: '지난 상품', price: 10_000 }, undefined)
    // 유튜브 수집 경로의 채팅 — 그 범위가 봉인 대상(봉인 예정 시각)이 된다
    await server.ingestChat(sellerId, { b, id: `e2e-chat-${tag}`, ch: `UCe2e${tag}`, nick: '지난 시청자', text: '안녕하세요', publishedAt: Date.now() })
    let sealed = false
    if (kind === 'sealed') {
      const scopeId = await server.service.scopeId(sellerId, date)
      if (scopeId !== null) sealed = await server.sealer.seal(sellerId, scopeId, date)
    }
    return c.json({ date, broadcast: b, sealed })
  })
  control.post('/_e2e/seal', async (c) => {
    const body = await read(c.req.raw)
    const sellerId = await sellerOf(body)
    const date = body.date
    if (sellerId === null || typeof date !== 'string' || !isValidDate(date)) return c.json({ error: 'input' }, 400)
    const scopeId = await server.service.scopeId(sellerId, date)
    return c.json({ sealed: scopeId === null ? false : await server.sealer.seal(sellerId, scopeId, date) })
  })
  control.all('*', (c) => server.app.fetch(c.req.raw, c.env))
  return control
}

/** E2E 서버가 듣는 주소: 이 컴퓨터 안(IPv4 루프백)에서만 (AC-S06-73, D-096 — 모든 인터페이스 0.0.0.0·::이 아니다) */
export const E2E_HOST = '127.0.0.1'

export interface E2eServer {
  readonly server: LivejjimServer
  readonly database: Database
  readonly account: E2eAccount
  readonly sellerId: string
  readonly fill: FillResult | null
  /** 가짜 구글·유튜브 서버 (youtube를 주었을 때만) */
  readonly fakeGoogle: FakeGoogle | null
  /** Node HTTP 서버 (열기는 listen으로) */
  readonly http: Server
  /** E2E_HOST(127.0.0.1)의 그 포트에서 연다 (0이면 빈 포트). 연 주소·포트를 돌려준다. 열지 못하면(포트를 이미 씀 등) 그 오류로 실패한다 */
  listen(port: number): Promise<{ readonly host: string; readonly port: number }>
  close(): Promise<void>
}

export async function startE2eServer(options: E2eOptions = {}): Promise<E2eServer> {
  const database = await openPglite()
  const masterKey = generateMasterKey()
  const appOrigin = options.appOrigin ?? 'http://localhost:5173'
  const fakeGoogle =
    options.youtube === undefined
      ? null
      : await FakeGoogle.start({
          ...(options.youtube.port === undefined ? {} : { port: options.youtube.port }),
          pollingIntervalMillis: options.youtube.pollingIntervalMillis ?? 1000,
        })
  const budget = options.youtube?.quotaBudget
  const server = createServer({
    database,
    masterKey,
    appOrigin,
    log: () => {},
    // E2E는 모든 브라우저 로그인이 한 주소(127.0.0.1 — 화면 서버의 /api 넘기기)에서 온다. 시험 수십 개가 같은 IP 한도(10분 20번)에 걸리지 않게
    // E2E 기동만 IP 한도를 넓힌다(운영 main은 기본값 — 로그인 제한 동작은 서버 시험 i3-login-limit이 확인한다)
    loginLimits: { ipMaxAttempts: 1_000_000 },
    ...(fakeGoogle === null
      ? {}
      : {
          youtube: {
            clientId: fakeGoogle.clientId,
            clientSecret: fakeGoogle.clientSecret,
            redirectUri: `${appOrigin}/api/youtube/oauth/callback`,
            returnUrl: options.youtube?.returnUrl ?? `${appOrigin}/settings/youtube`,
            endpoints: fakeGoogle.endpoints(),
            allowInsecure: true,
            ...(budget === undefined ? {} : { quota: { limit: budget, sellerBudget: budget } }),
          },
          collectorTiming: { scanMs: 1000 },
          // 확인 조회 한 쪽 = 가짜 서버의 쪽 크기 (꽉 찬 쪽인지 바르게 안다)
          outboxTiming: { ...(options.outboxFast === true ? E2E_OUTBOX_TIMING : {}), liveChatLookupPage: fakeGoogle.pageSize },
        }),
    ...(options.webDir === undefined ? {} : { webDir: options.webDir }),
    ...(options.hostActionDelayMs === undefined ? {} : { hostActionDelayMs: options.hostActionDelayMs }),
    ...(options.generatorSpeed === undefined ? {} : { generatorSpeed: options.generatorSpeed }),
    ...(options.passwordCost === undefined ? {} : { passwordCost: options.passwordCost }),
  })
  const account = readE2eAccount()
  const created = await createSellerAccount(database.db, Buffer.from(masterKey, 'base64'), account, options.passwordCost === undefined ? {} : { passwordCost: options.passwordCost })
  if (!created.ok) throw new Error(created.message)
  // 시험 계정(e2e-shop)은 시작 마법사를 마친 계정이다 — 기존 E2E가 로그인 뒤 방송 목록을 그대로 쓰게(I3 화면은 실제 방송이 없는 "처음" 계정에 마법사를
  // 저절로 연다, AC-I3-50). 마법사 시험은 POST /_e2e/sellers의 새 판매자(처음)로 한다 (dev-web, I3 dev-notes)
  await server.service.setWizard(created.sellerId, { status: 'DONE' })
  const fill = options.fill === undefined ? null : await fillScope(server, created.sellerId, options.fill)
  if (fakeGoogle !== null) server.start()
  const http = createNodeServer({ app: e2eControl(server, database, Buffer.from(masterKey, 'base64'), options.passwordCost) })
  return {
    server,
    database,
    account,
    sellerId: created.sellerId,
    fill,
    fakeGoogle,
    http,
    listen: (port) =>
      new Promise((resolve, reject) => {
        const failed = (error: Error) => reject(error)
        http.once('error', failed)
        http.listen(port, E2E_HOST, () => {
          http.off('error', failed)
          const address = http.address()
          if (typeof address !== 'object' || address === null) reject(new Error('듣는 주소를 알 수 없다'))
          else resolve({ host: address.address, port: address.port })
        })
      }),
    close: async () => {
      server.close()
      await server.stop()
      await fakeGoogle?.close()
      http.closeAllConnections()
      await new Promise<void>((resolve) => {
        if (!http.listening) resolve()
        else http.close(() => resolve())
      })
      await database.close()
    },
  }
}
