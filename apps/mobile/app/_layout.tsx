// 앱 뼈대 (expo-router): 서버 호출 설정(expo/fetch — 스트리밍 응답·기기 쿠키) → 앱 전체 서비스 → 세션 → 화면 묶음.
// 바깥 링크는 기기 브라우저(Linking.openURL)로 연다 (APP-01 AC4).
import { fetch as expoFetch } from 'expo/fetch'
import { randomUUID } from 'expo-crypto'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useMemo } from 'react'
import { Linking } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { configureApi } from '../src/api/config.ts'
import { setWebOpener } from '../src/lib/open-web.ts'
import { createServices, ServicesProvider, SessionProvider } from '../src/services.tsx'

configureApi({ fetch: (input, init) => expoFetch(input, init as Parameters<typeof expoFetch>[1]) as unknown as Promise<Response>, newId: randomUUID })
setWebOpener((url) => Linking.openURL(url))

export default function RootLayout() {
  const services = useMemo(() => createServices(), [])
  return (
    <SafeAreaProvider>
      <ServicesProvider services={services}>
        <SessionProvider services={services}>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }} />
        </SessionProvider>
      </ServicesProvider>
    </SafeAreaProvider>
  )
}
