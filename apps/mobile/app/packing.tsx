// 포장 모드 경로.
import { Redirect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PackingScreen } from '../src/screens/PackingScreen.tsx'
import { useSession } from '../src/services.tsx'

export default function PackingRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <PackingScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </SafeAreaView>
  )
}
