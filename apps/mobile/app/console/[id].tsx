// 방송 중 경로 (/console/<방송 ID>). 로그인이 풀리면 첫 화면으로. 아래 고정 버튼이 홈 막대를 피하도록 아래 안전 영역을 넘긴다.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ConsoleScreen } from '../../src/screens/ConsoleScreen.tsx'
import { useSession } from '../../src/services.tsx'
import { PALETTE } from '../../src/ui/kit/tokens.ts'
import { KitInsets } from '../../src/ui/kit/safe-area.tsx'

export default function ConsoleRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in' || typeof id !== 'string') return null
  const seller = session.me.role !== 'ASSISTANT'
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <ConsoleScreen broadcastId={id} seller={seller} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </KitInsets>
    </SafeAreaView>
  )
}
