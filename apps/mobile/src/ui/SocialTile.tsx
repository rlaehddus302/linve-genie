// 간편 로그인 로고를 앱 아이콘 모양 바탕 위에 (D-UX3-60, 사용자 지시 2026-11-07 "소셜 아이콘 뒤에 1*1 앱 아이콘 모양 배경도"):
// 1:1 둥근 네모(모서리 비율은 아이폰 앱 아이콘 22.5%), 공급자 단추 색. 흰 바탕(구글)은 얇은 테.
// "이미 가입한 적이 있어요" 카드와 설정 → 연동된 소셜 계정이 같이 쓴다 (D-UX3-61).
import { View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import type { LoginProvider } from '@livejjim/web/src/lib/social-login.ts'
import { SOCIAL_COLORS, SOCIAL_LOGOS } from '@livejjim/web/src/lib/social-logos.ts'

export function SocialTile({ provider, size = 22, testID }: { readonly provider: LoginProvider; readonly size?: number; readonly testID?: string }) {
  const logo = SOCIAL_LOGOS[provider]
  const color = SOCIAL_COLORS[provider]
  const mark = Math.round(size * 0.6)
  return (
    <View
      aria-hidden
      testID={testID}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.225), borderCurve: 'continuous',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color.background,
        borderWidth: color.background === color.border ? 0 : 1,
        borderColor: color.border,
      }}
    >
      <Svg width={mark} height={mark} viewBox={logo.viewBox}>
        {logo.paths.map((path) => (
          <Path key={path.d} d={path.d} fill={path.fill} />
        ))}
      </Svg>
    </View>
  )
}
