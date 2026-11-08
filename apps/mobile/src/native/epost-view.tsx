// 앱 안 웹 화면 (EP1 우체국 사전접수 — D-EP1-05). react-native-webview를 한곳에서만 쓴다(시험은 이 모듈을 가짜로 바꾼다).
// - https와 빈 쪽만 연다(전화·앱 열기 주소는 막는다). 우체국 새 창(주소 찾기)은 beforeLoad 스크립트가 같은 쪽 위 판으로 바꾼다(D-EP1-11).
// - 쿠키는 앱 안 화면끼리만 나눈다(우체국 로그인 유지). 파일 받기·위치·카메라는 쓰지 않는다.
import { forwardRef, useImperativeHandle, useRef, useState, type ComponentType, type Ref } from 'react'
import { WebView, type WebViewMessageEvent, type WebViewNavigation, type WebViewProps } from 'react-native-webview'
import { canOpenInView } from '../lib/epost-agent.ts'

/** 쓰는 부분만 (패키지의 클래스 타입은 이 TypeScript·React 판에서 속성이 never로 잡힌다) */
interface WebViewInstance {
  goBack(): void
  injectJavaScript(script: string): void
}
const Web = WebView as unknown as ComponentType<WebViewProps & { readonly ref?: Ref<WebViewInstance> }>
type ShouldStart = NonNullable<WebViewProps['onShouldStartLoadWithRequest']>
type LoadEnd = NonNullable<WebViewProps['onLoadEnd']>
type OpenWindow = NonNullable<WebViewProps['onOpenWindow']>

export interface EpostViewHandle {
  /** 지금 쪽에 스크립트를 넣는다 (넣기 전에 주소를 본 쪽에서만 부른다) */
  inject(script: string): void
  goBack(): void
  load(url: string): void
}

export interface EpostViewProps {
  readonly url: string
  /** 쪽마다 그 쪽 스크립트보다 먼저 넣는 스크립트 (우체국 새 창을 같은 쪽 위 판으로 — D-EP1-11) */
  readonly beforeLoad?: string
  readonly onMessage: (data: string) => void
  /** 쪽을 다 읽었을 때 (그 쪽 주소) */
  readonly onLoaded: (url: string) => void
  readonly onNavigate?: (state: { readonly url: string; readonly canGoBack: boolean }) => void
  /** 새 창 요청 (주소 검색 팝업 등) */
  readonly onOpenWindow?: (url: string) => void
  readonly testID?: string
}

export const EpostView = forwardRef<EpostViewHandle, EpostViewProps>(function EpostView({ url, beforeLoad, onMessage, onLoaded, onNavigate, onOpenWindow, testID }, ref) {
  const view = useRef<WebViewInstance>(null)
  const [source, setSource] = useState({ uri: url })
  useImperativeHandle(ref, () => ({
    inject: (script) => view.current?.injectJavaScript(script),
    goBack: () => view.current?.goBack(),
    load: (next) => setSource({ uri: next }),
  }))
  return (
    <Web
      ref={view}
      testID={testID}
      source={source}
      injectedJavaScriptBeforeContentLoaded={beforeLoad}
      originWhitelist={['https://*', 'about:*']}
      onShouldStartLoadWithRequest={((request) => canOpenInView(request.url)) satisfies ShouldStart}
      onMessage={(event: WebViewMessageEvent) => onMessage(event.nativeEvent.data)}
      onLoadEnd={((event) => onLoaded(event.nativeEvent.url)) satisfies LoadEnd}
      onNavigationStateChange={(state: WebViewNavigation) => onNavigate?.({ url: state.url, canGoBack: state.canGoBack })}
      onOpenWindow={((event) => onOpenWindow?.(event.nativeEvent.targetUrl)) satisfies OpenWindow}
      setSupportMultipleWindows
      javaScriptCanOpenWindowsAutomatically
      sharedCookiesEnabled
      thirdPartyCookiesEnabled={false}
      allowFileAccess={false}
      allowsBackForwardNavigationGestures
      mixedContentMode="never"
      geolocationEnabled={false}
      mediaCapturePermissionGrantType="deny"
      setBuiltInZoomControls={false}
      textZoom={100}
      style={{ flex: 1 }}
    />
  )
})
