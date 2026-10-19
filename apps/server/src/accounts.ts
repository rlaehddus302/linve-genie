// 판매자·계정 만들기 (AC-S04-32·40, D-073, D-074). 가입 API는 없다 — 운영자가 명령(commands/create-account.ts)으로 만든다.
// 판매자를 만들 때 32바이트 무작위 전화번호 키를 만들어 마스터 키로 암호화해 저장한다(평문 키는 DB·로그·응답에 없다).
import { hasControlChar } from './api-fields.ts'
import type { Db } from './db/database.ts'
import { accounts, sellers } from './db/schema.ts'
import { randomIds, type IdSource } from './ids.ts'
import { DEFAULT_PASSWORD_COST, hashPassword, newSealedSellerKey, type PasswordCost } from './secrets.ts'
import { findAccountByLogin } from './store.ts'
import { systemClock, type Clock } from './time.ts'

/** 로그인 아이디: 영문 소문자로 시작, 영문 소문자·숫자·`_`·`.`·`-` 3~32자 (받은 값은 소문자로 바꿔 비교한다) */
export const LOGIN_ID_RE = /^[a-z][a-z0-9_.-]{2,31}$/
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 200
const NAME_MAX = 50

export function normalizeLoginId(raw: string): string {
  return raw.trim().toLowerCase()
}

export interface NewAccountInput {
  /** 가게 이름 */
  readonly shopName: string
  readonly loginId: string
  readonly password: string
}

export type CreateAccountResult =
  | { readonly ok: true; readonly sellerId: string; readonly accountId: string; readonly loginId: string }
  | { readonly ok: false; readonly message: string }

export interface CreateAccountOptions {
  readonly ids?: Pick<IdSource, 'seller' | 'account'>
  readonly clock?: Clock
  readonly passwordCost?: PasswordCost
}

/** 판매자와 로그인 계정을 함께 만든다. 문장에는 받은 값을 넣지 않는다 */
export async function createSellerAccount(db: Db, masterKey: Buffer, input: NewAccountInput, options: CreateAccountOptions = {}): Promise<CreateAccountResult> {
  const shopName = input.shopName.trim()
  if (shopName === '' || shopName.length > NAME_MAX || hasControlChar(shopName)) return { ok: false, message: `가게 이름은 ${String(NAME_MAX)}자 이하로 적어 주세요.` }
  const loginId = normalizeLoginId(input.loginId)
  if (!LOGIN_ID_RE.test(loginId)) return { ok: false, message: "아이디는 영문 소문자로 시작하는 3~32자(영문 소문자·숫자·'_'·'.'·'-')로 적어 주세요." }
  if (input.password.length < PASSWORD_MIN || input.password.length > PASSWORD_MAX) {
    return { ok: false, message: `비밀번호는 ${String(PASSWORD_MIN)}자 이상 ${String(PASSWORD_MAX)}자 이하로 적어 주세요.` }
  }
  if ((await findAccountByLogin(db, loginId)) !== null) return { ok: false, message: '이미 있는 아이디예요.' }
  const ids = options.ids ?? randomIds
  const now = new Date((options.clock ?? systemClock).now())
  const sellerId = ids.seller()
  const accountId = ids.account()
  const passwordHash = await hashPassword(input.password, options.passwordCost ?? DEFAULT_PASSWORD_COST)
  await db.transaction(async (tx) => {
    await tx.insert(sellers).values({ id: sellerId, name: shopName, phoneKeyEnc: newSealedSellerKey(masterKey, sellerId), settings: '{}', createdAt: now })
    await tx.insert(accounts).values({ id: accountId, sellerId, loginId, passwordHash, createdAt: now })
  })
  return { ok: true, sellerId, accountId, loginId }
}
