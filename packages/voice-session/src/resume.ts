// 음성 원문을 서버에 보관하지 않고, 기기가 메모리에 들고 있던 대기 화면의 발급 여부만 검증한다.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import type { VoiceResumeView } from './controller/controller.ts'
import { fromWire, isRecord, toWire } from './wire.ts'

const key = randomBytes(32)
const signature = (value: string) => createHmac('sha256', key).update(value).digest()
export function sealResume(scope: string, view: VoiceResumeView, now: number): string {
  const plain = Buffer.from(JSON.stringify({ scope, expires: now + 3 * 60 * 60 * 1000, view: toWire(view) }))
  if (plain.byteLength > 128 * 1024) return ''
  const body = deflateRawSync(plain).toString('base64url')
  const token = `${body}.${signature(body).toString('base64url')}`
  return token.length <= 12_000 ? token : ''
}
export function openResume(token: string, scope: string, now: number): VoiceResumeView | null {
  try {
    if (token.length > 12_000) return null
    const [body, signed, extra] = token.split('.')
    if (body === undefined || signed === undefined || extra !== undefined) return null
    const actual = Buffer.from(signed, 'base64url'), expected = signature(body)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
    const decoded: unknown = JSON.parse(inflateRawSync(Buffer.from(body, 'base64url'), { maxOutputLength: 128 * 1024 }).toString('utf8'))
    if (!isRecord(decoded) || decoded.scope !== scope || typeof decoded.expires !== 'number' || decoded.expires < now) return null
    const view = fromWire(decoded.view)
    if (!isRecord(view) || !Array.isArray(view.cards) || !Array.isArray(view.sms) || !Array.isArray(view.offers) || !Array.isArray(view.recent) || !(view.forms instanceof Map) || !(view.notes instanceof Map) || !(view.info instanceof Map) || !(view.smsRequests instanceof Map) || !(view.smsChoices instanceof Map)) return null
    return view as unknown as VoiceResumeView
  } catch { return null }
}
