// 라벨·프린터 경로.
import { Redirect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LabelsScreen } from '../src/screens/LabelsScreen.tsx'
import { useSession } from '../src/services.tsx'

export default function LabelsRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <LabelsScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </SafeAreaView>
  )
}
