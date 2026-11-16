// 틱톡 프로필 사진 (D-TT-PHOTO-01): 홈 "지금 라이브 중"·채널 사진 자리에 틱톡 방송자의 프로필 사진을 보인다.
// - 사진 주소는 따로 묻지 않는다: 연결할 때 라이브러리가 이미 받는 방 정보(fetchRoomInfoOnConnect — connect()가 돌려주는 state.roomInfo)의
//   방송자(owner) avatar_thumb에서 꺼낸다. 틱톡에 무엇을 보내는 조작은 없다(읽기 전용, D-904).
// - 틱톡 사진 주소는 서명이 붙어 며칠 뒤 만료되고 기기마다 받는 머리글이 달라질 수 있어, 서버가 한 번 받아 작은 사진(data: 주소)으로 넘긴다 —
//   아이폰·안드로이드 모두 같은 글자로 그린다. 틱톡 이미지 서버(https · tiktokcdn·ibyteimg·byteimg)만, 넘겨주기(redirect)는 따르지 않는다.
// - 방 정보는 믿을 수 없는 입력이다: 모양을 하나하나 확인하고, 받은 바이트는 이미지 머리(JPEG·PNG·WEBP·GIF)로 다시 확인한다.

/** 틱톡 이미지 서버 (서명 붙은 프로필 사진 주소의 호스트) */
const AVATAR_HOST = /(^|\.)(tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|ibyteimg\.com|byteimg\.com)$/i
/** 받는 사진 크기 상한 (작은 사진 100×100 — 보통 수 KB) */
export const TIKTOK_AVATAR_MAX_BYTES = 200_000
/** 사진을 받을 때 기다리는 시간 */
export const TIKTOK_AVATAR_TIMEOUT_MS = 8_000
const MAX_URL = 2048

/** 사진 주소 → data: 주소 (못 받으면 null). 던지지 않는다 */
export type TikTokAvatarFetch = (url: string) => Promise<string | null>

/** 틱톡 이미지 서버의 https 주소인가 */
export function isTikTokAvatarUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_URL) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === '' && AVATAR_HOST.test(url.hostname)
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined
  } catch {
    return undefined
  }
}

function urlsOf(image: unknown): string[] {
  const list = field(image, 'url_list')
  return Array.isArray(list) ? list.slice(0, 8).filter(isTikTokAvatarUrl) : []
}

/**
 * 연결 결과(라이브러리 connect()의 state)에서 방송자 프로필 사진 주소를 꺼낸다 — roomInfo.data.owner의 avatar_thumb(없으면 avatar_medium).
 * 같은 사진의 여러 주소 중 JPEG를 먼저 고른다(어느 기기에서나 그려진다). 없거나 모양이 다르면 null
 */
export function tiktokAvatarUrl(state: unknown): string | null {
  const owner = field(field(field(state, 'roomInfo'), 'data'), 'owner')
  for (const key of ['avatar_thumb', 'avatar_medium']) {
    const urls = urlsOf(field(owner, key))
    if (urls.length === 0) continue
    return urls.find((url) => /\.jpe?g$/i.test(new URL(url).pathname)) ?? urls[0] ?? null
  }
  return null
}

/** 이미지 머리로 형식을 정한다 (JPEG·PNG·WEBP·GIF만) */
export function imageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
  if (bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0, 4)) === 'GIF8') return 'image/gif'
  return null
}

/** 받은 바이트 → data: 주소 (이미지가 아니거나 너무 크면 null) */
export function avatarDataUrl(bytes: Uint8Array): string | null {
  if (bytes.length === 0 || bytes.length > TIKTOK_AVATAR_MAX_BYTES) return null
  const type = imageType(bytes)
  return type === null ? null : `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
}

/** 실제로 사진을 받는 곳 (운영) — 틱톡 이미지 서버만, 넘겨주기를 따르지 않고, 크기·시간 상한 */
export function fetchTikTokAvatar(fetcher: typeof fetch = fetch): TikTokAvatarFetch {
  return async (url) => {
    if (!isTikTokAvatarUrl(url)) return null
    try {
      const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(TIKTOK_AVATAR_TIMEOUT_MS), headers: { Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8' } })
      if (!response.ok) return null
      const length = Number(response.headers.get('content-length') ?? '0')
      if (Number.isFinite(length) && length > TIKTOK_AVATAR_MAX_BYTES) return null
      const bytes = new Uint8Array(await response.arrayBuffer())
      return avatarDataUrl(bytes)
    } catch {
      return null
    }
  }
}
