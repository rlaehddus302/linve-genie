// 설정(음성·라벨) 경로.
import { Redirect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { webUrl } from '../src/api/config.ts'
import { phoneNoticeBuilt } from '../src/lib/build-flags.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'
import { SettingsScreen } from '../src/screens/SettingsScreen.tsx'
import { useSession } from '../src/services.tsx'

export default function SettingsRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F7F8F6' }} edges={['top']}>
      <KitInsets>
        <SettingsScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))} policyUrl={webUrl('/privacy')} onOpenDesign={__DEV__ ? () => router.push('/dev/design') : undefined} onOpenShop={session.me.role === 'ASSISTANT' ? undefined : () => router.push('/shop-settings')} showPhoneNotice={phoneNoticeBuilt()} />
      </KitInsets>
    </SafeAreaView>
  )
}
