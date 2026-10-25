// E2E용 서버 기동 (AC-S05-91, AC-S05-64, AC-S06-73). 실제 비밀값·네트워크·도커가 필요 없다. 127.0.0.1에서만 연다.
// - 메모리 PGlite + 마이그레이션, 그 자리에서 만든 시험용 마스터 키, 시험용 판매자 계정 하나(apps/server/e2e/account.json의 시험 값).
// - 선택: 상품 500·채팅 1만 건을 채운 실제 범위(오늘, KST), 화면의 방송자 조치 대기 시간 줄이기 신호(GET /api/client-config), 리허설 생성기 시험 속도.
// - 시험 모드 신호(GET /api/client-config testPrinter — 화면이 시험용 프린터를 켠다, I1 L-11 15): E2E 기동은 기본으로 켠다(testPrinter: false로 끌 수 있다).
// - 요금 기능(N5, AC-N5-11·40): 기본 꺼짐. billing: true면 시험 결제(가짜 결제 서버·가짜 발행기)와 BL-1 기본 요금 표로 켠다.
// - I2: 백업 저장소 = 임시 폴더(또는 지정한 폴더), 시작할 때 시험 판매자의 자동 백업 하나(시각과 상관없이 — 설정 화면의 "마지막 자동 백업"이 늘 있게),
//   확인서 데이터 조회의 ?at= (공유 그림 바이트를 같은 데이터의 Node 그림과 맞댈 때, AC-I2-15).
// - 입금 확인 시험 모드(N3 D-N3-12): 가짜 원천·시험용 입금 넣기(POST /api/deposits/test/rows)를 기본으로 켠다(testDeposits: false로 끈다).
//   받아 오기 주기는 기본 1초(depositPollMs), "지금 받아 오기" 간격은 운영 값 60초(depositRefetchMs로 줄인다). 팝빌 연동 키는 없다(계좌조회 원천은 "준비 중").
// - 채우기는 기록 경로(ScopeWriter)를 그대로 탄다: 상품은 product.register(조치자 서버), 채팅은 가짜 채팅 생성기의 메시지(조치자 수집기).
// - 선택: 가짜 메타 서버(instagram: true, N2 AC-N2-70) — 127.0.0.1의 빈 포트에 띄우고 서버의 인스타그램 설정을 그 주소로 둔다.
//   돌아오는 주소는 화면 주소 + /api/instagram/callback(화면 개발 서버가 /api를 이 서버로 넘긴다), 웹훅은 이 서버의 /webhooks/instagram으로 보낸다.
//   운영 기동(main.ts)에는 없다 — 시험 모드에서만.
// - I3 시험용 선택(AC-I3-93 — 운영 시작 main에는 없다): 유튜브 할당량 예산 줄이기, 발송함 시간 줄이기, 화면 폴더(같은 출처로 화면을 함께 냄),
//   시험용 조작 경로 /_e2e/*(새 판매자 계정·봉인 시험 날짜·지금 봉인) — 이 기동에서만 앞에 붙는다(서버 앱에는 없다).
// - 택배 자동 접수 시험 모드(T1 PARCEL_RULES PC-1, AC-T1-20): 가짜 택배사를 127.0.0.1의 빈 포트에 띄우고 서버가 그 어댑터를 쓴다(parcel: false로 끈다).
//   조회 주기는 기본 5초(parcelTrackMs). 시험 조작 /_e2e/parcel/*(상태 넘기기·오류 주입·받은 요청·지금 조회·지금 정리)는 이 기동에서만 있다.
// - 선택: 가짜 밴드 서버(band: {}, BND1 AC-BND1-62·80) — 127.0.0.1에 띄우고 밴드 연동을 그 주소로 둔다. 조작 경로 /_e2e/band/*는 이 기동에서만 있다.
// - 선택: 가짜 웹캐스트(tiktok: true, N2b-2 AC-N2b-2-73·80) — 틱톡 운영자 스위치를 켜고 연결 객체가 가짜 웹캐스트를 쓴다.
//   시험이 댓글·끊김·막힘을 넣는 경로 /_e2e/tiktok/*는 이 기동에서만 있다(운영 서버 시작 경로에는 없다 — 운영은 실제 감싸개 libraryWebcast()).
// - 선택: 가짜 LLM 서버(assist, A1 AC-A1-11) — 127.0.0.1의 빈 포트(또는 정한 포트)에 띄우고 AI 제안을 그 주소·가짜 키(fake-assist-key)로 켠다. 상한을 작게 줄 수 있다.
// - 선택: 가짜 OAuth 서버(social, L1 AC-L1-12) — 127.0.0.1의 빈 포트(또는 정한 포트)에 띄우고 간편 로그인 공급자(구글·카카오·네이버 중 고른 것)를 그 주소로 켠다.
//   조작은 그 서버의 /_fake/* (harness/sprints/L1/dev-notes.md "시험에게"). 운영 기동에는 없다.
import { randomBytes, randomInt } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createSellerAccount } from './accounts.ts'
import { testBilling } from './billing/fake.ts'
import { isValidDate } from '@livejjim/core'
import { FolderBackupStorage } from './backup.ts'
import { openPglite, type Database } from './db/database.ts'
import { ChatMaker, generatorView } from './generator.ts'
import { createNodeServer } from './node-server.ts'
import { FakeMeta } from './instagram/fake-meta.ts'
import { FakeBand, type FakeBandFault } from './band/fake.ts'
import { BAND_ALLOWED_PATHS, isBandOp } from './band/endpoints.ts'
import { FAKE_FAILURES, FAKE_TRACK_STATUSES, FakeCarrier, type FakeFailure, type FakeTrackStatus } from './parcel/fake-carrier.ts'
import { FakeWebcast, readTikTokSettings, type FakeAccountState, type TikTokFailureKind } from './tiktok/index.ts'
import { generateMasterKey, type PasswordCost } from './secrets.ts'
import { createServer, type LivejjimServer } from './server.ts'
import { findAccountByLogin } from './store.ts'
import { kstDate, systemClock, type Clock } from './time.ts'
import type { Draft } from './writer.ts'
import { FakeGoogle } from './youtube/fake-google.ts'
import type { OutboxTiming } from './youtube/outbox.ts'
import { FakeOAuth } from './social/fake-oauth.ts'
import { FakeLlm } from './assist/fake-llm.ts'
import type { ProviderId } from './social/providers.ts'

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
        drafts.push({ fields: { type: 'chat', ...chat }, actor: { kind: 'collector' }, chat: { b, id: chat.id }, source: 'youtube' }) // 실제 범위의 유튜브 채팅 흉내
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
  /** 시험 모드 신호 — 화면이 시험용 프린터를 켠다 (기본 true. 운영 기동에는 없다, AC-I1-16·50) */
  readonly testPrinter?: boolean
  /** 요금 기능 (N5) — 켜면 시험 결제(가짜 결제 서버·가짜 발행기)·기본 요금 표. 기본 false (AC-N5-11) */
  readonly billing?: boolean
  /** 백업 폴더 (없으면 임시 폴더를 만들고 끌 때 지운다) */
  readonly backupDir?: string
  /** 시작할 때 시험 판매자의 자동 백업을 하나 만든다 (기본 true) */
  readonly initialBackup?: boolean
  /** 가짜 메타 서버를 함께 띄우고 인스타그램을 그 주소로 연결한다 (기본 false, N2) */
  readonly instagram?: boolean
  /** 가짜 메타 서버 포트 (기본 0 = 빈 포트 — E2E 시험이 /_fake/*를 부르도록 정한다, N2b-2) */
  readonly instagramPort?: number
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
  /** 가짜 웹캐스트로 틱톡 라이브 베타를 켠다 (운영자 스위치 켬 — N2b-2). 조작은 /_e2e/tiktok/* */
  readonly tiktok?: boolean
  /**
   * 가짜 밴드 서버를 127.0.0.1의 그 포트(0이면 빈 포트)에 함께 띄우고 밴드 연동을 그 주소로 둔다 (BND1, D-BND1-13). 조작은 /_e2e/band/*.
   * 돌아오는 주소 = 화면 주소 + /api/band/callback(화면이 /api를 서버로 넘긴다). 읽기 간격은 E2E용으로 짧다(fastMs·fullMs — 기본 1초·3초)
   */
  readonly band?: { readonly port?: number; readonly fastMs?: number; readonly fullMs?: number }
  /** 입금 확인 시험 모드 — 가짜 원천·시험용 입금 넣기 (기본 true. 운영 기동에는 없다, AC-N3-17) */
  readonly testDeposits?: boolean
  /** 가짜·계좌조회 원천의 받아 오기 주기 (밀리초, 100~300000, 기본 1000 — E2E 기동만) */
  readonly depositPollMs?: number
  /** "지금 받아 오기" 간격 (밀리초, 0~60000, 기본 60000) */
  readonly depositRefetchMs?: number
  /** 택배 자동 접수 시험 모드 — 가짜 택배사 (기본 true. 운영 기동에는 없다, T1 AC-T1-20) */
  readonly parcel?: boolean
  /** 가짜 택배사 포트 (기본 0 = 빈 포트) */
  readonly parcelPort?: number
  /** 택배 배송 조회 주기 (밀리초, 기본 5000 — 운영 30분) */
  readonly parcelTrackMs?: number
  /**
   * 간편 로그인 (L1, AC-L1-12): 가짜 OAuth 서버를 127.0.0.1의 그 포트(0이면 빈 포트)에 함께 띄우고 고른 공급자(기본 셋 다)를 켠다.
   * 돌아오는 주소는 화면 주소 + /api/auth/<p>/callback(화면이 /api를 서버로 넘긴다) — 가짜 서버에도 그 주소를 등록한다. 기본 꺼짐(지금과 같다)
   */
  readonly social?: { readonly port?: number; readonly providers?: readonly ProviderId[] }
  /**
   * 선택: 가짜 LLM 서버(A1 AC-A1-11) — 127.0.0.1의 빈 포트(또는 정한 포트)에 띄우고 AI 제안을 그 주소·가짜 키로 켠다.
   * dailyLimit·globalLimit = 판매자·서버 전체 하루 상한(기본 20·500, 시험은 작게), timeoutMs = 호출 시간 제한(기본 15초). 없으면 키 없음(지금과 같다)
   */
  readonly assist?: { readonly port?: number; readonly dailyLimit?: number; readonly globalLimit?: number; readonly timeoutMs?: number }
}

/** E2E 기동의 택배 배송 조회 주기 기본값 (밀리초) */
export const E2E_PARCEL_TRACK_MS = 5000

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
export function e2eControl(
  server: LivejjimServer,
  database: Database,
  masterKey: Buffer,
  passwordCost?: PasswordCost,
  webcast?: FakeWebcast | null,
  carrier?: FakeCarrier | null,
  band?: FakeBand | null,
): Hono {
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
  if (webcast !== undefined && webcast !== null) registerTiktokControl(control, webcast, read)
  if (carrier !== undefined && carrier !== null) registerParcelControl(control, server, carrier, read)
  if (band !== undefined && band !== null) registerBandControl(control, band, read)
  control.all('*', (c) => server.app.fetch(c.req.raw, c.env))
  return control
}

/** E2E 기동의 밴드 읽기 간격 (밀리초 — 운영 10초·60초) */
export const E2E_BAND_FAST_MS = 1000
export const E2E_BAND_FULL_MS = 3000

/**
 * 가짜 밴드 조작 경로 (BND1, E2E 기동만 — 운영 서버 시작 경로에는 없다, AC-BND1-62). JSON POST(조회는 GET):
 * - POST /_e2e/band/user { name, userKey? } → { userKey } — 밴드 사용자(판매자·손님). 처음 사용자가 승인 창의 기본 사용자
 * - POST /_e2e/band/login { decision: approve|deny, userKey?, scope?(null이면 칸 없음), omitUserKey?, expiresIn?(null이면 칸 없음) } — 다음 승인 창
 * - POST /_e2e/band/band { name, members: [userKey], bandKey? } → { bandKey }
 * - POST /_e2e/band/post { bandKey, authorUserKey(null이면 user_key 없음), content?, createdAt? } → { postKey }
 * - POST /_e2e/band/comment { postKey, content, name?, userKey?(null이면 user_key 없음), createdAt?, commentKey? } → { commentKey }
 * - POST /_e2e/band/comments { postKey, items: [위와 같은 댓글] } → { commentKeys } — 한 번에 여러 개(같은 읽기에 함께 잡힌다)
 * - POST /_e2e/band/drop { postKey, commentKey } — 밴드에서 지움 · POST /_e2e/band/edit { postKey, commentKey, content } — 고침
 * - POST /_e2e/band/fail { op, resultCode? | http? | kind?(HANG·NOT_JSON·BAD_SHAPE), times? } — 그 요청 이름(token·profile·bands·posts·post·comments)의 다음 times번(기본 1)
 * - POST /_e2e/band/clear — 넣은 오류 지우기 · POST /_e2e/band/revoke { userKey } — 그 사용자의 토큰 풀기(다음 요청 10401)
 * - POST /_e2e/band/delay { op, ms } — 그 요청 이름의 응답을 늦춤(0이면 그만)
 * - GET  /_e2e/band/requests → { requests: [{ method, path }], onlyAllowed } — 받은 요청과 그것이 모두 읽기 일곱 GET인지(AC-BND1-60)
 */
function registerBandControl(control: Hono, band: FakeBand, read: (request: Request) => Promise<Record<string, unknown>>): void {
  const str = (value: unknown, max = 2000): string | null => (typeof value === 'string' && value.length <= max ? value : null)
  const comment = (input: Record<string, unknown>) => ({
    content: input.content,
    ...(input.name === undefined ? {} : { name: input.name === null ? null : String(input.name) }),
    ...(input.userKey === undefined ? {} : { userKey: input.userKey === null ? null : String(input.userKey) }),
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    ...(input.commentKey === undefined ? {} : { commentKey: input.commentKey === null ? null : String(input.commentKey) }),
  })
  control.post('/_e2e/band/user', async (c) => {
    const body = await read(c.req.raw)
    const name = str(body.name, 200)
    if (name === null) return c.json({ error: 'input' }, 400)
    return c.json({ userKey: band.addUser(name, str(body.userKey, 300) ?? undefined) })
  })
  control.post('/_e2e/band/login', async (c) => {
    const body = await read(c.req.raw)
    if (body.decision !== 'approve' && body.decision !== 'deny') return c.json({ error: 'input' }, 400)
    band.nextLogin({
      decision: body.decision,
      ...(typeof body.userKey === 'string' ? { userKey: body.userKey } : {}),
      ...(body.scope === undefined ? {} : { scope: body.scope === null ? null : String(body.scope) }),
      ...(body.omitUserKey === true ? { omitUserKey: true } : {}),
      ...(body.expiresIn === undefined ? {} : { expiresIn: typeof body.expiresIn === 'number' ? body.expiresIn : null }),
    })
    return c.json({ ok: true })
  })
  control.post('/_e2e/band/band', async (c) => {
    const body = await read(c.req.raw)
    const name = str(body.name, 200)
    if (name === null || !Array.isArray(body.members)) return c.json({ error: 'input' }, 400)
    return c.json({ bandKey: band.addBand({ name, members: body.members.map(String), ...(typeof body.bandKey === 'string' ? { bandKey: body.bandKey } : {}) }) })
  })
  control.post('/_e2e/band/post', async (c) => {
    const body = await read(c.req.raw)
    const bandKey = str(body.bandKey, 200)
    if (bandKey === null || !band.bands.has(bandKey)) return c.json({ error: 'input' }, 400)
    const postKey = band.addPost({
      bandKey,
      authorUserKey: typeof body.authorUserKey === 'string' ? body.authorUserKey : null,
      ...(typeof body.content === 'string' ? { content: body.content } : {}),
      ...(typeof body.createdAt === 'number' ? { createdAt: body.createdAt } : {}),
    })
    return c.json({ postKey })
  })
  control.post('/_e2e/band/comment', async (c) => {
    const body = await read(c.req.raw)
    const postKey = str(body.postKey, 200)
    if (postKey === null || !band.posts.has(postKey)) return c.json({ error: 'input' }, 400)
    return c.json({ commentKey: band.addComment(postKey, comment(body)) })
  })
  control.post('/_e2e/band/comments', async (c) => {
    const body = await read(c.req.raw)
    const postKey = str(body.postKey, 200)
    if (postKey === null || !band.posts.has(postKey) || !Array.isArray(body.items)) return c.json({ error: 'input' }, 400)
    const items = body.items.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    return c.json({ commentKeys: items.map((item) => band.addComment(postKey, comment(item))) })
  })
  control.post('/_e2e/band/drop', async (c) => {
    const body = await read(c.req.raw)
    const postKey = str(body.postKey, 200)
    const commentKey = str(body.commentKey, 300)
    if (postKey === null || commentKey === null || !band.posts.has(postKey)) return c.json({ error: 'input' }, 400)
    return c.json({ ok: band.dropComment(postKey, commentKey) })
  })
  control.post('/_e2e/band/edit', async (c) => {
    const body = await read(c.req.raw)
    const postKey = str(body.postKey, 200)
    const commentKey = str(body.commentKey, 300)
    const content = str(body.content)
    if (postKey === null || commentKey === null || content === null || !band.posts.has(postKey)) return c.json({ error: 'input' }, 400)
    return c.json({ ok: band.editComment(postKey, commentKey, content) })
  })
  control.post('/_e2e/band/fail', async (c) => {
    const body = await read(c.req.raw)
    const op = body.op
    const times = typeof body.times === 'number' && Number.isSafeInteger(body.times) && body.times > 0 && body.times <= 1000 ? body.times : 1
    let fault: FakeBandFault | null = null
    if (typeof body.resultCode === 'number' && Number.isSafeInteger(body.resultCode)) fault = { resultCode: body.resultCode }
    else if (typeof body.http === 'number' && Number.isSafeInteger(body.http)) fault = { http: body.http }
    else if (body.kind === 'HANG' || body.kind === 'NOT_JSON' || body.kind === 'BAD_SHAPE') fault = body.kind
    if (!isBandOp(op) || op === 'authorize' || fault === null) return c.json({ error: 'input' }, 400)
    band.fail(op, fault, times)
    return c.json({ ok: true })
  })
  control.post('/_e2e/band/clear', (c) => {
    band.clearFaults()
    band.releaseHanging()
    return c.json({ ok: true })
  })
  control.post('/_e2e/band/revoke', async (c) => {
    const body = await read(c.req.raw)
    const userKey = str(body.userKey, 300)
    if (userKey === null) return c.json({ error: 'input' }, 400)
    band.revoke(userKey)
    return c.json({ ok: true })
  })
  control.post('/_e2e/band/delay', async (c) => {
    const body = await read(c.req.raw)
    const ms = typeof body.ms === 'number' && Number.isSafeInteger(body.ms) && body.ms >= 0 && body.ms <= 120_000 ? body.ms : null
    if (!isBandOp(body.op) || ms === null) return c.json({ error: 'input' }, 400)
    band.delay(body.op, ms)
    return c.json({ ok: true })
  })
  control.get('/_e2e/band/requests', (c) => {
    const requests = band.requests.map((request) => ({ method: request.method, path: request.path }))
    return c.json({ requests, onlyAllowed: requests.every((request) => request.method === 'GET' && BAND_ALLOWED_PATHS.includes(request.path)) })
  })
}

const TIKTOK_ACCOUNT_STATES: readonly FakeAccountState[] = ['LIVE', 'OFFLINE', 'MISSING']
const TIKTOK_FAILURES: readonly TikTokFailureKind[] = ['NETWORK', 'NOT_LIVE', 'BLOCKED', 'SIGN_FAILED', 'USER_NOT_FOUND']

/**
 * 가짜 웹캐스트 조작 (N2b-2 — E2E 기동에서만). JSON POST, 세션 필요 없음. 아이디(uniqueId)는 판매자가 설정에 넣은 틱톡 아이디(소문자):
 * - POST /_e2e/tiktok/account { uniqueId, state: LIVE|OFFLINE|MISSING } — 그 아이디의 방송 상태 (처음은 MISSING)
 * - POST /_e2e/tiktok/comment { uniqueId, msgId?, userId, viewer?, nickname, comment } — 그 방송에 열린 연결로 댓글 하나 (viewer = 쓴 사람의 아이디 — 방송자 본인이면 uniqueId와 같게)
 * - POST /_e2e/tiktok/data { uniqueId } — 댓글이 아닌 자료(방 정보) 하나 (멈춘 연결 보기 시계를 되돌린다)
 * - POST /_e2e/tiktok/drop { uniqueId } — 열린 연결을 끊는다(틱톡 쪽 끊김)
 * - POST /_e2e/tiktok/fail { kind, times? } — 다음 연결 시도 times번(기본 1)을 그 종류로 실패시킨다 (막힘 = BLOCKED)
 * - POST /_e2e/tiktok/block { uniqueId, times? } — 막힘: 열린 연결을 끊고 다음 시도 times번(기본 9)을 BLOCKED로
 * - POST /_e2e/tiktok/end { uniqueId } — 방송 끝
 * - GET  /_e2e/tiktok/state — { attempts, open, maxOpen }
 */
function registerTiktokControl(control: Hono, webcast: FakeWebcast, read: (request: Request) => Promise<Record<string, unknown>>): void {
  let nextMsg = 7_309_000_000_000_000_000n
  const idOf = (body: Record<string, unknown>): string | null => (typeof body.uniqueId === 'string' && body.uniqueId !== '' ? body.uniqueId : null)
  control.post('/_e2e/tiktok/account', async (c) => {
    const body = await read(c.req.raw)
    const id = idOf(body)
    const state = body.state
    if (id === null || typeof state !== 'string' || !TIKTOK_ACCOUNT_STATES.includes(state as FakeAccountState)) return c.json({ error: 'input' }, 400)
    webcast.account(id, state as FakeAccountState)
    return c.json({ ok: true })
  })
  control.post('/_e2e/tiktok/comment', async (c) => {
    const body = await read(c.req.raw)
    const id = idOf(body)
    if (id === null) return c.json({ error: 'input' }, 400)
    nextMsg += 1n
    const msgId = typeof body.msgId === 'string' ? body.msgId : nextMsg.toString()
    const open = webcast.openHandles(id)
    webcast.broadcast(id, { msgId, userId: body.userId, uniqueId: body.viewer ?? `viewer_${String(body.userId)}`, nickname: body.nickname, comment: body.comment })
    return c.json({ msgId, delivered: open.length })
  })
  control.post('/_e2e/tiktok/data', async (c) => {
    const id = idOf(await read(c.req.raw))
    if (id === null) return c.json({ error: 'input' }, 400)
    for (const handle of webcast.openHandles(id)) handle.emit('roomUser', { viewerCount: 1 })
    return c.json({ ok: true })
  })
  control.post('/_e2e/tiktok/drop', async (c) => {
    const id = idOf(await read(c.req.raw))
    if (id === null) return c.json({ error: 'input' }, 400)
    for (const handle of webcast.openHandles(id)) handle.drop()
    return c.json({ ok: true })
  })
  control.post('/_e2e/tiktok/fail', async (c) => {
    const body = await read(c.req.raw)
    const kind = body.kind
    const times = typeof body.times === 'number' && Number.isInteger(body.times) && body.times >= 1 && body.times <= 100 ? body.times : 1
    if (typeof kind !== 'string' || !TIKTOK_FAILURES.includes(kind as TikTokFailureKind)) return c.json({ error: 'input' }, 400)
    webcast.failNext(kind as TikTokFailureKind, times)
    return c.json({ ok: true })
  })
  control.post('/_e2e/tiktok/block', async (c) => {
    const body = await read(c.req.raw)
    const id = idOf(body)
    if (id === null) return c.json({ error: 'input' }, 400)
    const times = typeof body.times === 'number' && Number.isInteger(body.times) && body.times >= 1 && body.times <= 100 ? body.times : 9
    webcast.failNext('BLOCKED', times)
    for (const handle of webcast.openHandles(id)) handle.drop()
    return c.json({ ok: true })
  })
  control.post('/_e2e/tiktok/end', async (c) => {
    const id = idOf(await read(c.req.raw))
    if (id === null) return c.json({ error: 'input' }, 400)
    for (const handle of webcast.openHandles(id)) handle.endStream()
    return c.json({ ok: true })
  })
  control.get('/_e2e/tiktok/state', (c) => c.json({ attempts: webcast.attempts, open: webcast.openCount, maxOpen: webcast.maxOpen }))
}
/**
 * 가짜 택배사 조작 (T1 — E2E 기동에서만). JSON POST, 세션 필요 없음:
 * - POST /_e2e/parcel/status { invoice, status: ACCEPTED|PICKED_UP|IN_TRANSIT|DELIVERED } — 그 송장의 조회 상태를 넘긴다
 * - POST /_e2e/parcel/fail { op: book|cancel|track, kind: ADDRESS|REJECTED|TIMEOUT|TIMEOUT_AFTER_BOOK|ERROR_500|BAD_INVOICE|REFUSED, times? } — 다음 요청 times번(기본 1)을 그 실패로
 * - POST /_e2e/parcel/track {} → { asked } — 배송 조회를 지금 한 바퀴 (조회 주기를 기다리지 않는다)
 * - POST /_e2e/parcel/sweep {} → { deleted } — 배송지 30일 정리를 지금
 * - GET  /_e2e/parcel/requests → { requests: [{ op, requestKey, invoices, body }], bookings } — 가짜 택배사가 받은 요청
 * - POST /_e2e/parcel/reset {} — 받은 요청 목록·주입한 실패를 비운다
 * 받는 분 주소에 [주소거절]·[접수거절]·[응답없음]·[접수후응답없음]·[서버오류]·[송장이상]을 넣어도 그 실패가 난다(fake-carrier.ts)
 */
function registerParcelControl(control: Hono, server: LivejjimServer, carrier: FakeCarrier, read: (request: Request) => Promise<Record<string, unknown>>): void {
  control.post('/_e2e/parcel/status', async (c) => {
    const body = await read(c.req.raw)
    if (typeof body.invoice !== 'string' || !FAKE_TRACK_STATUSES.includes(body.status as FakeTrackStatus)) return c.json({ error: 'input' }, 400)
    return c.json({ ok: carrier.setStatus(body.invoice, body.status as FakeTrackStatus) })
  })
  control.post('/_e2e/parcel/fail', async (c) => {
    const body = await read(c.req.raw)
    const op = body.op
    const times = typeof body.times === 'number' && Number.isInteger(body.times) && body.times >= 1 && body.times <= 100 ? body.times : 1
    if ((op !== 'book' && op !== 'cancel' && op !== 'track') || !FAKE_FAILURES.includes(body.kind as FakeFailure)) return c.json({ error: 'input' }, 400)
    carrier.failNext(op, body.kind as FakeFailure, times)
    return c.json({ ok: true })
  })
  control.post('/_e2e/parcel/track', async (c) => c.json({ asked: await server.parcels.trackOnce() }))
  control.post('/_e2e/parcel/sweep', async (c) => c.json({ deleted: await server.parcels.sweepOnce() }))
  control.get('/_e2e/parcel/requests', (c) => c.json({ requests: carrier.requests, bookings: carrier.bookingCount }))
  control.post('/_e2e/parcel/reset', (c) => {
    carrier.reset()
    return c.json({ ok: true })
  })
}

/** E2E 기동의 받아 오기 주기 기본값 (밀리초) */
export const E2E_DEPOSIT_POLL_MS = 1000

/** E2E 서버가 듣는 주소: 이 컴퓨터 안(IPv4 루프백)에서만 (AC-S06-73, D-096 — 모든 인터페이스 0.0.0.0·::이 아니다) */
export const E2E_HOST = '127.0.0.1'

export interface E2eServer {
  readonly server: LivejjimServer
  readonly database: Database
  readonly account: E2eAccount
  readonly sellerId: string
  readonly fill: FillResult | null
  /** 백업 폴더 (I2) */
  readonly backupDir: string
  /** 가짜 구글·유튜브 서버 (youtube를 주었을 때만) */
  readonly fakeGoogle: FakeGoogle | null
  /** Node HTTP 서버 (열기는 listen으로) */
  readonly http: Server
  /** 함께 띄운 가짜 메타 서버 (instagram: true일 때만) */
  readonly fakeMeta: FakeMeta | null
  /** 가짜 웹캐스트 (tiktok: true일 때만) */
  readonly fakeWebcast: FakeWebcast | null
  /** 가짜 밴드 서버 (band를 주었을 때만, BND1) */
  readonly fakeBand: FakeBand | null
  /** 가짜 택배사 (parcel: false가 아니면) */
  readonly fakeCarrier: FakeCarrier | null
  /** 가짜 OAuth 서버 (social을 주었을 때만, L1) */
  readonly fakeOAuth: FakeOAuth | null
  /** 가짜 LLM 서버 (assist를 주었을 때만, A1) */
  readonly fakeLlm: FakeLlm | null
  /** E2E_HOST(127.0.0.1)의 그 포트에서 연다 (0이면 빈 포트). 연 주소·포트를 돌려준다. 열지 못하면(포트를 이미 씀 등) 그 오류로 실패한다 */
  listen(port: number): Promise<{ readonly host: string; readonly port: number }>
  close(): Promise<void>
}

export async function startE2eServer(options: E2eOptions = {}): Promise<E2eServer> {
  const database = await openPglite()
  const masterKey = generateMasterKey()
  const ownBackupDir = options.backupDir === undefined
  const backupDir = options.backupDir ?? mkdtempSync(join(tmpdir(), 'livejjim-e2e-backup-'))
  const appOrigin = options.appOrigin ?? 'http://localhost:5173'
  const fakeMeta = options.instagram === true ? await FakeMeta.start(options.instagramPort === undefined ? {} : { port: options.instagramPort }) : null
  const fakeGoogle =
    options.youtube === undefined
      ? null
      : await FakeGoogle.start({
          ...(options.youtube.port === undefined ? {} : { port: options.youtube.port }),
          pollingIntervalMillis: options.youtube.pollingIntervalMillis ?? 1000,
        })
  const budget = options.youtube?.quotaBudget
  const fakeWebcast = options.tiktok === true ? new FakeWebcast() : null
  const fakeBand = options.band === undefined ? null : await FakeBand.start(options.band.port === undefined ? {} : { port: options.band.port })
  const fakeCarrier = options.parcel === false ? null : await FakeCarrier.start(options.parcelPort === undefined ? {} : { port: options.parcelPort })
  const socialProviders: readonly ProviderId[] = options.social?.providers ?? ['google', 'kakao', 'naver']
  const fakeOAuth =
    options.social === undefined
      ? null
      : await FakeOAuth.start({
          ...(options.social.port === undefined ? {} : { port: options.social.port }),
          redirectUris: Object.fromEntries(socialProviders.map((provider) => [provider, `${appOrigin}/api/auth/${provider}/callback`])),
        })
  const fakeLlm = options.assist === undefined ? null : await FakeLlm.start(options.assist.port === undefined ? {} : { port: options.assist.port })
  const server = createServer({
    database,
    masterKey,
    appOrigin,
    ...(fakeMeta === null ? {} : { instagram: fakeMeta.settings({ redirectUri: `${appOrigin}/api/instagram/callback` }) }),
    log: () => {},
    backupStorage: new FolderBackupStorage(backupDir),
    receiptAtParam: true,
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
    ...(fakeOAuth === null ? {} : { socialLogin: fakeOAuth.setup({ providers: socialProviders }) }),
    ...(fakeLlm === null || options.assist === undefined
      ? {}
      : {
          assist: fakeLlm.setup({
            ...(options.assist.dailyLimit === undefined ? {} : { dailyLimit: options.assist.dailyLimit }),
            ...(options.assist.globalLimit === undefined ? {} : { globalLimit: options.assist.globalLimit }),
            ...(options.assist.timeoutMs === undefined ? {} : { timeoutMs: options.assist.timeoutMs }),
          }),
        }),
    ...(options.hostActionDelayMs === undefined ? {} : { hostActionDelayMs: options.hostActionDelayMs }),
    ...(options.generatorSpeed === undefined ? {} : { generatorSpeed: options.generatorSpeed }),
    ...(options.passwordCost === undefined ? {} : { passwordCost: options.passwordCost }),
    testPrinter: options.testPrinter ?? true,
    ...(options.billing === true ? { billing: testBilling() } : {}),
    ...(fakeWebcast === null ? {} : { tiktok: { settings: readTikTokSettings({ LIVEJJIM_TIKTOK_BETA: 'on' }), webcast: fakeWebcast.factory } }),
    ...(fakeBand === null
      ? {}
      : { band: { settings: fakeBand.settings({ redirectUri: `${appOrigin}/api/band/callback` }), timing: { fastMs: options.band?.fastMs ?? E2E_BAND_FAST_MS, fullMs: options.band?.fullMs ?? E2E_BAND_FULL_MS } } }),
    deposits: {
      testMode: options.testDeposits ?? true,
      popbill: null,
      pollMs: options.depositPollMs ?? E2E_DEPOSIT_POLL_MS,
      ...(options.depositRefetchMs === undefined ? {} : { refetchGapMs: options.depositRefetchMs }),
    },
    ...(fakeCarrier === null ? {} : { parcel: { carriers: { FAKE: fakeCarrier.adapter() }, trackEveryMs: options.parcelTrackMs ?? E2E_PARCEL_TRACK_MS } }),
  })
  const account = readE2eAccount()
  const created = await createSellerAccount(database.db, Buffer.from(masterKey, 'base64'), account, options.passwordCost === undefined ? {} : { passwordCost: options.passwordCost })
  if (!created.ok) throw new Error(created.message)
  // 시험 계정(e2e-shop)은 시작 마법사를 마친 계정이다 — 기존 E2E가 로그인 뒤 방송 목록을 그대로 쓰게(I3 화면은 실제 방송이 없는 "처음" 계정에 마법사를
  // 저절로 연다, AC-I3-50). 마법사 시험은 POST /_e2e/sellers의 새 판매자(처음)로 한다 (dev-web, I3 dev-notes)
  await server.service.setWizard(created.sellerId, { status: 'DONE' })
  const fill = options.fill === undefined ? null : await fillScope(server, created.sellerId, options.fill)
  if (options.initialBackup !== false) await server.backups.createNow(created.sellerId, 'daily')
  server.backups.start()
  server.work.receipts.warm()
  if (fakeGoogle !== null) server.start()
  // 택배 배송 조회·배송지 정리 (유튜브를 켜지 않은 기동도 — 시험 모드 주기)
  else if (fakeCarrier !== null) server.parcels.start()
  // 밴드 보관 기간 지우기·이어받기 (유튜브를 켜지 않은 기동도)
  if (fakeBand !== null && fakeGoogle === null) void server.band.resume()
  const http = createNodeServer({ app: e2eControl(server, database, Buffer.from(masterKey, 'base64'), options.passwordCost, fakeWebcast, fakeCarrier, fakeBand) })
  return {
    server,
    database,
    account,
    sellerId: created.sellerId,
    fill,
    backupDir,
    fakeGoogle,
    http,
    fakeMeta,
    fakeWebcast,
    fakeBand,
    fakeCarrier,
    fakeOAuth,
    fakeLlm,
    listen: (port) =>
      new Promise((resolve, reject) => {
        const failed = (error: Error) => reject(error)
        http.once('error', failed)
        http.listen(port, E2E_HOST, () => {
          http.off('error', failed)
          const address = http.address()
          if (typeof address !== 'object' || address === null) reject(new Error('듣는 주소를 알 수 없다'))
          else {
            // 가짜 메타 서버가 서명한 웹훅을 이 서버로 보낸다 (/_fake/comments)
            if (fakeMeta !== null) fakeMeta.webhookUrl = `http://${address.address}:${String(address.port)}/webhooks/instagram`
            resolve({ host: address.address, port: address.port })
          }
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
      await fakeMeta?.close()
      await fakeBand?.close()
      await fakeCarrier?.close()
      await fakeOAuth?.close()
      await fakeLlm?.close()
      await database.close()
      if (ownBackupDir) rmSync(backupDir, { recursive: true, force: true })
    },
  }
}
