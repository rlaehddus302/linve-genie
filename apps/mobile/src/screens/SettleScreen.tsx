// 정산 탭 (D-UX2-02·D-UX2-07): 정산은 아직 앱 화면이 없다 — 탭을 누르자마자 브라우저로 나가지 않고, 웹에서 열린다는 한 줄과 [웹으로 열기]를 먼저 보인다.
import { ScrollView, View } from 'react-native'
import { openWeb } from '../lib/open-web.ts'
import { BigButton, Txt, useKit } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'

export const SETTLE_WEB_LINE = '정산은 웹 화면에서 열려요'
export const SETTLE_WEB_HINT = '휴대폰 브라우저에서 열려요. 로그인이 필요할 수 있어요.'

export function SettleScreen() {
  const { p } = useKit()
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="settle-screen">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.xl, paddingTop: 28, paddingBottom: SPACE.xxxl, gap: SPACE.xl }}>
        <Txt step="headline" weight="heavy" role="heading" aria-level={1}>
          정산
        </Txt>
        <View style={{ gap: SPACE.sm }}>
          <Txt step="bodyLarge" weight="bold">
            {SETTLE_WEB_LINE}
          </Txt>
          <Txt step="caption" color="textSub">
            {SETTLE_WEB_HINT}
          </Txt>
        </View>
        <BigButton label="웹으로 열기" ariaLabel="정산 — 웹으로 열기" onPress={() => void openWeb('/settlements')} />
      </ScrollView>
    </View>
  )
}
