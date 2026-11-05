// 첫 화면: 세션 확인 → 로그인 또는 홈 "오늘 할 일"(아래 탭).
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
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
  // 홈이 다시 보일 때마다(방송에서 돌아옴·방송을 끝냄) 방송 목록·할 일 숫자를 다시 받는다 — 진행 중 방송(리허설 포함)이 "방송으로 돌아가기"로 보이게 (D-UX2-07)
  const [visits, setVisits] = useState(0)
  const first = useRef(true)
  useFocusEffect(
    useCallback(() => {
      // 처음 보일 때는 홈이 스스로 받는다 — 다시 보일 때만 올린다
      if (first.current) first.current = false
      else setVisits((count) => count + 1)
    }, []),
  )
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        {session.state === 'checking' ? <Loading text="로그인을 확인하는 중…" /> : null}
        {session.state === 'out' ? <LoginScreen expired={session.expired} offline={session.offline === true} onRecheck={recheck} onLogin={login} onSocialDone={recheck} /> : null}
        {session.state === 'in' ? (
          <TabFrame active="home" go={(key) => router.replace(TAB_PATH[key])}>
            <HomeScreen
              refresh={visits}
              sellerName={session.me.seller.name}
              nav={{
                openConsole: (id) => router.push({ pathname: '/console/[id]', params: { id } }),
                openNewBroadcast: () => router.push('/new-broadcast'),
                openAllBroadcasts: () => router.push('/broadcasts'),
                openPacking: () => router.replace('/packing'),
                openLabels: () => router.replace('/labels'),
                openSettings: () => router.push('/settings'),
                openSettle: () => router.replace('/settle'),
                ...(session.me.role === 'ASSISTANT' ? {} : { openStart: () => router.push('/start') }),
              }}
            />
          </TabFrame>
        ) : null}
      </KitInsets>
    </SafeAreaView>
  )
}
