// 더보기 (D-UX2-02): 라벨·프린터, 설정, 웹에서 여는 화면(정산·구매자·택배…), 로그아웃. 웹 화면은 기기 브라우저로 연다(APP-01 AC4).
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { openWeb, WEB_SCREENS } from '../lib/open-web.ts'
import { OPEN_IN_WEB } from '../lib/words.ts'
import { ConfirmSheet, GroupLabel, RowDivider, RowGroup, TodoRow, Txt, useKit } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'

export interface MoreNavigation {
  readonly openLabels: () => void
  readonly openSettings: () => void
}

export function MoreScreen({ nav, account, onLogout }: { readonly nav: MoreNavigation; readonly account?: string; readonly onLogout?: () => void }) {
  const { p } = useKit()
  const [asking, setAsking] = useState(false)
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="more-screen">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.xl, paddingTop: 28, paddingBottom: SPACE.xxxl, gap: SPACE.xl }}>
        <Txt step="headline" weight="heavy" role="heading" aria-level={1}>
          더보기
        </Txt>
        <RowGroup label="앱에서">
          <TodoRow title="라벨·프린터" sub="프린터 잇기, 라벨 뽑기" onPress={nav.openLabels} />
          <RowDivider />
          <TodoRow title="설정" sub="음성, 라벨, 알림 받기" onPress={nav.openSettings} />
        </RowGroup>
        <View style={{ gap: 10 }}>
          <GroupLabel>웹에서 보기</GroupLabel>
          <Txt step="caption" color="textSub">
            휴대폰 브라우저에서 열려요. 로그인이 필요할 수 있어요.
          </Txt>
          <RowGroup label={OPEN_IN_WEB}>
            {WEB_SCREENS.map((screen, index) => (
              <View key={screen.key}>
                {index > 0 ? <RowDivider /> : null}
                <TodoRow title={screen.word} ariaLabel={`${screen.word} — ${OPEN_IN_WEB}`} onPress={() => void openWeb(screen.path)} />
              </View>
            ))}
          </RowGroup>
        </View>
        {onLogout !== undefined ? (
          <View style={{ gap: 10 }}>
            <GroupLabel>계정</GroupLabel>
            <RowGroup label="계정">
              <TodoRow title="로그아웃" sub={account} onPress={() => setAsking(true)} />
            </RowGroup>
          </View>
        ) : null}
      </ScrollView>
      <ConfirmSheet
        visible={asking}
        question="로그아웃할까요?"
        description="다시 들어오려면 아이디와 비밀번호가 필요해요."
        confirmLabel="로그아웃"
        cancelLabel="아니요, 그대로 둘게요"
        danger
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false)
          onLogout?.()
        }}
      />
    </View>
  )
}
