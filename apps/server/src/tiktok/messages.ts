// 판매자에게 그대로 보이는 틱톡 연결 상태 문장 (AC-N2b-1-30·37, UX-01·UX-03). N2b-2 화면이 글자 그대로 쓴다.
// 영문 글자·숫자 오류 코드·기술 낱말을 넣지 않는다(시험이 모든 문장 상수를 검사한다). 프로그램이 읽는 값은 영문 코드(state·reason)로 따로 준다.

export type TikTokState = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'RETRYING' | 'STOPPED' | 'ENDED' | 'OFF'
export type TikTokStopReason = 'USER_NOT_FOUND' | 'GAVE_UP' | 'BY_SELLER'
export type TikTokOffReason = 'OPERATOR_OFF' | 'NO_CONSENT'

export const TIKTOK_STATES: readonly TikTokState[] = Object.freeze(['IDLE', 'CONNECTING', 'CONNECTED', 'RETRYING', 'STOPPED', 'ENDED', 'OFF'])

/** 상태별 문장. 이유가 있는 상태는 이유별로 나눈다 */
export const TIKTOK_STATUS_MESSAGES = Object.freeze({
  IDLE: '틱톡에 아직 연결하지 않았어요.',
  CONNECTING: '틱톡에 연결하는 중이에요.',
  CONNECTED: '틱톡 댓글을 받고 있어요.',
  RETRYING: Object.freeze({
    NETWORK: '틱톡 연결이 끊겨 다시 연결하는 중이에요.',
    NOT_LIVE: '틱톡 방송이 아직 시작되지 않았어요. 잠시 뒤 다시 확인해요.',
    BLOCKED: '틱톡이 연결을 막아 다시 시도하는 중이에요. 그동안 댓글을 직접 넣어 주세요.',
    SIGN_FAILED: '틱톡 연결 준비에 실패해 다시 시도하는 중이에요. 그동안 댓글을 직접 넣어 주세요.',
  }),
  STOPPED: Object.freeze({
    USER_NOT_FOUND: '그런 틱톡 아이디를 찾지 못했어요. 아이디를 확인해 주세요.',
    GAVE_UP: '틱톡에 다시 연결하지 못했어요. 다시 연결을 누르거나 댓글을 직접 넣어 주세요.',
    BY_SELLER: '틱톡 연결을 끊었어요.',
  }),
  ENDED: '틱톡 방송이 끝났어요.',
  OFF: Object.freeze({
    OPERATOR_OFF: '지금은 틱톡 연결을 쓸 수 없어요. 댓글을 직접 넣어 주세요.',
    NO_CONSENT: '틱톡 연결이 꺼져 있어요. 안내를 읽고 동의하면 켤 수 있어요.',
  }),
})

/** 받던 연결이 판매자가 끊지 않았는데 끊긴 뒤 보여 주는 안내 (상태의 missed가 true일 때) */
export const TIKTOK_MISSED_MESSAGE = '끊긴 동안의 틱톡 댓글은 받지 못했을 수 있어요. 틱톡 앱에서 확인해 주세요.'

/** (state, reason) → 문장. 표에 없는 조합이면 null */
export function tiktokStatusMessage(state: TikTokState, reason: string | null): string | null {
  const entry: unknown = TIKTOK_STATUS_MESSAGES[state]
  if (typeof entry === 'string') return reason === null ? entry : null
  if (reason === null || typeof entry !== 'object' || entry === null || !Object.hasOwn(entry, reason)) return null
  const message: unknown = (entry as Record<string, unknown>)[reason]
  return typeof message === 'string' ? message : null
}
