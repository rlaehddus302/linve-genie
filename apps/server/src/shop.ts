// 가게 설정 (STL-04 "가게 이름·입금 계좌 안내(설정)", I2 D-I2-02, AC-I2-01). 판매 규칙 설정과 따로, 이벤트 로그 밖이다.
// - 가게 이름 = 판매자 이름(sellers.name — 로그인 정보·화면 위 가게 이름과 같은 값). 고치면 그 이름도 바뀐다.
// - 입금 계좌 = 은행·계좌번호·예금주 셋 다 적거나 셋 다 비움. 안내 문장은 계좌가 있을 때만 확인서에 나온다(문서 패키지).
// - 판매자 자신이 구매자에게 공개하는 정보라 휴대폰 번호 검사(D-079)를 하지 않는다. 서버 로그에 값을 남기지 않는다.
// - 합친 뒤(I3 AC-I3-47): PUT /api/shop은 다섯 칸(이 파일의 가게 설정) 또는 가게 이름 하나({ name } — 시작 마법사·가게 이름만)를 받는다.
//   가게 이름은 모든 입구가 같은 규칙 하나(accounts.ts checkShopNameRule — 1~30글자, 제어·서식 글자·U+2028·U+2029·짝 없는 서로게이트 거절,
//   지금 이름 그대로면 다시 따지지 않음, 문장 "가게 이름은 1~30자로 적어 주세요." — D-I2-18·D-I2-15, SA-I2-006·SA-I3-007).
import type { ShopSettings } from '@livejjim/documents'
import { eq } from 'drizzle-orm'
import { SHOP_NAME_MAX, SHOP_NAME_MESSAGE, checkShopNameRule } from './accounts.ts'
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
export { SHOP_NAME_MAX }
export const SHOP_BANK_MAX = 20
export const SHOP_ACCOUNT_NUMBER_MAX = 30
export const SHOP_HOLDER_MAX = 20
export const SHOP_NOTE_MAX = 100

export const ACCOUNT_PARTIAL_MESSAGE = '은행·계좌번호·예금주를 모두 적거나 모두 비워 주세요.'
const CONTROL_MESSAGE = '줄바꿈·탭 같은 글자는 쓸 수 없어요.'
const MESSAGES = {
  name: SHOP_NAME_MESSAGE,
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
const ACCOUNT_NUMBER_RE = /^[0-9\- ]+$/
const HAS_DIGIT_RE = /[0-9]/

const rejection = (message: string, problems: readonly FieldProblem[]): Rejection => ({ status: 400, code: 'INVALID_INPUT', message, problems })

/**
 * PUT /api/shop 본문 검사: 다섯 칸(name·bank·accountNumber·accountHolder·accountNote) 모두 문자열로. 앞뒤 공백을 지운 뒤 길이를 센다.
 * 제어 글자가 있거나·모르는 칸·형식이 틀린 값·계좌 일부만이면 저장하지 않고 칸별 문제를 돌려준다.
 * 가게 이름 칸은 가게 이름 규칙 하나(checkShopNameRule, D-I2-18)이고 문제 문장도 하나(SHOP_NAME_MESSAGE). currentName = 지금 저장된 가게 이름 —
 * 고치지 않았으면(앞뒤 공백을 지운 값이 같으면) 길이·글자를 다시 따지지 않는다(이 결정 전에 31~50자 이름으로 만든 판매자도 계좌만 적어 저장된다, SA-I2-006)
 */
export function checkShopInput(body: unknown, currentName: string | null = null): { ok: true; value: ShopView } | { ok: false; rejection: Rejection } {
  if (!isPlainObject(body)) return { ok: false, rejection: { status: 400, code: 'NOT_JSON', message: '보낸 내용의 형식이 올바르지 않아요.', problems: [] } }
  const extra = ownKeys(body).filter((key) => !(SHOP_FIELDS as readonly string[]).includes(key))
  if (extra.length > 0) return { ok: false, rejection: { status: 400, code: 'UNKNOWN_FIELD', message: '받을 수 없는 항목이 있어요.', problems: unknownFieldProblems(extra) } }
  const problems: FieldProblem[] = []
  const values: Record<(typeof SHOP_FIELDS)[number], string> = { name: '', bank: '', accountNumber: '', accountHolder: '', accountNote: '' }
  for (const field of SHOP_FIELDS) {
    const raw = own(body, field)
    if (field === 'name') {
      const name = checkShopNameRule(raw, currentName)
      if (name === null) problems.push({ field, message: SHOP_NAME_MESSAGE })
      else values.name = name
      continue
    }
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
 * 규칙은 다섯 칸 저장·계정 만들기와 같은 하나다(checkShopNameRule, D-I2-18)
 */
export function checkShopName(raw: unknown, currentName: string | null): string | null {
  return checkShopNameRule(raw, currentName)
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
