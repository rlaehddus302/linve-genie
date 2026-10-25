// 네이버 밴드 글 댓글 화면 낱말·판단 (BND1 AC-BND1-70~78, D-BND1-09·10·12·15).
// - 서버가 응답에 문장을 주는 곳(계정·연결 상태·막는 까닭·기준선·넣지 못한 수·알림·오류)은 서버 문장을 그대로 쓴다.
//   여기 문장은 서버가 주지 않는 자리(확인 창·단추·알림 띠·돌아온 결과)이고 acceptance의 따옴표 문장과 글자가 같다.
// - 영문 값(state·status·blockCode·kind)은 프로그램만 읽는다. 화면에 내보내지 않는다.
import type { BandAccount, BandLinkView } from '../api/types.ts'
import { kstTime } from './kst.ts'

/** 밴드에서 돌아온 결과 코드(`?band=`) → 문장 (서버 BAND_CALLBACK_RESULTS와 같다, AC-BND1-12) */
export const BAND_CALLBACK: Readonly<Record<string, string>> = {
  connected: '밴드를 연결했어요.',
  denied: '밴드 연결을 취소했어요.',
  expired: '연결 시간이 지났어요. 다시 해 주세요.',
  scope: '밴드 앱 권한이 모자라요. 운영자에게 문의해 주세요.',
  failed: '밴드 연결에 실패했어요. 잠시 뒤 다시 해 주세요.',
}

/** 모르는 결과 코드의 문장 (주소를 손으로 고친 경우 등) */
export const BAND_CALLBACK_UNKNOWN = '밴드 연결 결과를 확인하지 못했어요. 아래 연결 상태를 확인해 주세요.'

export function bandCallbackMessage(code: string): string {
  return Object.hasOwn(BAND_CALLBACK, code) ? (BAND_CALLBACK[code] ?? BAND_CALLBACK_UNKNOWN) : BAND_CALLBACK_UNKNOWN
}

export function bandCallbackSucceeded(code: string): boolean {
  return code === 'connected'
}

// ── 설정 "네이버 밴드" (AC-BND1-70) ─────────────────────────────────────

export const BAND_CONNECT = '밴드 연결하기'
/** 연결됨·다시 연결 필요일 때의 같은 단추 (D-BND1-19) */
export const BAND_RECONNECT = '다시 연결하기'
export const BAND_DISCONNECT = '연결 끊기'
export const BAND_NOT_CONNECTED_WORD = '연결 안 됨'
export const BAND_DISCONNECT_QUESTION = '끊으면 이어 둔 밴드 글의 댓글도 더 받지 않아요.'
export const BAND_DISCONNECT_HINT = '밴드 앱의 설정에서도 연결을 끊을 수 있어요.'

/** 설정의 연결 상태 한 줄 — 연결됨은 화면이 만든다(프로필 이름을 못 받았으면 "연결됨"만), 그 밖은 서버 문장 */
export function bandAccountWords(account: BandAccount): string {
  if (account.status === 'CONNECTED') return account.profileName === null || account.profileName === '' ? '연결됨' : `연결됨 — ${account.profileName}`
  if (account.status === 'NOT_CONNECTED') return BAND_NOT_CONNECTED_WORD
  return account.message ?? ''
}

// ── 콘솔 "밴드" 칸 (AC-BND1-71~74) ──────────────────────────────────────

export const BAND_LINK_START = '밴드 글 잇기'
export const BAND_LINK_OTHER = '다른 글 잇기'
export const BAND_LINK = '잇기'
export const BAND_UNLINK = '끊기'
export const BAND_UNLINK_QUESTION = '끊으면 이 방송의 밴드 댓글을 더 받지 않아요. 이미 받은 찜은 그대로예요.'
export const BAND_LINK_CONFIRM = '이 글에 지금부터 달리는 댓글을 찜으로 받아요. 이미 달려 있는 댓글은 넣지 않아요. 글을 올린 뒤 바로 이어 주세요.'
export const BAND_LINK_BUSY = '글을 읽는 중이에요…'
export const BAND_NO_POSTS = '이 밴드에 내가 쓴 글이 없어요. 밴드 앱에서 공지 글을 먼저 올려 주세요.'
export const BAND_MORE = '더 보기'
export const BAND_PICK_AGAIN = '밴드 다시 고르기'
export const BAND_POST_AGAIN = '글 다시 고르기'
export const BAND_NO_LINK = '이은 밴드 글이 없어요.'
/** 알림 띠 (AC-BND1-73) */
export const BAND_NOT_COMING = '밴드 댓글이 들어오지 않아요.'
export const BAND_SEEN = '확인했어요'
export const BAND_NEW_NOTICE = '새 알림'

/** 알림 띠 한 줄 — 확인하지 않은 밴드 알림을 종류와 상관없이 센다 (D-BND1-17) */
export function bandNoticesMessage(count: number): string {
  return `확인하지 않은 밴드 알림이 ${String(count)}개 있어요.`
}

/** 설정 칸의 연결 단추 글자 — 연결됨·다시 연결 필요면 "다시 연결하기" (D-BND1-19) */
export function bandConnectLabel(account: BandAccount): string {
  return account.status === 'CONNECTED' || account.status === 'RECONNECT_NEEDED' ? BAND_RECONNECT : BAND_CONNECT
}

/** "HH:MM:SS에 읽었어요" (KST) */
export function bandReadWords(at: string): string {
  const time = kstTime(at)
  return time === '' ? '' : `${time}에 읽었어요`
}

export function bandCommentCountWords(count: number | null): string {
  return count === null ? '' : `댓글 ${count.toLocaleString('ko-KR')}개`
}

export function bandMemberWords(count: number | null): string {
  return count === null ? '' : `멤버 ${count.toLocaleString('ko-KR')}명`
}

/** 이 회차에 끝나지 않은 밴드 글 연결이 있다 (읽는 중·다시 시도·멈춤 — 끊거나 회차를 끝내기 전) */
export function bandLinkOpen(link: BandLinkView | null): boolean {
  return link !== null && link.state !== 'NONE' && link.state !== 'FINISHED'
}

/** 설정에서 고쳐야 이을 수 있는 막힘 ("설정으로") */
const SETTINGS_BLOCKS: ReadonlySet<string> = new Set(['NOT_CONFIGURED', 'NOT_CONNECTED', 'RECONNECT_NEEDED'])

export function bandNeedsSettings(link: BandLinkView): boolean {
  if (link.state === 'RECONNECT_NEEDED') return true
  return !bandLinkOpen(link) && !link.canLink && link.blockCode !== null && SETTINGS_BLOCKS.has(link.blockCode)
}

/** 다시 시도 중인 채 이만큼 지나면 알림 띠에 올린다 (AC-BND1-73) */
export const BAND_RETRY_ALERT_MS = 60_000

/**
 * 밴드 댓글이 들어오지 않는다 (알림 띠 한 줄, AC-BND1-73): 다시 시도 중인 채 60초가 넘었거나(마지막으로 읽은 때 — 없으면 이은 때부터)
 * 다시 연결 필요·읽을 수 없음·유튜브를 이은 회차. 읽는 중·끝남은 아니다.
 */
export function bandNotComing(link: BandLinkView | null, now: number): boolean {
  if (link === null) return false
  if (link.state === 'RECONNECT_NEEDED' || link.state === 'NO_ACCESS' || link.state === 'YOUTUBE_LINKED') return true
  if (link.state !== 'RETRYING') return false
  const since = Date.parse(link.lastReadAt ?? link.linkedAt ?? '')
  return Number.isFinite(since) && now - since > BAND_RETRY_ALERT_MS
}

/** 다시 시도 중인 채 60초가 되는 때 (그때 알림 띠를 다시 본다) — 없으면 null */
export function bandRetryAlertAt(link: BandLinkView | null): number | null {
  if (link?.state !== 'RETRYING') return null
  const since = Date.parse(link.lastReadAt ?? link.linkedAt ?? '')
  return Number.isFinite(since) ? since + BAND_RETRY_ALERT_MS + 1 : null
}

/** 알림 띠의 확인하지 않은 밴드 알림 수 (지운·고친 댓글·늦게 읽음·막다른 경우 모두, D-BND1-17) — 끝난 연결은 띄우지 않는다 */
export function bandUnseen(link: BandLinkView | null): number {
  if (link === null || link.state === 'NONE' || link.state === 'FINISHED') return 0
  return Math.max(0, link.notices.unseen)
}

/** "확인했어요"로 보낼 번호 = 화면이 본 마지막 알림 번호 (없으면 null) */
export function bandSeenUpTo(link: BandLinkView | null): number | null {
  if (link === null || link.notices.items.length === 0) return null
  return link.notices.items.reduce((max, item) => Math.max(max, item.id), 0)
}
