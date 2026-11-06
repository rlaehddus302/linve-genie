// 전체 탭 (옛 더보기, D-UX2-02 → D-UX3-04 토스식): 맨 위 제목 "전체" + 오른쪽 위 [설정], 그 아래 앱 화면을 묶음 이름이 든 흰 카드로
// (방송 · 주문·입금 · 배송 · 가게 — D-APPX-01·03), 맨 아래 계정(로그아웃). 라벨·프린터는 아래 탭 "라벨"로 옮겼다(D-UX3-01).
// "웹에서 보기"는 웹에만 있는 화면이 생길 때만 보인다(지금은 비었다 — 바깥 로그인 연결은 가게 설정 "연결").
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { openWeb, WEB_SCREENS } from '../lib/open-web.ts'
import { OPEN_IN_WEB } from '../lib/words.ts'
import { ConfirmSheet, RowDivider, RowGroup, TodoRow, Txt, useKit, useTabBarRoom } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'

export interface MoreNavigation {
  /** 옛 더보기의 라벨·프린터 줄 — 라벨은 아래 탭이 됐다(D-UX3-01). 받아도 쓰지 않는다 */
  readonly openLabels?: () => void
  readonly openSettings: () => void
  /** 앱 안 화면 열기 (리포트·손님·입금 확인 — D-APPX-01). 없으면 그 줄을 보이지 않는다 */
  readonly openApp?: (path: InAppPath) => void
}

/** 웹에만 있던 화면 중 앱 화면으로 옮긴 것 (D-APPX-01). group: 전체 탭에서 묶는 카드 (D-UX3-04) */
export const IN_APP_SCREENS = [
  { path: '/reviews', title: '확인 필요', sub: '주문인지 애매한 댓글·문자 주문으로 넣거나 빼기', group: '방송' },
  { path: '/schedule', title: '방송 일정', sub: '다음 방송 알리기, 공개 일정 주소, 알림 신청 수', group: '방송' },
  { path: '/report', title: '방송 리포트', sub: '매출, 손님, 품종별·시간대별 판매', group: '방송' },
  { path: '/deposits', title: '입금 확인', sub: '은행 입금과 손님 맞추기, 붙여넣기', group: '주문·입금' },
  { path: '/buyers', title: '구매자', sub: '날짜별 구매자, 합치기·떼어 내기·차단', group: '주문·입금' },
  { path: '/customers', title: '손님', sub: '단골, 입금 늦음, 메모, 저장한 배송지', group: '주문·입금' },
  { path: '/receipts', title: '영수증·판매대장', sub: '구매 내역 확인서 링크·PDF, 판매대장 엑셀', group: '배송' },
  { path: '/labels', title: '라벨 프린터', sub: '라벨 켜기·끄기, 프린터 연결, 라벨 꾸미기', group: '가게' },
  { path: '/shop-settings', title: '가게 설정', sub: '가게·계좌, 판매 규칙, 배송비, 택배, 손님 관리', group: '가게' },
] as const
export const MORE_GROUPS = ['방송', '주문·입금', '배송', '가게'] as const
export type InAppPath = (typeof IN_APP_SCREENS)[number]['path']

export function MoreScreen({ nav, account, onLogout }: { readonly nav: MoreNavigation; readonly account?: string; readonly onLogout?: () => void }) {
  const { p } = useKit()
  const room = useTabBarRoom()
  const [asking, setAsking] = useState(false)
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="more-screen">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.xl, paddingBottom: SPACE.xxxl + room, gap: SPACE.md }} scrollIndicatorInsets={{ bottom: room }}>
        {/* 맨 위: 제목 + 오른쪽 위 설정 (토스 "고객센터 | 설정" 자리) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingLeft: SPACE.xs, marginBottom: SPACE.xs }}>
          <Pressable role="button" aria-label="설정" onPress={nav.openSettings} hitSlop={6} style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous', justifyContent: 'center', backgroundColor: pressed ? p.pressed : 'transparent' })}>
            <Txt step="bodyLarge" weight="medium" color="textSub">
              설정
            </Txt>
          </Pressable>
        </View>
        {nav.openApp !== undefined
          ? MORE_GROUPS.map((group) => {
              const rows = IN_APP_SCREENS.filter((screen) => screen.group === group)
              return (
                <RowGroup key={group} title={group}>
                  {rows.map((screen, index) => (
                    <View key={screen.path}>
                      {index > 0 ? <RowDivider /> : null}
                      <TodoRow title={screen.title} sub={screen.sub} onPress={() => nav.openApp?.(screen.path)} />
                    </View>
                  ))}
                </RowGroup>
              )
            })
          : null}
        {WEB_SCREENS.length > 0 ? (
          <View style={{ gap: 10 }}>
            <Txt step="caption" color="textSub">
              휴대폰 브라우저에서 열려요. 로그인이 필요할 수 있어요.
            </Txt>
            <RowGroup title="웹에서 보기" label={OPEN_IN_WEB}>
              {WEB_SCREENS.map((screen, index) => (
                <View key={screen.key}>
                  {index > 0 ? <RowDivider /> : null}
                  <TodoRow title={screen.word} ariaLabel={`${screen.word} — ${OPEN_IN_WEB}`} onPress={() => void openWeb(screen.path)} />
                </View>
              ))}
            </RowGroup>
          </View>
        ) : null}
        {onLogout !== undefined ? (
          <RowGroup title="계정" label="계정">
            <TodoRow title="로그아웃" sub={account} onPress={() => setAsking(true)} />
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
