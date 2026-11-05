// 앱 뼈대 (expo-router): 서버 호출 설정(expo/fetch — 스트리밍 응답·기기 쿠키) → 앱 전체 서비스 → 세션 → 화면 묶음.
// 바깥 링크는 기기 브라우저(Linking.openURL)로 연다 (APP-01 AC4). 방송 플랫폼 찾기는 그 앱, 없으면 앱 안 브라우저(D-UX3-10). 클립보드는 유튜브 주소 붙여넣기 단계만 읽고, 영수증 링크 복사 때만 쓴다(expo-clipboard).
import AsyncStorage from '@react-native-async-storage/async-storage'
import { configureVoiceStorage } from '../src/lib/voice-preferences.ts'
import { fetch as expoFetch } from 'expo/fetch'
import { getStringAsync, setStringAsync } from 'expo-clipboard'
import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync, getRandomBytes, randomUUID } from 'expo-crypto'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { openAuthSessionAsync, openBrowserAsync } from 'expo-web-browser'
import { useMemo } from 'react'
import { Linking } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { installProductionNative, PrinterDevicePicker } from '../src/native/production.tsx'
import { configureApi } from '../src/api/config.ts'
import { setWebOpener } from '../src/lib/open-web.ts'
import { setPlatformOpener } from '../src/lib/open-app.ts'
import { setClipboardReader, setClipboardWriter } from '../src/lib/clipboard.ts'
import { setSocialNative, toBase64Url } from '../src/lib/social-auth.ts'
import { createServices, ServicesProvider, SessionProvider } from '../src/services.tsx'
import { TAB_SCREENS } from '../src/lib/tab-routes.ts'

configureApi({ fetch: (input, init) => expoFetch(input, init as Parameters<typeof expoFetch>[1]) as unknown as Promise<Response>, newId: randomUUID })
setWebOpener((url) => Linking.openURL(url))
// 방송 플랫폼: 앱이 있으면 앱, 없으면(열기 거절) 앱 안 브라우저 — 닫힐 때 끝난다 (D-UX3-10)
setPlatformOpener(async (target) => {
  try {
    await Linking.openURL(target.app)
    return 'app'
  } catch {
    await openBrowserAsync(target.web)
    return 'browser'
  }
})
setClipboardReader(() => getStringAsync())
setClipboardWriter((text) => setStringAsync(text))
installProductionNative()
configureVoiceStorage(AsyncStorage)
// 앱 안 간편 로그인 (D-UX3-28): 앱 위 로그인 창(ASWebAuthenticationSession·Custom Tabs) — 사파리·웹으로 넘기지 않는다
setSocialNative({
  openAuthSession: async (url, returnUrl) => {
    const result = await openAuthSessionAsync(url, returnUrl)
    return result.type === 'success' ? result.url : null
  },
  randomVerifier: () => toBase64Url(btoa(String.fromCharCode(...getRandomBytes(32)))),
  sha256: async (text) => toBase64Url(await digestStringAsync(CryptoDigestAlgorithm.SHA256, text, { encoding: CryptoEncoding.BASE64 })),
  storage: AsyncStorage,
})

export default function RootLayout() {
  const services = useMemo(() => createServices(), [])
  return (
    <SafeAreaProvider>
      <ServicesProvider services={services}>
        <SessionProvider services={services}>
          <StatusBar style="dark" />
          <PrinterDevicePicker />
          {/* 뒤로 가기는 왼쪽 가장자리에서 밀 때만 (D-UX3-24): iOS 26부터 기본이 '화면 어디서 밀어도 뒤로'라 라벨 끌기·가로 밀기까지 뒤로 갔다 */}
          <Stack screenOptions={{ headerShown: false, fullScreenGestureEnabled: false }}>
            {/* 탭 화면끼리는 화면 전환 없이 바꿔 끼운다 — 짧은 좌우 밀림은 TabFrame이 낸다 (D-UX3-01) */}
            {TAB_SCREENS.map((name) => (
              <Stack.Screen key={name} name={name} options={{ animation: 'none' }} />
            ))}
          </Stack>
        </SessionProvider>
      </ServicesProvider>
    </SafeAreaProvider>
  )
}
