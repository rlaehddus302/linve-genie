// 감사 채팅 정정 (D-RETRO-105, DOMAIN_RULES R-13 "게시 뒤 감사 정정", SPEC AC5).
// 이미 올라간 실시간 채팅 감사 글에 든 값(번호·품종·옵션·수량·금액·찜한 사람)이 판매자가 고쳐 달라지면, 그 글을 지우고 고친 글을 새로 올린다.
// - 엔진 효과가 아니다: 엔진은 그대로 순수하고(게시된 감사 효과는 완료 그대로), 발송함 실행기가 바퀴마다 지금 엔진 상태와 올라간 글을 견줘 정정 줄을 만든다.
// - 판매자가 켠 실제 운영에서만(절대 규칙 7): 실제 범위(리허설·복구 아님)에서 서버가 올린 감사만, 그 방송이 고침 따라가기(thanks.followEdits)를 켰을 때,
//   이은 방송이 살아 있고 채팅이 끝나지 않았을 때, 공식 경로면 지금 실시간 채팅 게시 동의·게시 권한·같은 채널일 때만 한다.
// - 연달아 고치면 한 번만: 줄은 글 하나에 하나이고, 기다리는 동안 고친 값이 또 바뀌면 다시 10초를 기다린다(처음부터 60초까지). 할 때 지금 값으로 다시 정한다.
// - 지우기 → 새 글. 지우지 못하면 새 글 앞에 "[수정] "을 붙이고, 빠진 감사(확정이 풀린 찜)는 "[수정] 앞 글의 … 감사는 잘못 올라갔어요"로 알린다.
// - 새 글은 한 번만 올린다: 응답을 모르면(시간 초과·연결 끊김·5xx) 다시 올리지 않는다. 확실히 올라가지 않은 실패(속도 제한·로그인)만 다시 한다.
// - 새 글은 우리 글이다: 올리기 전에 글을 적어 두어 수집기가 찜으로 읽지 않는다(isOurPost).
import { formatThanksHead, getBroadcast, getBuyer, listClaims, listEffects, listProducts, type EngineState } from '@livejjim/core'
import type { Db } from '../db/database.ts'
import { errorKind, type LogSink } from '../log.ts'
import type { ScopeWriter } from '../writer.ts'
import { ChatSendError, NOT_POSTED, type ChatSender, type ChatSendRoute } from './chat-send/sender.ts'
import { ChannelMismatchError, YoutubeAccessError, type YoutubeConnections } from './connect.ts'
import { GoogleError, POST_TIMEOUT_MS, type GoogleClient } from './google.ts'
import { jsonStrings, recentSentLiveThanks, type RunnerRow } from './outbox-store.ts'
import type { QuotaMeter } from './quota.ts'
import { activeLink, insertOwnMessage, type LinkRow } from './store.ts'
import { LIVE_CHAT_MAX, THANKS_SUFFIX, batchMessages, charCount, cleanPostText, truncate } from './texts.ts'
import { deleteFix, dueFixes, insertFix, recentFixes, staleFixes, updateFix, type FixChange, type FixRow } from './thanks-fix-store.ts'
import type { Timer } from './timer.ts'

/** 올라간 지 이만큼 안의 감사만 고친다 */
export const FIX_WINDOW_MS = 30 * 60 * 1000
/** 마지막 고침 뒤 이만큼 기다렸다 한 번 (운영 감사 묶음 창과 같은 10초, D-RETRO-01) */
export const FIX_SETTLE_MS = 10_000
/** 연달아 고쳐도 처음 고침에서 이만큼이 지나면 한다 */
export const FIX_MAX_WAIT_MS = 60_000
/** 지우지 못했을 때 새 글 앞말 */
export const FIX_PREFIX = '[수정] '
/** 확실히 올라가지 않은 실패·지우기 실패의 다시 하기 (2·4·8초) */
export const FIX_MAX_RETRIES = 3
/** 하는 중 임대 */
export const FIX_LEASE_MS = 60_000
/** 지우기·할당량 기다림 다시 보기 */
const FIX_RECHECK_MS = 5000

const NAME_SUFFIX = `님${THANKS_SUFFIX}`

/** 고칠 글 하나 (처음 올린 감사의 묶음 메시지, 또는 앞 정정이 올린 글) */
export interface PostedThanks {
  readonly source: string
  readonly sellerId: string
  readonly scopeId: string
  readonly date: string
  readonly broadcastId: string
  readonly effectIds: readonly string[]
  /** 효과마다 올린 때의 감사 문구 (처음 올린 감사는 비워 두면 엔진의 문구 — 게시된 효과의 문구는 그 뒤 바뀌지 않는다) */
  readonly oldTexts: readonly (string | null)[]
  /** 처음 올린 감사의 실제 글 (묶음 문구). 앞 정정의 글이면 null */
  readonly oldMessage: string | null
  readonly remoteIds: readonly (string | null)[]
}

export interface FixPlan {
  /** 올라간 글과 지금 값이 다른가 */
  readonly changed: boolean
  /** 새 글에 남는 효과와 고친 문구 (글 안 순서) */
  readonly kept: readonly (readonly [string, string])[]
  /** 빠지는 감사(확정이 풀린 찜)의 올린 때 문구 */
  readonly removed: readonly string[]
  /** 효과마다 올린 때의 문구 (줄에 적는다) */
  readonly oldTexts: readonly string[]
}

/**
 * 감사 문구의 이름 뒤 부분(`{구매자}님 구매 감사합니다`)을 올린 문구에서 찾는다 — 이름은 올린 때의 것 그대로 둔다(R-13 "구매자 이름은 효과가 나온 때의 것").
 * 그 구매자의 표시 이름·이름 이력 중 문구 끝에 맞고 그 앞이 금액(`…원 `)으로 끝나는 것(긴 이름부터). 없으면 문구 모양(`{번호}번 … {금액}원 {이름}님 구매 감사합니다`)으로, 그것도 안 되면 null(고치지 않는다)
 */
export function thanksTail(text: string, names: readonly string[]): string | null {
  for (const name of [...new Set(names)].sort((a, b) => b.length - a.length)) {
    const tail = `${name}${NAME_SUFFIX}`
    if (name !== '' && text.endsWith(tail) && /원 $/u.test(text.slice(0, -tail.length))) return tail
  }
  const match = /^\d+번 .*?\d[\d,]*원 (.+님 구매 감사합니다)$/u.exec(text)
  return match?.[1] ?? null
}

/** 한 건 문구의 항목(끝말 `구매 감사합니다` 뗀 것) */
const itemOf = (text: string): string => {
  const clean = cleanPostText(text)
  return clean.endsWith(THANKS_SUFFIX) ? clean.slice(0, -THANKS_SUFFIX.length) : clean
}

/** 남은 감사로 만든 글 (묶음 문구 — 처음 올릴 때와 같은 규칙, 200자 넘으면 나눔) */
function compose(kept: readonly (readonly [string, string])[], max = LIVE_CHAT_MAX): string[] {
  return batchMessages(kept.map(([, text], index) => ({ id: index, text })), max).map((message) => message.text)
}

/**
 * 고칠지 정한다 (순수 함수). 그 방송이 고침 따라가기를 켜지 않았거나 효과를 찾을 수 없으면 null(아무것도 하지 않는다).
 * 효과마다: 그 찜이 아직 그 확정(확정버전)이면 지금 번호·품종·옵션 글·수량·단가로 앞머리를 다시 만들고 이름 뒤는 올린 문구 그대로, 확정이 풀렸으면 뺀다.
 * 다른가: 처음 올린 감사는 새로 만든 글이 실제로 올린 글과 다르면(빠진 감사가 있어도), 앞 정정의 글은 효과마다 문구가 다르면
 */
export function planFix(state: EngineState, posted: PostedThanks): FixPlan | null {
  if (getBroadcast(state, posted.broadcastId)?.settings['thanks.followEdits'] !== true) return null
  const effects = new Map(listEffects(state).map((effect) => [effect.id, effect]))
  const claims = new Map(listClaims(state).map((claim) => [claim.id, claim]))
  const products = new Map(listProducts(state).map((product) => [product.key, product]))
  const kept: [string, string][] = []
  const removed: string[] = []
  const oldTexts: string[] = []
  let itemChanged = false
  for (const [index, id] of posted.effectIds.entries()) {
    const effect = effects.get(id)
    const old = posted.oldTexts[index] ?? effect?.text ?? null
    if (effect === undefined || effect.kind !== 'POST_THANKS' || old === null) return null
    oldTexts.push(old)
    const claim = claims.get(effect.claim)
    if (claim === undefined || claim.status !== 'CONFIRMED' || claim.confirmVersion !== effect.confirmVersion || claim.price === null) {
      removed.push(old)
      continue
    }
    const product = products.get(claim.product)
    const buyer = getBuyer(state, claim.buyer)
    const names = claim.origin === 'sms' || buyer?.kind === 'sms' ? ['문자찜'] : buyer === null ? [] : [buyer.display, ...buyer.nameHistory]
    const tail = thanksTail(old, names)
    if (product === undefined || tail === null) {
      // 고칠 값을 정할 수 없다 — 올린 문구 그대로 둔다(이름 자리를 짐작하지 않는다)
      kept.push([id, old])
      continue
    }
    const text = `${formatThanksHead({ no: product.no, name: product.name, price: claim.price, optionText: claim.variant, qty: claim.qty })}${tail}`
    if (text !== old) itemChanged = true
    kept.push([id, text])
  }
  let changed: boolean
  if (removed.length > 0) changed = true
  else if (posted.oldMessage !== null) {
    const messages = compose(kept)
    changed = messages.length !== 1 || messages[0] !== posted.oldMessage
  } else changed = itemChanged
  return { changed, kept, removed, oldTexts }
}

/**
 * 새로 올릴 글. 지웠으면 남은 감사를 처음과 같은 묶음 글로. 지우지 못했으면 글마다 앞에 "[수정] "(200자 안에 들게 묶음을 나눔)을 붙이고,
 * 빠진 감사가 있으면 "[수정] 앞 글의 {번호}번 … {구매자}님 감사는 잘못 올라갔어요"를 덧붙인다(손님이 앞 글이 틀렸음을 알게)
 */
export function fixMessages(kept: readonly (readonly [string, string])[], removed: readonly string[], deleted: boolean): string[] {
  if (deleted) return compose(kept)
  const out = compose(kept, LIVE_CHAT_MAX - charCount(FIX_PREFIX)).map((text) => `${FIX_PREFIX}${text}`)
  if (removed.length > 0) out.push(truncate(`${FIX_PREFIX}앞 글의 ${removed.map(itemOf).join(', ')} 감사는 잘못 올라갔어요`, LIVE_CHAT_MAX))
  return out
}

/** JSON 칸 → 값 (깨졌으면 기본값) */
function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const pairsOf = (value: string): [string, string][] =>
  parseJson<unknown[]>(value, []).filter((item): item is [string, string] => Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string')

const idsOf = (value: string): (string | null)[] => parseJson<unknown[]>(value, []).map((item) => (typeof item === 'string' && item !== '' ? item : null))

/** 정정 줄 → 고칠 글 */
function postedOfFix(fix: FixRow): PostedThanks {
  return {
    source: fix.source,
    sellerId: fix.sellerId,
    scopeId: fix.scopeId,
    date: fix.date,
    broadcastId: fix.broadcastId,
    effectIds: jsonStrings(fix.effectIds),
    oldTexts: jsonStrings(fix.oldTexts),
    oldMessage: fix.oldMessage,
    remoteIds: idsOf(fix.oldRemoteIds),
  }
}

type Route = { readonly kind: 'official'; readonly channelId: string } | { readonly kind: 'bot'; readonly sender: ChatSender } | { readonly kind: 'wait' } | { readonly kind: 'none'; readonly reason: string }

/** 지우기·올리기 결과: 됨 · 다시 하면 됨(확실히 하지 못함) · 모름(올라갔을 수 있다 — 다시 하지 않는다) · 안 됨 */
type Outcome = { readonly kind: 'ok'; readonly id: string | null; readonly author: string | null } | { readonly kind: 'retry' } | { readonly kind: 'unknown' } | { readonly kind: 'rejected'; readonly reason: string }

export interface ThanksFixerOptions {
  readonly db: Db
  readonly timer: Timer
  readonly log: LogSink
  readonly writer: ScopeWriter
  readonly connections: YoutubeConnections
  readonly google: GoogleClient
  readonly quota: QuotaMeter
  /** 이 서버의 이름 (하는 중 임대 주인) */
  readonly owner: string
  readonly chatSend?: ChatSendRoute
  readonly postTimeoutMs?: number
  /** 지금 요청을 끊는 신호 (실행기가 멈출 때) */
  readonly signal: () => AbortSignal
  /** 실행기가 죽은 것처럼 멈췄으면 던진다 (더 쓰지 않는다) */
  readonly check: () => void
  /** 실행기가 죽은 것처럼 멈췄나 */
  readonly killed: () => boolean
}

export class ThanksFixer {
  readonly #options: ThanksFixerOptions
  /** 범위마다 마지막으로 본 (엔진 seq, 글 목록) — 그대로면 다시 견주지 않는다 */
  readonly #seen = new Map<string, string>()

  constructor(options: ThanksFixerOptions) {
    this.#options = options
  }

  /** 한 바퀴: 멈췄던 줄 정리 → 고칠 글 찾기 → 때가 된 줄 하기 */
  async run(): Promise<void> {
    await this.#recover()
    await this.#detect()
    await this.#runDue()
  }

  #now(): Date {
    return new Date(this.#options.timer.now())
  }

  async #update(fix: Pick<FixRow, 'sellerId' | 'id'>, change: FixChange, expect: Parameters<typeof updateFix>[5]): Promise<boolean> {
    this.#options.check()
    return updateFix(this.#options.db, fix.sellerId, fix.id, change, this.#now(), expect)
  }

  // ── 고칠 글 찾기 ─────────────────────────────────────────────────────

  async #detect(): Promise<void> {
    const { db, writer } = this.#options
    const now = this.#now()
    const since = new Date(now.getTime() - FIX_WINDOW_MS)
    const sent = await recentSentLiveThanks(db, since)
    const fixes = await recentFixes(db, since)
    if (sent.length === 0 && fixes.length === 0) return
    const fixBySource = new Map(fixes.map((fix) => [`${fix.sellerId}|${fix.source}`, fix]))
    const messages: PostedThanks[] = []
    // 처음 올린 감사: 메시지(묶음)마다
    const groups = new Map<string, RunnerRow[]>()
    for (const row of sent) {
      const key = `${row.sellerId}|${row.groupId ?? `r${String(row.id)}`}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    for (const rows of groups.values()) {
      const first = rows[0] as RunnerRow
      if (first.broadcastId === null) continue
      messages.push({
        source: `outbox:${first.groupId ?? `r${String(first.id)}`}`,
        sellerId: first.sellerId,
        scopeId: first.scopeId,
        date: first.date,
        broadcastId: first.broadcastId,
        effectIds: rows.map((row) => row.effectId),
        oldTexts: [],
        oldMessage: first.sentText,
        remoteIds: [first.remoteId],
      })
    }
    // 앞 정정이 올린 글
    for (const fix of fixes) {
      if (fix.state !== 'DONE' || fix.doneAt === null || fix.doneAt.getTime() < since.getTime()) continue
      const pairs = pairsOf(fix.newTexts)
      if (pairs.length === 0) continue
      messages.push({
        source: `fix:${String(fix.id)}`,
        sellerId: fix.sellerId,
        scopeId: fix.scopeId,
        date: fix.date,
        broadcastId: fix.broadcastId,
        effectIds: pairs.map(([id]) => id),
        oldTexts: pairs.map(([, text]) => text),
        oldMessage: null,
        remoteIds: idsOf(fix.newRemoteIds),
      })
    }
    // 아직 고치지 않은 글과, 기다리는 중(아직 지우지 않은) 정정의 글만
    const open = messages.filter((message) => {
      const fix = fixBySource.get(`${message.sellerId}|${message.source}`)
      return fix === undefined || (fix.state === 'WAITING' && fix.deleted === null)
    })
    const byScope = new Map<string, PostedThanks[]>()
    for (const message of open) {
      const key = `${message.sellerId}|${message.date}`
      byScope.set(key, [...(byScope.get(key) ?? []), message])
    }
    const links = new Map<string, LinkRow | null>()
    for (const [key, list] of byScope) {
      const first = list[0] as PostedThanks
      const runtime = await writer.read(first.sellerId, first.date, false)
      const signature = `${String(runtime.seq)}|${list.map((message) => `${message.source}:${fixBySource.get(`${message.sellerId}|${message.source}`)?.newTexts ?? ''}`).join(',')}`
      if (this.#seen.get(key) === signature) continue
      this.#seen.set(key, signature)
      for (const message of list) {
        const plan = planFix(runtime.state, message)
        const fix = fixBySource.get(`${message.sellerId}|${message.source}`)
        if (plan === null) continue
        if (!plan.changed) {
          // 기다리는 동안 처음 값으로 돌아왔다 — 하지 않는다
          if (fix !== undefined) await this.#drop(fix, 'WAITING')
          continue
        }
        const planned = JSON.stringify(plan.kept)
        if (fix !== undefined) {
          if (fix.newTexts === planned) continue
          // 기다리는 동안 또 고쳤다 — 마지막 고침에서 다시 기다린다(처음 고침에서 60초까지)
          const nextAt = new Date(Math.min(now.getTime() + FIX_SETTLE_MS, fix.createdAt.getTime() + FIX_MAX_WAIT_MS))
          await this.#update(fix, { newTexts: planned, nextAt }, { state: 'WAITING' })
          continue
        }
        // 이은 방송이 살아 있고 채팅이 끝나지 않았을 때만 줄을 만든다
        const linkKey = `${message.sellerId}|${message.broadcastId}`
        if (!links.has(linkKey)) links.set(linkKey, await activeLink(db, message.sellerId, message.broadcastId))
        const link = links.get(linkKey) ?? null
        if (link === null || link.chatEndedAt !== null) continue
        this.#options.check()
        await insertFix(db, {
          sellerId: message.sellerId,
          scopeId: message.scopeId,
          broadcastId: message.broadcastId,
          source: message.source,
          effectIds: message.effectIds,
          oldTexts: plan.oldTexts,
          oldMessage: message.oldMessage,
          oldRemoteIds: message.remoteIds,
          newTexts: planned,
          nextAt: new Date(now.getTime() + FIX_SETTLE_MS),
          now,
        })
      }
    }
  }

  // ── 하기 ─────────────────────────────────────────────────────────────

  /** 서버가 하던 중에 멈춘 줄: 지우기 전이면 처음부터, 새 글을 올리던 중이면 올라갔는지 몰라 다시 하지 않는다, 다 올렸으면 마침 */
  async #recover(): Promise<void> {
    for (const fix of await staleFixes(this.#options.db, this.#now())) {
      const planned = jsonStrings(fix.sentTexts).length
      const posted = idsOf(fix.newRemoteIds).length
      const expect = { state: 'WORKING' as const, ...(fix.leaseOwner === null ? {} : { leaseOwner: fix.leaseOwner }) }
      if (fix.deleted === null) await this.#update(fix, { state: 'WAITING', nextAt: this.#now(), leaseOwner: null, leaseUntil: null }, expect)
      else if (posted < planned) await this.#finish(fix, 'FAILED', 'UNCONFIRMED', expect)
      else await this.#finish(fix, 'DONE', null, expect)
    }
  }

  async #runDue(): Promise<void> {
    const { owner } = this.#options
    for (const fix of await dueFixes(this.#options.db, this.#now())) {
      const now = this.#now()
      if (!(await this.#update(fix, { state: 'WORKING', leaseOwner: owner, leaseUntil: new Date(now.getTime() + FIX_LEASE_MS) }, { state: 'WAITING' }))) continue
      try {
        await this.#work(fix)
      } catch (error) {
        if (this.#options.killed()) throw error
        this.#options.log({ level: 'error', code: 'OUTBOX_ERROR', seller: fix.sellerId, errorKind: errorKind(error) })
        await this.#retry(fix, fix.attempts + 1)
      }
    }
  }

  /** 아무것도 하지 않은 줄을 지운다 (그사이 올린 값으로 돌아옴) — 그 글을 다음에 또 고치면 새 줄로 처음부터 기다린다 */
  async #drop(fix: FixRow, state: 'WAITING' | 'WORKING'): Promise<void> {
    this.#options.check()
    await deleteFix(this.#options.db, fix.sellerId, fix.id, state === 'WAITING' ? { state } : { state, leaseOwner: this.#options.owner })
  }

  async #finish(fix: FixRow, state: 'DONE' | 'FAILED' | 'SKIPPED', reason: string | null, expect: Parameters<typeof updateFix>[5] = { state: 'WORKING', leaseOwner: this.#options.owner }): Promise<void> {
    const changed = await this.#update(fix, { state, reason, nextAt: null, leaseOwner: null, leaseUntil: null, ...(state === 'DONE' ? { doneAt: this.#now() } : {}) }, expect)
    if (!changed) return
    if (state === 'DONE') this.#options.log({ level: 'info', code: 'THANKS_FIX_DONE', seller: fix.sellerId, date: fix.date })
    if (state === 'FAILED') this.#options.log({ level: 'warn', code: 'THANKS_FIX_FAILED', seller: fix.sellerId, date: fix.date, ...(reason === null ? {} : { reason }) })
  }

  /** 다시 하기 (2·4·8초, 3번 넘으면 그만) — 지금까지 한 것(지움·올린 글)은 줄에 남아 있어 이어서 한다 */
  async #retry(fix: FixRow, attempts: number): Promise<void> {
    if (attempts > FIX_MAX_RETRIES) return this.#finish(fix, 'FAILED', 'GAVE_UP')
    await this.#update(
      fix,
      { state: 'WAITING', attempts, nextAt: new Date(this.#now().getTime() + 2 ** attempts * 1000), leaseOwner: null, leaseUntil: null },
      { state: 'WORKING', leaseOwner: this.#options.owner },
    )
  }

  async #work(fix: FixRow): Promise<void> {
    const { db, writer, owner } = this.#options
    const link = await activeLink(db, fix.sellerId, fix.broadcastId)
    if (link === null) return this.#finish(fix, 'FAILED', 'NO_LINK')
    if (link.chatEndedAt !== null) return this.#finish(fix, 'FAILED', 'CHAT_ENDED')
    const route = await this.#route(fix.sellerId, link)
    if (route.kind === 'none') return this.#finish(fix, 'FAILED', route.reason)
    if (route.kind === 'wait') {
      await this.#update(fix, { state: 'WAITING', nextAt: new Date(this.#now().getTime() + FIX_RECHECK_MS), leaseOwner: null, leaseUntil: null }, { state: 'WORKING', leaseOwner: owner })
      return
    }
    let deleted = fix.deleted
    let sentTexts = jsonStrings(fix.sentTexts)
    let attempts = fix.attempts
    if (deleted === null) {
      // 처음 하기: 지금 값으로 다시 정한다(기다리는 동안의 마지막 고침) → 지우기 → 올릴 글을 정해 적는다
      const runtime = await writer.read(fix.sellerId, fix.date, false)
      const plan = planFix(runtime.state, postedOfFix(fix))
      if (plan === null) return this.#finish(fix, 'SKIPPED', 'UNKNOWN')
      if (!plan.changed) return this.#drop(fix, 'WORKING')
      const removal = await this.#removeAll(route, link, fix, idsOf(fix.oldRemoteIds))
      if (removal === 'retry' && fix.attempts + 1 <= FIX_MAX_RETRIES) return this.#retry(fix, fix.attempts + 1)
      deleted = removal === 'deleted'
      sentTexts = fixMessages(plan.kept, plan.removed, deleted)
      const saved = await this.#update(
        fix,
        { deleted, sentTexts: JSON.stringify(sentTexts), newTexts: JSON.stringify(plan.kept), attemptAt: this.#now(), attempts: 0 },
        { state: 'WORKING', leaseOwner: owner },
      )
      if (!saved) return
      attempts = 0
    } else {
      // 다시 하기: 지난번에 정한 글을 이어 올린다 (우리 글로 거르는 기준 시각을 새로)
      if (!(await this.#update(fix, { attemptAt: this.#now() }, { state: 'WORKING', leaseOwner: owner }))) return
    }
    const ids = idsOf(fix.newRemoteIds)
    for (let index = ids.length; index < sentTexts.length; index++) {
      const text = sentTexts[index] as string
      const outcome = await this.#post(route, link, fix, text)
      this.#options.check()
      if (outcome.kind === 'ok') {
        ids.push(outcome.id)
        if (outcome.id !== null) {
          await insertOwnMessage(db, { sellerId: fix.sellerId, scopeId: fix.scopeId, linkId: link.id, liveChatId: link.liveChatId, authorChannelId: outcome.author, messageId: outcome.id, text, publishedAt: this.#now() })
        }
        await this.#update(fix, { newRemoteIds: JSON.stringify(ids) }, { state: 'WORKING', leaseOwner: owner })
        continue
      }
      if (outcome.kind === 'retry') return this.#retry(fix, attempts + 1)
      return this.#finish(fix, 'FAILED', outcome.kind === 'unknown' ? 'UNCONFIRMED' : outcome.reason)
    }
    await this.#finish(fix, 'DONE', deleted ? null : 'NOT_DELETED')
  }

  /**
   * 어느 길로 지우고 올리나 — 그 판매자의 실시간 채팅 감사가 가는 길과 같다(봇 길이 있으면 봇, 아니면 공식).
   * 공식: 지금 연결이 살아 있고, 실시간 채팅 게시 동의가 켜져 있고, 게시 권한이 있고, 그 방송을 이은 채널 = 지금 연결한 채널일 때만. 할당량 멈춤이면 기다린다
   */
  async #route(sellerId: string, link: LinkRow): Promise<Route> {
    const sender = this.#options.chatSend?.senderFor(sellerId) ?? null
    if (sender !== null) return { kind: 'bot', sender }
    const connection = await this.#options.connections.row(sellerId)
    if (connection === null || connection.consentLiveChatAt === null) return { kind: 'none', reason: 'NO_CONSENT' }
    if (connection.status !== 'CONNECTED') return { kind: 'none', reason: 'RECONNECT' }
    if (!connection.canPublish) return { kind: 'none', reason: 'NO_PERMISSION' }
    if (link.channelId !== null && link.channelId !== connection.channelId) return { kind: 'none', reason: 'NOT_MY_CHANNEL' }
    if ((await this.#options.quota.mode(sellerId)) === 'PAUSED') return { kind: 'wait' }
    return { kind: 'official', channelId: link.channelId ?? connection.channelId }
  }

  /** 올라간 글을 모두 지운다: 모두 지움(이미 없음 포함) · 다시 하면 될 실패가 있음 · 지울 수 없음(메시지 ID 모름·권한 없음·지우는 길이 없음) */
  async #removeAll(route: Route, link: LinkRow, fix: FixRow, remoteIds: readonly (string | null)[]): Promise<'deleted' | 'retry' | 'failed'> {
    if (remoteIds.length === 0 || remoteIds.some((id) => id === null)) return 'failed'
    let result: 'deleted' | 'retry' | 'failed' = 'deleted'
    for (const id of remoteIds) {
      const outcome = await this.#remove(route, link, fix, id as string)
      this.#options.check()
      if (outcome.kind === 'retry' || outcome.kind === 'unknown') result = result === 'failed' ? 'failed' : 'retry'
      else if (outcome.kind === 'rejected') result = 'failed'
    }
    return result
  }

  async #remove(route: Route, link: LinkRow, fix: FixRow, messageId: string): Promise<Outcome> {
    const { connections, google, quota, log } = this.#options
    if (route.kind === 'bot') {
      if (route.sender.remove === undefined) return { kind: 'rejected', reason: 'NOT_SUPPORTED' }
      try {
        await route.sender.remove({ videoId: link.videoId, channelId: link.broadcastChannelId, liveChatId: link.liveChatId }, messageId, this.#options.signal())
        return { kind: 'ok', id: null, author: null }
      } catch (error) {
        return chatSendOutcome(error)
      }
    }
    if (route.kind !== 'official') return { kind: 'rejected', reason: 'NO_ROUTE' }
    try {
      await connections.withChannelToken(fix.sellerId, route.channelId, (token) =>
        google.api({
          sellerId: fix.sellerId,
          method: 'liveChatMessages.delete',
          accessToken: token,
          httpMethod: 'DELETE',
          path: '/liveChat/messages',
          query: { id: messageId },
          timeoutMs: this.#options.postTimeoutMs ?? POST_TIMEOUT_MS,
          signal: this.#options.signal(),
        }),
      )
      return { kind: 'ok', id: null, author: null }
    } catch (error) {
      // 이미 없다(판매자가 지웠거나 앞 시도가 지웠다) — 지운 것으로 본다
      if (error instanceof GoogleError && error.status === 404) return { kind: 'ok', id: null, author: null }
      log({ level: 'warn', code: 'YOUTUBE_API_FAILED', seller: fix.sellerId, errorKind: errorKind(error), ...(error instanceof GoogleError && error.status !== null ? { status: error.status } : {}) })
      if (error instanceof GoogleError && error.reason === 'quotaExceeded') await quota.markExceeded(fix.sellerId)
      return googleOutcome(error)
    }
  }

  async #post(route: Route, link: LinkRow, fix: FixRow, text: string): Promise<Outcome> {
    const { connections, google, quota, log } = this.#options
    if (route.kind === 'bot') {
      try {
        const result = await route.sender.send({ videoId: link.videoId, channelId: link.broadcastChannelId, liveChatId: link.liveChatId }, text, this.#options.signal())
        return { kind: 'ok', id: result.messageId, author: result.authorChannelId ?? route.sender.authorChannelId }
      } catch (error) {
        return chatSendOutcome(error)
      }
    }
    if (route.kind !== 'official') return { kind: 'rejected', reason: 'NO_ROUTE' }
    if (link.liveChatId === '') return { kind: 'rejected', reason: 'REJECTED' }
    try {
      const body = await connections.withChannelToken(fix.sellerId, route.channelId, (token) =>
        google.api({
          sellerId: fix.sellerId,
          method: 'liveChatMessages.insert',
          accessToken: token,
          httpMethod: 'POST',
          path: '/liveChat/messages',
          query: { part: 'snippet' },
          body: { snippet: { liveChatId: link.liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText: text } } },
          timeoutMs: this.#options.postTimeoutMs ?? POST_TIMEOUT_MS,
          signal: this.#options.signal(),
        }),
      )
      return { kind: 'ok', id: typeof body.id === 'string' && body.id !== '' ? body.id : null, author: route.channelId }
    } catch (error) {
      log({ level: 'warn', code: 'YOUTUBE_API_FAILED', seller: fix.sellerId, errorKind: errorKind(error), ...(error instanceof GoogleError && error.status !== null ? { status: error.status } : {}) })
      if (error instanceof GoogleError && error.reason === 'quotaExceeded') await quota.markExceeded(fix.sellerId)
      const outcome = googleOutcome(error)
      // 5xx는 올라갔을 수 있다 — 새 글은 다시 올리지 않는다
      return error instanceof GoogleError && error.kind === 'http' && (error.status ?? 0) >= 500 ? { kind: 'unknown' } : outcome
    }
  }
}

/** 공식 API 실패 → 결과. 시간 초과·연결 끊김은 모름, 5xx·429·속도 제한·할당량·401은 다시, 채팅 끝남은 CHAT_ENDED, 권한·채널 문제와 그 밖은 안 됨 */
function googleOutcome(error: unknown): Outcome {
  if (error instanceof ChannelMismatchError) return { kind: 'rejected', reason: 'NOT_MY_CHANNEL' }
  if (error instanceof YoutubeAccessError) return { kind: 'rejected', reason: 'RECONNECT' }
  if (!(error instanceof GoogleError)) return { kind: 'unknown' }
  if (error.kind === 'timeout' || error.kind === 'network') return { kind: 'unknown' }
  const reason = error.reason
  if (reason === 'liveChatEnded' || reason === 'liveChatDisabled' || reason === 'liveChatNotFound') return { kind: 'rejected', reason: 'CHAT_ENDED' }
  const status = error.status ?? 0
  if (status >= 500 || status === 429 || status === 401 || reason === 'quotaExceeded' || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') return { kind: 'retry' }
  if (status === 403) return { kind: 'rejected', reason: 'NO_PERMISSION' }
  return { kind: 'rejected', reason: 'REJECTED' }
}

/** 다른 길 실패 → 결과. 확실히 올라가지 않은 것(로그인·속도 제한·막힘)은 다시, 응답을 모르면 모름, 채팅 끝남·그 밖의 거절은 안 됨 */
function chatSendOutcome(error: unknown): Outcome {
  if (!(error instanceof ChatSendError)) return { kind: 'unknown' }
  if (NOT_POSTED.has(error.kind)) return { kind: 'retry' }
  if (error.kind === 'ended') return { kind: 'rejected', reason: 'CHAT_ENDED' }
  if (error.kind === 'rejected') return { kind: 'rejected', reason: 'REJECTED' }
  return { kind: 'unknown' }
}
