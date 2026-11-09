// 설정(음성·라벨) 경로.
import { Redirect, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { webUrl } from '../src/api/config.ts'
import { phoneNoticeBuilt } from '../src/lib/build-flags.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { SettingsScreen } from '../src/screens/SettingsScreen.tsx'
import { useSession } from '../src/services.tsx'

export default function SettingsRoute() {
  const { session } = useSession()
  const router = useRouter()
  // 연동된 소셜 계정 화면에서 돌아오면 줄의 로고를 다시 읽는다 (D-UX3-61)
  const [linkedRefresh, setLinkedRefresh] = useState(0)
  useFocusEffect(useCallback(() => setLinkedRefresh((count) => count + 1), []))
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  // 상태 막대 자리도 화면 바탕과 같은 회색 (D-UX3-96 — 옛 #F7F8F6은 아래 회색과 달라 띠가 보였다)
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <SettingsScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))} policyUrl={webUrl('/privacy')} onOpenDesign={__DEV__ ? () => router.push('/dev/design') : undefined} onOpenShop={() => router.push('/shop-settings')} onOpenVarieties={() => router.push('/varieties')} onOpenLinked={() => router.push('/linked-accounts')} linkedRefresh={linkedRefresh} showPhoneNotice={phoneNoticeBuilt()} />
      </KitInsets>
    </SafeAreaView>
  )
}
