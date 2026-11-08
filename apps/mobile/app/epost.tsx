// 우체국 창구소포 간편사전접수 경로 (택배 접수 화면에서 연다 — EP1 PC-9). ?date=YYYY-MM-DD&buyers=<구매자 ID,…> (한 명이면 buyer=도 받는다 — D-EP1-19)
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { EpostScreen } from '../src/screens/EpostScreen.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function EpostRoute() {
  const { session } = useSession()
  const router = useRouter()
  const { date, buyer, buyers } = useLocalSearchParams<{ date?: string; buyer?: string; buyers?: string }>()
  const list = (typeof buyers === 'string' && buyers !== '' ? buyers.split(',') : typeof buyer === 'string' && buyer !== '' ? [buyer] : []).filter((id) => id !== '')
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  if (typeof date !== 'string' || date === '' || list.length === 0) return <Redirect href="/parcels" />
  const back = () => (router.canGoBack() ? router.back() : router.replace('/parcels'))
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top', 'bottom']}>
      <KitInsets>
        <EpostScreen key={`${date}/${list.join(',')}`} date={date} buyers={list} nav={{ onBack: back, openNext: (next) => router.replace({ pathname: '/epost', params: { date, buyers: next } }) }} />
      </KitInsets>
    </SafeAreaView>
  )
}
