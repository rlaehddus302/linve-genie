// 앱 뼈대 (expo-router): 서버 호출 설정(expo/fetch — 스트리밍 응답·기기 쿠키) → 앱 전체 서비스 → 세션 → 화면 묶음.
// 바깥 링크는 기기 브라우저(Linking.openURL)로 연다 (APP-01 AC4). 방송 플랫폼 찾기는 그 앱, 없으면 앱 안 브라우저(D-UX3-10). 클립보드는 유튜브 주소 붙여넣기 단계만 읽고, 영수증 링크 복사 때만 쓴다(expo-clipboard).
import { PrintBackground } from '../src/native/print-background.ts'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { configureVoiceStorage } from '../src/lib/voice-preferences.ts'
import { fetch as expoFetch } from 'expo/fetch'
import { getStringAsync, setStringAsync } from 'expo-clipboard'
import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync, getRandomBytes, randomUUID } from 'expo-crypto'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { openAuthSessionAsync, openBrowserAsync } from 'expo-web-browser'
import { useEffect, useState } from 'react'
import { Linking } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { installProductionNative, PrinterDevicePicker } from '../src/native/production.tsx'
import { configureApi } from '../src/api/config.ts'
import { setWebOpener } from '../src/lib/open-web.ts'
import { setPlatformOpener } from '../src/lib/open-app.ts'
import { setClipboardReader, setClipboardWriter } from '../src/lib/clipboard.ts'
import { setSocialNative, toBase64Url } from '../src/lib/social-auth.ts'
import { loadPrintMemory } from '../src/lib/printer-memory.ts'
import { makeDeviceId, createServices, ServicesProvider, SessionProvider, useServices, useSession } from '../src/services.tsx'
import { KeptStreamAudio } from '../src/screens/console/StreamAudio.tsx'
import { TAB_SCREENS } from '../src/lib/tab-routes.ts'
import { RouteSwipeProvider } from '../src/ui/kit/route-swipe.tsx'
import { TRY_LOGIN_ON, parseTryLogin } from '../src/lib/try-login.ts'
import { ScreenFocusProvider } from '../src/lib/cached-get.ts'
import { installAppUpdates } from '../src/native/updates.ts'
import { useAppUpdateWatch } from '../src/lib/app-update.ts'

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
// 앱 화면 새 버전 받기 (D-OTA-01): 운영 빌드에서만 켜진다
installAppUpdates()
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

/** 시뮬레이터 연습 로그인 (D-UX4-99): EXPO_PUBLIC_TRY_LOGIN=1 빌드에서만 livejjim://try-login 주소로 로그인한다 */
function TryLogin() {
  const { login } = useSession()
  useEffect(() => {
    if (!TRY_LOGIN_ON) return
    const take = (url: string | null | undefined) => {
      const found = url === null || url === undefined ? null : parseTryLogin(url)
      if (found !== null) void login(found.id, found.pw).catch(() => undefined)
    }
    void Linking.getInitialURL().then(take)
    const sub = Linking.addEventListener('url', (event) => take(event.url))
    return () => sub.remove()
  }, [login])
  return null
}

/** 켤 때·앞으로 돌아올 때 새 화면 묶음을 묻고 받아 둔다 (D-OTA-01) */
function UpdateWatch() {
  useAppUpdateWatch()
  return null
}

/** 방송 화면을 나가도 방송 소리를 계속 듣는다 (D-UX3-48) */
function StreamKeeper() {
  const services = useServices()
  const { session } = useSession()
  return <KeptStreamAudio session={services.voice} keep={services.streamKeep} signedIn={session.state === 'in'} />
}

const readyServices = loadPrintMemory(AsyncStorage, makeDeviceId).then(createServices)

export default function RootLayout() {
  const [services, setServices] = useState<Awaited<typeof readyServices> | null>(null)
  useEffect(() => {
    let mounted = true
    void readyServices.then((ready) => { if (mounted) setServices(ready) })
    return () => { mounted = false }
  }, [])
  if (services === null) return null
  return (
    <SafeAreaProvider>
      <ServicesProvider services={services}>
        <SessionProvider services={services}>
          <StatusBar style="dark" />
          <PrinterDevicePicker />
          <PrintBackground />
          <StreamKeeper />
          <TryLogin />
          <UpdateWatch />
          {/* 뒤로 가기는 왼쪽 가장자리에서 밀 때만 (D-UX3-24): iOS 26부터 기본이 '화면 어디서 밀어도 뒤로'라 라벨 끌기·가로 밀기까지 뒤로 갔다 */}
          {/* 쌓인 화면에서 돌아와 다시 보이면 그 화면의 서버 자료를 뒤에서 조용히 다시 받는다 (D-UX4-77) */}
          {/* 경로 안에 겹쳐 그린 화면이 열려 있으면 그 경로의 밀어 뒤로 가기를 끈다 — 겹친 화면이 스스로 밀려 닫힌다 (D-UX4-50) */}
          <Stack screenOptions={{ headerShown: false, fullScreenGestureEnabled: false }} screenLayout={({ navigation, children }) => <RouteSwipeProvider setEnabled={(enabled) => navigation.setOptions({ gestureEnabled: enabled })}><ScreenFocusProvider navigation={navigation}>{children}</ScreenFocusProvider></RouteSwipeProvider>}>
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
