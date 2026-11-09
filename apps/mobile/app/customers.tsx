// 고객 탭 경로 (D-UX3-60, 사용자 지시 2026-11-07 "원래 있던 택배 아이콘 자리는 사람 아이콘으로 해서 고객"): 손님 목록·자세히(D-APPX-01).
import { Redirect, useRouter } from 'expo-router'
import { TAB_PATH } from '../src/lib/tab-routes.ts'
import { CustomersScreen } from '../src/screens/CustomersScreen.tsx'
import { TabFrame } from '../src/screens/TabFrame.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function CustomersRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <RouteFrame>
        <TabFrame active="customers" go={(key) => router.replace(TAB_PATH[key])}>
          <CustomersScreen openCustomer={(id) => router.push({ pathname: '/customer', params: { id } })} />
        </TabFrame>
      </RouteFrame>
  )
}
