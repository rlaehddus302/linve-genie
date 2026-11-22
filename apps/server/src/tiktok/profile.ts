// 틱톡 계정 공개 정보 (D-RECENT-TT-02): 라이브 링크 넣는 화면의 "최근 연결한 채널" 틱톡 줄에 닉네임·프로필 사진·지금 라이브인지를 보인다.
// - 틱톡 웹이 계정 페이지에서 부르는 공개 읽기 주소(api-live/user/room) 하나만 GET으로 부른다 — 서명·쿠키·로그인 없음, 틱톡에 글을 올리는 조작 없음(D-904).
// - 받은 것은 믿을 수 없는 입력이다: 모양을 하나하나 확인하고, 요청한 아이디와 다른 계정이면 버린다. 사진 주소는 틱톡 이미지 서버의 것만(isTikTokAvatarUrl).
// - 못 받거나 모양이 다르면 null — 화면은 지금처럼 @아이디·틱톡 그림·[연결]을 보인다(모를 때 잇기를 막지 않는다).
import { isTikTokAvatarUrl } from './avatar.ts'

/** 계정 공개 정보 — live: true 라이브 중 · false 라이브 아님 · null 모름 */
export interface TikTokProfile {
  readonly live: boolean | null
  readonly nickname: string | null
  readonly avatarUrl: string | null
}

/** 틱톡 아이디 → 공개 정보 (못 받으면 null). 던지지 않는다 */
export type TikTokProfileFetch = (uniqueId: string) => Promise<TikTokProfile | null>

/** 기다리는 시간 — 화면이 이것만큼 늦게 뜰 수 있다 */
export const TIKTOK_PROFILE_TIMEOUT_MS = 5_000
/** 받는 크기 상한 (보통 25KB 안팎) */
export const TIKTOK_PROFILE_MAX_BYTES = 500_000
/** 닉네임 글자 수 상한 */
export const TIKTOK_PROFILE_NAME_MAX = 40

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined
  } catch {
    return undefined
  }
}

/** 방 상태 숫자 → 라이브인가 (2 라이브 중, 4 라이브 아님 — 그 밖은 모름) */
function liveOf(status: unknown): boolean | null {
  if (status === 2) return true
  if (status === 4) return false
  return null
}

/** 공개 정보 응답(JSON) → 계정 정보. 요청한 아이디의 것이 아니거나 모양이 다르면 null */
export function parseTikTokProfile(json: unknown, uniqueId: string): TikTokProfile | null {
  if (field(json, 'statusCode') !== 0) return null
  const data = field(json, 'data')
  const user = field(data, 'user')
  const id = field(user, 'uniqueId')
  if (typeof id !== 'string' || id.toLowerCase() !== uniqueId.toLowerCase()) return null
  const room = liveOf(field(field(data, 'liveRoom'), 'status'))
  const live = room ?? liveOf(field(user, 'status'))
  const rawNick = field(user, 'nickname')
  // 제어 문자는 뺀다
  const trimmed = typeof rawNick === 'string' ? Array.from(rawNick).filter((ch) => { const code = ch.codePointAt(0) ?? 0; return code >= 0x20 && code !== 0x7f }).join('').trim() : ''
  const chars = Array.from(trimmed)
  const nickname = trimmed === '' ? null : chars.length > TIKTOK_PROFILE_NAME_MAX ? `${chars.slice(0, TIKTOK_PROFILE_NAME_MAX).join('')}…` : trimmed
  const avatar = field(user, 'avatarThumb')
  return { live, nickname, avatarUrl: isTikTokAvatarUrl(avatar) ? avatar : null }
}

/** 실제 틱톡 공개 정보 받기 */
export function fetchTikTokProfile(fetcher: typeof fetch = fetch): TikTokProfileFetch {
  return async (uniqueId) => {
    const url = `https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId=${encodeURIComponent(uniqueId)}`
    try {
      const response = await fetcher(url, {
        method: 'GET',
        redirect: 'error',
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIKTOK_PROFILE_TIMEOUT_MS),
      })
      if (!response.ok) return null
      const text = await response.text()
      if (text.length > TIKTOK_PROFILE_MAX_BYTES) return null
      return parseTikTokProfile(JSON.parse(text), uniqueId)
    } catch {
      return null
    }
  }
}
