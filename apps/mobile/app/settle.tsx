// 정산 탭 경로 — 앱 정산 화면 (D-APPX-01, 전에는 웹으로 열기 안내 D-UX2-07).
import { Redirect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TAB_PATH } from '../src/lib/tab-routes.ts'
import { SettleScreen } from '../src/screens/SettleScreen.tsx'
import { TabFrame } from '../src/screens/TabFrame.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function SettleRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <TabFrame active="settle" go={(key) => router.replace(TAB_PATH[key])}>
          <SettleScreen nav={{ openReport: (date) => router.push({ pathname: '/report', params: { date } }), openDeposits: () => router.push('/deposits') }} />
        </TabFrame>
      </KitInsets>
    </SafeAreaView>
  )
}
