// AI 확인 필요 제안 서비스 (A1, SPEC CMT-06, R-20 10, D-A1-01~D-A1-08). 판정은 하지 않는다 — 코어 조회 함수(listReviews·listProducts·getBroadcast)와
// 코어 인식 함수(parseOptionComment — rules.ts가 부른다)만 쓰고, 이벤트를 만들지 않는다(제안은 판정이 아니다).
// - 보일 때마다(attach): 규칙 제안을 지금 상품 목록으로 다시 계산하고, 없으면 AI 캐시 제안을 지금 목록으로 다시 검사한다. 판매 중(OPEN·SOLD) 상품만.
//   외부 호출을 하지 않는다.
// - AI 제안 받기(run): 판매자가 확인 필요 화면을 열 때 한 번. 켜짐·키 있음일 때만, 같은 판매자 요청이 진행 중이면 BUSY.
//   범위 안 방송마다(오래된 방송부터) planAssist로 고른 항목을 한 번 묶어(20개까지) 부른다. 부르기 전에 하루 상한(판매자·서버 전체, KST 날짜)을
//   어드바이저리 락 안에서 세고 호출 기록 줄을 먼저 넣는다(실패한 호출도 센다). 부르기 직전마다 켬을 다시 읽는다(끄면 그 순간부터 새 호출 없음).
// - 캐시 = (판매자, 범위, 방송, 가린 글의 해시, 읽은 번호) → 검사를 통과한 제안 또는 "없음". HTTP 오류·시간 초과·연결 실패는 캐시하지 않는다.
// - 댓글 원문·가린 글·요청·응답 본문은 저장·로그하지 않는다. 로그는 정해진 코드·판매자 ID·HTTP 상태·개수만.
// - AIY1 (D-AIY1-01~04·06): 유튜브에서 온 줄(이벤트 출처 youtube·extension·모름 — DB의 events.chat_source)은 AI로 보내지 않는다.
//   거르기는 planAssist 안에서 같은 글 묶기·묶음 수보다 먼저, 그리고 켬 다시 읽기·하루 상한 세기(#reserve)보다 먼저다. 유튜브 줄엔 AI 캐시 제안도 보이지 않는다(규칙 제안만).
import { createHmac } from 'node:crypto'
import { DEFAULT_SETTINGS, getBroadcast, listBroadcasts, listProducts, listReviews, type EngineState, type OptionCatalogEntry, type ReviewInfo, type SaleSettings } from '@livejjim/core'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { assistCache, assistCalls, assistSettings } from '../db/schema.ts'
import { errorKind, type LogSink } from '../log.ts'
import { chatSourcesAt, eventBodiesAt, findBroadcast, optionScopes } from '../store.ts'
import { kstDate, type Clock } from '../time.ts'
import type { ScopeWriter } from '../writer.ts'
import { ANTHROPIC_BASE_URL, AnthropicAssist, DEFAULT_ASSIST_MODEL, type CommentAssist } from './anthropic.ts'
import { SUGGEST_REASONS, isYoutubeSource, planAssist, redact, ruleSuggestion, validateResponse, type PlanItem, type Suggestion } from './rules.ts'

/** 판매자 하루 호출 상한 기본값 (D-A1-04) */
export const DEFAULT_SELLER_DAILY_CALLS = 20
/** 서버 전체 하루 호출 상한 기본값 (D-A1-04) */
export const DEFAULT_GLOBAL_DAILY_CALLS = 500
/** 한 호출에 묶는 항목 수 (D-A1-03) */
export const ASSIST_BATCH_MAX = 20
/** 상한 값의 범위 (운영 환경 변수) */
export const DAILY_LIMIT_MAX = 1_000_000

/**
 * AI 제안 설정. 운영 기동은 환경 변수로 키·모델·상한만 만든다(readAssistEnv — 주소는 고정 https://api.anthropic.com).
 * 주소 바꾸기·http 허용·HTTP 함수·시간 제한·어댑터 바꾸기는 시험·E2E·연습 기동만(가짜 LLM 서버)
 */
export interface AssistSetup {
  /** 없거나 빈 값이면 AI 제안을 쓸 수 없다(규칙 제안만) */
  readonly apiKey: string | null
  readonly model?: string
  readonly sellerDailyLimit?: number
  readonly globalDailyLimit?: number
  readonly baseUrl?: string
  /** http:// 주소를 받는다 (가짜 LLM 서버 — 시험·연습만) */
  readonly allowInsecure?: boolean
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
  readonly batchMax?: number
  /** 어댑터 바꾸기 (시험만) */
  readonly adapter?: CommentAssist
}

export const ASSIST_ENV = {
  key: 'LIVEJJIM_ASSIST_API_KEY',
  model: 'LIVEJJIM_ASSIST_MODEL',
  sellerDaily: 'LIVEJJIM_ASSIST_DAILY_CALLS',
  globalDaily: 'LIVEJJIM_ASSIST_GLOBAL_DAILY_CALLS',
} as const

const MODEL_RE = /^[A-Za-z0-9._:-]{1,100}$/

export type AssistEnvResult = { readonly ok: true; readonly setup: AssistSetup } | { readonly ok: false; readonly message: string }

/**
 * 운영 환경 변수의 AI 제안 설정 (D-A1-08): 키·모델·판매자 하루 상한·서버 전체 하루 상한만 읽는다. 주소를 바꾸는 환경 변수는 없다(운영 주소 고정).
 * 상한·모델 모양이 틀리면 시작하지 않는다. 값은 문장에 넣지 않는다
 */
export function readAssistEnv(env: Readonly<Record<string, string | undefined>>): AssistEnvResult {
  const get = (key: string) => env[key]?.trim() ?? ''
  const key = get(ASSIST_ENV.key)
  const model = get(ASSIST_ENV.model)
  if (model !== '' && !MODEL_RE.test(model)) return { ok: false, message: `AI 제안 모델 이름(${ASSIST_ENV.model})은 영문·숫자·'.'·'_'·'-'·':'로 적어 주세요.` }
  const limit = (name: string, fallback: number): number | null => {
    const raw = get(name)
    if (raw === '') return fallback
    if (!/^\d{1,7}$/.test(raw)) return null
    const value = Number(raw)
    return value <= DAILY_LIMIT_MAX ? value : null
  }
  const sellerDaily = limit(ASSIST_ENV.sellerDaily, DEFAULT_SELLER_DAILY_CALLS)
  if (sellerDaily === null) return { ok: false, message: `AI 제안 판매자 하루 상한(${ASSIST_ENV.sellerDaily})은 0~1000000 사이 정수로 적어 주세요.` }
  const globalDaily = limit(ASSIST_ENV.globalDaily, DEFAULT_GLOBAL_DAILY_CALLS)
  if (globalDaily === null) return { ok: false, message: `AI 제안 서버 전체 하루 상한(${ASSIST_ENV.globalDaily})은 0~1000000 사이 정수로 적어 주세요.` }
  return { ok: true, setup: { apiKey: key === '' ? null : key, ...(model === '' ? {} : { model }), sellerDailyLimit: sellerDaily, globalDailyLimit: globalDaily } }
}

/** 설정 확인 (서버 만들 때): 주소는 https만(시험·연습의 allowInsecure면 http도), 상한·모델 모양. 문제가 있으면 문장 */
export function checkAssistSetup(setup: AssistSetup): string | null {
  const url = setup.baseUrl ?? ANTHROPIC_BASE_URL
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'AI 제안 주소 설정을 확인해 주세요.'
  }
  if (parsed.protocol !== 'https:' && !(setup.allowInsecure === true && parsed.protocol === 'http:')) return 'AI 제안 주소는 https://로만 적을 수 있어요.'
  for (const value of [setup.sellerDailyLimit, setup.globalDailyLimit]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > DAILY_LIMIT_MAX)) return 'AI 제안 하루 상한은 0~1000000 사이 정수여야 해요.'
  }
  if (setup.model !== undefined && !MODEL_RE.test(setup.model)) return 'AI 제안 모델 이름을 확인해 주세요.'
  if (setup.batchMax !== undefined && (!Number.isSafeInteger(setup.batchMax) || setup.batchMax < 1 || setup.batchMax > ASSIST_BATCH_MAX)) return 'AI 제안 묶음 크기는 1~20이어야 해요.'
  return null
}

/** 화면에 보이는 제안 (출처 RULE = 비슷한 글자로 찾음 · AI = AI가 읽음) */
export type ShownSuggestion = Suggestion & { readonly source: 'RULE' | 'AI' }

/** AI 제안 받기 결과 코드 (acceptance "결과 코드") */
export type AssistResult = 'DONE' | 'OFF' | 'UNAVAILABLE' | 'LIMIT' | 'FAILED' | 'BUSY'

export interface AssistSettingsView {
  /** 서버에 키가 있다 */
  readonly available: boolean
  readonly enabled: boolean
  /** 지금 켠 때의 동의 시각 (UTC ISO, 꺼져 있으면 null) */
  readonly consentedAt: string | null
  /** 오늘(KST) 센 호출 수 */
  readonly usedToday: number
  readonly dailyLimit: number
}

export type AssistUpdate = { readonly kind: 'ok'; readonly view: AssistSettingsView } | { readonly kind: 'consent_required' } | { readonly kind: 'unavailable' }

/** 제안을 붙일 확인 필요 항목 (reviewsView가 넘긴다) */
export interface AttachItem {
  readonly broadcast: string
  readonly origin: 'chat' | 'sms'
  readonly reason: string
  readonly no: number | null
  /** 댓글 글 (채팅) — 없으면 null */
  readonly text: string | null
  /** 유튜브에서 온 줄 (D-AIY1-01 — youtubeLine으로 정한다). true면 AI 캐시 제안을 찾지 않는다(규칙 제안만) */
  readonly youtube: boolean
}

/** 확인 필요 항목의 AI 제외 이유 코드 (D-AIY1-04): 채팅 항목이고 유튜브에서 온 줄이면 'YOUTUBE_POLICY', 아니면 null */
export type ExcludedReason = 'YOUTUBE_POLICY'

/** 유튜브에서 온 줄인가: 채팅 항목이고 이벤트 출처가 youtube·extension·빈 값·모르는 값 (문자찜은 false) */
export const youtubeLine = (origin: 'chat' | 'sms', source: string | null | undefined): boolean => origin === 'chat' && isYoutubeSource(source)

export const excludedOf = (item: { readonly origin: 'chat' | 'sms'; readonly youtube: boolean }): ExcludedReason | null => (item.origin === 'chat' && item.youtube ? 'YOUTUBE_POLICY' : null)

/** 방송 하나의 상품 목록(판매 종료가 아닌 상품, 번호 순 — 코어 인식 함수의 입력과 같음)·상태·설정 */
interface BroadcastContext {
  readonly catalog: OptionCatalogEntry[]
  readonly status: ReadonlyMap<number, string>
  readonly settings: SaleSettings
}

const ON_SALE = new Set(['OPEN', 'SOLD'])

function contextOf(state: EngineState, broadcast: string): BroadcastContext {
  const products = listProducts(state).filter((product) => product.broadcast === broadcast)
  const catalog = products
    .filter((product) => product.status !== 'CLOSED')
    .map((product) => ({ no: product.no, name: product.name, aliases: [...product.aliases], options: product.options.map((item) => ({ name: item.name, choices: item.choices.map((choice) => ({ label: choice.label, ...(choice.aliases === undefined ? {} : { aliases: [...choice.aliases] }) })) })) }))
    .sort((a, b) => a.no - b.no)
  return { catalog, status: new Map(products.map((product) => [product.no, product.status])), settings: getBroadcast(state, broadcast)?.settings ?? DEFAULT_SETTINGS }
}

const parseSettings = (settings: SaleSettings) => ({ 'claim.maxNumber': settings['claim.maxNumber'], 'claim.maxQuantity': settings['claim.maxQuantity'], 'claim.multiNumber': settings['claim.multiNumber'] })

/** 규칙 제안 (제안을 붙이는 항목만 — 채팅·사유 둘·글 있음) */
function ruleFor(item: AttachItem, context: BroadcastContext): Suggestion | null {
  if (item.origin !== 'chat' || !SUGGEST_REASONS.has(item.reason) || item.text === null) return null
  return ruleSuggestion(item.text, { reason: item.reason, ...(item.no === null ? {} : { no: item.no }) }, context.catalog, parseSettings(context.settings))
}

const visible = (suggestion: Suggestion | null, context: BroadcastContext): boolean => suggestion !== null && ON_SALE.has(context.status.get(suggestion.no) ?? '')

/** 저장한 AI 제안을 지금 목록으로 다시 검사 (응답 검사와 같은 판단) */
function recheck(stored: string | null, item: AttachItem, context: BroadcastContext): Suggestion | null {
  if (stored === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const line = { ...(parsed as Record<string, unknown>), id: '1' }
  const checked = validateResponse([{ id: '1', ...(item.no === null ? {} : { no: item.no }) }], JSON.stringify({ suggestions: [line] }), context.catalog, context.settings['claim.maxQuantity'])
  return checked['1'] ?? null
}

export interface AssistServiceOptions {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly clock: Clock
  readonly masterKey: Buffer
  readonly log: LogSink
  readonly setup?: AssistSetup | null
  /** 시험 주입점: 호출 기록 줄을 넣은 직후·어댑터를 부르기 직전 */
  readonly hooks?: { readonly beforeCall?: () => void | Promise<void> }
}

export class AssistService {
  readonly #db: Db
  readonly #writer: ScopeWriter
  readonly #clock: Clock
  readonly #log: LogSink
  readonly #hashKey: Buffer
  readonly #adapter: CommentAssist | null
  readonly #sellerDaily: number
  readonly #globalDaily: number
  readonly #batchMax: number
  readonly #busy = new Set<string>()
  readonly #hooks: NonNullable<AssistServiceOptions['hooks']>

  constructor(options: AssistServiceOptions) {
    this.#db = options.db
    this.#writer = options.writer
    this.#clock = options.clock
    this.#log = options.log
    this.#hooks = options.hooks ?? {}
    this.#hashKey = createHmac('sha256', options.masterKey).update('livejjim/assist-cache/v1', 'utf8').digest()
    const setup = options.setup ?? null
    const key = setup?.apiKey?.trim() ?? ''
    this.#adapter =
      setup === null || key === ''
        ? null
        : (setup.adapter ??
          new AnthropicAssist({
            apiKey: key,
            model: setup.model ?? DEFAULT_ASSIST_MODEL,
            ...(setup.baseUrl === undefined ? {} : { baseUrl: setup.baseUrl }),
            ...(setup.fetch === undefined ? {} : { fetch: setup.fetch }),
            ...(setup.timeoutMs === undefined ? {} : { timeoutMs: setup.timeoutMs }),
          }))
    this.#sellerDaily = setup?.sellerDailyLimit ?? DEFAULT_SELLER_DAILY_CALLS
    this.#globalDaily = setup?.globalDailyLimit ?? DEFAULT_GLOBAL_DAILY_CALLS
    this.#batchMax = setup?.batchMax ?? ASSIST_BATCH_MAX
  }

  /** 서버에 키가 있다 */
  get available(): boolean {
    return this.#adapter !== null
  }

  get dailyLimit(): number {
    return this.#sellerDaily
  }

  /** 가린 글의 해시 (마스터 키에서 나눈 키의 HMAC — DB만으로 글을 되돌릴 수 없다) */
  #hash(redacted: string): string {
    return createHmac('sha256', this.#hashKey).update(redacted, 'utf8').digest('base64url')
  }

  #today(): string {
    return kstDate(this.#clock.now())
  }

  async #usedToday(sellerId: string): Promise<number> {
    const rows = await this.#db
      .select({ n: sql<number>`count(*)::int` })
      .from(assistCalls)
      .where(and(eq(assistCalls.sellerId, sellerId), eq(assistCalls.day, this.#today())))
    return rows[0]?.n ?? 0
  }

  async #row(sellerId: string): Promise<{ enabled: boolean; consentedAt: Date | null }> {
    const rows = await this.#db.select({ enabled: assistSettings.enabled, consentedAt: assistSettings.consentedAt }).from(assistSettings).where(eq(assistSettings.sellerId, sellerId)).limit(1)
    return rows[0] ?? { enabled: false, consentedAt: null }
  }

  /** 설정 보기 */
  async view(sellerId: string): Promise<AssistSettingsView> {
    const row = await this.#row(sellerId)
    return {
      available: this.available,
      enabled: row.enabled,
      consentedAt: row.consentedAt === null ? null : row.consentedAt.toISOString(),
      usedToday: await this.#usedToday(sellerId),
      dailyLimit: this.#sellerDaily,
    }
  }

  /** 켜기(동의 필요·키 필요)·끄기(늘 됨, 동의 시각을 지운다 — 다시 켤 때 동의를 다시 받는다) */
  async update(sellerId: string, enabled: boolean, consent: boolean): Promise<AssistUpdate> {
    if (enabled && !this.available) return { kind: 'unavailable' }
    if (enabled && !consent) return { kind: 'consent_required' }
    const now = new Date(this.#clock.now())
    const values = enabled ? { enabled: true, consentedAt: now, updatedAt: now } : { enabled: false, consentedAt: null, updatedAt: now }
    await this.#db
      .insert(assistSettings)
      .values({ sellerId, ...values })
      .onConflictDoUpdate({ target: assistSettings.sellerId, set: values })
    return { kind: 'ok', view: await this.view(sellerId) }
  }

  /** 캐시 행 (방송 하나의 그 해시들) → `${no}\0${hash}` → 저장한 제안 JSON 또는 null */
  async #cached(sellerId: string, scope: { date: string; rehearsal: boolean }, broadcast: string, hashes: readonly string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>()
    if (hashes.length === 0) return out
    const rows = await this.#db
      .select({ textHash: assistCache.textHash, no: assistCache.no, suggestion: assistCache.suggestion })
      .from(assistCache)
      .where(
        and(
          eq(assistCache.sellerId, sellerId),
          eq(assistCache.scopeDate, scope.date),
          eq(assistCache.rehearsal, scope.rehearsal),
          eq(assistCache.broadcastId, broadcast),
          inArray(assistCache.textHash, [...new Set(hashes)]),
        ),
      )
    for (const row of rows) out.set(`${String(row.no)}\u0000${row.textHash}`, row.suggestion)
    return out
  }

  /**
   * 보일 때마다 (R-20 10 "보일 때마다"): 항목마다 제안 또는 null. 규칙 제안이 있으면 그것만, 없으면 AI 캐시 제안(지금 목록으로 다시 검사).
   * 판매 중(OPEN·SOLD) 상품의 제안만. 외부 호출을 하지 않는다
   */
  async attach(sellerId: string, scope: { date: string; rehearsal: boolean }, state: EngineState, items: readonly AttachItem[]): Promise<(ShownSuggestion | null)[]> {
    const contexts = new Map<string, BroadcastContext>()
    const contextFor = (broadcast: string): BroadcastContext => {
      let context = contexts.get(broadcast)
      if (context === undefined) {
        context = contextOf(state, broadcast)
        contexts.set(broadcast, context)
      }
      return context
    }
    const out: (ShownSuggestion | null)[] = []
    const pending: { index: number; item: AttachItem; hash: string }[] = []
    for (const item of items) {
      const context = contextFor(item.broadcast)
      const rule = ruleFor(item, context)
      if (rule !== null) {
        out.push(visible(rule, context) ? { ...rule, source: 'RULE' } : null)
        continue
      }
      out.push(null)
      // D-AIY1-04: 유튜브 줄은 AI 캐시를 찾지 않는다 (예전 캐시·같은 글의 다른 출처 캐시도 보이지 않는다 — 행은 그대로)
      if (item.youtube) continue
      if (item.origin !== 'chat' || !SUGGEST_REASONS.has(item.reason) || item.text === null) continue
      const redacted = redact(item.text)
      if (redacted === '') continue
      pending.push({ index: out.length - 1, item, hash: this.#hash(redacted) })
    }
    const byBroadcast = new Map<string, typeof pending>()
    for (const entry of pending) byBroadcast.set(entry.item.broadcast, [...(byBroadcast.get(entry.item.broadcast) ?? []), entry])
    for (const [broadcast, entries] of byBroadcast) {
      const cached = await this.#cached(
        sellerId,
        scope,
        broadcast,
        entries.map((entry) => entry.hash),
      )
      const context = contextFor(broadcast)
      for (const entry of entries) {
        const stored = cached.get(`${String(entry.item.no ?? 0)}\u0000${entry.hash}`)
        if (stored === undefined) continue
        const suggestion = recheck(stored, entry.item, context)
        out[entry.index] = visible(suggestion, context) ? { ...(suggestion as Suggestion), source: 'AI' } : null
      }
    }
    return out
  }

  /** 호출 기록 줄을 먼저 넣는다 — 판매자·서버 전체 하루 상한 안일 때만(어드바이저리 락으로 세기와 넣기를 한 번에). 넘으면 null */
  async #reserve(sellerId: string, items: number): Promise<number | null> {
    const day = this.#today()
    const now = new Date(this.#clock.now())
    return this.#db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('livejjim/assist-calls', 0))`)
      const counts = await tx
        .select({ seller: sql<number>`count(*) filter (where ${assistCalls.sellerId} = ${sellerId})::int`, all: sql<number>`count(*)::int` })
        .from(assistCalls)
        .where(eq(assistCalls.day, day))
      const seller = counts[0]?.seller ?? 0
      const all = counts[0]?.all ?? 0
      if (seller >= this.#sellerDaily || all >= this.#globalDaily) return null
      const inserted = await tx.insert(assistCalls).values({ sellerId, day, items, createdAt: now }).returning({ id: assistCalls.id })
      return inserted[0]?.id ?? null
    })
  }

  /**
   * AI 제안 받기 (화면을 열 때 한 번). 범위 = 확인 필요 목록과 같다(방송을 주면 그 방송 — 다른 판매자·리허설 구분이 다른 방송이면 null = 404).
   * 이벤트를 만들지 않는다
   */
  async run(sellerId: string, query: { readonly rehearsal: boolean; readonly broadcast?: string }): Promise<{ result: AssistResult; called: number } | null> {
    let targets: { date: string; rehearsal: boolean; scopeId: string }[]
    if (query.broadcast !== undefined) {
      const row = await findBroadcast(this.#db, sellerId, query.broadcast)
      if (row === null || row.rehearsal !== query.rehearsal) return null
      targets = [{ date: row.date, rehearsal: row.rehearsal, scopeId: row.scopeId }]
    } else targets = await optionScopes(this.#db, sellerId, query.rehearsal)
    if (this.#adapter === null) return { result: 'UNAVAILABLE', called: 0 }
    if (!(await this.#row(sellerId)).enabled) return { result: 'OFF', called: 0 }
    if (this.#busy.has(sellerId)) return { result: 'BUSY', called: 0 }
    this.#busy.add(sellerId)
    try {
      return await this.#runLocked(sellerId, targets, query.broadcast, this.#adapter)
    } finally {
      this.#busy.delete(sellerId)
    }
  }

  async #runLocked(sellerId: string, targets: readonly { date: string; rehearsal: boolean; scopeId: string }[], only: string | undefined, adapter: CommentAssist): Promise<{ result: AssistResult; called: number }> {
    let called = 0
    for (const target of targets) {
      const runtime = await this.#writer.readDetached(sellerId, target.date, target.rehearsal)
      const { state, seq, scopeId } = runtime
      if (seq === 0 || scopeId === null) continue
      const reviews = listReviews(state).filter((review) => only === undefined || review.broadcast === only)
      if (reviews.length === 0) continue
      const seqs = [...new Set(reviews.map((review) => review.seq))]
      const bodies = await eventBodiesAt(this.#db, sellerId, scopeId, seqs)
      // D-AIY1-02: 출처는 화면이 아니라 DB의 기록(events.chat_source)에서 읽는다
      const sources = await chatSourcesAt(this.#db, sellerId, scopeId, seqs)
      // 오래된 방송부터 (그 범위의 선언 순서)
      for (const broadcast of listBroadcasts(state)) {
        const items = reviews.filter((review) => review.broadcast === broadcast.id)
        if (items.length === 0) continue
        const outcome = await this.#runBroadcast(sellerId, target, state, broadcast.id, items, bodies, sources, adapter)
        if (outcome === 'disabled') return { result: called === 0 ? 'OFF' : 'DONE', called }
        if (outcome === 'limit') return { result: called === 0 ? 'LIMIT' : 'DONE', called }
        if (outcome === 'failed') return { result: 'FAILED', called: called + 1 }
        if (outcome === 'called') called++
      }
    }
    return { result: 'DONE', called }
  }

  async #runBroadcast(
    sellerId: string,
    scope: { date: string; rehearsal: boolean },
    state: EngineState,
    broadcast: string,
    reviews: readonly ReviewInfo[],
    bodies: ReadonlyMap<number, Record<string, unknown>>,
    sources: ReadonlyMap<number, string | null>,
    adapter: CommentAssist,
  ): Promise<'none' | 'called' | 'failed' | 'limit' | 'disabled'> {
    const context = contextOf(state, broadcast)
    const rows = reviews.map((review) => {
      const body = bodies.get(review.seq) ?? {}
      const text = review.origin === 'chat' && typeof body.text === 'string' ? body.text : null
      const item: AttachItem = { broadcast, origin: review.origin, reason: review.reason, no: review.no, text, youtube: youtubeLine(review.origin, sources.get(review.seq)) }
      // 유튜브 줄은 가리지도·해시하지도 않는다 (글이 이 아래로 흘러가지 않게)
      const redacted = text === null || item.youtube ? '' : redact(text)
      return { id: review.item, item, redacted, hash: redacted === '' ? '' : this.#hash(redacted), rule: ruleFor(item, context) !== null }
    })
    const excluded = rows.filter((row) => row.item.youtube && SUGGEST_REASONS.has(row.item.reason) && !row.rule && row.item.text !== null).length
    if (excluded > 0) this.#log({ level: 'info', code: 'ASSIST_EXCLUDED', seller: sellerId, count: excluded })
    const cached = await this.#cached(
      sellerId,
      scope,
      broadcast,
      rows.filter((row) => row.hash !== '').map((row) => row.hash),
    )
    const planItems: PlanItem[] = rows.map((row) => ({
      id: row.id,
      origin: row.item.origin,
      reason: row.item.reason,
      no: row.item.no,
      rule: row.rule,
      cached: row.hash !== '' && cached.has(`${String(row.item.no ?? 0)}\u0000${row.hash}`),
      // 유튜브 줄의 글은 plan에도 넘기지 않는다 (youtube: true면 어차피 보내지 않는다)
      text: row.item.youtube ? '' : (row.item.text ?? ''),
      youtube: row.item.youtube,
    }))
    // 상한은 아래 #reserve가 락 안에서 센다 — 여기서는 보낼 것이 있는지만 본다
    const { send } = planAssist({ enabled: true, hasKey: true, usedToday: 0, dailyLimit: 1, globalUsed: 0, globalLimit: 1, batchMax: this.#batchMax, items: planItems })
    if (send.length === 0) return 'none'
    // 마지막 안전장치 (D-AIY1-02): 유튜브 줄이 고른 목록에 있으면 부르지 않는다 (planAssist가 이미 거른다 — 상한·기록보다 먼저)
    if (send.some((id) => rows.find((row) => row.id === id)?.item.youtube !== false)) return 'none'
    // 부르기 직전에 켬을 다시 읽는다 (끄면 그 순간부터 새 호출 없음, AC-A1-08)
    if (!(await this.#row(sellerId)).enabled) return 'disabled'
    const callId = await this.#reserve(sellerId, send.length)
    if (callId === null) return 'limit'
    const chosen = send.map((id, index) => {
      const row = rows.find((candidate) => candidate.id === id) as (typeof rows)[number]
      return { requestId: String(index + 1), row }
    })
    let reply
    try {
      await this.#hooks.beforeCall?.()
      reply = await adapter.suggest({
        catalog: context.catalog,
        items: chosen.map(({ requestId, row }) => ({ id: requestId, ...(row.item.no === null ? {} : { no: row.item.no }), text: row.redacted })),
        maxQuantity: context.settings['claim.maxQuantity'],
      })
    } catch (error) {
      this.#log({ level: 'warn', code: 'ASSIST_FAILED', seller: sellerId, errorKind: errorKind(error) })
      reply = { ok: false as const, failure: 'NETWORK' as const, status: null }
    }
    const finishedAt = new Date(this.#clock.now())
    if (!reply.ok) {
      await this.#db.update(assistCalls).set({ ok: false, failure: reply.failure, finishedAt }).where(eq(assistCalls.id, callId))
      if (reply.failure === 'HTTP') this.#log({ level: 'warn', code: 'ASSIST_HTTP_ERROR', seller: sellerId, ...(reply.status === null ? {} : { status: reply.status }) })
      else this.#log({ level: 'warn', code: reply.failure === 'TIMEOUT' ? 'ASSIST_TIMEOUT' : 'ASSIST_NETWORK', seller: sellerId })
      return 'failed'
    }
    const checked = validateResponse(
      chosen.map(({ requestId, row }) => ({ id: requestId, ...(row.item.no === null ? {} : { no: row.item.no }) })),
      reply.text,
      context.catalog,
      context.settings['claim.maxQuantity'],
    )
    const now = new Date(this.#clock.now())
    const values = chosen.map(({ requestId, row }) => {
      const suggestion = checked[requestId] ?? null
      return {
        sellerId,
        scopeDate: scope.date,
        rehearsal: scope.rehearsal,
        broadcastId: broadcast,
        textHash: row.hash,
        no: row.item.no ?? 0,
        suggestion: suggestion === null ? null : JSON.stringify(suggestion),
        createdAt: now,
      }
    })
    await this.#db.insert(assistCache).values(values).onConflictDoNothing()
    const { usage } = reply
    await this.#db
      .update(assistCalls)
      .set({ ok: true, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens, finishedAt })
      .where(eq(assistCalls.id, callId))
    const rejected = values.filter((value) => value.suggestion === null).length
    if (rejected > 0) this.#log({ level: 'info', code: 'ASSIST_NO_SUGGESTION', seller: sellerId, count: rejected })
    return 'called'
  }

  /** 오늘(KST) 서버 전체 호출 수 (운영 상태용) */
  async globalUsedToday(): Promise<number> {
    const rows = await this.#db
      .select({ n: sql<number>`count(*)::int` })
      .from(assistCalls)
      .where(eq(assistCalls.day, this.#today()))
    return rows[0]?.n ?? 0
  }
}

/** 시험용 키 없음 설정 */
export const NO_ASSIST: AssistSetup = Object.freeze({ apiKey: null })
