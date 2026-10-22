// 영수증 보내기 화면의 링크 글 (RCP-02, D-N4b-01·05, AC-N4b-32·33).
// - 링크 상태 말: "링크 있음 · 11월 4일 (화) 20:31까지"(KST) · "링크 기간 지남" · "링크 끊음" · "링크 없음".
// - 복사·공유하는 글 한 줄: `<가게 이름> 구매 내역 확인서예요. 11월 4일 (화)까지 열 수 있어요. <링크>` — 링크가 맨 끝.
// - 글 공유(Web Share)를 받는 기기인가: navigator.share가 있고, canShare가 있으면 그 글을 받는다고 할 때.
// 우리는 링크를 보내지 않는다 — 판매자가 복사하거나 기기의 공유 창으로 한 사람씩 보낸다(D-N4b-05).
import type { ReceiptLink } from '../api/types.ts'
import { kstHm, kstMonthDayWeekday } from './kst.ts'

export const LINK_NONE = '링크 없음'
export const LINK_EXPIRED = '링크 기간 지남'
export const LINK_REVOKED = '링크 끊음'

/** 쓸 수 있는 링크인가 (주소가 있다) */
export function usableLink(link: ReceiptLink | null): link is ReceiptLink & { readonly url: string; readonly expiresAt: string } {
  return link !== null && link.status === 'ACTIVE' && link.url !== null && link.expiresAt !== null
}

/** 링크 상태 말 */
export function linkWords(link: ReceiptLink | null): string {
  if (link === null) return LINK_NONE
  switch (link.status) {
    case 'ACTIVE':
      return link.expiresAt === null ? '링크 있음' : `링크 있음 · ${kstMonthDayWeekday(link.expiresAt)} ${kstHm(link.expiresAt)}까지`
    case 'EXPIRED':
      return LINK_EXPIRED
    case 'REVOKED':
      return LINK_REVOKED
    case 'NONE':
      return LINK_NONE
  }
}

/** 복사·공유하는 글 한 줄 (가게 이름이 비어 있으면 그 앞말 없이) */
export function shareText(shopName: string, expiresAt: string, url: string): string {
  const shop = shopName.trim()
  return `${shop === '' ? '' : `${shop} `}구매 내역 확인서예요. ${kstMonthDayWeekday(expiresAt)}까지 열 수 있어요. ${url}`
}

/** 이 기기가 글 공유를 하는가 */
export function canShareText(text: string): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false
    return typeof navigator.canShare !== 'function' || navigator.canShare({ text })
  } catch {
    return false
  }
}

export type TextShareOutcome = 'shared' | 'cancelled' | 'failed'

/** 글 공유 (파일 없음). 판매자가 공유 창을 닫으면(AbortError) 'cancelled' — 안내하지 않는다 */
export function shareLinkText(text: string): Promise<TextShareOutcome> {
  let pending: Promise<void>
  try {
    pending = navigator.share({ text })
  } catch {
    return Promise.resolve('failed')
  }
  return pending.then(
    () => 'shared' as const,
    (error: unknown) => (error instanceof DOMException && error.name === 'AbortError' ? ('cancelled' as const) : ('failed' as const)),
  )
}

/** 클립보드에 글을 넣는다 — 쓸 수 없으면 false (화면이 손으로 복사할 칸을 보인다) */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined || typeof navigator.clipboard.writeText !== 'function') return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
