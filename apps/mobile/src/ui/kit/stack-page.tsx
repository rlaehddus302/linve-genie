// 진짜 쌓인 화면(경로)의 틀 (D-UX4-57): 모든 쌓인 화면과 같은 머리(NavBar) + 본문 + 키보드 피하기.
// 화면 넘김·밀어서 뒤로 가기·상태 막대는 휴대폰(네이티브 쌓기)이 그대로 맡는다 — 흉내 내지 않는다.
// 경로 파일이 SafeAreaView(edges top)로 감싸므로 위는 띄우지 않는다(usePageTop).
import type { ReactNode } from 'react'
import { KeyboardAvoidingView, ScrollView, View } from 'react-native'
import { NavBar } from './app.tsx'
import { KEYBOARD_AVOID } from './sheets.tsx'
import { GUTTER, SPACE } from './tokens.ts'
import { useKit, usePageTop, useTopInset } from './theme.tsx'

export function StackPage({ title, name, onBack, backLabel = '뒤로', gray = false, scroll = true, footer, children, testID }: { readonly title?: string; readonly name: string; readonly onBack: () => void; readonly backLabel?: string; readonly gray?: boolean; readonly scroll?: boolean; readonly footer?: ReactNode; readonly children?: ReactNode; readonly testID?: string }) {
  const { p } = useKit()
  const top = usePageTop()
  // 키보드 피하기는 이 화면이 화면 맨 위에서 얼마나 아래에서 시작하는지 알아야 한다(상태 막대 아래면 그 높이)
  const offset = useTopInset() - top
  const body = scroll ? (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: gray ? GUTTER : SPACE.lg, paddingTop: SPACE.sm, paddingBottom: SPACE.xxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1 }}>{children}</View>
  )
  return (
    <View role="main" aria-label={name} testID={testID} style={{ flex: 1, backgroundColor: gray ? p.background : p.surface, paddingTop: top }}>
      <KeyboardAvoidingView behavior={KEYBOARD_AVOID} keyboardVerticalOffset={offset} style={{ flex: 1 }}>
        <NavBar onBack={onBack} backLabel={backLabel} {...(title === undefined ? {} : { title })} />
        {body}
        {footer}
      </KeyboardAvoidingView>
    </View>
  )
}
