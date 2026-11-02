// 전체 탭 경로 (옛 더보기, D-UX3-04): 설정, 앱 화면 묶음, 웹에서 보기, 로그아웃.
import { Redirect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TAB_PATH } from '../src/lib/tab-routes.ts'
import { MoreScreen } from '../src/screens/MoreScreen.tsx'
import { TabFrame } from '../src/screens/TabFrame.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function MoreRoute() {
  const { session, logout } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <TabFrame active="more" go={(key) => router.replace(TAB_PATH[key])}>
          <MoreScreen nav={{ openSettings: () => router.push('/settings'), openApp: (path) => router.push(path) }} account={`${session.me.seller.name} · ${session.me.loginId}`} onLogout={() => void logout()} />
        </TabFrame>
      </KitInsets>
    </SafeAreaView>
  )
}
