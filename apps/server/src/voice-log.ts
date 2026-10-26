// 음성 등록·고침 기록 (V3, DOMAIN_RULES R-25, D-V3-64·D-V3-65, AC-V3-70).
// - 음성(화면이 상품 등록·고치기·번호 바꾸기·판매 종료 쓰기에 voiceLog 칸을 실어 보냄)으로 일어난 일을 한 줄씩 남긴다(출처 voice만 — 판매자 채팅 읽기는 D-V3-68로 없앰).
//   판정 엔진 이벤트와 별개인 서버 기록이다. 같은 기록 트랜잭션 안에서 상품 명령(이벤트 행)보다 먼저 넣고(입력 우선 기록), 명령이 실패로 기록되거나
//   기록되지 못했으면(거절·저장 실패) 줄에 실패 표시를 단다.
// - 상품 상태(전 값·찜 수)는 그 범위의 지금 상태를 코어 조회(getProduct·listClaims)로 읽는다 — 서버에 판정을 두지 않는다.
// - "크게 바뀜"(R-25): 등록 가격 > 3,000,000원 · 가격 고침 새 가격 > 3,000,000원 또는 새 > 전 × 3 또는 새 × 3 < 전 (정수 비교).
// - 들은 말: 화면이 가린(D-V3-56) 한 줄. 서버는 문자열·300글자(코드 포인트)를 검사하고, 저장 전에 제어 문자를 빼고(줄바꿈 → 공백) 긴 숫자를 한 번 더 가린다.
//   로그에는 들은 말·품종·닉네임을 남기지 않는다(코드·방송·번호·한 일만).
// - 모든 질의에 판매자 ID 조건을 건다.
import { formatWon, getProduct, listClaims, type ClaimStatus, type EngineState } from '@livejjim/core'
import type { VoiceLedgerMark, VoiceLedgerRow } from '@livejjim/documents'
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm'
import { isPlainObject, own, ownKeys } from './api-fields.ts'
import type { Db } from './db/database.ts'
import { voiceLog } from './db/schema.ts'
import type { FieldProblem } from './errors.ts'
import type { Actor, CommittedRecord } from './writer.ts'

/** 들은 말 상한 (R-25 — 300글자, 코드 포인트) */
export const VOICE_LOG_HEARD_MAX = 300
/** 크게 바뀜 가격 선 (R-25, D-V3-64) */
export const VOICE_LOG_BIG_PRICE = 3_000_000
/** 기기 표시 형식 */
const DEVICE_RE = /^[A-Za-z0-9_-]{1,64}$/
/** 되돌린 쓰기의 요청 번호 형식 (REQUEST_ID_RE와 같음) */
const UNDO_RE = /^[A-Za-z0-9_-]{1,64}$/

export const VOICE_LOG_KINDS = ['REGISTER', 'PRICE', 'NAME', 'RENUMBER', 'UNDO'] as const
export type VoiceLogKind = (typeof VOICE_LOG_KINDS)[number]
export const VOICE_LOG_SOURCES = ['voice'] as const
export type VoiceLogSource = (typeof VOICE_LOG_SOURCES)[number]

/** voiceLog 칸을 받는 쓰기 종류 (판매 종료는 등록 되돌리기로만) */
export const VOICE_LOG_TYPES: readonly string[] = ['product.register', 'product.update', 'product.renumber', 'product.close']

/** 살아 있는 찜 (INV-2의 활성 찜 — 확정·대기·보류·충돌) */
const LIVE: readonly ClaimStatus[] = ['CONFIRMED', 'WAITLISTED', 'PENDING', 'CONFLICT']

export const VOICE_LOG_MESSAGES = {
  shape: "음성 기록 칸은 { heard: '들은 말' } 모양이어야 해요.",
  heard: `들은 말은 ${String(VOICE_LOG_HEARD_MAX)}글자까지 글로 적어 주세요.`,
  source: '음성 기록의 출처는 voice만 보낼 수 있어요.',
  device: '기기 표시는 영문·숫자·-·_ 64글자까지예요.',
  undo: '되돌린 쓰기의 요청 번호 형식이 올바르지 않아요.',
  undoType: '판매 종료는 음성 등록을 되돌릴 때만 음성 기록 칸을 보낼 수 있어요.',
  undoRegister: '상품 등록은 되돌리기가 될 수 없어요.',
  renumberClaimed: '찜이 있는 상품이라 번호를 옮기지 않았어요.',
  filter: "어느 방송(b)이나 날짜(date)의 기록인지 적어 주세요.",
  date: "날짜는 '2026-10-18'처럼 적어 주세요.",
  no: '상품 번호는 1 이상의 정수예요.',
} as const

/** 화면이 보낸 기록 칸 (검사한 값) */
export interface VoiceLogInput {
  readonly source: VoiceLogSource
  readonly heard: string
  readonly undo: string | null
  readonly device: string | null
}

/** 상품 값 (전·후) */
export interface VoiceLogValue {
  readonly no?: number
  readonly name?: string
  readonly price?: number
}

/** 넣을 줄 (기록 트랜잭션 안에서 만든다) */
export interface VoiceLogPlan {
  readonly kind: VoiceLogKind
  readonly productId: string | null
  readonly no: number
  readonly toNo: number | null
  readonly before: VoiceLogValue | null
  readonly after: VoiceLogValue | null
  readonly claims: number
  readonly big: boolean
  readonly withClaims: boolean
}

/** 조회 한 줄 (GET /api/voice/log) */
export interface VoiceLogEntry {
  readonly id: number
  readonly at: string
  readonly date: string
  readonly rehearsal: boolean
  readonly b: string
  readonly product: string | null
  readonly no: number
  readonly toNo: number | null
  readonly kind: VoiceLogKind
  readonly before: VoiceLogValue | null
  readonly after: VoiceLogValue | null
  readonly source: VoiceLogSource
  readonly by: { readonly kind: 'account'; readonly accountId: string | null } | { readonly kind: 'server' }
  readonly device: string | null
  readonly claims: number
  readonly heard: string
  readonly big: boolean
  readonly withClaims: boolean
  readonly undone: boolean
  readonly undoOf: string | null
  readonly failed: boolean
}

// ── 글 다듬기 ─────────────────────────────────────────────────────────────

const codePoints = (text: string): number => {
  let count = 0
  for (const _ of text) count++
  return count
}

/**
 * 화면 가리기(D-V3-56·66·75 — 화면 쪽 음성 가리기 함수)의 그물. 서버는 음성 묶음을 부르지 않으므로(AC-I4-04 경계) 같은 규칙을 여기 둔다.
 * dev-device 규칙과 같은 차례·같은 정규식이다(harness/sprints/V3/dev-notes.md "dev-device 추가 24·25"):
 * 1. 자리 글자(숫자·공·영·일~구)로만 된 토큰이 공백을 사이에 두고 이어져 자리가 8개 이상 → `****` (앞뒤에 다른 한글 음절이 붙은 토큰은 아님). 숫자만 가리기보다 먼저 — "영일영 1234 5678" → `****`
 * 2. 섞인 자리 글자(숫자·한글, 륙 포함)가 공백·`-`을 사이에 두고 8개 이상 → `****` ("공일공-1234-5678")
 * 3. 숫자가 공백·`-`을 사이에 두고 8개 이상 이어짐 → `****`
 * 4. 끝자리 낱말(끝자리·뒷번호·뒷자리·끝번호·끝 자리·뒷 번호·끝 번호·뒷 자리) + 끝말(R-17 2, 없어도) + 자리 글자 4개(사이 공백 허용) → `****`
 *    — 뒤에 숫자가 이어지거나, 공백·끝으로 끝나는 한글 자리 글자 토큰이 이어지면(`일이삼사오` 다섯 자리) 가리지 않는다. `5678이요`의 `이요`는 끝말이라 가린다
 */
const MASK = '****'
/** R-17 2 끝말 (화면 쪽 끝말 목록과 같은 목록 — 바꾸면 함께 바꾼다) */
const ENDINGS = ['이에요', '예요', '에요', '입니다', '이요', '이고', '이랑', '하고', '짜리', '에는', '은', '는', '이', '가', '을', '를', '에', '엔', '도', '요', '랑', '까지', '인데']
const ENDING_PATTERN = [...ENDINGS].sort((a, b) => b.length - a.length).join('|')
const DIGIT_CHAR = '[0-9공영일이삼사오육칠팔구]'
const DIGIT_RUN = `${DIGIT_CHAR}+`
const DIGIT_RUNS = new RegExp(`(?<![가-힣])${DIGIT_RUN}(?:\\s+${DIGIT_RUN})*(?![가-힣])`, 'g')
const LAST4_WORDS = ['끝자리', '뒷번호', '뒷자리', '끝번호', '끝 자리', '뒷 번호', '끝 번호', '뒷 자리']
const LAST4_RULES = LAST4_WORDS.map(
  (word) => new RegExp(`(${word.replace(/ /g, '\\s*')}(?:${ENDING_PATTERN})?)(\\s*)(?:${DIGIT_CHAR}\\s*){3}${DIGIT_CHAR}(?![0-9])(?![공영일이삼사오육칠팔구]+(?:\\s|$))`, 'g'),
)
const ANY_DIGIT = '[0-9공영일이삼사오육륙칠팔구]'
const LONG_MIXED_DIGITS = new RegExp(`${ANY_DIGIT}(?:[\\s-]*${ANY_DIGIT}){7,}`, 'g')
export function maskHeard(text: string): string {
  let out = text.replace(DIGIT_RUNS, (run) => (run.replace(/\s/g, '').length >= 8 ? MASK : run)).replace(LONG_MIXED_DIGITS, MASK)
  out = out.replace(/[0-9](?:[\s-]*[0-9])*/g, (run) => (run.replace(/[^0-9]/g, '').length >= 8 ? MASK : run))
  for (const rule of LAST4_RULES) out = out.replace(rule, (_match, lead: string, space: string) => `${lead}${space}${MASK}`)
  return out
}

/** 저장할 들은 말: 짝 없는 서로게이트·제어 문자 빼기(줄바꿈·탭 → 공백), 앞뒤 공백 지우기, 한 번 더 가리기, 300글자까지 */
export function cleanHeard(text: string): string {
  let out = ''
  for (const char of text.toWellFormed()) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0x0a || code === 0x0d || code === 0x09) out += ' '
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) continue
    else out += char
  }
  const masked = maskHeard(out.trim())
  return [...masked].slice(0, VOICE_LOG_HEARD_MAX).join('')
}

/** 화면이 보낸 voiceLog 칸 검사: { heard, source?: 'voice', undo?: 요청 번호, device? } */
export function parseVoiceLogInput(raw: unknown): { ok: true; value: VoiceLogInput } | { ok: false; problems: FieldProblem[] } {
  const fail = (message: string): { ok: false; problems: FieldProblem[] } => ({ ok: false, problems: [{ field: 'voiceLog', message }] })
  if (!isPlainObject(raw)) return fail(VOICE_LOG_MESSAGES.shape)
  if (ownKeys(raw).some((key) => !['heard', 'source', 'undo', 'device'].includes(key))) return fail(VOICE_LOG_MESSAGES.shape)
  const heard = own(raw, 'heard')
  if (typeof heard !== 'string' || codePoints(heard) > VOICE_LOG_HEARD_MAX) return fail(VOICE_LOG_MESSAGES.heard)
  const source = own(raw, 'source')
  if (source !== undefined && source !== 'voice') return fail(VOICE_LOG_MESSAGES.source)
  const undo = own(raw, 'undo')
  if (undo !== undefined && (typeof undo !== 'string' || !UNDO_RE.test(undo))) return fail(VOICE_LOG_MESSAGES.undo)
  const device = own(raw, 'device')
  if (device !== undefined && (typeof device !== 'string' || !DEVICE_RE.test(device))) return fail(VOICE_LOG_MESSAGES.device)
  return { ok: true, value: { source: 'voice', heard: cleanHeard(heard), undo: typeof undo === 'string' ? undo : null, device: typeof device === 'string' ? device : null } }
}

/** 쓰기 종류와 기록 칸이 맞는지 (판매 종료는 되돌리기만, 등록은 되돌리기가 아님) */
export function voiceLogTypeProblem(type: string, input: VoiceLogInput): FieldProblem[] {
  if (type === 'product.close' && input.undo === null) return [{ field: 'voiceLog', message: VOICE_LOG_MESSAGES.undoType }]
  if (type === 'product.register' && input.undo !== null) return [{ field: 'voiceLog', message: VOICE_LOG_MESSAGES.undoRegister }]
  return []
}

// ── 크게 바뀜 (R-25) ─────────────────────────────────────────────────────

/** 등록 가격이 크게 바뀜인지: > 3,000,000원 */
export function bigRegister(price: number): boolean {
  return price > VOICE_LOG_BIG_PRICE
}

/** 가격 고침이 크게 바뀜인지: 새 > 3,000,000원 · 새 > 전 × 3 · 새 × 3 < 전 (정수 비교) */
export function bigPriceChange(before: number, after: number): boolean {
  return after > VOICE_LOG_BIG_PRICE || after > before * 3 || after * 3 < before
}

// ── 줄 만들기 (기록 트랜잭션 안의 지금 상태로) ────────────────────────────

/** 그 상품의 살아 있는 찜 수 (코어 조회) */
export function liveClaimCount(state: EngineState, productKey: string): number {
  let count = 0
  for (const claim of listClaims(state)) if (claim.product === productKey && LIVE.includes(claim.status)) count++
  return count
}

const int = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) ? value : null)
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/**
 * 이 쓰기가 남길 줄 (상품 명령 전의 상태로). 형식이 틀린 값은 코어가 거절할 것이라 그대로 적되 숫자 아닌 번호는 0으로 둔다.
 * - 등록 → REGISTER · 고치기 → 가격이 바뀌면 PRICE, 품종이 바뀌면 NAME (둘 다 바뀌면 두 줄, 아무것도 바뀌지 않으면 보낸 칸의 첫 줄 하나)
 * - 번호 바꾸기 → RENUMBER · 되돌리기(undo 있음) → UNDO 한 줄
 */
export function planVoiceLog(state: EngineState, fields: Readonly<Record<string, unknown>>, undo: boolean): VoiceLogPlan[] {
  const type = fields['type']
  const b = str(fields['b']) ?? ''
  if (type === 'product.renumber') {
    const from = int(fields['from']) ?? 0
    const to = int(fields['to'])
    const product = getProduct(state, b, from)
    const claims = product === null ? 0 : liveClaimCount(state, product.key)
    return [{ kind: undo ? 'UNDO' : 'RENUMBER', productId: product?.id ?? null, no: from, toNo: to, before: { no: from }, after: to === null ? null : { no: to }, claims, big: false, withClaims: claims > 0 }]
  }
  const no = int(fields['no']) ?? 0
  const product = getProduct(state, b, no)
  const claims = product === null ? 0 : liveClaimCount(state, product.key)
  const productId = product?.id ?? null
  if (type === 'product.register') {
    const price = int(fields['price'])
    const name = str(fields['name']) ?? ''
    return [{ kind: 'REGISTER', productId: null, no, toNo: null, before: null, after: { name, ...(price === null ? {} : { price }) }, claims: 0, big: price !== null && bigRegister(price), withClaims: false }]
  }
  if (type === 'product.close') {
    // 음성 등록 되돌리기 = 판매 종료 (D-083)
    return [{ kind: 'UNDO', productId, no, toNo: null, before: product === null ? null : { name: product.name, price: product.price }, after: null, claims, big: false, withClaims: claims > 0 }]
  }
  // product.update
  const price = int(fields['price'])
  const name = str(fields['name'])
  if (undo) {
    const before: { name?: string; price?: number } = {}
    const after: { name?: string; price?: number } = {}
    if (name !== null) {
      if (product !== null) before.name = product.name
      after.name = name
    }
    if (price !== null) {
      if (product !== null) before.price = product.price
      after.price = price
    }
    return [{ kind: 'UNDO', productId, no, toNo: null, before, after, claims, big: false, withClaims: claims > 0 }]
  }
  const rows: VoiceLogPlan[] = []
  const priceRow = (): VoiceLogPlan => ({
    kind: 'PRICE',
    productId,
    no,
    toNo: null,
    before: product === null ? null : { price: product.price },
    after: { price: price as number },
    claims,
    big: product === null ? bigRegister(price as number) : bigPriceChange(product.price, price as number),
    withClaims: claims > 0,
  })
  const nameRow = (): VoiceLogPlan => ({ kind: 'NAME', productId, no, toNo: null, before: product === null ? null : { name: product.name }, after: { name: name as string }, claims, big: false, withClaims: claims > 0 })
  if (price !== null && (product === null || product.price !== price)) rows.push(priceRow())
  if (name !== null && (product === null || product.name !== name)) rows.push(nameRow())
  if (rows.length === 0) {
    if (price !== null) rows.push(priceRow())
    else if (name !== null) rows.push(nameRow())
  }
  return rows
}

// ── 저장 ──────────────────────────────────────────────────────────────────

export interface VoiceLogContext {
  readonly sellerId: string
  readonly requestId: string
  readonly date: string
  readonly rehearsal: boolean
  readonly b: string
  readonly actor: Actor
  readonly input: VoiceLogInput
}

const json = (value: VoiceLogValue | null): string | null => (value === null ? null : JSON.stringify(value))

function rowsOf(ctx: VoiceLogContext, plans: readonly VoiceLogPlan[], at: Date, failed: boolean): (typeof voiceLog.$inferInsert)[] {
  return plans.map((plan) => ({
    sellerId: ctx.sellerId,
    requestId: ctx.requestId,
    kind: plan.kind,
    at,
    date: ctx.date,
    rehearsal: ctx.rehearsal,
    broadcastId: ctx.b,
    productId: plan.productId,
    no: plan.no,
    toNo: plan.toNo,
    before: json(plan.before),
    after: json(plan.after),
    source: ctx.input.source,
    actor: ctx.actor.kind === 'account' ? 'account' : 'server',
    accountId: ctx.actor.kind === 'account' ? ctx.actor.accountId : null,
    device: ctx.input.device,
    claims: plan.claims,
    heard: ctx.input.heard,
    big: plan.big,
    withClaims: plan.withClaims,
    undone: false,
    undoOf: ctx.input.undo,
    failed,
  }))
}

/**
 * 기록 트랜잭션 안에서 상품 명령보다 먼저 넣는다 (아직 결과를 모르니 실패 아님으로 넣고 afterInsert가 고친다).
 * 같은 요청이 앞서 거절돼 실패 줄이 있으면 이번 값으로 바꾼다
 */
export async function insertVoiceLog(tx: Db, ctx: VoiceLogContext, plans: readonly VoiceLogPlan[], at: Date): Promise<void> {
  const rows = rowsOf(ctx, plans, at, false)
  for (const row of rows) {
    const { sellerId: _s, requestId: _r, kind: _k, ...rest } = row
    await tx
      .insert(voiceLog)
      .values(row)
      .onConflictDoUpdate({ target: [voiceLog.sellerId, voiceLog.requestId, voiceLog.kind], set: rest })
  }
}

/**
 * 같은 트랜잭션에서 상품 명령을 기록한 뒤: 실패로 기록됐으면 실패 표시, 등록이면 생긴 상품 ID, 되돌리기가 바꿨으면 되돌린 줄에 "되돌림"
 */
export async function settleVoiceLog(tx: Db, ctx: VoiceLogContext, record: CommittedRecord | undefined, after: EngineState | undefined): Promise<void> {
  // 실패 = 상품에 반영되지 않음: 실패로 기록됐거나 엔진이 바꾼 것이 없다(없는 번호·이미 같은 값 등)
  const failed = record === undefined || record.failed || !record.changed
  const mine = and(eq(voiceLog.sellerId, ctx.sellerId), eq(voiceLog.requestId, ctx.requestId)) as SQL
  if (failed) {
    await tx.update(voiceLog).set({ failed: true }).where(mine)
    return
  }
  const fields = record.event as unknown as { readonly type?: unknown; readonly b?: unknown; readonly no?: unknown }
  if (fields.type === 'product.register' && after !== undefined && typeof fields.b === 'string' && typeof fields.no === 'number') {
    const product = getProduct(after, fields.b, fields.no)
    if (product !== null) await tx.update(voiceLog).set({ productId: product.id }).where(mine)
  }
  if (ctx.input.undo !== null && record.changed) {
    await tx
      .update(voiceLog)
      .set({ undone: true })
      .where(and(eq(voiceLog.sellerId, ctx.sellerId), eq(voiceLog.requestId, ctx.input.undo), eq(voiceLog.broadcastId, ctx.b), inArray(voiceLog.kind, ['REGISTER', 'PRICE', 'NAME', 'RENUMBER'])))
  }
}

/** 상품 명령이 기록되지 못했을 때(거절·저장 실패) 실패 줄 — 같은 요청의 줄이 이미 있으면 그대로 둔다 */
export async function insertFailedVoiceLog(db: Db, ctx: VoiceLogContext, plans: readonly VoiceLogPlan[], at: Date): Promise<void> {
  const rows = rowsOf(ctx, plans, at, true)
  if (rows.length === 0) return
  await db
    .insert(voiceLog)
    .values(rows)
    .onConflictDoNothing({ target: [voiceLog.sellerId, voiceLog.requestId, voiceLog.kind] })
}

// ── 조회 ──────────────────────────────────────────────────────────────────

export interface VoiceLogFilter {
  readonly b?: string
  readonly date?: string
  /** 엔진 상품 ID */
  readonly product?: string
  /** 상품 번호 (옮긴 줄은 전·후 번호 어느 쪽이든) */
  readonly no?: number
  /** 리허설 범위인지 (방송을 적지 않았으면 기본 실제) */
  readonly rehearsal?: boolean
}

type VoiceLogRow = typeof voiceLog.$inferSelect

const parseValue = (text: string | null): VoiceLogValue | null => {
  if (text === null) return null
  try {
    const value: unknown = JSON.parse(text)
    return isPlainObject(value) ? (value as VoiceLogValue) : null
  } catch {
    return null
  }
}

export function entryOf(row: VoiceLogRow): VoiceLogEntry {
  return {
    id: row.id,
    at: row.at.toISOString(),
    date: row.date,
    rehearsal: row.rehearsal,
    b: row.broadcastId,
    product: row.productId,
    no: row.no,
    toNo: row.toNo,
    kind: row.kind as VoiceLogKind,
    before: parseValue(row.before),
    after: parseValue(row.after),
    source: row.source as VoiceLogSource,
    by: row.actor === 'account' ? { kind: 'account', accountId: row.accountId } : { kind: 'server' },
    device: row.device,
    claims: row.claims,
    heard: row.heard,
    big: row.big,
    withClaims: row.withClaims,
    undone: row.undone,
    undoOf: row.undoOf,
    failed: row.failed,
  }
}

/** 그 판매자의 기록, 시각순 (같은 시각이면 넣은 순) */
export async function listVoiceLog(db: Db, sellerId: string, filter: VoiceLogFilter): Promise<VoiceLogEntry[]> {
  const conditions: SQL[] = [eq(voiceLog.sellerId, sellerId)]
  if (filter.b !== undefined) conditions.push(eq(voiceLog.broadcastId, filter.b))
  else conditions.push(eq(voiceLog.rehearsal, filter.rehearsal ?? false))
  if (filter.b !== undefined && filter.rehearsal !== undefined) conditions.push(eq(voiceLog.rehearsal, filter.rehearsal))
  if (filter.date !== undefined) conditions.push(eq(voiceLog.date, filter.date))
  if (filter.product !== undefined) conditions.push(eq(voiceLog.productId, filter.product))
  const rows = await db
    .select()
    .from(voiceLog)
    .where(and(...conditions))
    .orderBy(asc(voiceLog.at), asc(voiceLog.id))
  const no = filter.no
  return (no === undefined ? rows : rows.filter((row) => row.no === no || row.toNo === no)).map(entryOf)
}

/** 전·후 값 하나를 시트 칸 값으로: 가격은 정수 원(수 칸), 품종은 글, 번호는 수. 등록은 "품종 가격원" 글 (품종이 없으면 가격만) */
function sheetValue(kind: VoiceLogKind, value: VoiceLogValue | null): number | string | null {
  if (value === null) return null
  if (kind === 'REGISTER') {
    if (value.price === undefined) return value.name ?? null
    return value.name === undefined || value.name === '' ? value.price : `${value.name} ${formatWon(value.price)}`
  }
  if (value.price !== undefined) return value.price
  if (value.name !== undefined) return value.name
  if (value.no !== undefined) return value.no
  return null
}

/**
 * 그 날짜(실제 범위)의 판매대장 "음성 기록" 시트 줄 (packages/documents VoiceLedgerRow), 시각순. broadcasts가 있으면 그 방송만.
 * 상품 명령이 기록되지 못한 줄(failed)은 넣지 않는다 — 시트에 실패 표시 칸이 없어 바뀐 것처럼 읽히지 않게(정산 화면 조회에는 실패 표시와 함께 있다)
 */
export async function voiceLogSheetRows(db: Db, sellerId: string, date: string, broadcasts: readonly string[] | null): Promise<VoiceLedgerRow[]> {
  if (broadcasts !== null && broadcasts.length === 0) return []
  const rows = await db
    .select()
    .from(voiceLog)
    .where(and(eq(voiceLog.sellerId, sellerId), eq(voiceLog.date, date), eq(voiceLog.rehearsal, false), eq(voiceLog.failed, false), ...(broadcasts === null ? [] : [inArray(voiceLog.broadcastId, [...broadcasts])])))
    .orderBy(asc(voiceLog.at), asc(voiceLog.id))
  return rows.map((row) => {
    const kind = row.kind as VoiceLogKind
    const marks: VoiceLedgerMark[] = []
    if (row.big) marks.push('BIG_CHANGE')
    if (row.withClaims) marks.push('WITH_CLAIMS')
    if (row.undone) marks.push('UNDONE')
    return {
      at: row.at.getTime(),
      no: row.no,
      toNo: row.toNo,
      action: kind,
      before: sheetValue(kind, parseValue(row.before)),
      after: sheetValue(kind, parseValue(row.after)),
      source: row.source as VoiceLogSource,
      claims: row.claims,
      heard: row.heard,
      marks,
    }
  })
}
