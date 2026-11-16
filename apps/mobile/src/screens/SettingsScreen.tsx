// 설정 화면 — 줄 조각은 전체 탭과 같다(settings/SettingRows.tsx, D-UX4-201). 전체 탭이 같은 줄을 바로 보이므로 이 화면은 다른 화면의 "설정으로" 길에서만 연다.
// 설정 중 음성·라벨·휴대폰 알림 받기(SMS3 AC-SMS3-29) (APP-01 화면 범위). 나머지 설정은 앱 "가게 설정"(D-APPX-03). 로그아웃도 여기.
// 모양 (D-UX3-96, 토스 설정처럼): 흰 묶음 카드 안 맨 위에 작은 회색 이름, 줄 오른쪽에 스위치·›. 권한 설명 세 줄은 "앱이 쓰는 권한"을 펼쳐야 보이고,
// 로그아웃은 큰 초록 단추 대신 카드 아래 글자 단추(확인 판은 그대로).
// - 음성: "번호와 가격이 들리면 바로 등록"(이 기기), 권한 설명 문장 보기.
// - 라벨: 라벨 기능 켬/끔(PUT /api/settings/labels), 1등 확정 때 라벨 자동 출력(PATCH /api/settings print.autoOnConfirm — 다음 방송부터).
import { ScrollView, View } from 'react-native'
import { useState } from 'react'
import { openExternal, openWeb } from '../lib/open-web.ts'
import { OPEN_IN_WEB } from '../lib/words.ts'
import { useSession } from '../services.tsx'
import { AppHeader, ConfirmSheet, ListRow, Toast, Txt, useKit } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { SETTINGS_GUTTER, SettingsGroup, TextButton } from './settings/Group.tsx'
import { LabelToggleRows, LinkedLogos, PermissionNotes, useLinkedProviders, useSettingsActions, VoiceInstantRow } from './settings/SettingRows.tsx'
import { PhoneNoticeCard } from './PhoneNoticeCard.tsx'
import { VARIETIES_TITLE } from './VarietiesScreen.tsx'
import { LINKED_TITLE, PROVIDER_NAMES } from '@livejjim/web/src/lib/social-login.ts'
import { Late } from '../ui/late.tsx'

export { PERMISSION_WORDS, SETTING_NEXT_BROADCAST } from './settings/SettingRows.tsx'

/** showPhoneNotice: 알림 받기를 뺀 빌드(LIVEGENIE_NOTICE=off)면 false — 칸을 숨긴다 */
export function SettingsScreen({
  onBack,
  policyUrl,
  onOpenDesign,
  onOpenShop,
  onOpenVarieties,
  onOpenLinked,
  linkedRefresh = 0,
  showPhoneNotice = true,
}: {
  readonly onBack: () => void
  readonly policyUrl?: string
  readonly onOpenDesign?: () => void
  readonly onOpenShop?: () => void
  readonly onOpenVarieties?: () => void
  /** 연동된 소셜 계정 화면 (D-UX3-61) */
  readonly onOpenLinked?: () => void
  /** 바뀌면 연동된 계정을 다시 읽는다 (그 화면에서 돌아올 때) */
  readonly linkedRefresh?: number
  readonly showPhoneNotice?: boolean
}) {
  const { session, logout } = useSession()
  const act = useSettingsActions()
  const [asking, setAsking] = useState(false)
  const { p } = useKit()
  const linked = useLinkedProviders(onOpenLinked !== undefined, linkedRefresh)

  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="settings-screen">
      <AppHeader title="설정" onBack={onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SETTINGS_GUTTER, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
        <SettingsGroup title="음성" label="음성">
          <VoiceInstantRow act={act} />
          {/* 내 품종 장부 (D-V3-127) — 직접 지은 이름도 알아듣게 */}
          {onOpenVarieties !== undefined ? <ListRow title={VARIETIES_TITLE} subtitle="키우는 품종 이름을 적어 두면 더 정확히 음성 인식해요." onPress={onOpenVarieties} /> : null}
          {/* 권한 설명은 펼쳐야 보인다 (D-UX3-96 — 늘 보이던 세 줄을 접었다) */}
          <PermissionNotes />
        </SettingsGroup>
        <SettingsGroup title="라벨" label="라벨">
          <LabelToggleRows act={act} />
        </SettingsGroup>
        {/* 휴대폰 알림 받기 (SMS3 AC-SMS3-29) */}
        {showPhoneNotice ? <PhoneNoticeCard /> : null}
        <SettingsGroup title="그 밖" label="그 밖">
          {onOpenShop !== undefined ? <ListRow title="가게 설정" subtitle="가게·계좌, 판매 규칙, 배송비, 택배, 손님 관리" onPress={onOpenShop} /> : <ListRow title="설정 전체" value={OPEN_IN_WEB} ariaLabel={`설정 전체 — ${OPEN_IN_WEB}`} onPress={() => void openWeb('/settings')} />}
          {policyUrl !== undefined ? <ListRow title="개인정보처리방침" onPress={() => void openExternal(policyUrl)} /> : null}
          {onOpenDesign !== undefined ? <ListRow title="디자인 견본 (개발용)" onPress={onOpenDesign} /> : null}
        </SettingsGroup>
        <SettingsGroup title="계정" label="계정">
          {session.state === 'in' ? (
            <View style={{ gap: 2, paddingVertical: SPACE.xs }}>
              <Txt step="bodyLarge" weight="medium">{session.me.seller.name}</Txt>
              <Txt step="caption" color="textSub">{session.me.loginId}</Txt>
            </View>
          ) : null}
          {/* 연동된 소셜 계정 (D-UX3-61) — 오른쪽에 연결된 로고들 */}
          <Late>
            {onOpenLinked !== undefined && linked !== null ? (
              <ListRow
                title={LINKED_TITLE}
                ariaLabel={`${LINKED_TITLE} — ${linked.length === 0 ? '없음' : linked.map((provider) => PROVIDER_NAMES[provider]).join(', ')}`}
                right={<LinkedLogos linked={linked} />}
                onPress={onOpenLinked}
                testID="settings-linked"
              />
            ) : null}
          </Late>
        </SettingsGroup>
        {/* 로그아웃은 카드 아래 글자 단추 (토스 설정 맨 아래처럼) */}
        <TextButton label="로그아웃" align="flex-start" onPress={() => setAsking(true)} />
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
          void logout()
        }}
      />
    </View>
  )
}
