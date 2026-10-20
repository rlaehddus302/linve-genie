// 여러 플랫폼(유튜브·인스타그램·틱톡) 화면 낱말·판단 (PLT-01·02·03, D-N2-15, D-N2b-2-02·13, AC-N2b-2-60~68).
// - 플랫폼 이름은 키 접두어 하나로 정한다(서버 platformOfKey와 같다): `ig:` 인스타그램 · `tt:` 틱톡 · `sms:` 문자 · 그 밖 유튜브.
// - 서버가 응답에 문장을 주는 곳(수집 상태·오류)은 서버 문장을 그대로 쓴다. 여기 문장은 서버가 응답으로 주지 않는 자리
//   (조회 결과만으로 정하는 안내·확인 창·화면 문장)이고 acceptance의 따옴표 문장과 글자가 같다.
import type { Buyer, ChatMessage, InstagramDmRow, TikTokCollection, TikTokSettings } from '../api/types.ts'

export type KeyPlatform = 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'SMS'

/** 키 → 플랫폼 (구매자 ID·채팅 채널) */
export function platformOfKey(key: string): KeyPlatform {
  if (key.startsWith('ig:')) return 'INSTAGRAM'
  if (key.startsWith('tt:')) return 'TIKTOK'
  if (key.startsWith('sms:')) return 'SMS'
  return 'YOUTUBE'
}

/** 화면에 붙이는 플랫폼 글자 (색만으로 구분하지 않는다) */
export const PLATFORM_WORD: Readonly<Record<KeyPlatform, string>> = {
  YOUTUBE: '유튜브',
  INSTAGRAM: '인스타그램',
  TIKTOK: '틱톡',
  SMS: '문자',
}

/** 구매자 종류 글자: 유튜브·인스타그램·틱톡·문자 (인스타·틱톡 구매자가 없는 날은 지금처럼 유튜브·문자뿐이다) */
export function buyerPlatformWord(buyer: Pick<Buyer, 'id' | 'kind'>): string {
  if (buyer.kind === 'sms') return PLATFORM_WORD.SMS
  return PLATFORM_WORD[platformOfKey(buyer.id)]
}

/**
 * 채팅 줄마다 플랫폼 글자를 붙일지 (AC-N2b-2-65): 그 회차에 인스타그램·틱톡 채팅이 있거나 인스타그램·틱톡이 이어져 있으면 모든 줄에.
 * 유튜브만 이은(또는 아무것도 잇지 않은) 회차는 지금 화면 그대로.
 */
export function chatPlatformTags(messages: readonly Pick<ChatMessage, 'channel'>[], otherLinked: boolean): boolean {
  return otherLinked || messages.some((message) => platformOfKey(message.channel) !== 'YOUTUBE')
}

/** 둘 이상 이으면 보이는 도착순 안내 (AC-N2b-2-61, D-N2b-2-02) */
export const MULTI_PLATFORM_NOTICE = '여러 플랫폼을 함께 이으면 서버에 먼저 도착한 댓글이 먼저예요. 플랫폼마다 댓글이 도착하는 속도가 조금씩 달라요.'
/** 리허설 회차의 인스타그램·틱톡 칸 자리 (AC-N2b-2-60) */
export const REHEARSAL_LIVE = '리허설 방송에는 라이브를 이을 수 없어요.'

// ── 틱톡 ─────────────────────────────────────────────────────────────

/** 콘솔 틱톡 칸의 준비 안 됨 문장 (서버 잇기 거절 문장과 같다 — AC-N2b-2-30 표) */
export const TIKTOK_NOT_READY = '지금은 틱톡 연결을 쓸 수 없어요. 댓글을 직접 넣어 주세요.'
export const TIKTOK_NO_CONSENT = '틱톡 연결이 꺼져 있어요. 설정에서 안내를 읽고 켜 주세요.'
export const TIKTOK_NO_ID = '설정에서 내 틱톡 아이디를 먼저 넣어 주세요.'
/** 알림 띠 한 줄 (AC-N2b-2-62) */
export const TIKTOK_PASTE_ALERT = '틱톡 댓글이 들어오지 않아요. 댓글을 직접 붙여 넣어 주세요.'
export const TIKTOK_UNLINK_QUESTION = '끊으면 이 방송의 틱톡 댓글을 더 받지 않아요. 이미 받은 찜은 그대로예요.'
export const TIKTOK_OFF_QUESTION = '끄면 틱톡 댓글을 바로 그만 받아요. 끌까요?'

/** 판매자의 틱톡 동의가 지금 판으로 켜져 있는가 */
export function tiktokConsentOn(settings: Pick<TikTokSettings, 'consent' | 'notice'>): boolean {
  return settings.consent?.on === true && settings.consent.version === settings.notice.version
}

/** 콘솔에서 잇기 전에 막히는 이유 (없으면 null = 이을 수 있음) */
export function tiktokBlocker(settings: TikTokSettings, readyReason: string | undefined): string | null {
  if (!settings.operator) return readyReason ?? TIKTOK_NOT_READY
  if (!tiktokConsentOn(settings)) return TIKTOK_NO_CONSENT
  if (settings.tiktokId === null) return TIKTOK_NO_ID
  return null
}

/** "다시 연결"을 보이는 상태 */
export function tiktokReconnectable(collection: TikTokCollection | null): boolean {
  return collection !== null && ['RETRYING', 'STOPPED', 'ENDED', 'OFF'].includes(collection.state)
}

/** 댓글이 들어오지 않는 상태 — "댓글 붙여넣기"가 주 단추, 알림 띠 한 줄 (AC-N2b-2-62) */
export function tiktokNeedsPaste(collection: TikTokCollection | null): boolean {
  if (collection === null || collection.state === 'FINISHED') return false
  if (collection.missed) return true
  if (collection.state === 'STOPPED' || collection.state === 'OFF') return true
  return collection.state === 'RETRYING' && (collection.reason === 'BLOCKED' || collection.reason === 'SIGN_FAILED')
}

// ── 인스타그램 ───────────────────────────────────────────────────────

export const INSTAGRAM_NOT_CONFIGURED = '인스타그램 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요.'
export const INSTAGRAM_NOT_CONNECTED = '인스타그램 계정을 먼저 연결해 주세요.'
export const INSTAGRAM_RECONNECT = '인스타그램 연결을 다시 해 주세요.'
export const INSTAGRAM_UNLINK_QUESTION = '끊으면 이 방송의 인스타그램 댓글을 더 받지 않아요. 이미 받은 찜은 그대로예요.'
export const INSTAGRAM_DISCONNECT_QUESTION = '연결을 끊으면 인스타그램 댓글을 받지 않고 감사 DM도 보내지 않아요. 끊을까요?'
export const INSTAGRAM_CONSENT_EXPLAIN = '동의한 뒤에 확정된 판매부터 DM을 보내고, 그 전 판매는 보내지 않아요.'
export const INSTAGRAM_LIVES_EMPTY = '진행 중인 인스타그램 라이브가 없어요. 인스타그램에서 라이브를 시작한 뒤 다시 눌러 주세요.'

/** 인스타그램에서 돌아온 결과 코드(`?instagram=`) → 문장 (서버 CALLBACK_MESSAGES와 같다) */
export const INSTAGRAM_CALLBACK: Readonly<Record<string, string>> = {
  CONNECTED: '인스타그램 계정을 연결했어요.',
  CONSENT_ON: '인스타그램 DM 자동 발송을 켰어요.',
  NO_MESSAGE_PERMISSION: 'DM을 보내는 권한을 허락하지 않아 자동 발송을 켜지 못했어요.',
  STATE_INVALID: '연결 시간이 지났어요. 다시 시도해 주세요.',
  DENIED: '인스타그램 연결을 허락하지 않았어요. 다시 시도해 주세요.',
  NO_ACCOUNT: '연결할 수 있는 인스타그램 프로페셔널(비즈니스·크리에이터) 계정이 없어요.',
  MANY_ACCOUNTS: '인스타그램 계정을 하나만 골라 다시 연결해 주세요.',
  NO_COMMENT_PERMISSION: '댓글을 읽는 권한을 허락해야 연결할 수 있어요. 다시 연결해 주세요.',
  ACCOUNT_TAKEN: '이 인스타그램 계정은 연결할 수 없어요. 운영자에게 문의해 주세요.',
  OTHER_ACCOUNT: '처음 연결한 계정과 달라요. 바꾸려면 먼저 연결을 끊어 주세요.',
  SUBSCRIBE_FAILED: '인스타그램 댓글 받기를 켜지 못했어요. 잠시 뒤 다시 연결해 주세요.',
  CONNECT_FAILED: '인스타그램 연결을 마치지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  NOT_CONFIGURED: INSTAGRAM_NOT_CONFIGURED,
}

/** 모르는 결과 코드의 문장 */
export const INSTAGRAM_CALLBACK_UNKNOWN = '인스타그램 연결 결과를 확인하지 못했어요. 아래 연결 상태를 확인해 주세요.'

export function instagramCallbackMessage(code: string): string {
  return Object.hasOwn(INSTAGRAM_CALLBACK, code) ? (INSTAGRAM_CALLBACK[code] ?? INSTAGRAM_CALLBACK_UNKNOWN) : INSTAGRAM_CALLBACK_UNKNOWN
}

export function instagramCallbackSucceeded(code: string): boolean {
  return code === 'CONNECTED' || code === 'CONSENT_ON'
}

/** 그 회차의 보내지 못한 감사 DM 수 (FAILED — 이유 무엇이든, AC-N2b-2-63) */
export function failedDmCount(rows: readonly Pick<InstagramDmRow, 'broadcast' | 'status'>[], broadcast: string): number {
  return rows.filter((row) => row.broadcast === broadcast && row.status === 'FAILED').length
}

export function failedDmMessage(count: number): string {
  return `감사 DM ${String(count)}건을 보내지 못했어요. 인스타그램 앱에서 직접 보내 주세요.`
}

// ── 붙여넣기 (AC-N2b-2-64) ─────────────────────────────────────────────

export const PASTE_GUIDE = "틱톡 화면의 댓글을 '닉네임: 댓글' 한 줄씩 붙여 넣어 주세요."
export const PASTE_STALE = '글을 고쳤어요. 미리 보기를 다시 해 주세요.'

export function pasteGroupMessage(lines: number): string {
  return `같은 닉네임 ${String(lines)}줄은 한 구매자로 넣어요`
}

export function pasteButtonLabel(total: number): string {
  return `찜 ${String(total)}개 넣기`
}

export function pasteDoneMessage(added: number): string {
  return `찜 ${String(added)}개를 넣었어요.`
}
