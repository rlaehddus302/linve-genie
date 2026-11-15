// 앱 안 라이브 찾기 브라우저 (D-UX4-160~162, 사용자 지시 2026-11-16 "그냥 우리 앱 안에서 브라우저 띄워서 해당 라이브 들어간 다음에,
// 밑에 [이 라이브에요] 버튼을 누르면 자동으로 그 라이브로 연결되도록"):
// - 전체 화면 판. 위 한 줄: 뒤로 ‹ · 앞으로 › · 지금 쪽의 도메인 · [닫기]. 가운데 웹 화면.
// - 아래 고정 한 줄(규칙 8 — 위아래로 쌓지 않음): 왼쪽 [닫기], 오른쪽 [이 라이브예요]. 지금 주소가 라이브 한 편일 때만 켜지고(browserLiveLink),
//   아니면 꺼진 채 그 위에 "라이브 화면으로 들어가면 눌러 주세요".
// - 웹 화면은 바꿔 끼운다: 앱은 react-native-webview(native/live-browser-view.tsx — 앱 시작 때 끼움), 웹(시험)은 주소 칸 하나인 대체 화면.
// - 안드로이드 뒤로: 웹 화면에 뒤가 있으면 뒤로, 없으면 닫는다.
import { forwardRef, useImperativeHandle, useRef, useState, type ComponentType, type Ref } from 'react'
import { Modal, Platform, TextInput, View } from 'react-native'
import { browserHost, browserLiveLink } from '../lib/live-browser.ts'
import { BigButton, BottomCTA, HeaderTextButton, Icon, NAV, RADIUS, SPACE, Tap, Txt, useKit, useTopInset } from '../ui/kit/index.ts'
import { font } from '../ui/kit/font.ts'

export interface LiveBrowserViewHandle {
  goBack(): void
  goForward(): void
}

export interface LiveBrowserViewProps {
  /** 처음 여는 주소 (바뀌어도 다시 읽지 않는다) */
  readonly url: string
  /** 보는 주소가 바뀌었을 때 (쪽 이동·SPA history 바뀜 모두) */
  readonly onLocation: (url: string) => void
  /** 뒤로·앞으로 갈 수 있는지 */
  readonly onHistory: (state: { readonly canGoBack: boolean; readonly canGoForward: boolean }) => void
  readonly testID?: string
}

export type LiveBrowserViewComponent = ComponentType<LiveBrowserViewProps & { readonly ref?: Ref<LiveBrowserViewHandle> }>

/** 웹(시험) 대체 화면: 웹 화면 대신 주소 칸 — 넣은 주소를 보는 주소로 친다 */
const AddressOnlyView = forwardRef<LiveBrowserViewHandle, LiveBrowserViewProps>(function AddressOnlyView({ url, onLocation, testID }, ref) {
  const { p } = useKit()
  const [value, setValue] = useState(url)
  useImperativeHandle(ref, () => ({ goBack: () => undefined, goForward: () => undefined }))
  return (
    <View testID={testID} style={{ flex: 1, padding: SPACE.xl, gap: SPACE.sm }}>
      <Txt step="body" color="textSub">
        이 기기에서는 웹 화면을 열 수 없어요. 라이브 주소를 넣어 보세요.
      </Txt>
      <TextInput
        aria-label="주소"
        value={value}
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="url"
        onChangeText={(text) => {
          setValue(text)
          onLocation(text.trim())
        }}
        style={{ minHeight: 48, borderBottomWidth: 2, borderColor: p.outline, fontSize: 16, ...font(), color: p.text }}
      />
    </View>
  )
})

let BrowserView: LiveBrowserViewComponent = AddressOnlyView

/** 앱 시작 때 실제 웹 화면을 끼운다 (app/_layout.tsx — 웹·시험은 대체 화면 그대로). 앞에 끼워 있던 것을 돌려준다(시험이 되돌리게) */
export function setLiveBrowserView(next: LiveBrowserViewComponent): LiveBrowserViewComponent {
  const before = BrowserView
  BrowserView = next
  return before
}

/** 아래 단추 */
export const BROWSER_PICK = '이 라이브예요'
export const BROWSER_CLOSE = '닫기'
/** [이 라이브예요]가 꺼져 있을 때 그 위 안내 */
export const BROWSER_HINT = '라이브 화면으로 들어가면 눌러 주세요'

export interface LiveBrowserOpen {
  /** 열 때마다 새 번호 — 같은 주소를 다시 열어도 처음부터 */
  readonly id: number
  readonly url: string
}

export interface LiveBrowserProps {
  /** null이면 닫힘 */
  readonly open: LiveBrowserOpen | null
  readonly onClose: () => void
  /** [이 라이브예요] — 링크 칸에 넣을 라이브 링크 */
  readonly onPick: (url: string) => void
}

export function LiveBrowser({ open, onClose, onPick }: LiveBrowserProps) {
  // 판이 내려가는 동안에도 보던 쪽 그대로
  const held = useRef(open)
  if (open !== null) held.current = open
  const shown = held.current
  const back = useRef<() => void>(onClose)
  return (
    <Modal
      visible={open !== null}
      animationType={Platform.OS === 'web' ? 'none' : 'slide'}
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={() => back.current()}
    >
      {shown === null ? null : <BrowserPage key={shown.id} start={shown.url} onClose={onClose} onPick={onPick} backRef={back} />}
    </Modal>
  )
}

function BrowserPage({ start, onClose, onPick, backRef }: { readonly start: string; readonly onClose: () => void; readonly onPick: (url: string) => void; readonly backRef: { current: () => void } }) {
  const { p } = useKit()
  const top = useTopInset()
  const view = useRef<LiveBrowserViewHandle>(null)
  const [location, setLocation] = useState(start)
  const [history, setHistory] = useState({ canGoBack: false, canGoForward: false })
  const live = browserLiveLink(location)
  backRef.current = () => {
    if (history.canGoBack) view.current?.goBack()
    else onClose()
  }
  const host = browserHost(location)
  return (
    <View role="dialog" aria-label="라이브 찾기" testID="live-browser" style={{ flex: 1, backgroundColor: p.surface, paddingTop: top }}>
      <View style={{ minHeight: NAV.row, flexDirection: 'row', alignItems: 'center', paddingLeft: NAV.left, paddingRight: NAV.right, gap: SPACE.xs }}>
        <StepButton icon="back" label="뒤로" disabled={!history.canGoBack} onPress={() => view.current?.goBack()} />
        <StepButton icon="chevron" label="앞으로" disabled={!history.canGoForward} onPress={() => view.current?.goForward()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Txt step="body" weight="medium" color="textSub" numberOfLines={1} testID="live-browser-host">
            {host}
          </Txt>
        </View>
        <HeaderTextButton label={BROWSER_CLOSE} ariaLabel="브라우저 닫기" onPress={onClose} />
      </View>
      <View style={{ flex: 1, borderTopWidth: 1, borderColor: p.line }}>
        <BrowserView ref={view} url={start} onLocation={setLocation} onHistory={setHistory} testID="live-browser-web" />
      </View>
      <BottomCTA {...(live === null ? { note: BROWSER_HINT } : {})}>
        <BigButton kind="secondary" label={BROWSER_CLOSE} onPress={onClose} testID="live-browser-close" />
        <BigButton kind="primary" label={BROWSER_PICK} disabled={live === null} onPress={() => (live === null ? undefined : onPick(live.url))} testID="live-browser-pick" />
      </BottomCTA>
    </View>
  )
}

/** 머리의 뒤로 ‹ · 앞으로 › (갈 곳이 없으면 흐리게, 눌러도 아무 일 없음) */
function StepButton({ icon, label, disabled, onPress }: { readonly icon: 'back' | 'chevron'; readonly label: string; readonly disabled: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap role="button" aria-label={label} aria-disabled={disabled} disabled={disabled} onPress={onPress} hitSlop={4} style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent', opacity: disabled ? 0.3 : 1 })}>
      <Icon name={icon} size={22} color={p.text} />
    </Tap>
  )
}
