// 틱톡 짧은 공유 링크 풀기 (D-UX3-14, 사용자 지시 2026-11-03 "틱톡도 링크로 이을 수 있게"). 틱톡 앱의 [공유 → 링크 복사]는 vt.tiktok.com/… 짧은 링크를 준다.
// 해석(target.ts)은 순수 함수로 두고 바깥에 묻지 않는다 — 여는 일은 여기서만 한다. 틱톡에 무엇을 쓰지 않는다(GET 한 번씩, 본문은 읽지 않고 버린다).
// 넘겨주는 곳(Location)만 따라가며, 틱톡 호스트가 아니면 멈춘다. 몇 번(SHORT_LINK_HOPS) 넘게 넘겨지거나 시간이 지나면 못 푼 것으로 본다.
import { parseTikTokTarget } from './target.ts'

/** 짧은 링크 → 아이디가 든 틱톡 주소 (못 풀면 null) */
export type ShortLinkResolver = (url: string) => Promise<string | null>

export const SHORT_LINK_HOPS = 4
export const SHORT_LINK_TIMEOUT_MS = 5_000
const TIKTOK_HOST_RE = /^(?:[a-z0-9-]+\.)*tiktok\.com$/

export function fetchShortLinkResolver(fetchImpl: typeof fetch = fetch): ShortLinkResolver {
  return async (start) => {
    let url: URL
    try {
      url = new URL(/^https?:\/\//i.test(start.trim()) ? start.trim() : `https://${start.trim()}`)
    } catch {
      return null
    }
    for (let hop = 0; hop < SHORT_LINK_HOPS; hop += 1) {
      if (!TIKTOK_HOST_RE.test(url.hostname.toLowerCase())) return null
      url.protocol = 'https:'
      let location: string | null
      try {
        const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(SHORT_LINK_TIMEOUT_MS), headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' } })
        location = response.headers.get('location')
        await response.body?.cancel().catch(() => undefined)
      } catch {
        return null
      }
      if (location === null) return null
      try {
        url = new URL(location, url)
      } catch {
        return null
      }
      const parsed = parseTikTokTarget(url.toString())
      if ('uniqueId' in parsed) return url.toString()
      if (parsed.error !== 'SHORT_LINK') return null
    }
    return null
  }
}
