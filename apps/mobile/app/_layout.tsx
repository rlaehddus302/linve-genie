// 앱 뼈대 (expo-router): 서버 호출 설정(expo/fetch — 스트리밍 응답·기기 쿠키) → 앱 전체 서비스 → 세션 → 화면 묶음.
// 바깥 링크는 기기 브라우저(Linking.openURL)로 연다 (APP-01 AC4). 클립보드는 유튜브 주소 붙여넣기 단계만 읽고, 영수증 링크 복사 때만 쓴다(expo-clipboard).
import AsyncStorage from '@react-native-async-storage/async-storage'
import { configureVoiceStorage } from '../src/lib/voice-preferences.ts'
import { fetch as expoFetch } from 'expo/fetch'
import { getStringAsync, setStringAsync } from 'expo-clipboard'
import { randomUUID } from 'expo-crypto'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useMemo } from 'react'
import { Linking } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { installProductionNative, PrinterDevicePicker } from '../src/native/production.tsx'
import { configureApi } from '../src/api/config.ts'
import { setWebOpener } from '../src/lib/open-web.ts'
import { setClipboardReader, setClipboardWriter } from '../src/lib/clipboard.ts'
import { createServices, ServicesProvider, SessionProvider } from '../src/services.tsx'

configureApi({ fetch: (input, init) => expoFetch(input, init as Parameters<typeof expoFetch>[1]) as unknown as Promise<Response>, newId: randomUUID })
setWebOpener((url) => Linking.openURL(url))
setClipboardReader(() => getStringAsync())
setClipboardWriter((text) => setStringAsync(text))
installProductionNative()
configureVoiceStorage(AsyncStorage)

export default function RootLayout() {
  const services = useMemo(() => createServices(), [])
  return (
    <SafeAreaProvider>
      <ServicesProvider services={services}>
        <SessionProvider services={services}>
          <StatusBar style="dark" />
          <PrinterDevicePicker />
          <Stack screenOptions={{ headerShown: false }} />
        </SessionProvider>
      </ServicesProvider>
    </SafeAreaProvider>
  )
}
