// 전체 탭 경로 (옛 더보기, D-UX3-04 → D-UX4-201): 앱 화면과 설정을 관련된 것끼리 묶어 바로 보인다, 웹에서 보기, 로그아웃.
import { Redirect, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { webUrl } from '../src/api/config.ts'
import { phoneNoticeBuilt } from '../src/lib/build-flags.ts'
import { TAB_PATH } from '../src/lib/tab-routes.ts'
import { MoreScreen } from '../src/screens/MoreScreen.tsx'
import { TabFrame } from '../src/screens/TabFrame.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function MoreRoute() {
  const { session, logout } = useSession()
  const router = useRouter()
  // 연동된 소셜 계정 화면에서 돌아오면 줄의 로고를 다시 읽는다 (D-UX3-61)
  const [linkedRefresh, setLinkedRefresh] = useState(0)
  useFocusEffect(useCallback(() => setLinkedRefresh((count) => count + 1), []))
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <RouteFrame>
        <TabFrame active="more" go={(key) => router.replace(TAB_PATH[key])}>
          <MoreScreen
            nav={{ openApp: (path) => router.push(path) }}
            settings={{
              openVarieties: () => router.push('/varieties'),
              openLinked: () => router.push('/linked-accounts'),
              linkedRefresh,
              policyUrl: webUrl('/privacy'),
              openDesign: __DEV__ ? () => router.push('/dev/design') : undefined,
              showPhoneNotice: phoneNoticeBuilt(),
            }}
            account={`${session.me.seller.name} · ${session.me.loginId}`}
            onLogout={() => void logout()}
          />
        </TabFrame>
      </RouteFrame>
  )
}
