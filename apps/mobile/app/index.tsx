// 첫 화면: 세션 확인 → 로그인 또는 방송 목록.
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { HomeScreen } from '../src/screens/HomeScreen.tsx'
import { LoginScreen } from '../src/screens/LoginScreen.tsx'
import { useSession } from '../src/services.tsx'
import { Loading } from '../src/ui/parts.tsx'

export default function IndexRoute() {
  const { session, login, recheck } = useSession()
  const router = useRouter()
  return (
    <SafeAreaView style={{ flex: 1 }}>
      {session.state === 'checking' ? <Loading text="로그인을 확인하는 중…" /> : null}
      {session.state === 'out' ? <LoginScreen expired={session.expired} offline={session.offline === true} onRecheck={recheck} onLogin={login} /> : null}
      {session.state === 'in' ? (
        <HomeScreen
          sellerName={session.me.seller.name}
          nav={{
            openConsole: (id) => router.push({ pathname: '/console/[id]', params: { id } }),
            openPacking: () => router.push('/packing'),
            openLabels: () => router.push('/labels'),
            openSettings: () => router.push('/settings'),
          }}
        />
      ) : null}
    </SafeAreaView>
  )
}
