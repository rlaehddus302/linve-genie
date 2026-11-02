// 방송 플랫폼 앱 열기 (D-UX3-10): "방송 주소를 모르겠어요" → 유튜브·틱톡·밴드 중 하나 → 그 앱을 열고, 없으면 앱 안 브라우저로 그 사이트를 연다.
// 판매자는 자기 방송에서 공유 → 링크 복사를 누르고 돌아오면 주소 칸이 클립보드로 저절로 채워진다(useAddressLinker).
// 여는 함수는 바꿔 끼운다(앱은 Linking + expo-web-browser, 시험은 가짜).

export type LivePlatform = 'youtube' | 'tiktok' | 'band'

export interface PlatformTarget {
  readonly key: LivePlatform
  readonly word: string
  /** 앱 주소 (설치돼 있으면 앱이 열린다) */
  readonly app: string
  /** 앱이 없을 때 앱 안 브라우저로 여는 사이트 */
  readonly web: string
}

export const LIVE_PLATFORMS: readonly PlatformTarget[] = [
  { key: 'youtube', word: '유튜브', app: 'youtube://', web: 'https://m.youtube.com/' },
  { key: 'tiktok', word: '틱톡', app: 'snssdk1233://', web: 'https://www.tiktok.com/' },
  { key: 'band', word: '밴드', app: 'bandapp://', web: 'https://band.us/' },
]

/** 앱을 연다 — 못 열면(앱 없음) 앱 안 브라우저로 사이트를 열고, 브라우저를 닫을 때 끝난다 */
type Opener = (target: PlatformTarget) => Promise<'app' | 'browser'>

let opener: Opener = async () => 'browser'

export function setPlatformOpener(next: Opener): void {
  opener = next
}

export function openPlatform(target: PlatformTarget): Promise<'app' | 'browser'> {
  return opener(target)
}
