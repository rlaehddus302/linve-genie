// 비밀값 다루기 (D-073, D-074).
// - 서버 마스터 키(환경 변수, 32바이트): 판매자 전화번호 키를 AES-256-GCM으로 암호화한다.
// - 판매자 전화번호 키(판매자마다 무작위 32바이트): phoneKey = HMAC-SHA256(판매자 키, 정규화한 번호)의 base64url.
// - 비밀번호: scrypt 해시만 저장한다. 세션 토큰: 무작위 32바이트, 서버엔 SHA-256 해시만.
// - 로그인 시도 수 표의 키: 마스터 키에서 나눈 키로 만든 아이디 HMAC (아이디 원문은 DB에 없다).
// 오류 메시지에 비밀값·입력값을 넣지 않는다.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

const KEY_BYTES = 32

/** 마스터 키 읽기 결과 (값은 담지 않는다) */
export type MasterKeyResult = { readonly ok: true; readonly key: Buffer } | { readonly ok: false; readonly message: string }

/**
 * 마스터 키 문자열(base64 또는 base64url, 디코딩하면 정확히 32바이트)을 읽는다.
 * 없거나 형식이 틀리면 쉬운 문장을 돌려준다 — 받은 값은 문장에 넣지 않는다.
 */
export function readMasterKey(raw: string | undefined): MasterKeyResult {
  if (raw === undefined || raw.trim() === '') return { ok: false, message: '서버 마스터 키(LIVEJJIM_MASTER_KEY)가 없어요.' }
  const text = raw.trim()
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(text)) return { ok: false, message: '서버 마스터 키(LIVEJJIM_MASTER_KEY) 형식이 올바르지 않아요. 32바이트를 base64로 적어 주세요.' }
  const key = Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (key.length !== KEY_BYTES) return { ok: false, message: '서버 마스터 키(LIVEJJIM_MASTER_KEY) 길이가 맞지 않아요. 32바이트를 base64로 적어 주세요.' }
  return { ok: true, key }
}

/** 새 마스터 키 (운영자가 처음 한 번 만든다 — 시험은 시험 안에서 만든다) */
export function generateMasterKey(): string {
  return randomBytes(KEY_BYTES).toString('base64')
}

const SELLER_KEY_AAD = 'livejjim/seller-phone-key/v1/'

/** 판매자 전화번호 키를 새로 만들어 마스터 키로 암호화한 문자열을 돌려준다 (판매자 ID를 함께 묶어 다른 판매자 행으로 옮기면 풀리지 않는다) */
export function newSealedSellerKey(masterKey: Buffer, sellerId: string): string {
  return sealSellerKey(masterKey, sellerId, randomBytes(KEY_BYTES))
}

export function sealSellerKey(masterKey: Buffer, sellerId: string, sellerKey: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv)
  cipher.setAAD(Buffer.from(SELLER_KEY_AAD + sellerId, 'utf8'))
  const sealed = Buffer.concat([cipher.update(sellerKey), cipher.final()])
  return ['v1', iv.toString('base64url'), sealed.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.')
}

/** 암호화한 판매자 키를 푼다. 마스터 키가 다르거나 값이 손상되면 오류(메시지에 값 없음) */
export function openSellerKey(masterKey: Buffer, sellerId: string, sealed: string): Buffer {
  const parts = sealed.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new SecretError('판매자 키 형식이 올바르지 않다')
  const [, ivText = '', dataText = '', tagText = ''] = parts
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(ivText, 'base64url'))
    decipher.setAAD(Buffer.from(SELLER_KEY_AAD + sellerId, 'utf8'))
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
    const key = Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()])
    if (key.length !== KEY_BYTES) throw new SecretError('판매자 키 길이가 맞지 않다')
    return key
  } catch (error) {
    if (error instanceof SecretError) throw error
    throw new SecretError('판매자 키를 풀지 못했다 (마스터 키가 다르거나 값이 손상됨)')
  }
}

/** 비밀값 처리 오류. 메시지에 비밀값·입력값이 없다 */
export class SecretError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretError'
  }
}

/** phoneKey = HMAC-SHA256(판매자 키, 정규화한 번호)의 base64url (43자, D-061·D-073) */
export function phoneKeyOf(sellerKey: Buffer, normalizedPhone: string): string {
  return createHmac('sha256', sellerKey).update(normalizedPhone, 'utf8').digest('base64url')
}

// ── 로그인 시도 수의 아이디 키 ─────────────────────────────────────────────

const LOGIN_LIMIT_INFO = 'livejjim/login-limit-key/v1'

/** 로그인 시도 수 표의 키를 만드는 비밀 키 (마스터 키에서 나눈다 — 인스턴스·재시작마다 같다) */
export function loginLimitSecret(masterKey: Buffer): Buffer {
  return createHmac('sha256', masterKey).update(LOGIN_LIMIT_INFO, 'utf8').digest()
}

/** 로그인 시도 수 표의 키 = HMAC-SHA256(나눈 키, 정규화한 아이디)의 base64url. 아이디 칸에 전화번호를 적어도 DB에서 되돌릴 수 없다 */
export function loginLimitKey(secret: Buffer, normalizedLoginId: string): string {
  return createHmac('sha256', secret).update(normalizedLoginId, 'utf8').digest('base64url')
}

// ── 비밀번호 (scrypt) ──────────────────────────────────────────────────────

/** scrypt 비용. 운영 기본값은 N=2^15. 시험은 낮춰서 빠르게 돈다 */
export interface PasswordCost {
  readonly N: number
  readonly r: number
  readonly p: number
}

export const DEFAULT_PASSWORD_COST: PasswordCost = { N: 2 ** 15, r: 8, p: 1 }

function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) => (error ? reject(error) : resolve(derived)))
  })
}

const scryptOptions = (cost: PasswordCost): ScryptOptions => ({ N: cost.N, r: cost.r, p: cost.p, maxmem: 256 * cost.N * cost.r * cost.p })

/** 비밀번호 해시: `scrypt$N$r$p$salt$hash` (base64url) */
export async function hashPassword(password: string, cost: PasswordCost = DEFAULT_PASSWORD_COST): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, 32, scryptOptions(cost))
  return ['scrypt', cost.N, cost.r, cost.p, salt.toString('base64url'), derived.toString('base64url')].join('$')
}

/** 저장한 해시와 비밀번호가 맞는지 (해시 형식이 틀리면 false) */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, nText = '', rText = '', pText = '', saltText = '', hashText = ''] = parts
  const cost = { N: Number(nText), r: Number(rText), p: Number(pText) }
  if (![cost.N, cost.r, cost.p].every((value) => Number.isSafeInteger(value) && value > 0)) return false
  const expected = Buffer.from(hashText, 'base64url')
  if (expected.length !== 32) return false
  try {
    const derived = await scryptAsync(password, Buffer.from(saltText, 'base64url'), 32, scryptOptions(cost))
    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

// ── 세션 토큰 ──────────────────────────────────────────────────────────────

/** 새 세션 토큰 (무작위 32바이트, base64url 43자) */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/** 서버에 두는 세션 토큰 해시 */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url')
}

/** 문자열 SHA-256 (hex) */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
