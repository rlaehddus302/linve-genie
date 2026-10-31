// 첫 화면: 세션 확인 → 로그인 또는 홈 "오늘 할 일"(아래 탭).
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TAB_PATH } from '../src/lib/tab-routes.ts'
import { HomeScreen } from '../src/screens/HomeScreen.tsx'
import { LoginScreen } from '../src/screens/LoginScreen.tsx'
import { TabFrame } from '../src/screens/TabFrame.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'
import { Loading } from '../src/ui/parts.tsx'

export default function IndexRoute() {
  const { session, login, recheck } = useSession()
  const router = useRouter()
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        {session.state === 'checking' ? <Loading text="로그인을 확인하는 중…" /> : null}
        {session.state === 'out' ? <LoginScreen expired={session.expired} offline={session.offline === true} onRecheck={recheck} onLogin={login} /> : null}
        {session.state === 'in' ? (
          <TabFrame active="home" go={(key) => router.replace(TAB_PATH[key])}>
            <HomeScreen
              sellerName={session.me.seller.name}
              nav={{
                openConsole: (id) => router.push({ pathname: '/console/[id]', params: { id } }),
                openPacking: () => router.replace('/packing'),
                openLabels: () => router.push('/labels'),
                openSettings: () => router.push('/settings'),
              }}
            />
          </TabFrame>
        ) : null}
      </KitInsets>
    </SafeAreaView>
  )
}
