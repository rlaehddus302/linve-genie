// 채널 프로필 사진 (D-UX4-95 → D-UX4-112): 라이브 연결 정보 줄과 링크 화면 "최근 연결한 채널의 라이브"가 같이 쓴다.
// 사진을 모르면 회색 동그라미 안 재생 그림 — 받은 적 있으면 바로 (홈 "지금 라이브 중"과 같은 경로, D-UX4-77)
// live (D-UX4-118): 홈 "지금 라이브 중"처럼 빨간 테두리 + 아래 "라이브" 꼬리표 — 사진은 테두리 안쪽으로 작아진다
import { Image, Text, View } from 'react-native'
import { useCachedGet } from '../lib/cached-get.ts'
import { font } from './kit/font.ts'
import { Icon, useKit } from './kit/index.ts'

/** 라이브 테두리 두께·사진과 테두리 사이 (홈 HOME_LIVE와 같은 모양) */
export const LIVE_RING = { width: 2, inset: 4 } as const

export function ChannelPhoto({ channelId, size, live = false, testID }: { readonly channelId: string | null; readonly size: number; readonly live?: boolean; readonly testID?: string }) {
  const { p, tones } = useKit()
  const avatar = useCachedGet<{ avatar: string | null }>(channelId === null || channelId === '' ? null : `/api/youtube/channels/${encodeURIComponent(channelId)}/avatar`).data?.avatar ?? null
  const inner = live ? size - LIVE_RING.inset * 2 : size
  const photo =
    avatar !== null ? (
      <Image aria-hidden testID={live ? undefined : testID} source={{ uri: avatar }} style={{ width: inner, height: inner, borderRadius: inner / 2, borderCurve: 'continuous' }} />
    ) : (
      <View aria-hidden testID={live ? undefined : testID} style={{ width: inner, height: inner, borderRadius: inner / 2, borderCurve: 'continuous', backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="play" color={p.textSub} size={Math.round(inner / 2)} />
      </View>
    )
  if (!live) return photo
  return (
    <View aria-hidden testID={testID} style={{ width: size, height: size, borderRadius: size / 2, borderCurve: 'continuous', borderWidth: LIVE_RING.width, borderColor: tones.danger.fg, alignItems: 'center', justifyContent: 'center' }}>
      {photo}
      <View testID="channel-live-tag" style={{ position: 'absolute', bottom: -4, alignSelf: 'center', paddingHorizontal: 3, borderRadius: 4, borderCurve: 'continuous', backgroundColor: tones.danger.fg }}>
        <Text allowFontScaling={false} style={{ fontSize: 8, lineHeight: 11, color: '#FFFFFF', ...font('700') }}>
          라이브
        </Text>
      </View>
    </View>
  )
}
