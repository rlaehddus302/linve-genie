// 휴대폰 번호로 같은 사람 묶기 (D-UX3-30): 간편 로그인으로 처음 온 사람은 문자 인증을 마쳐야 계정이 생긴다.
// - 번호는 원문을 두지 않는다: 찾기용 HMAC(마스터 키에서 나눈 키)과 화면용 가린 번호(010-****-5678)만.
// - 인증번호는 6자리(암호학적 난수), 3분, 틀리기 5번까지, 다시 보내기 60초 간격, 한 확인에 5번·한 번호에 하루 10번까지.
// - 문자는 솔라피(https://api.solapi.com, 공식 SDK와 같은 HMAC-SHA256 서명)로 보낸다. 키·보내는 번호가 없으면 문자 인증을 끈다(가입은 전처럼 바로).
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { SERVICE_NAME } from '../brand.ts'

export const CODE_TTL_MS = 3 * 60 * 1000
export const CODE_MAX_ATTEMPTS = 5
export const RESEND_GAP_MS = 60 * 1000
export const CHECK_MAX_SENDS = 5
export const PHONE_DAY_MAX_SENDS = 10
export const DAY_MS = 24 * 60 * 60 * 1000

/** 휴대폰 번호 정규화: 숫자만, +82·82 → 0, 010·011·016·017·018·019 + 7~8자리. 아니면 null */
export function normalizeMobile(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 40) return null
  let digits = input.replace(/[\s\-().]/g, '')
  if (digits.startsWith('+82')) digits = `0${digits.slice(3)}`
  else if (digits.startsWith('82') && digits.length >= 11) digits = `0${digits.slice(2)}`
  if (digits.startsWith('00')) digits = digits.slice(1)
  return /^01[016789]\d{7,8}$/.test(digits) ? digits : null
}

/** 화면에 보일 가린 번호 (010-****-5678) */
export function maskedMobile(normalized: string): string {
  return `${normalized.slice(0, 3)}-****-${normalized.slice(-4)}`
}

const PHONE_HASH_INFO = 'livejjim/account-phone/v1'
const CODE_INFO = 'livejjim/phone-code/v1'

/** 계정 찾기용 번호 해시 = HMAC-SHA256(마스터 키에서 나눈 키, 정규화한 번호)의 base64url */
export function accountPhoneHash(masterKey: Buffer, normalized: string): string {
  const key = createHmac('sha256', masterKey).update(PHONE_HASH_INFO, 'utf8').digest()
  return createHmac('sha256', key).update(normalized, 'utf8').digest('base64url')
}

/** 인증번호 해시 (확인 키에 묶는다 — 다른 확인의 번호로 통과하지 못하게) */
export function codeHash(masterKey: Buffer, checkKey: string, code: string): string {
  const key = createHmac('sha256', masterKey).update(CODE_INFO, 'utf8').digest()
  return createHmac('sha256', key).update(`${checkKey}\n${code}`, 'utf8').digest('base64url')
}

export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0')

export const codeText = (code: string): string => `[${SERVICE_NAME}] 인증번호 ${code}\n3분 안에 넣어 주세요. 남에게 알려 주지 마세요.`

// ── 문자 보내기 ───────────────────────────────────────────────────────────

export interface SmsSender {
  /** 문자 한 통을 보낸다. 접수되지 않으면 던진다 (문장·로그에 번호·본문을 넣지 않는다) */
  send(to: string, text: string): Promise<void>
}

export class SmsSendError extends Error {
  readonly kind: string
  readonly status: number | null
  constructor(kind: string, status: number | null) {
    super(`SMS_${kind}`)
    this.kind = kind
    this.status = status
  }
}

export interface SolapiSetup {
  readonly apiKey: string
  readonly apiSecret: string
  /** 솔라피에 미리 등록한 보내는 번호 (숫자만) */
  readonly from: string
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
  readonly baseUrl?: string
}

/** 솔라피 Authorization 머리 (공식 SDK getAuthInfo와 같다: signature = hex HMAC-SHA256(secret, date + salt)) */
export function solapiAuthorization(apiKey: string, apiSecret: string, date: string, salt: string): string {
  const signature = createHmac('sha256', apiSecret).update(date + salt).digest('hex')
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`
}

const SALT_ALPHABET = '1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function solapiSender(setup: SolapiSetup): SmsSender {
  const fetcher = setup.fetch ?? globalThis.fetch
  const base = setup.baseUrl ?? 'https://api.solapi.com'
  return {
    async send(to, text) {
      const salt = Array.from(randomBytes(32), (byte) => SALT_ALPHABET[byte % SALT_ALPHABET.length]).join('')
      const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
      let response: Response
      try {
        response = await fetcher(`${base}/messages/v4/send-many/detail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: solapiAuthorization(setup.apiKey, setup.apiSecret, date, salt) },
          body: JSON.stringify({ messages: [{ to, from: setup.from, text }] }),
          signal: AbortSignal.timeout(setup.timeoutMs ?? 10_000),
        })
      } catch {
        throw new SmsSendError('network', null)
      }
      if (!response.ok) throw new SmsSendError('http', response.status)
      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new SmsSendError('body', response.status)
      }
      const failed = (body as { failedMessageList?: unknown } | null)?.failedMessageList
      if (Array.isArray(failed) && failed.length > 0) throw new SmsSendError('rejected', response.status)
    },
  }
}

export const SMS_ENV = { apiKey: 'LIVEJJIM_SMS_SOLAPI_API_KEY', apiSecret: 'LIVEJJIM_SMS_SOLAPI_API_SECRET', from: 'LIVEJJIM_SMS_FROM' } as const

export type SmsEnvResult = { readonly ok: true; readonly setup: SolapiSetup | null } | { readonly ok: false; readonly message: string }

/** 문자 발송 설정: 셋 다 비면 끔, 일부만 있으면 시작하지 않는다(값은 문장에 넣지 않는다) */
export function readSmsEnv(env: Readonly<Record<string, string | undefined>>): SmsEnvResult {
  const get = (name: string) => (env[name] ?? '').trim()
  const apiKey = get(SMS_ENV.apiKey)
  const apiSecret = get(SMS_ENV.apiSecret)
  const from = get(SMS_ENV.from).replace(/-/g, '')
  if (apiKey === '' && apiSecret === '' && from === '') return { ok: true, setup: null }
  if (apiKey === '' || apiSecret === '' || from === '') return { ok: false, message: '문자 발송 설정이 반만 적혀 있어요. 솔라피 API 키·비밀값·보내는 번호 셋 다 적거나 셋 다 지워 주세요.' }
  if (!/^\d{8,12}$/.test(from)) return { ok: false, message: '문자 보내는 번호는 숫자 8~12자리로 적어 주세요.' }
  return { ok: true, setup: { apiKey, apiSecret, from } }
}
