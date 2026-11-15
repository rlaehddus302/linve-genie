// 앱 안 라이브 찾기 웹 화면 (D-UX4-161): 이미 앱에 들어 있는 react-native-webview(우체국 화면과 같은 것 — 새 네이티브 모듈 없음).
// 앱 시작 때 setLiveBrowserView로 끼운다(시험·웹은 LiveBrowser의 주소 칸 대체 화면).
// - 웹 쪽(https·http)만 연다 — 앱 열기 주소(youtube://·intent:// 등)는 막아 앱 밖으로 나가지 않는다. 새 창은 같은 화면에서.
// - 주소 변화: onNavigationStateChange + 쪽 안 스크립트(LOCATION_WATCH_SCRIPT)가 history 바뀜(SPA)을 알려 준다.
// - 로그인을 요구하지 않는다(웹뷰의 구글 로그인은 막힌다) — 공개 라이브 쪽만 본다. 쿠키는 우체국 화면과 나누지 않는다.
import { forwardRef, useImperativeHandle, useRef, useState, type ComponentType, type Ref } from 'react'
import { WebView, type WebViewMessageEvent, type WebViewNavigation, type WebViewProps } from 'react-native-webview'
import { LOCATION_WATCH_SCRIPT, canOpenInBrowser, readLocationMessage } from '../lib/live-browser.ts'
import type { LiveBrowserViewHandle, LiveBrowserViewProps } from '../screens/LiveBrowser.tsx'

/** 쓰는 부분만 (패키지의 클래스 타입은 이 TypeScript·React 판에서 속성이 never로 잡힌다) */
interface WebViewInstance {
  goBack(): void
  goForward(): void
}
const Web = WebView as unknown as ComponentType<WebViewProps & { readonly ref?: Ref<WebViewInstance> }>
type ShouldStart = NonNullable<WebViewProps['onShouldStartLoadWithRequest']>

export const LiveBrowserWebView = forwardRef<LiveBrowserViewHandle, LiveBrowserViewProps>(function LiveBrowserWebView({ url, onLocation, onHistory, testID }, ref) {
  const view = useRef<WebViewInstance>(null)
  // 처음 주소만 — 다시 그려도 쪽을 다시 읽지 않는다
  const [source] = useState({ uri: url })
  useImperativeHandle(ref, () => ({
    goBack: () => view.current?.goBack(),
    goForward: () => view.current?.goForward(),
  }))
  return (
    <Web
      ref={view}
      testID={testID}
      source={source}
      injectedJavaScript={LOCATION_WATCH_SCRIPT}
      originWhitelist={['https://*', 'http://*', 'about:*']}
      onShouldStartLoadWithRequest={((request) => canOpenInBrowser(request.url)) satisfies ShouldStart}
      onMessage={(event: WebViewMessageEvent) => {
        const next = readLocationMessage(event.nativeEvent.data)
        if (next !== null) onLocation(next)
      }}
      onNavigationStateChange={(state: WebViewNavigation) => {
        if (/^https?:\/\//i.test(state.url)) onLocation(state.url)
        onHistory({ canGoBack: state.canGoBack, canGoForward: state.canGoForward })
      }}
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
      allowsInlineMediaPlayback
      allowsBackForwardNavigationGestures
      thirdPartyCookiesEnabled={false}
      allowFileAccess={false}
      mixedContentMode="never"
      geolocationEnabled={false}
      mediaCapturePermissionGrantType="deny"
      setBuiltInZoomControls={false}
      textZoom={100}
      style={{ flex: 1 }}
    />
  )
})
