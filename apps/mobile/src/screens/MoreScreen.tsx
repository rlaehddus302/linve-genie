// 전체 탭 (옛 더보기, D-UX2-02 → D-UX3-04 토스식 → D-UX3-96 다듬기): 맨 위 한 줄에 왼쪽 계정 이름 · 오른쪽 [설정], 그 아래 앱 화면을 묶음 이름이 든 흰 카드로
// (방송 · 주문·입금 · 배송 · 가게 — D-APPX-01·03), 맨 아래 계정(로그아웃). 라벨·프린터는 아래 탭 "라벨"로 옮겼다(D-UX3-01).
// 줄은 토스 "전체"처럼 이름만 — 줄마다 붙던 설명 글과 줄 사이 선은 뺐다(D-UX3-96). 간격·여백은 홈과 같다.
// "웹에서 보기"는 웹에만 있는 화면이 생길 때만 보인다(지금은 비었다 — 바깥 로그인 연결은 가게 설정 "연결").
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { openWeb, WEB_SCREENS } from '../lib/open-web.ts'
import { OPEN_IN_WEB } from '../lib/words.ts'
import { AppHeader, ConfirmSheet, HeaderTextButton, NAV, RowGroup, TodoRow, Txt, useKit, useTabBarRoom } from '../ui/kit/index.ts'
import { GUTTER, SPACE } from '../ui/kit/tokens.ts'

export interface MoreNavigation {
  /** 옛 더보기의 라벨·프린터 줄 — 라벨은 아래 탭이 됐다(D-UX3-01). 받아도 쓰지 않는다 */
  readonly openLabels?: () => void
  readonly openSettings: () => void
  /** 앱 안 화면 열기 (리포트·손님·입금 확인 — D-APPX-01). 없으면 그 줄을 보이지 않는다 */
  readonly openApp?: (path: InAppPath) => void
}

/** 웹에만 있던 화면 중 앱 화면으로 옮긴 것 (D-APPX-01). group: 전체 탭에서 묶는 카드 (D-UX3-04). 줄 설명 글은 뺐다 (D-UX3-96) */
export const IN_APP_SCREENS = [
  { path: '/reviews', title: '확인 필요', group: '방송' },
  { path: '/schedule', title: '방송 일정', group: '방송' },
  { path: '/report', title: '방송 리포트', group: '방송' },
  { path: '/deposits', title: '입금 확인', group: '주문·입금' },
  { path: '/buyers', title: '구매자', group: '주문·입금' },
  { path: '/receipts', title: '영수증·판매대장', group: '배송' },
  { path: '/labels', title: '라벨 프린터', group: '가게' },
  { path: '/shop-settings', title: '가게 설정', group: '가게' },
] as const
export const MORE_GROUPS = ['방송', '주문·입금', '배송', '가게'] as const
export type InAppPath = (typeof IN_APP_SCREENS)[number]['path']

export function MoreScreen({ nav, account, onLogout }: { readonly nav: MoreNavigation; readonly account?: string; readonly onLogout?: () => void }) {
  const { p } = useKit()
  const room = useTabBarRoom()
  const [asking, setAsking] = useState(false)
  // "김다육 · kim" → 이름은 크게, 아이디는 옆에 작게
  const [name, loginId] = account === undefined ? [undefined, undefined] : splitAccount(account)
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="more-screen">
      {/* 모든 화면과 같은 머리 줄 (D-UX4-59): 왼쪽 계정(이름 크게 · 아이디 작게) · 오른쪽 "설정" 글자 단추 (토스 "고객센터 | 설정" 자리) */}
      <AppHeader
        title={name ?? '전체'}
        left={
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SPACE.sm, transform: [{ translateY: NAV.titleLift }] }}>
            <Txt step="title" weight="heavy" numberOfLines={1} role="heading" aria-level={1}>
              {name ?? '전체'}
            </Txt>
            {loginId === undefined ? null : (
              <Txt step="body" color="textSub" numberOfLines={1}>
                {loginId}
              </Txt>
            )}
          </View>
        }
        right={<HeaderTextButton label="설정" onPress={nav.openSettings} />}
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl + room, gap: SPACE.md }} scrollIndicatorInsets={{ bottom: room }}>
        {nav.openApp !== undefined
          ? MORE_GROUPS.map((group) => (
              <RowGroup key={group} title={group}>
                {IN_APP_SCREENS.filter((screen) => screen.group === group).map((screen) => (
                  <TodoRow key={screen.path} title={screen.title} onPress={() => nav.openApp?.(screen.path)} />
                ))}
              </RowGroup>
            ))
          : null}
        {WEB_SCREENS.length > 0 ? (
          <RowGroup title="웹에서 보기" label={OPEN_IN_WEB}>
            {WEB_SCREENS.map((screen) => (
              <TodoRow key={screen.key} title={screen.word} ariaLabel={`${screen.word} — ${OPEN_IN_WEB}`} onPress={() => void openWeb(screen.path)} />
            ))}
          </RowGroup>
        ) : null}
        {onLogout !== undefined ? (
          <RowGroup title="계정" label="계정">
            <TodoRow title="로그아웃" onPress={() => setAsking(true)} />
          </RowGroup>
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

/** "김다육 · kim" → ["김다육", "kim"] (가운뎃점이 없으면 이름만) */
export function splitAccount(account: string): readonly [string, string | undefined] {
  const at = account.lastIndexOf(' · ')
  return at < 0 ? [account, undefined] : [account.slice(0, at), account.slice(at + 3)]
}
