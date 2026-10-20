// 계좌조회 원천의 사업자번호·은행·계좌번호 암호화 (DP-1 "비밀값", DAT-06, D-073 방식, AC-N3-16).
// 서버 마스터 키로 AES-256-GCM 암호화하고 판매자 ID·원천 ID를 추가 인증 데이터로 묶는다 — 다른 판매자(또는 다른 원천) 행으로 옮기면 풀리지 않는다.
// 오류 메시지에 값을 넣지 않는다. 계좌 비밀번호·빠른조회 아이디/비밀번호·생년월일은 받지도 두지도 않는다(D-N3-09).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { SecretError } from '../secrets.ts'

const AAD = 'livejjim/deposit-account/v1/'

export interface AccountSecret {
  /** 사업자번호 10자리 */
  readonly corpNum: string
  /** 팝빌 은행 코드 4자리 */
  readonly bank: string
  /** 계좌번호 (숫자만) */
  readonly accountNumber: string
}

export function sealAccount(masterKey: Buffer, sellerId: string, sourceId: string, account: AccountSecret): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv)
  cipher.setAAD(Buffer.from(`${AAD}${sellerId}/${sourceId}`, 'utf8'))
  const sealed = Buffer.concat([cipher.update(JSON.stringify([account.corpNum, account.bank, account.accountNumber]), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), sealed.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.')
}

/** 암호화한 계좌 정보를 푼다. 마스터 키·판매자·원천이 다르거나 값이 손상되면 SecretError(메시지에 값 없음) */
export function openAccount(masterKey: Buffer, sellerId: string, sourceId: string, sealed: string): AccountSecret {
  const parts = sealed.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new SecretError('계좌 정보 형식이 올바르지 않다')
  const [, ivText = '', dataText = '', tagText = ''] = parts
  let text: string
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(ivText, 'base64url'))
    decipher.setAAD(Buffer.from(`${AAD}${sellerId}/${sourceId}`, 'utf8'))
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
    text = Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    throw new SecretError('계좌 정보를 풀지 못했다 (마스터 키가 다르거나 값이 손상됨)')
  }
  const parsed: unknown = JSON.parse(text)
  if (!Array.isArray(parsed) || parsed.length !== 3 || !parsed.every((value) => typeof value === 'string')) throw new SecretError('계좌 정보 형식이 올바르지 않다')
  const [corpNum, bank, accountNumber] = parsed as [string, string, string]
  return { corpNum, bank, accountNumber }
}
