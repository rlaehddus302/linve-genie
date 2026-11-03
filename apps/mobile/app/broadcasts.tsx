// 내 방송 모두 보기 경로 (/broadcasts): 홈 [모두보기]에서 쌓아 연다 — 날짜마다 흰 카드 (D-UX3-18).
import { Redirect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { AllBroadcastsScreen } from '../src/screens/BroadcastList.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function BroadcastsRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <AllBroadcastsScreen onOpen={(id) => router.push({ pathname: '/console/[id]', params: { id } })} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </KitInsets>
    </SafeAreaView>
  )
}
