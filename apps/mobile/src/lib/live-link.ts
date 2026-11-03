// 붙여 넣은 글에서 방송 링크 찾기 (D-UX3-14, 사용자 지시 2026-11-03 "틱톡과 밴드도 링크로"). 앱의 [공유 → 링크 복사]는 링크 앞뒤에 글을 붙이기도 해
// ("…님의 라이브 https://vt.tiktok.com/ZS…/ 복사해서…") 글 안의 첫 http(s) 링크를 꺼낸다. 어느 플랫폼인지는 호스트로만 본다 — 판정은 서버.
import { youtubeAddress } from './clipboard.ts'

export type LinkPlatform = 'youtube' | 'tiktok' | 'band'

export interface LiveLink {
  readonly platform: LinkPlatform
  readonly url: string
}

const TIKTOK_HOST = /^((www|m|vt|vm)\.)?tiktok\.com$/i
const BAND_HOST = /^(www\.)?band\.us$/i

function hostOf(url: string): string | null {
  const match = /^(?:https?:\/\/)?([^/?#\s]+)/i.exec(url)
  return match === null ? null : (match[1] ?? null)
}

/** 붙여 넣은 글 → 방송 링크 (모르는 링크·글이면 null) */
export function liveLinkOf(text: string): LiveLink | null {
  const value = text.trim()
  if (value === '' || value.length > 4096) return null
  const youtube = youtubeAddress(value)
  if (youtube !== null) return { platform: 'youtube', url: youtube }
  const candidates = /\s/.test(value) ? (value.match(/https?:\/\/[^\s]+/gi) ?? []) : [value]
  for (const candidate of candidates) {
    const url = candidate.replace(/[)\]}>'".,，。]+$/u, '')
    const inner = youtubeAddress(url)
    if (inner !== null) return { platform: 'youtube', url: inner }
    const host = hostOf(url)
    if (host === null) continue
    if (TIKTOK_HOST.test(host)) return { platform: 'tiktok', url }
    if (BAND_HOST.test(host)) return { platform: 'band', url }
  }
  return null
}
