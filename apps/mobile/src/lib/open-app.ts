// 라이브 플랫폼 (D-UX3-10·14 → D-UX4-160): [링크를 모르겠어요] 판의 유튜브·틱톡·밴드.
// 전에는 고르면 그 앱(없으면 앱 밖 브라우저)을 열고 링크를 복사해 돌아오게 했다. 이제는 앱 안 브라우저(LiveBrowser)에서 라이브를 찾아
// [이 라이브예요]를 누른다 — 시작 주소·라이브 주소 판정은 lib/live-browser.ts.

export type LivePlatform = 'youtube' | 'tiktok' | 'band'

export interface PlatformTarget {
  readonly key: LivePlatform
  readonly word: string
}

export const LIVE_PLATFORMS: readonly PlatformTarget[] = [
  { key: 'youtube', word: '유튜브' },
  { key: 'tiktok', word: '틱톡' },
  { key: 'band', word: '밴드' },
]
