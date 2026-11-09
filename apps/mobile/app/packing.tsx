// 포장 탭 경로 (D-UX3-60): 위에서 포장 · 택배를 나눈다. `view=parcels`(·`date`)면 택배 쪽부터 연다 — 홈 "택배 접수"·옛 /parcels 주소.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { TAB_PATH } from '../src/lib/tab-routes.ts'
import { PackingTab } from '../src/screens/PackingTab.tsx'
import { TabFrame } from '../src/screens/TabFrame.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function PackingRoute() {
  const { session } = useSession()
  const router = useRouter()
  const params = useLocalSearchParams<{ view?: string; date?: string }>()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <RouteFrame>
        <TabFrame active="packing" go={(key) => router.replace(TAB_PATH[key])}>
          <PackingTab
            initialSide={params.view === 'parcels' ? 'parcels' : 'packing'}
            initialDate={typeof params.date === 'string' ? params.date : undefined}
            nav={{ openSettle: (date, buyer) => router.replace({ pathname: '/settle', params: { date, buyer } }), openSettings: () => router.push('/shop-settings'), openEpost: (date, buyers) => router.push({ pathname: '/epost', params: { date, buyers: buyers.join(',') } }) }}
          />
        </TabFrame>
      </RouteFrame>
  )
}
