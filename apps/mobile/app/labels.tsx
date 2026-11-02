// 라벨 경로: 아래 탭 "라벨"(D-UX3-01). 방송 화면·시작 안내처럼 다른 화면에서 열면(`?from=`) 탭 막대 없이 뒤로 가기가 있는 화면.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TAB_PATH } from '../src/lib/tab-routes.ts'
import { LabelsScreen } from '../src/screens/LabelsScreen.tsx'
import { TabFrame } from '../src/screens/TabFrame.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function LabelsRoute() {
  const { session } = useSession()
  const router = useRouter()
  const { from } = useLocalSearchParams<{ from?: string }>()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  const pushed = typeof from === 'string' && from !== ''
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        {pushed ? (
          <LabelsScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        ) : (
          <TabFrame active="labels" go={(key) => router.replace(TAB_PATH[key])}>
            <LabelsScreen />
          </TabFrame>
        )}
      </KitInsets>
    </SafeAreaView>
  )
}
