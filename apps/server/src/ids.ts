// 서버가 만드는 ID (시험에서 바꿔 끼울 수 있다).
// - 방송 ID: 추측할 수 없는 무작위 값, 영문·숫자·`_`·`-`만 (상품 키 `<방송>/<번호>`에 쓴다, AC-S04-21)
// - 문자찜 ref: 영문 소문자만 — 숫자가 없어 휴대폰 번호 모양이 될 수 없다(R-1, D-073). 요청이 정할 수 없다(AC-S04-31)
import { randomBytes, randomUUID, randomInt } from 'node:crypto'

export interface IdSource {
  seller(): string
  account(): string
  scope(): string
  broadcast(): string
  smsRef(): string
}

const LOWER = 'abcdefghijklmnopqrstuvwxyz'

function lowerLetters(length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += LOWER[randomInt(LOWER.length)]
  return out
}

export const randomIds: IdSource = {
  seller: () => `sel_${randomUUID()}`,
  account: () => `acc_${randomUUID()}`,
  scope: () => `scp_${randomUUID()}`,
  broadcast: () => `b_${randomBytes(12).toString('base64url')}`,
  smsRef: () => `r${lowerLetters(19)}`,
}
