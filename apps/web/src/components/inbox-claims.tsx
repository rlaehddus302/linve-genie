// 휴대폰 알림으로 바로 넣은 문자찜 (SMS3 AC-SMS3-30): 콘솔이 찜 ID를 주고, 보드·상품 자세히가 "문자로 받음"을 붙인다.
import { createContext, useContext } from 'react'
import { INBOX_FROM_SMS } from '../lib/inbox.ts'

export const NO_INBOX_CLAIMS: ReadonlySet<string> = new Set()

export const InboxClaimsContext = createContext<ReadonlySet<string>>(NO_INBOX_CLAIMS)

export function useInboxClaims(): ReadonlySet<string> {
  return useContext(InboxClaimsContext)
}

/** "문자로 받음" 표시 (색 + 글자) */
export function FromSmsTag() {
  return <span className="tag tag-sms">{INBOX_FROM_SMS}</span>
}
