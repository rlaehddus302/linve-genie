// 택배 탭 (D-UX3-39): 접수·우체국 직접 접수·운송장·받는 분 직접 넣기. 포장 화면 [택배 화면으로]·홈 "택배 접수"는 그 날짜부터(D-UX3-35).
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TAB_PATH } from '../src/lib/tab-routes.ts'
import { ParcelsScreen } from '../src/screens/ParcelsScreen.tsx'
import { TabFrame } from '../src/screens/TabFrame.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function ParcelsRoute() {
  const { session } = useSession()
  const router = useRouter()
  const params = useLocalSearchParams<{ date?: string }>()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <TabFrame active="parcels" go={(key) => router.replace(TAB_PATH[key])}>
          <ParcelsScreen initialDate={typeof params.date === 'string' ? params.date : undefined} nav={{ openSettle: (date, buyer) => router.replace({ pathname: '/settle', params: { date, buyer } }), openSettings: () => router.push('/shop-settings'), openEpost: (date, kind) => router.push({ pathname: '/epost', params: { date, kind } }) }} />
        </TabFrame>
      </KitInsets>
    </SafeAreaView>
  )
}
