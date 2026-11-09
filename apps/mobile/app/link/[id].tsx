// 방송 연결 경로 (/link/<방송 ID>?closed=1): 방송 화면에서 쌓아 연다 — 밀어서 뒤로 가기가 된다 (D-UX3-09).
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { View } from 'react-native'
import { BroadcastLinkScreen } from '../../src/screens/BroadcastLinkScreen.tsx'
import { useSession } from '../../src/services.tsx'
import { PALETTE } from '../../src/ui/kit/tokens.ts'
import { KitInsets } from '../../src/ui/kit/safe-area.tsx'

export default function LinkRoute() {
  const { id, closed } = useLocalSearchParams<{ id: string; closed?: string }>()
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in' || typeof id !== 'string') return null
  // 위 안전 영역은 FormPage가 직접 띄운다
  return (
    <View style={{ flex: 1, backgroundColor: PALETTE.light.surface }}>
      <KitInsets belowStatusBar={false}>
        <BroadcastLinkScreen broadcastId={id} closed={closed === '1'} onBack={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/console/[id]', params: { id } }))} />
      </KitInsets>
    </View>
  )
}
