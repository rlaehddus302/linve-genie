// 정산 정보 (D-RETRO-60·61, 판매자 요청 2026-11-12 "계좌·성함·전화번호를 미리 넣는 화면이 없어서 직접 만들었다"):
// 구매자별 정산서에 찍는 입금 계좌·판매자 전화번호·방송(호스트) 이름과 배송비 규칙을 한 번에 읽고 고친다.
// - 계좌(은행·계좌번호·예금주)는 가게 설정과 같은 칸이다(sellers.shop JSON — 가게 설정 화면에서 고쳐도 같은 값).
// - 전화번호·방송 이름·"한 번 정했다" 표시는 같은 JSON의 statement 칸에 더한다(DB 칸은 그대로). 전화번호는 판매자마다 묶어 암호화한다.
// - 배송비는 판매 규칙 설정(shipping.baseFee·shipping.freeThreshold) 하나가 진실이다 — 날짜별 정산과 정산서가 같은 값을 쓴다.
//   판매자가 아직 정하지 않았으면 정산서는 5만 원 미만 5,000원(STATEMENT_SHIPPING_DEFAULT)으로 보이고, 저장하면 그 값이 판매 규칙에 들어간다.
// - 받은 값(계좌번호·전화번호)은 오류 문장·로그에 넣지 않는다.
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { eq } from 'drizzle-orm'
import { isPlainObject, own, ownKeys } from './api-fields.ts'
import type { Db } from './db/database.ts'
import { sellers } from './db/schema.ts'
import type { FieldProblem } from './errors.ts'
import { unknownFieldProblems } from './messages.ts'
import { openSellerText, sealSellerText } from './secrets.ts'
import { checkShopInput } from './shop.ts'
import type { Rejection } from './writer.ts'
import { STATEMENT_SHIPPING_DEFAULT, type StatementInfo, type StatementShipping } from '../../web/src/lib/broadcast-sales.ts'

export { STATEMENT_SHIPPING_DEFAULT, type StatementInfo, type StatementShipping }

export const STATEMENT_FIELDS = ['bank', 'accountNumber', 'accountHolder', 'phone', 'hostName', 'shipping'] as const
export const STATEMENT_PHONE_MAX = 20
export const STATEMENT_HOST_MAX = 20
export const SHIPPING_FEE_MAX = 1_000_000
export const SHIPPING_FREE_MAX = 100_000_000

export const STATEMENT_MESSAGES = {
  phone: `전화번호는 숫자와 '-'로 ${String(STATEMENT_PHONE_MAX)}글자까지 적어 주세요.`,
  hostName: `방송 이름은 ${String(STATEMENT_HOST_MAX)}글자까지 적어 주세요.`,
  shipping: '배송비를 다시 정해 주세요.',
  fee: '배송비는 1원부터 1,000,000원까지 숫자로 적어 주세요.',
  freeFrom: '무료 배송 기준은 1원부터 100,000,000원까지 숫자로 적어 주세요. 없으면 비워 주세요.',
} as const

const PHONE_RE = /^[0-9][0-9\- ]*$/
const PHONE_PURPOSE = 'statement-phone'

const length = (text: string): number => [...text].length
/** 제어 글자(줄바꿈·탭 등)와 줄·문단 나눔 글자 */
const hasControl = (text: string): boolean => [...text].some((ch) => {
  const code = ch.codePointAt(0) ?? 0
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
})
const digits = (text: string): number => text.replace(/\D/g, '').length

const invalid = (message: string, problems: readonly FieldProblem[]): Rejection => ({ status: 400, code: 'INVALID_INPUT', message, problems })

/** 저장된 판매 규칙에서 정산서 배송비 규칙을 읽는다 — 판매자가 배송비 칸을 고른 적이 없으면 null */
export function shippingFromSettings(raw: unknown): StatementShipping | null {
  if (!isPlainObject(raw)) return null
  const hasFee = Object.hasOwn(raw, 'shipping.baseFee')
  const hasFree = Object.hasOwn(raw, 'shipping.freeThreshold')
  if (!hasFee && !hasFree) return null
  const fee = own(raw, 'shipping.baseFee')
  const free = own(raw, 'shipping.freeThreshold')
  // 한 칸만 고른 판매자: 나머지는 엔진 기본값(기본 배송비 4,000원 · 무료 기준 없음)이 날짜별 정산에 쓰이므로 정산서도 그대로 따른다
  const baseFee = typeof fee === 'number' && Number.isSafeInteger(fee) && fee >= 0 ? fee : DEFAULT_SETTINGS['shipping.baseFee']
  const freeFrom = typeof free === 'number' && Number.isSafeInteger(free) && free >= 0 ? free : DEFAULT_SETTINGS['shipping.freeThreshold']
  if (baseFee === 0) return { charge: false, fee: 0, freeFrom: null }
  return { charge: true, fee: baseFee, freeFrom }
}

/** 정산서 배송비 규칙 → 판매 규칙 설정 두 칸 (받지 않으면 0원 · 기준 없음) */
export function shippingSettings(shipping: StatementShipping): { 'shipping.baseFee': number; 'shipping.freeThreshold': number | null } {
  return shipping.charge ? { 'shipping.baseFee': shipping.fee, 'shipping.freeThreshold': shipping.freeFrom } : { 'shipping.baseFee': 0, 'shipping.freeThreshold': null }
}

/** 정수 원으로 읽는다 — 숫자거나 "5,000"·"5000" 같은 글. 소수·음수·그 밖의 글은 null */
function readWon(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!/^\d+$/.test(text) && !/^\d{1,3}(,\d{3})+$/.test(text)) return null
  const won = Number(text.replace(/,/g, ''))
  return Number.isSafeInteger(won) ? won : null
}

export type StatementInput = Omit<StatementInfo, 'decided'>

/**
 * PUT /api/statement-info 본문 검사. 여섯 칸 모두 보낸다(빈 칸은 ""). 계좌는 가게 설정과 같은 규칙(셋 다 적거나 셋 다 비움).
 * 전화번호는 숫자·'-'·빈칸만, 숫자 8자리 이상. 배송비는 정수 원만 — 받는다면 1원 이상, 무료 기준은 비우거나 1원 이상.
 * shopNow: 지금 저장된 가게 이름·입금 안내(계좌 규칙 검사에 그대로 넘긴다 — 이 화면은 그 두 칸을 고치지 않는다)
 */
export function checkStatementInput(body: unknown, shopNow: { readonly name: string; readonly accountNote: string }): { ok: true; value: StatementInput } | { ok: false; rejection: Rejection } {
  if (!isPlainObject(body)) return { ok: false, rejection: { status: 400, code: 'NOT_JSON', message: '보낸 내용의 형식이 올바르지 않아요.', problems: [] } }
  const extra = ownKeys(body).filter((key) => !(STATEMENT_FIELDS as readonly string[]).includes(key))
  if (extra.length > 0) return { ok: false, rejection: { status: 400, code: 'UNKNOWN_FIELD', message: '받을 수 없는 항목이 있어요.', problems: unknownFieldProblems(extra) } }
  const problems: FieldProblem[] = []
  let message = '입력한 내용을 확인해 주세요.'

  const account = checkShopInput({ name: shopNow.name, bank: own(body, 'bank'), accountNumber: own(body, 'accountNumber'), accountHolder: own(body, 'accountHolder'), accountNote: shopNow.accountNote }, shopNow.name)
  if (!account.ok) {
    const kept = account.rejection.problems.filter((problem) => problem.field === 'bank' || problem.field === 'accountNumber' || problem.field === 'accountHolder')
    problems.push(...kept)
    if (kept.length > 0) message = account.rejection.message
  }

  const rawPhone = own(body, 'phone')
  let phone = ''
  if (typeof rawPhone !== 'string' || hasControl(rawPhone)) problems.push({ field: 'phone', message: STATEMENT_MESSAGES.phone })
  else {
    phone = rawPhone.trim()
    if (phone !== '' && (length(phone) > STATEMENT_PHONE_MAX || !PHONE_RE.test(phone) || digits(phone) < 8)) problems.push({ field: 'phone', message: STATEMENT_MESSAGES.phone })
  }

  const rawHost = own(body, 'hostName')
  let hostName = ''
  if (typeof rawHost !== 'string' || hasControl(rawHost)) problems.push({ field: 'hostName', message: STATEMENT_MESSAGES.hostName })
  else {
    hostName = rawHost.trim()
    if (length(hostName) > STATEMENT_HOST_MAX) problems.push({ field: 'hostName', message: STATEMENT_MESSAGES.hostName })
  }

  const rawShipping = own(body, 'shipping')
  let shipping: StatementShipping = { charge: false, fee: 0, freeFrom: null }
  if (!isPlainObject(rawShipping) || typeof own(rawShipping, 'charge') !== 'boolean' || ownKeys(rawShipping).some((key) => !['charge', 'fee', 'freeFrom'].includes(key))) {
    problems.push({ field: 'shipping', message: STATEMENT_MESSAGES.shipping })
  } else if (own(rawShipping, 'charge') === true) {
    const fee = readWon(own(rawShipping, 'fee'))
    const rawFree = own(rawShipping, 'freeFrom')
    const noFree = rawFree === null || rawFree === undefined || (typeof rawFree === 'string' && rawFree.trim() === '')
    const freeFrom = noFree ? null : readWon(rawFree)
    const feeOk = fee !== null && fee >= 1 && fee <= SHIPPING_FEE_MAX
    const freeOk = noFree || (freeFrom !== null && freeFrom >= 1 && freeFrom <= SHIPPING_FREE_MAX)
    if (!feeOk) problems.push({ field: 'shipping.fee', message: STATEMENT_MESSAGES.fee })
    if (!freeOk) problems.push({ field: 'shipping.freeFrom', message: STATEMENT_MESSAGES.freeFrom })
    if (feeOk && freeOk) shipping = { charge: true, fee, freeFrom }
  }

  if (problems.length > 0) return { ok: false, rejection: invalid(message, problems) }
  // 계좌 칸에 문제가 없으면 계좌 세 칸은 글이다(가게 이름·입금 안내 칸의 문제는 이 화면이 고치는 칸이 아니라 따지지 않는다)
  const trimmed = (key: string): string => String(own(body, key)).trim()
  const value = account.ok ? account.value : { bank: trimmed('bank'), accountNumber: trimmed('accountNumber'), accountHolder: trimmed('accountHolder') }
  return { ok: true, value: { bank: value.bank, accountNumber: value.accountNumber, accountHolder: value.accountHolder, phone, hostName, shipping } }
}

interface StatementExtras {
  readonly hostName: string
  readonly phoneEnc: string | null
  readonly decided: boolean
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text)
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function extrasOf(shop: Record<string, unknown>): StatementExtras {
  const raw = own(shop, 'statement')
  const record = isPlainObject(raw) ? raw : {}
  const hostName = own(record, 'hostName')
  const phoneEnc = own(record, 'phoneEnc')
  return { hostName: typeof hostName === 'string' ? hostName : '', phoneEnc: typeof phoneEnc === 'string' && phoneEnc !== '' ? phoneEnc : null, decided: own(record, 'decided') === true }
}

const text = (record: Record<string, unknown>, key: string): string => {
  const value = own(record, key)
  return typeof value === 'string' ? value : ''
}

/** 암호화한 전화번호를 푼다 — 풀지 못하면(마스터 키가 바뀜·값 손상) 빈 칸: 정산서에서 그 줄이 빠지고 판매자가 다시 적는다 */
function openPhone(masterKey: Buffer, sellerId: string, sealed: string | null): string {
  if (sealed === null) return ''
  try {
    return openSellerText(masterKey, PHONE_PURPOSE, sellerId, sealed)
  } catch {
    return ''
  }
}

/** 판매자의 정산 정보 (판매자 ID 조건). 없는 판매자면 null */
export async function readStatementInfo(db: Db, masterKey: Buffer, sellerId: string): Promise<StatementInfo | null> {
  const rows = await db.select({ shop: sellers.shop, settings: sellers.settings }).from(sellers).where(eq(sellers.id, sellerId)).limit(1)
  const row = rows[0]
  if (row === undefined) return null
  const shop = parseObject(row.shop)
  const extras = extrasOf(shop)
  return {
    bank: text(shop, 'bank'),
    accountNumber: text(shop, 'accountNumber'),
    accountHolder: text(shop, 'accountHolder'),
    phone: openPhone(masterKey, sellerId, extras.phoneEnc),
    hostName: extras.hostName,
    shipping: shippingFromSettings(parseObject(row.settings)) ?? STATEMENT_SHIPPING_DEFAULT,
    decided: extras.decided,
  }
}

/** 계좌·전화번호·방송 이름을 가게 설정 JSON에 저장하고 "정했다"로 표시한다 (배송비는 부르는 쪽이 판매 규칙에 넣는다). 없는 판매자면 거짓 */
export async function writeStatementShop(db: Db, masterKey: Buffer, sellerId: string, value: StatementInput): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx.select({ shop: sellers.shop }).from(sellers).where(eq(sellers.id, sellerId)).for('update')
    const row = rows[0]
    if (row === undefined) return false
    const shop = parseObject(row.shop)
    const statement = { hostName: value.hostName, phoneEnc: value.phone === '' ? null : sealSellerText(masterKey, PHONE_PURPOSE, sellerId, value.phone), decided: true }
    const next = { bank: value.bank, accountNumber: value.accountNumber, accountHolder: value.accountHolder, accountNote: text(shop, 'accountNote'), statement }
    await tx.update(sellers).set({ shop: JSON.stringify(next) }).where(eq(sellers.id, sellerId))
    return true
  })
}
