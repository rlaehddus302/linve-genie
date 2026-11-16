// 전체 탭 (옛 더보기, D-UX2-02 → D-UX3-04 토스식 → D-UX3-96 다듬기 → D-UX4-201 설정을 밖으로): 맨 위 한 줄에 계정 이름(왼쪽),
// 그 아래 앱 화면과 설정을 관련된 것끼리 묶은 흰 카드 — 라이브 · 음성 인식 · 휴대폰 알림 받기 · 주문·입금 · 배송 · 라벨 · 가게 · 계정.
// 옛 [설정] 단추 뒤에 있던 스위치·줄(음성 바로 등록·품종 장부·라벨 기능·자동 출력·연동된 계정·권한·개인정보처리방침)을 모두 이 탭에 바로 보인다.
// 라벨 묶음에는 라벨 프린터·라벨 디자인 고치기·라벨 기능·자동 출력이 함께 있다(사용자 지시 2026-11-16).
// 줄은 토스 "전체"처럼 이름만(D-UX3-96). 간격·여백은 홈과 같다.
// "웹에서 보기"는 웹에만 있는 화면이 생길 때만 보인다(지금은 비었다 — 바깥 로그인 연결은 가게 설정 "연결").
import { useState, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { LINKED_TITLE, PROVIDER_NAMES } from '@livejjim/web/src/lib/social-login.ts'
import { openExternal, openWeb, WEB_SCREENS } from '../lib/open-web.ts'
import { OPEN_IN_WEB } from '../lib/words.ts'
import { AppHeader, ConfirmSheet, NAV, RowGroup, Toast, TodoRow, Txt, useKit, useTabBarRoom } from '../ui/kit/index.ts'
import { GUTTER, SPACE } from '../ui/kit/tokens.ts'
import { Late } from '../ui/late.tsx'
import { PhoneNoticeCard } from './PhoneNoticeCard.tsx'
import { LabelToggleRows, LinkedLogos, PermissionNotes, useLinkedProviders, useSettingsActions, VoiceInstantRow, type SettingsActions } from './settings/SettingRows.tsx'
import { VARIETIES_TITLE } from './VarietiesScreen.tsx'

export interface MoreNavigation {
  /** 옛 더보기의 라벨·프린터 줄 — 라벨은 아래 탭이 됐다(D-UX3-01). 받아도 쓰지 않는다 */
  readonly openLabels?: () => void
  /** 옛 [설정] 단추 — 설정은 이 탭에 바로 보인다(D-UX4-201). 받아도 쓰지 않는다 */
  readonly openSettings?: () => void
  /** 앱 안 화면 열기 (리포트·손님·입금 확인 — D-APPX-01). 없으면 그 줄을 보이지 않는다 */
  readonly openApp?: (path: InAppPath) => void
}

/** 설정 줄을 보일 때 필요한 것 (D-UX4-201). 없으면 설정 줄을 보이지 않는다(화면 줄만) */
export interface MoreSettings {
  /** 내 품종 장부 (D-V3-127) */
  readonly openVarieties: () => void
  /** 연동된 소셜 계정 화면 (D-UX3-61) */
  readonly openLinked?: () => void
  /** 바뀌면 연동된 계정을 다시 읽는다 (그 화면에서 돌아올 때) */
  readonly linkedRefresh?: number
  readonly policyUrl?: string
  /** 디자인 견본 (개발 빌드만) */
  readonly openDesign?: () => void
  /** 알림 받기를 뺀 빌드(LIVEGENIE_NOTICE=off)면 false — 칸을 숨긴다 */
  readonly showPhoneNotice: boolean
}

/** 웹에만 있던 화면 중 앱 화면으로 옮긴 것 (D-APPX-01). group: 전체 탭에서 묶는 카드 (D-UX3-04). 줄 설명 글은 뺐다 (D-UX3-96) */
export const IN_APP_SCREENS = [
  { path: '/reviews', title: '확인 필요', group: '라이브' },
  { path: '/schedule', title: '라이브 일정', group: '라이브' },
  { path: '/report', title: '라이브 리포트', group: '라이브' },
  { path: '/deposits', title: '입금 확인', group: '주문·입금' },
  { path: '/buyers', title: '구매자', group: '주문·입금' },
  { path: '/receipts', title: '영수증·판매대장', group: '배송' },
  // 라벨은 한 묶음에 (D-UX4-201): 프린터 연결·출력 상태 · 라벨 디자인 고치기(방송 시작 라벨 단계의 그 화면 하나, D-UX4-80)
  { path: '/labels', title: '라벨 프린터', group: '라벨' },
  { path: '/label-setup?step=design', title: '라벨 디자인', group: '라벨' },
  { path: '/shop-settings', title: '가게 설정', group: '가게' },
  // 정산서에 찍는 계좌·전화번호·방송 이름·배송비 (D-RETRO-60)
  { path: '/statement-info', title: '정산 정보', group: '가게' },
] as const
export const MORE_GROUPS = ['라이브', '음성 인식', '주문·입금', '배송', '라벨', '가게'] as const
export type InAppPath = (typeof IN_APP_SCREENS)[number]['path']
type MoreGroup = (typeof MORE_GROUPS)[number]

/** 카드 안 스위치 줄 — 화면 줄(TodoRow)과 같은 양옆 여백 */
function Pad({ children }: { readonly children: ReactNode }) {
  return <View style={{ paddingHorizontal: SPACE.xl }}>{children}</View>
}

/** 묶음마다 화면 줄 뒤에 붙는 설정 줄 */
function settingRows(group: MoreGroup, settings: MoreSettings, act: SettingsActions): ReactNode {
  if (group === '음성 인식') {
    return (
      <>
        <Pad>
          <VoiceInstantRow act={act} titleWeight="book" />
        </Pad>
        {/* 내 품종 장부 (D-V3-127) — 직접 지은 이름도 알아듣게 */}
        <TodoRow title={VARIETIES_TITLE} sub="키우는 품종 이름을 적어 두면 더 정확히 음성 인식해요." onPress={settings.openVarieties} />
      </>
    )
  }
  if (group === '라벨') {
    return (
      <Pad>
        <LabelToggleRows act={act} titleWeight="book" />
      </Pad>
    )
  }
  return null
}

function LinkedRow({ settings }: { readonly settings: MoreSettings }) {
  const linked = useLinkedProviders(settings.openLinked !== undefined, settings.linkedRefresh ?? 0)
  const open = settings.openLinked
  return (
    <Late>
      {open !== undefined && linked !== null ? (
        <TodoRow
          title={LINKED_TITLE}
          ariaLabel={`${LINKED_TITLE} — ${linked.length === 0 ? '없음' : linked.map((provider) => PROVIDER_NAMES[provider]).join(', ')}`}
          right={<LinkedLogos linked={linked} />}
          onPress={open}
          testID="settings-linked"
        />
      ) : null}
    </Late>
  )
}

export function MoreScreen({ nav, account, onLogout, settings }: { readonly nav: MoreNavigation; readonly account?: string; readonly onLogout?: () => void; readonly settings?: MoreSettings }) {
  const { p } = useKit()
  const room = useTabBarRoom()
  const act = useSettingsActions()
  const [asking, setAsking] = useState(false)
  // "김다육 · kim" → 이름은 크게, 아이디는 옆에 작게
  const [name, loginId] = account === undefined ? [undefined, undefined] : splitAccount(account)
  const openApp = nav.openApp
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="more-screen">
      {/* 모든 화면과 같은 머리 줄 (D-UX4-59): 왼쪽 계정(이름 크게 · 아이디 작게). 옛 오른쪽 [설정]은 뺐다 — 설정이 이 탭에 있다(D-UX4-201) */}
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
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl + room, gap: SPACE.md }} scrollIndicatorInsets={{ bottom: room }} keyboardShouldPersistTaps="handled">
        {MORE_GROUPS.map((group) => {
          const screens = openApp === undefined ? [] : IN_APP_SCREENS.filter((screen) => screen.group === group)
          const extra = settings === undefined ? null : settingRows(group, settings, act)
          if (screens.length === 0 && extra === null) return null
          return (
            <View key={group} style={{ gap: SPACE.md }}>
              <RowGroup title={group}>
                {screens.map((screen) => (
                  <TodoRow key={screen.path} title={screen.title} onPress={() => openApp?.(screen.path)} />
                ))}
                {extra}
              </RowGroup>
              {/* 휴대폰 알림 받기 (SMS3 AC-SMS3-29) — 찜을 받는 길이라 음성 인식 바로 아래 */}
              {group === '음성 인식' && settings?.showPhoneNotice === true ? <PhoneNoticeCard /> : null}
            </View>
          )
        })}
        {WEB_SCREENS.length > 0 ? (
          <RowGroup title="웹에서 보기" label={OPEN_IN_WEB}>
            {WEB_SCREENS.map((screen) => (
              <TodoRow key={screen.key} title={screen.word} ariaLabel={`${screen.word} — ${OPEN_IN_WEB}`} onPress={() => void openWeb(screen.path)} />
            ))}
          </RowGroup>
        ) : null}
        {onLogout !== undefined || settings !== undefined ? (
          <RowGroup title="계정" label="계정">
            {settings === undefined ? null : (
              <>
                <LinkedRow settings={settings} />
                {/* 권한 설명은 펼쳐야 보인다 (D-UX3-96) */}
                <Pad>
                  <PermissionNotes />
                </Pad>
                {settings.policyUrl !== undefined ? <TodoRow title="개인정보처리방침" onPress={() => void openExternal(settings.policyUrl ?? '')} /> : null}
                {settings.openDesign !== undefined ? <TodoRow title="디자인 견본 (개발용)" onPress={settings.openDesign} /> : null}
              </>
            )}
            {onLogout !== undefined ? <TodoRow title="로그아웃" onPress={() => setAsking(true)} /> : null}
          </RowGroup>
        ) : null}
      </ScrollView>
      <Toast toast={act.toast} onDismiss={act.hide} />
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
