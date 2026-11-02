// 새 방송 1단계 경로 (/new-broadcast): 판매 종류 고르기 (D-UX3-09). 쌓인 화면 — 밀어서 뒤로 가기가 된다.
import { Redirect, useRouter } from 'expo-router'
import { View } from 'react-native'
import { newBroadcastNav } from '../../src/lib/new-broadcast-nav.ts'
import { NewBroadcastCategoryScreen } from '../../src/screens/NewBroadcastScreen.tsx'
import { useSession } from '../../src/services.tsx'
import { PALETTE } from '../../src/ui/kit/tokens.ts'
import { KitInsets } from '../../src/ui/kit/safe-area.tsx'

export default function NewBroadcastRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  // 위 안전 영역은 FormPage가 직접 띄운다
  return (
    <View style={{ flex: 1, backgroundColor: PALETTE.light.surface }}>
      <KitInsets>
        <NewBroadcastCategoryScreen nav={newBroadcastNav(router)} />
      </KitInsets>
    </View>
  )
}
