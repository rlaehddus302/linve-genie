// 첫 화면: 세션 확인 → 로그인 또는 홈 "오늘 할 일"(아래 탭).
// D-UX3-30: 문자 인증이 켜진 서버에서 번호가 없는 판매자 계정은 홈 전에 휴대폰 번호를 한 번 확인한다(왼쪽 단추는 로그아웃).
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TAB_PATH } from '../src/lib/tab-routes.ts'
import { HomeScreen } from '../src/screens/HomeScreen.tsx'
import { ACCOUNT_PHONE_BODY, ACCOUNT_PHONE_TITLE, LOGOUT_LABEL } from '@livejjim/web/src/lib/social-login.ts'
import { accountPhoneSend, accountPhoneVerify } from '../src/lib/social-auth.ts'
import { LoginScreen } from '../src/screens/LoginScreen.tsx'
import { PhoneVerify } from '../src/screens/PhoneVerify.tsx'
import { TabFrame } from '../src/screens/TabFrame.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'
import { Loading, Screen } from '../src/ui/parts.tsx'

export default function IndexRoute() {
  const { session, login, logout, recheck } = useSession()
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
        {session.state === 'in' && session.me.phoneRequired === true ? (
          <Screen title="휴대폰 번호" testID="phone-required">
            <PhoneVerify
              title={ACCOUNT_PHONE_TITLE}
              body={ACCOUNT_PHONE_BODY}
              send={accountPhoneSend}
              verify={async (code) => {
                await accountPhoneVerify(code)
                await recheck()
              }}
              back={{ label: LOGOUT_LABEL, onPress: () => void logout() }}
            />
          </Screen>
        ) : null}
        {session.state === 'in' && session.me.phoneRequired !== true ? (
          <TabFrame active="home" go={(key) => router.replace(TAB_PATH[key])}>
            <HomeScreen
              refresh={visits}
              sellerName={session.me.seller.name}
              nav={{
                openConsole: (id) => router.push({ pathname: '/console/[id]', params: { id } }),
                openNewBroadcast: () => router.push('/new-broadcast'),
                openAllBroadcasts: () => router.push('/broadcasts'),
                openPacking: () => router.replace('/packing'),
                openLabels: () => router.push('/labels'),
                openSettings: () => router.push('/settings'),
                openSettle: () => router.replace('/settle'),
                openParcels: (date) => router.replace({ pathname: '/parcels', params: { date } }),
                openReceipts: () => router.push('/receipts'),
                openStart: () => router.push('/start'),
              }}
            />
          </TabFrame>
        ) : null}
      </KitInsets>
    </SafeAreaView>
  )
}
