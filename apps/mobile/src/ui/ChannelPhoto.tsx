// 채널 프로필 사진 (D-UX4-95 → D-UX4-112): 라이브 연결 정보 줄과 링크 화면 "최근 연결한 채널의 라이브"가 같이 쓴다.
// 사진을 모르면 회색 동그라미 안 재생 그림 — 받은 적 있으면 바로 (홈 "지금 라이브 중"과 같은 경로, D-UX4-77)
import { Image, View } from 'react-native'
import { useCachedGet } from '../lib/cached-get.ts'
import { Icon, useKit } from './kit/index.ts'

export function ChannelPhoto({ channelId, size, testID }: { readonly channelId: string | null; readonly size: number; readonly testID?: string }) {
  const { p } = useKit()
  const avatar = useCachedGet<{ avatar: string | null }>(channelId === null || channelId === '' ? null : `/api/youtube/channels/${encodeURIComponent(channelId)}/avatar`).data?.avatar ?? null
  if (avatar !== null) return <Image aria-hidden testID={testID} source={{ uri: avatar }} style={{ width: size, height: size, borderRadius: size / 2, borderCurve: 'continuous' }} />
  return (
    <View aria-hidden testID={testID} style={{ width: size, height: size, borderRadius: size / 2, borderCurve: 'continuous', backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="play" color={p.textSub} size={Math.round(size / 2)} />
    </View>
  )
}
