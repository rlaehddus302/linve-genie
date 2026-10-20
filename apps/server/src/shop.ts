// 가게 설정 (STL-04 "가게 이름·입금 계좌 안내(설정)", I2 D-I2-02, AC-I2-01). 판매 규칙 설정과 따로, 이벤트 로그 밖이다.
// - 가게 이름 = 판매자 이름(sellers.name — 로그인 정보·화면 위 가게 이름과 같은 값). 고치면 그 이름도 바뀐다.
// - 입금 계좌 = 은행·계좌번호·예금주 셋 다 적거나 셋 다 비움. 안내 문장은 계좌가 있을 때만 확인서에 나온다(문서 패키지).
// - 판매자 자신이 구매자에게 공개하는 정보라 휴대폰 번호 검사(D-079)를 하지 않는다. 서버 로그에 값을 남기지 않는다.
// - 합친 뒤(I3 AC-I3-47): PUT /api/shop은 다섯 칸(이 파일의 가게 설정) 또는 가게 이름 하나({ name } — 시작 마법사·가게 이름만)를 받는다.
//   가게 이름의 상한은 이 파일의 규칙(새로 적는 이름 1~30글자, 지금 이름 그대로면 길이를 다시 따지지 않음 — SA-I2-006)이고,
//   글자 검사는 I3 규칙을 더한다: 제어·서식 글자, 줄 나눔(U+2028)·문단 나눔(U+2029), 짝 없는 서로게이트는 받지 않는다(SA-I3-007 — 위 줄·라벨이 두 줄이 된다).
import type { ShopSettings } from '@livejjim/documents'
import { eq } from 'drizzle-orm'
import { isPlainObject, own, ownKeys } from './api-fields.ts'
import type { Db } from './db/database.ts'
import { sellers } from './db/schema.ts'
import type { FieldProblem } from './errors.ts'
import { unknownFieldProblems } from './messages.ts'
import type { Rejection } from './writer.ts'

/** 가게 설정 (GET·PUT /api/shop) — 빈 칸은 "" */
export interface ShopView {
  readonly name: string
  readonly bank: string
  readonly accountNumber: string
  readonly accountHolder: string
  readonly accountNote: string
}

export const SHOP_FIELDS = ['name', 'bank', 'accountNumber', 'accountHolder', 'accountNote'] as const
export const SHOP_NAME_MAX = 30
export const SHOP_BANK_MAX = 20
export const SHOP_ACCOUNT_NUMBER_MAX = 30
export const SHOP_HOLDER_MAX = 20
export const SHOP_NOTE_MAX = 100

export const ACCOUNT_PARTIAL_MESSAGE = '은행·계좌번호·예금주를 모두 적거나 모두 비워 주세요.'
const CONTROL_MESSAGE = '줄바꿈·탭 같은 글자는 쓸 수 없어요.'
const MESSAGES = {
  name: `가게 이름은 1~${String(SHOP_NAME_MAX)}글자로 적어 주세요.`,
  bank: `은행은 ${String(SHOP_BANK_MAX)}글자까지 적어 주세요.`,
  accountNumber: `계좌번호는 숫자와 '-'로 ${String(SHOP_ACCOUNT_NUMBER_MAX)}글자까지 적어 주세요.`,
  accountHolder: `예금주는 ${String(SHOP_HOLDER_MAX)}글자까지 적어 주세요.`,
  accountNote: `입금 안내 문장은 ${String(SHOP_NOTE_MAX)}글자까지 적어 주세요.`,
} as const
const MISSING = { bank: '은행을 적어 주세요.', accountNumber: '계좌번호를 적어 주세요.', accountHolder: '예금주를 적어 주세요.' } as const

/** 코드 포인트 수 */
const length = (text: string): number => [...text].length
/** 제어 글자 U+0000~U+001F·U+007F (AC-I2-01) */
const hasControl = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}
/** 가게 이름에 받지 않는 글자 (I3 accounts.ts cleanDisplayName과 같은 판단 — Cc·Cf·Zl·Zp·Cs) */
const NAME_FORBIDDEN_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u
const ACCOUNT_NUMBER_RE = /^[0-9\- ]+$/
const HAS_DIGIT_RE = /[0-9]/

const rejection = (message: string, problems: readonly FieldProblem[]): Rejection => ({ status: 400, code: 'INVALID_INPUT', message, problems })

/**
 * PUT /api/shop 본문 검사: 다섯 칸(name·bank·accountNumber·accountHolder·accountNote) 모두 문자열로. 앞뒤 공백을 지운 뒤 길이를 센다.
 * 제어 글자가 있거나·모르는 칸·형식이 틀린 값·계좌 일부만이면 저장하지 않고 칸별 문제를 돌려준다.
 * currentName = 지금 저장된 가게 이름. 가게 이름을 고치지 않았으면(앞뒤 공백을 지운 값이 같으면) 길이를 다시 따지지 않는다 —
 * 계정 만들기 명령(accounts.ts)이 30글자보다 긴 이름을 받았던 판매자도 계좌만 적어 저장할 수 있다(TD-I2-004·SA-I2-006, D-I2-02의 1~30글자는 새로 적는 이름에 건다)
 */
export function checkShopInput(body: unknown, currentName: string | null = null): { ok: true; value: ShopView } | { ok: false; rejection: Rejection } {
  if (!isPlainObject(body)) return { ok: false, rejection: { status: 400, code: 'NOT_JSON', message: '보낸 내용의 형식이 올바르지 않아요.', problems: [] } }
  const extra = ownKeys(body).filter((key) => !(SHOP_FIELDS as readonly string[]).includes(key))
  if (extra.length > 0) return { ok: false, rejection: { status: 400, code: 'UNKNOWN_FIELD', message: '받을 수 없는 항목이 있어요.', problems: unknownFieldProblems(extra) } }
  const problems: FieldProblem[] = []
  const values: Record<(typeof SHOP_FIELDS)[number], string> = { name: '', bank: '', accountNumber: '', accountHolder: '', accountNote: '' }
  for (const field of SHOP_FIELDS) {
    const raw = own(body, field)
    if (typeof raw !== 'string') {
      problems.push({ field, message: MESSAGES[field] })
      continue
    }
    if (hasControl(raw)) {
      problems.push({ field, message: CONTROL_MESSAGE })
      continue
    }
    values[field] = raw.trim()
  }
  const failed = new Set(problems.map((problem) => problem.field))
  const check = (field: (typeof SHOP_FIELDS)[number], ok: boolean) => {
    if (!failed.has(field) && !ok) problems.push({ field, message: MESSAGES[field] })
  }
  const unchangedName = currentName !== null && values.name !== '' && values.name === currentName.trim()
  // 새로 적는 이름의 서식 글자·줄 나눔·짝 없는 서로게이트 (I3 규칙, SA-I3-007) — 지금 이름 그대로면 따지지 않는다
  if (!failed.has('name') && !unchangedName && NAME_FORBIDDEN_RE.test(values.name)) {
    problems.push({ field: 'name', message: CONTROL_MESSAGE })
    failed.add('name')
  }
  check('name', unchangedName || (length(values.name) >= 1 && length(values.name) <= SHOP_NAME_MAX))
  check('accountNote', length(values.accountNote) <= SHOP_NOTE_MAX)
  const accountFields = ['bank', 'accountNumber', 'accountHolder'] as const
  const filled = accountFields.filter((field) => values[field] !== '')
  let partial = false
  if (filled.length > 0 && filled.length < accountFields.length) {
    partial = true
    for (const field of accountFields) if (values[field] === '' && !failed.has(field)) problems.push({ field, message: MISSING[field] })
  }
  if (values.bank !== '') check('bank', length(values.bank) <= SHOP_BANK_MAX)
  if (values.accountNumber !== '') {
    check('accountNumber', length(values.accountNumber) <= SHOP_ACCOUNT_NUMBER_MAX && ACCOUNT_NUMBER_RE.test(values.accountNumber) && HAS_DIGIT_RE.test(values.accountNumber))
  }
  if (values.accountHolder !== '') check('accountHolder', length(values.accountHolder) <= SHOP_HOLDER_MAX)
  if (problems.length > 0) return { ok: false, rejection: rejection(partial ? ACCOUNT_PARTIAL_MESSAGE : '입력한 내용을 확인해 주세요.', problems) }
  return { ok: true, value: values }
}

/**
 * 가게 이름 하나만 바꾸기 (PUT /api/shop { name } — I3 AC-I3-47 시작 마법사·설정의 가게 이름). 앞뒤 공백을 지운 값을 돌려주고, 틀리면 null.
 * 상한은 가게 설정과 같다: 새로 적는 이름은 1~30글자(코드 포인트)이고 서식 글자 등이 없어야 한다. 지금 이름 그대로면 길이·서식 글자를 다시 따지지 않는다(SA-I2-006).
 * 빈 이름·제어 글자는 지금 이름과 상관없이 거절
 */
export function checkShopName(raw: unknown, currentName: string | null): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  if (name === '' || hasControl(name)) return null
  if (currentName !== null && name === currentName.trim()) return name
  return NAME_FORBIDDEN_RE.test(name) || length(name) > SHOP_NAME_MAX ? null : name
}

/** 저장된 가게 설정 JSON → 계좌·안내 칸 (형식이 틀린 값은 빈 칸) */
function parseShopJson(text: string): Omit<ShopView, 'name'> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = {}
  }
  const record = isPlainObject(parsed) ? parsed : {}
  const text1 = (key: string): string => {
    const value = own(record, key)
    return typeof value === 'string' ? value : ''
  }
  return { bank: text1('bank'), accountNumber: text1('accountNumber'), accountHolder: text1('accountHolder'), accountNote: text1('accountNote') }
}

/** 판매자의 가게 설정 (판매자 ID 조건) */
export async function readShop(db: Db, sellerId: string): Promise<ShopView> {
  const rows = await db.select({ name: sellers.name, shop: sellers.shop }).from(sellers).where(eq(sellers.id, sellerId)).limit(1)
  const row = rows[0]
  if (row === undefined) throw new Error('판매자가 없다')
  return { name: row.name, ...parseShopJson(row.shop) }
}

/** 가게 설정 JSON (sellers.shop 칸 — 계좌·안내만, 가게 이름은 name 칸) */
export function shopJson(view: Omit<ShopView, 'name'>): string {
  return JSON.stringify({ bank: view.bank, accountNumber: view.accountNumber, accountHolder: view.accountHolder, accountNote: view.accountNote })
}

/** 가게 설정 저장 (판매자 ID 조건). 검사는 checkShopInput이 먼저 했다 */
export async function writeShop(db: Db, sellerId: string, view: ShopView): Promise<void> {
  await db.update(sellers).set({ name: view.name, shop: shopJson(view) }).where(eq(sellers.id, sellerId))
}

/** 문서 패키지의 가게 설정 모양 (확인서 — 계좌가 없으면 계좌·안내 칸이 없다) */
export function documentShop(view: ShopView): ShopSettings {
  const hasAccount = view.accountNumber !== ''
  return {
    name: view.name,
    account: hasAccount ? { bank: view.bank, number: view.accountNumber, holder: view.accountHolder } : null,
    accountNote: hasAccount && view.accountNote !== '' ? view.accountNote : null,
  }
}
