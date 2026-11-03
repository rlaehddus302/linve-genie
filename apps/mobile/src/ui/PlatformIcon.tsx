// 방송 플랫폼 아이콘 (D-UX3-12) — 새 방송 링크 단계와 홈 '내 방송' 줄(D-UX3-18)이 같이 쓴다.
import { Image, View, type ImageSourcePropType } from 'react-native'
import youtubeLogo from '../../assets/platforms/youtube.png'
import tiktokLogo from '../../assets/platforms/tiktok.png'
import bandLogo from '../../assets/platforms/band.png'
import type { LivePlatform } from '../lib/open-app.ts'
import { useKit } from './kit/index.ts'

const PLATFORM_LOGO: Readonly<Record<LivePlatform, ImageSourcePropType | string>> = { youtube: youtubeLogo, tiktok: tiktokLogo, band: bandLogo }

/** 플랫폼 아이콘 — 각 앱의 정식 앱 아이콘(앱스토어 그림, D-UX3-12). 장식이라 이름은 옆 글자 */
export function PlatformIcon({ platform, size = 40 }: { readonly platform: LivePlatform; readonly size?: number }) {
  const { p } = useKit()
  const logo = PLATFORM_LOGO[platform]
  return (
    <View aria-hidden style={{ width: size, height: size, borderRadius: size * 0.2237, borderCurve: 'continuous', overflow: 'hidden', borderWidth: 1, borderColor: p.line }}>
      <Image source={typeof logo === 'string' ? { uri: logo } : logo} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
    </View>
  )
}
