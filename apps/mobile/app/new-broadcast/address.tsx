// 새 방송 2단계 경로 (/new-broadcast/address?category=): 방송 주소 (D-UX3-09·10).
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { View } from 'react-native'
import { newBroadcastNav } from '../../src/lib/new-broadcast-nav.ts'
import { NewBroadcastAddressScreen } from '../../src/screens/NewBroadcastScreen.tsx'
import { useSession } from '../../src/services.tsx'
import { PALETTE } from '../../src/ui/kit/tokens.ts'
import { KitInsets } from '../../src/ui/kit/safe-area.tsx'

export default function NewBroadcastRoute() {
  const { category } = useLocalSearchParams<{ category?: string }>()
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  // 위 안전 영역은 FormPage가 직접 띄운다
  return (
    <View style={{ flex: 1, backgroundColor: PALETTE.light.surface }}>
      <KitInsets>
        <NewBroadcastAddressScreen category={typeof category === 'string' ? category : undefined} nav={newBroadcastNav(router)} />
      </KitInsets>
    </View>
  )
}
