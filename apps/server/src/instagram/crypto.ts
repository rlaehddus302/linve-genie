// 인스타그램 토큰 암호화 (DAT-06, NFR-06, D-073, D-N2-06, AC-N2-13).
// 토큰 묶음(JSON)을 서버 마스터 키로 AES-256-GCM 암호화한다(판매자 전화번호 키와 같은 방식). 판매자 ID를 AAD로 묶어 다른 판매자 행으로 옮기면 풀리지 않는다.
// 마스터 키가 바뀌었거나 값이 손상되면 SecretError — 부르는 쪽은 그 연결을 "다시 연결 필요"로 본다(서버는 죽지 않는다).
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { SecretError } from '../secrets.ts'
import type { MetaTokens } from './meta.ts'

const AAD = 'livejjim/instagram-tokens/v1/'

export function sealTokens(masterKey: Buffer, sellerId: string, tokens: MetaTokens): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv)
  cipher.setAAD(Buffer.from(AAD + sellerId, 'utf8'))
  const sealed = Buffer.concat([cipher.update(JSON.stringify({ u: tokens.user, p: tokens.page, i: tokens.ig }), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), sealed.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.')
}

export function openTokens(masterKey: Buffer, sellerId: string, sealed: string): MetaTokens {
  const parts = sealed.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new SecretError('토큰 형식이 올바르지 않다')
  const [, ivText = '', dataText = '', tagText = ''] = parts
  let parsed: unknown
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(ivText, 'base64url'))
    decipher.setAAD(Buffer.from(AAD + sellerId, 'utf8'))
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
    parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8'))
  } catch {
    throw new SecretError('토큰을 풀지 못했다 (마스터 키가 다르거나 값이 손상됨)')
  }
  const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  const pick = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
  return { user: pick(record.u), page: pick(record.p), ig: pick(record.i) }
}

/** OAuth state 해시 (state 원문은 저장하지 않는다) */
export function stateHash(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('base64url')
}

/** 상수 시간 문자열 비교 (길이가 달라도 같은 비용으로 false) */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest()
  const right = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(left, right) && a.length === b.length
}
