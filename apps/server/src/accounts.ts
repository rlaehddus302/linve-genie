// 판매자·계정 만들기 (AC-S04-32·40, D-073, D-074). 가입 API는 없다 — 운영자가 명령(commands/create-account.ts)으로 만든다.
// 판매자를 만들 때 32바이트 무작위 전화번호 키를 만들어 마스터 키로 암호화해 저장한다(평문 키는 DB·로그·응답에 없다).
import { randomInt } from 'node:crypto'
import type { Db } from './db/database.ts'
import { accounts, sellers } from './db/schema.ts'
import { randomIds, type IdSource } from './ids.ts'
import { DEFAULT_PASSWORD_COST, hashPassword, newSealedSellerKey, type PasswordCost } from './secrets.ts'
import { insertAssistant, listAssistants, lockSeller, loginIdTaken, type AssistantRow } from './store.ts'
import { systemClock, type Clock } from './time.ts'
import { uniqueViolation } from './writer.ts'

/** 로그인 아이디: 영문 소문자로 시작, 영문 소문자·숫자·`_`·`.`·`-` 3~32자 (받은 값은 소문자로 바꿔 비교한다) */
export const LOGIN_ID_RE = /^[a-z][a-z0-9_.-]{2,31}$/
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 200

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

/**
 * 판매자와 로그인 계정을 함께 만든다. 문장에는 받은 값을 넣지 않는다.
 * 가게 이름은 모든 입구와 같은 규칙(checkShopNameRule — 1~30글자, D-I2-18)이고 틀리면 아무것도 만들지 않는다
 */
export async function createSellerAccount(db: Db, masterKey: Buffer, input: NewAccountInput, options: CreateAccountOptions = {}): Promise<CreateAccountResult> {
  const shopName = checkShopNameRule(input.shopName, null)
  if (shopName === null) return { ok: false, message: SHOP_NAME_MESSAGE }
  const loginId = normalizeLoginId(input.loginId)
  if (!LOGIN_ID_RE.test(loginId)) return { ok: false, message: "아이디는 영문 소문자로 시작하는 3~32자(영문 소문자·숫자·'_'·'.'·'-')로 적어 주세요." }
  if (input.password.length < PASSWORD_MIN || input.password.length > PASSWORD_MAX) {
    return { ok: false, message: `비밀번호는 ${String(PASSWORD_MIN)}자 이상 ${String(PASSWORD_MAX)}자 이하로 적어 주세요.` }
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
/** 제어 글자 U+0000~U+001F·U+007F (앞뒤 공백을 지우기 전의 글에서 본다 — 탭·줄바꿈도 받지 않는다) */
const hasRawControl = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/**
 * 가게 이름 규칙 하나 (I2 마지막 감사 SA-I2-009·TD-I2-004, D-I2-18·D-I2-15, AC-I2-01): 운영자 계정 만들기 명령·시작 마법사·설정의 PUT /api/shop 모두.
 * 앞뒤 공백을 지운 뒤 1~30글자(코드 포인트 — 그림 문자 하나 = 1글자), 제어 글자·서식 글자·U+2028·U+2029·짝 없는 서로게이트는 받지 않는다.
 * 예외: currentName(지금 저장된 이름)과 같은 이름(앞뒤 공백만 다름)은 길이·글자를 다시 따지지 않는다 — 이 결정 전에 만든 31~50자 이름의 판매자.
 * 복구·가져오기는 이 함수를 부르지 않는다(파일의 가게 이름 그대로). 맞으면 앞뒤 공백을 지운 이름, 아니면 null(문장은 SHOP_NAME_MESSAGE 하나)
 */
export function checkShopNameRule(raw: unknown, currentName: string | null): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  // 지금 이름을 그대로 다시 보내면(앞뒤 공백만 다름) 길이·글자를 다시 따지지 않는다. 다만 보낸 글에 새로 붙은 제어 글자(줄바꿈·탭)는 받지 않는다
  if (currentName !== null && name !== '' && name === currentName.trim() && (raw === currentName || !hasRawControl(raw))) return name
  if (hasRawControl(raw)) return null
  return cleanDisplayName(raw, SHOP_NAME_MAX)
}

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
