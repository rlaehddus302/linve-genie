// 앱 안 우체국 화면의 웹뷰 (D-UX3-37). 화면(EpostScreen)은 이 얇은 껍데기만 쓴다 — 시험에서는 이 파일을 가짜로 바꾼다.
// 우체국 화면이 여는 새 창은 앱 안에서 열 수 없다(웹뷰에는 opener가 이어진 창이 없다) → 알리기만 한다. 우체국 [파일(주소) 등록] 창은 스크립트가 대신한다.
import { useImperativeHandle, useRef, type ComponentType, type Ref } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { WebView } from 'react-native-webview'

/** 웹뷰에서 쓰는 것만 (이 판의 타입 정의는 RN 0.88 타입과 겹쳐 props가 never가 된다 — 쓰는 속성만 적어 둔다) */
interface NativeWebViewHandle {
  injectJavaScript(script: string): void
  reload(): void
}
interface NativeWebViewProps {
  readonly ref?: Ref<NativeWebViewHandle>
  readonly source: { readonly uri: string }
  readonly style?: StyleProp<ViewStyle>
  readonly originWhitelist?: readonly string[]
  readonly javaScriptEnabled?: boolean
  readonly domStorageEnabled?: boolean
  readonly sharedCookiesEnabled?: boolean
  readonly setSupportMultipleWindows?: boolean
  readonly allowsBackForwardNavigationGestures?: boolean
  readonly onMessage?: (event: { readonly nativeEvent: { readonly data: string } }) => void
  readonly onLoadEnd?: (event: { readonly nativeEvent: { readonly url: string } }) => void
  readonly onOpenWindow?: (event: { readonly nativeEvent: { readonly targetUrl: string } }) => void
}
const NativeWebView = WebView as unknown as ComponentType<NativeWebViewProps>

export interface EpostWebHandle {
  /** 지금 화면에 스크립트를 넣는다 */
  inject(script: string): void
  reload(): void
}

export interface EpostWebProps {
  readonly uri: string
  readonly onMessage: (data: string) => void
  /** 화면 하나를 다 읽었을 때 (주소) */
  readonly onLoaded: (url: string) => void
  /** 우체국 화면이 새 창을 열려고 했을 때 */
  readonly onPopup: () => void
  readonly ref?: Ref<EpostWebHandle>
}

export function EpostWeb({ uri, onMessage, onLoaded, onPopup, ref }: EpostWebProps) {
  const view = useRef<NativeWebViewHandle>(null)
  useImperativeHandle(ref, () => ({
    inject: (script: string) => view.current?.injectJavaScript(script),
    reload: () => view.current?.reload(),
  }))
  return (
    <NativeWebView
      ref={view}
      source={{ uri }}
      style={{ flex: 1 }}
      originWhitelist={['https://*']}
      javaScriptEnabled
      domStorageEnabled
      sharedCookiesEnabled
      setSupportMultipleWindows={false}
      allowsBackForwardNavigationGestures
      onMessage={(event) => onMessage(event.nativeEvent.data)}
      onLoadEnd={(event) => onLoaded(event.nativeEvent.url)}
      onOpenWindow={() => onPopup()}
    />
  )
}
