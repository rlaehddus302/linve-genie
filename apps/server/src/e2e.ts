// E2E용 서버 기동 (AC-S05-91, AC-S05-64). 실제 비밀값·네트워크·도커가 필요 없다.
// - 메모리 PGlite + 마이그레이션, 그 자리에서 만든 시험용 마스터 키, 시험용 판매자 계정 하나(apps/server/e2e/account.json의 시험 값).
// - 선택: 상품 500·채팅 1만 건을 채운 실제 범위(오늘, KST), 화면의 방송자 조치 대기 시간 줄이기 신호(GET /api/client-config), 리허설 생성기 시험 속도.
// - 채우기는 기록 경로(ScopeWriter)를 그대로 탄다: 상품은 product.register(조치자 서버), 채팅은 가짜 채팅 생성기의 메시지(조치자 수집기).
import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { createSellerAccount } from './accounts.ts'
import { openPglite, type Database } from './db/database.ts'
import { ChatMaker, generatorView } from './generator.ts'
import { createNodeServer } from './node-server.ts'
import { generateMasterKey, type PasswordCost } from './secrets.ts'
import { createServer, type LivejjimServer } from './server.ts'
import { kstDate, systemClock, type Clock } from './time.ts'
import type { Draft } from './writer.ts'

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
}

export interface E2eServer {
  readonly server: LivejjimServer
  readonly database: Database
  readonly account: E2eAccount
  readonly sellerId: string
  readonly fill: FillResult | null
  /** Node HTTP 서버 (listen은 부르는 쪽이 한다) */
  readonly http: Server
  close(): Promise<void>
}

export async function startE2eServer(options: E2eOptions = {}): Promise<E2eServer> {
  const database = await openPglite()
  const masterKey = generateMasterKey()
  const server = createServer({
    database,
    masterKey,
    appOrigin: options.appOrigin ?? 'http://localhost:5173',
    log: () => {},
    ...(options.hostActionDelayMs === undefined ? {} : { hostActionDelayMs: options.hostActionDelayMs }),
    ...(options.generatorSpeed === undefined ? {} : { generatorSpeed: options.generatorSpeed }),
    ...(options.passwordCost === undefined ? {} : { passwordCost: options.passwordCost }),
  })
  const account = readE2eAccount()
  const created = await createSellerAccount(database.db, Buffer.from(masterKey, 'base64'), account, options.passwordCost === undefined ? {} : { passwordCost: options.passwordCost })
  if (!created.ok) throw new Error(created.message)
  const fill = options.fill === undefined ? null : await fillScope(server, created.sellerId, options.fill)
  const http = createNodeServer({ app: server.app })
  return {
    server,
    database,
    account,
    sellerId: created.sellerId,
    fill,
    http,
    close: async () => {
      server.close()
      http.closeAllConnections()
      await new Promise<void>((resolve) => {
        if (!http.listening) resolve()
        else http.close(() => resolve())
      })
      await database.close()
    },
  }
}
