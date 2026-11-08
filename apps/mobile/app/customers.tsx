// 고객 탭 경로 (D-UX3-60, 사용자 지시 2026-11-07 "원래 있던 택배 아이콘 자리는 사람 아이콘으로 해서 고객"): 손님 목록·자세히(D-APPX-01).
import { Redirect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TAB_PATH } from '../src/lib/tab-routes.ts'
import { CustomersScreen } from '../src/screens/CustomersScreen.tsx'
import { TabFrame } from '../src/screens/TabFrame.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function CustomersRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <TabFrame active="customers" go={(key) => router.replace(TAB_PATH[key])}>
          <CustomersScreen />
        </TabFrame>
      </KitInsets>
    </SafeAreaView>
  )
}
