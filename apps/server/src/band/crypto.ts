// 밴드 토큰 암호화 (DAT-06, D-BND1-11·14, AC-BND1-13). 서버 마스터 키로 AES-256-GCM, 판매자 ID를 AAD로 묶는다(다른 판매자 행으로 옮기면 풀리지 않는다).
// 마스터 키가 바뀌었거나 값이 손상되면 SecretError — 부르는 쪽은 그 연결을 "다시 연결 필요"로 본다(서버는 죽지 않는다).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { SecretError } from '../secrets.ts'

const AAD = 'livejjim/band-token/v1/'

export function sealBandToken(masterKey: Buffer, sellerId: string, token: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv)
  cipher.setAAD(Buffer.from(AAD + sellerId, 'utf8'))
  const sealed = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), sealed.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.')
}

export function openBandToken(masterKey: Buffer, sellerId: string, sealed: string): string {
  const parts = sealed.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new SecretError('토큰 형식이 올바르지 않다')
  const [, ivText = '', dataText = '', tagText = ''] = parts
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(ivText, 'base64url'))
    decipher.setAAD(Buffer.from(AAD + sellerId, 'utf8'))
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
    const token = Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8')
    if (token === '') throw new SecretError('빈 토큰')
    return token
  } catch {
    throw new SecretError('토큰을 풀지 못했다 (마스터 키가 다르거나 값이 손상됨)')
  }
}

/** 해시 (경로 표 원문은 저장하지 않는다 · 바꾼 본문 비교) */
export function bandHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url')
}
