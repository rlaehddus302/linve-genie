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
  /** 앱 안 화면 열기 (리포트·손님·입금 확인 — D-APPX-01). 없으면 그 줄을 보이지 않는다 */
  readonly openApp?: (path: InAppPath) => void
}

/** 웹에만 있던 화면 중 앱 화면으로 옮긴 것 (D-APPX-01) */
export const IN_APP_SCREENS = [
  { path: '/deposits', title: '입금 확인', sub: '은행 입금과 손님 맞추기, 붙여넣기' },
  { path: '/customers', title: '손님', sub: '단골, 입금 늦음, 메모, 저장한 배송지' },
  { path: '/report', title: '방송 리포트', sub: '매출, 손님, 품종별·시간대별 판매' },
] as const
export type InAppPath = (typeof IN_APP_SCREENS)[number]['path']

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
          <TodoRow title="설정" sub="음성, 라벨, 알림 받기, 문자 연동" onPress={nav.openSettings} />
          {nav.openApp !== undefined
            ? IN_APP_SCREENS.map((screen) => (
                <View key={screen.path}>
                  <RowDivider />
                  <TodoRow title={screen.title} sub={screen.sub} onPress={() => nav.openApp?.(screen.path)} />
                </View>
              ))
            : null}
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
