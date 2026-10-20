// 판매자·계정 만들기 (AC-S04-32·40, D-073, D-074). 가입 API는 없다 — 운영자가 명령(commands/create-account.ts)으로 만든다.
// 판매자를 만들 때 32바이트 무작위 전화번호 키를 만들어 마스터 키로 암호화해 저장한다(평문 키는 DB·로그·응답에 없다).
// N5: 선택 항목 사업자등록번호(G-BIL bizno로 읽는다 — 틀리면 계정을 만들지 않는다). 번호만 암호화해 사업자 정보에 두고, 상호·대표자는 화면에서 적는다(AC-N5-12).
import { randomInt } from 'node:crypto'
import { hasControlChar } from './api-fields.ts'
import type { Db } from './db/database.ts'
import { BILLING_MESSAGES, sealedBusinessNumber } from './billing/service.ts'
import { parseBizno } from './billing/rules.ts'
import { accounts, billingBusiness, sellers } from './db/schema.ts'
import { randomIds, type IdSource } from './ids.ts'
import { DEFAULT_PASSWORD_COST, hashPassword, newSealedSellerKey, type PasswordCost } from './secrets.ts'
import { insertAssistant, listAssistants, lockSeller, loginIdTaken, type AssistantRow } from './store.ts'
import { systemClock, type Clock } from './time.ts'
import { uniqueViolation } from './writer.ts'

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
  /** 사업자등록번호 (선택, N5) */
  readonly businessNumber?: string
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
  let businessNumber: string | null = null
  if (input.businessNumber !== undefined) {
    const parsed = parseBizno(input.businessNumber)
    if ('error' in parsed) return { ok: false, message: BILLING_MESSAGES.biznoChecksum }
    businessNumber = parsed.ok
  }
  // 지운 보조자의 아이디도 다시 쓰지 않는다 (AC-I3-62)
  if (await loginIdTaken(db, loginId)) return { ok: false, message: '이미 있는 아이디예요.' }
  const ids = options.ids ?? randomIds
  const now = new Date((options.clock ?? systemClock).now())
  const sellerId = ids.seller()
  const accountId = ids.account()
  const passwordHash = await hashPassword(input.password, options.passwordCost ?? DEFAULT_PASSWORD_COST)
  await db.transaction(async (tx) => {
    await tx.insert(sellers).values({ id: sellerId, name: shopName, phoneKeyEnc: newSealedSellerKey(masterKey, sellerId), settings: '{}', createdAt: now })
    await tx.insert(accounts).values({ id: accountId, sellerId, loginId, passwordHash, createdAt: now })
    if (businessNumber !== null) {
      const sealed = sealedBusinessNumber(masterKey, sellerId, businessNumber)
      await tx.insert(billingBusiness).values({ sellerId, sealed: sealed.sealed, masked: sealed.masked, receiptKind: 'TAX_INVOICE', updatedAt: now })
    }
  })
  return { ok: true, sellerId, accountId, loginId }
}

// ── 판매자가 화면에서 정하는 이름 (가게 이름 AC-I3-47 · 보조자 이름 AC-I3-60) ──────────────

/**
 * 줄바꿈·제어·서식 글자 (Unicode Cc·Cf — 방향 바꾸기 글자 U+202E·폭 없는 글자 포함)
 * + 줄 나눔 글자 U+2028(Zl)·문단 나눔 글자 U+2029(Zp) — 이것도 줄바꿈이라 한 줄로 보여야 하는 위 줄·라벨이 두 줄이 된다 (SA-I3-007)
 * + 짝 없는 서로게이트(Cs) — 글자가 아니다. `u` 플래그에서 짝 맞은 서로게이트(이모지)는 한 코드 포인트라 걸리지 않는다
 */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u

/** 앞뒤 공백을 뺀 1~max자(코드 포인트)이고 제어·서식 글자가 없으면 그 값, 아니면 null. 휴대폰 번호 검사는 하지 않는다(D-I3-10) */
export function cleanDisplayName(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  const length = [...trimmed].length
  if (length < 1 || length > max || CONTROL_OR_FORMAT.test(trimmed)) return null
  return trimmed
}

export const SHOP_NAME_MAX = 30
export const SHOP_NAME_MESSAGE = '가게 이름은 1~30자로 적어 주세요.'

// ── 보조자 계정 (SYS-04, D-I3-11, AC-I3-60) ────────────────────────────────

export const ASSISTANT_LIMIT = 5
export const ASSISTANT_NAME_MAX = 20
export const ASSISTANT_NAME_MESSAGE = '보조자 이름은 1~20자로 적어 주세요.'
export const ASSISTANT_LIMIT_MESSAGE = '보조자는 5명까지 만들 수 있어요.'
/** 보조자 아이디: `bo-` + 8자. 헷갈리는 글자(i·l·o·0·1)를 뺀 영문 소문자·숫자 — LOGIN_ID_RE를 지킨다 */
const LOGIN_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const LOGIN_RANDOM_LENGTH = 8
/** 보조자 비밀번호: 18자, 헷갈리는 글자 `0 O o 1 l I`를 뺀 영문·숫자 (약 103비트) */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
export const ASSISTANT_PASSWORD_LENGTH = 18

function randomText(alphabet: string, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)]
  return out
}

export function newAssistantLoginId(): string {
  return `bo-${randomText(LOGIN_ALPHABET, LOGIN_RANDOM_LENGTH)}`
}

export function newAssistantPassword(): string {
  return randomText(PASSWORD_ALPHABET, ASSISTANT_PASSWORD_LENGTH)
}

export type CreateAssistantResult =
  | { readonly ok: true; readonly assistant: AssistantRow; readonly password: string }
  | { readonly ok: false; readonly reason: 'name' | 'limit' | 'seller' }

/**
 * 판매자가 보조자를 만든다. 서버가 아이디·비밀번호를 만들고 비밀번호는 이 결과에만 담는다(DB엔 scrypt 해시만).
 * 같은 판매자의 만들기는 판매자 행을 잠가 하나씩 한다 — 동시에 보내도 5명을 넘지 않는다. 받은 값·만든 값은 로그에 남기지 않는다
 */
export async function createAssistant(
  db: Db,
  sellerId: string,
  rawName: unknown,
  options: { readonly ids?: Pick<IdSource, 'account'>; readonly clock?: Clock; readonly passwordCost?: PasswordCost } = {},
): Promise<CreateAssistantResult> {
  const name = cleanDisplayName(rawName, ASSISTANT_NAME_MAX)
  if (name === null) return { ok: false, reason: 'name' }
  const password = newAssistantPassword()
  // 비싼 해시는 잠그기 전에
  const passwordHash = await hashPassword(password, options.passwordCost ?? DEFAULT_PASSWORD_COST)
  const ids = options.ids ?? randomIds
  for (let attempt = 0; attempt < 5; attempt++) {
    const now = new Date((options.clock ?? systemClock).now())
    const id = ids.account()
    try {
      const outcome = await db.transaction(async (tx): Promise<CreateAssistantResult> => {
        if (!(await lockSeller(tx, sellerId))) return { ok: false, reason: 'seller' }
        if ((await listAssistants(tx, sellerId)).length >= ASSISTANT_LIMIT) return { ok: false, reason: 'limit' }
        let loginId = newAssistantLoginId()
        for (let tries = 0; tries < 10 && (await loginIdTaken(tx, loginId)); tries++) loginId = newAssistantLoginId()
        await insertAssistant(tx, { id, sellerId, loginId, passwordHash, name, now })
        return { ok: true, assistant: { id, name, loginId, createdAt: now }, password }
      })
      return outcome
    } catch (error) {
      // 다른 판매자가 같은 순간 같은 아이디를 만들었다(드묾) — 처음부터 다시
      if (uniqueViolation(error) === 'accounts_login_id_uq') continue
      throw error
    }
  }
  throw new Error('보조자 아이디를 만들지 못했다')
}
