// 휴대폰 번호로 같은 사람 묶기 (D-UX3-30): 간편 로그인으로 처음 온 사람은 문자 인증을 마쳐야 계정이 생긴다.
// - 번호는 원문을 두지 않는다: 찾기용 HMAC(마스터 키에서 나눈 키)과 화면용 가린 번호(010-****-5678)만.
// - 인증번호는 6자리(암호학적 난수), 3분, 틀리기 5번까지, 다시 보내기 60초 간격, 한 확인에 5번·한 번호에 하루 10번까지.
// - 문자는 네이버 클라우드 SENS(https://sens.apigw.ntruss.com, 공식 서명 v2 = HMAC-SHA256 base64)로 보낸다(D-REAL-07, 솔라피에서 바꿈).
//   키·서비스 ID·보내는 번호가 없으면 문자 인증을 끈다(가입은 전처럼 바로).
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
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

export interface SensSetup {
  /** 네이버 클라우드 API 인증키 (Access Key ID) */
  readonly accessKey: string
  /** 네이버 클라우드 API 인증키 (Secret Key) */
  readonly secretKey: string
  /** SENS 프로젝트의 SMS 서비스 ID (ncp:sms:kr:…) */
  readonly serviceId: string
  /** SENS에 미리 등록한 보내는 번호 (숫자만) */
  readonly from: string
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
  readonly baseUrl?: string
}

/** SENS 서명 v2 (공식 문서: base64(HMAC-SHA256(secretKey, "POST {경로}\n{시각 ms}\n{accessKey}"))) */
export function sensSignature(secretKey: string, method: string, path: string, timestamp: string, accessKey: string): string {
  return createHmac('sha256', secretKey).update(`${method} ${path}\n${timestamp}\n${accessKey}`, 'utf8').digest('base64')
}

/** 통신사 기준 글자 바이트(한글 등 2, 영문·숫자 1) — 80바이트 넘으면 장문 */
export const smsBytes = (text: string): number => Array.from(text).reduce((sum, ch) => sum + ((ch.codePointAt(0) ?? 0) < 0x80 ? 1 : 2), 0)

export function sensSender(setup: SensSetup): SmsSender {
  const fetcher = setup.fetch ?? globalThis.fetch
  const base = setup.baseUrl ?? 'https://sens.apigw.ntruss.com'
  const path = `/sms/v2/services/${encodeURIComponent(setup.serviceId)}/messages`
  return {
    async send(to, text) {
      const timestamp = String(Date.now())
      const type = smsBytes(text) > 80 ? 'LMS' : 'SMS'
      let response: Response
      try {
        response = await fetcher(`${base}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'x-ncp-apigw-timestamp': timestamp,
            'x-ncp-iam-access-key': setup.accessKey,
            'x-ncp-apigw-signature-v2': sensSignature(setup.secretKey, 'POST', path, timestamp, setup.accessKey),
          },
          body: JSON.stringify({ type, contentType: 'COMM', countryCode: '82', from: setup.from, content: text, messages: [{ to }] }),
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
      // 접수되면 statusCode "202"·statusName "success"
      const status = (body as { statusName?: unknown } | null)?.statusName
      if (status !== 'success') throw new SmsSendError('rejected', response.status)
    },
  }
}

export const SMS_ENV = { accessKey: 'LIVEJJIM_SMS_NCP_ACCESS_KEY', secretKey: 'LIVEJJIM_SMS_NCP_SECRET_KEY', serviceId: 'LIVEJJIM_SMS_SENS_SERVICE_ID', from: 'LIVEJJIM_SMS_FROM' } as const

export type SmsEnvResult = { readonly ok: true; readonly setup: SensSetup | null } | { readonly ok: false; readonly message: string }

/** 문자 발송 설정: 넷 다 비면 끔, 일부만 있으면 시작하지 않는다(값은 문장에 넣지 않는다) */
export function readSmsEnv(env: Readonly<Record<string, string | undefined>>): SmsEnvResult {
  const get = (name: string) => (env[name] ?? '').trim()
  const accessKey = get(SMS_ENV.accessKey)
  const secretKey = get(SMS_ENV.secretKey)
  const serviceId = get(SMS_ENV.serviceId)
  const from = get(SMS_ENV.from).replace(/-/g, '')
  const values = [accessKey, secretKey, serviceId, from]
  if (values.every((value) => value === '')) return { ok: true, setup: null }
  if (values.some((value) => value === '')) return { ok: false, message: '문자 발송 설정이 일부만 적혀 있어요. 네이버 클라우드 인증키(Access Key·Secret Key)·SENS 서비스 ID·보내는 번호 넷 다 적거나 넷 다 지워 주세요.' }
  if (!/^\d{8,12}$/.test(from)) return { ok: false, message: '문자 보내는 번호는 숫자 8~12자리로 적어 주세요.' }
  return { ok: true, setup: { accessKey, secretKey, serviceId, from } }
}
