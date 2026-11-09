// 설정 중 음성·라벨·휴대폰 알림 받기(SMS3 AC-SMS3-29) (APP-01 화면 범위). 나머지 설정은 앱 "가게 설정"(D-APPX-03). 로그아웃도 여기.
// 모양 (D-UX3-96, 토스 설정처럼): 흰 묶음 카드 안 맨 위에 작은 회색 이름, 줄 오른쪽에 스위치·›. 권한 설명 세 줄은 "앱이 쓰는 권한"을 펼쳐야 보이고,
// 로그아웃은 큰 초록 단추 대신 카드 아래 글자 단추(확인 판은 그대로).
// - 음성: "번호와 가격이 들리면 바로 등록"(이 기기), 권한 설명 문장 보기.
// - 라벨: 라벨 기능 켬/끔(PUT /api/settings/labels), 1등 확정 때 라벨 자동 출력(PATCH /api/settings print.autoOnConfirm — 다음 방송부터).
import { View } from 'react-native'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { LabelSettings } from '@livejjim/web/src/api/print-types.ts'
import { get, isApiError, patch, put } from '../api/client.ts'
import { openExternal, openWeb } from '../lib/open-web.ts'
import { OPEN_IN_WEB, VOICE_INSTANT_LABEL } from '../lib/words.ts'
import { useServices, useSession } from '../services.tsx'
import { AppHeader, ConfirmSheet, ErrorLine, ListRow, Toast, ToggleRow, Txt, useKit, useToast } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { ScrollView } from 'react-native'
import { DetailToggle, GroupNote, SETTINGS_GUTTER, SettingsGroup, TextButton } from './settings/Group.tsx'
import { PhoneNoticeCard } from './PhoneNoticeCard.tsx'
import { VARIETIES_TITLE } from './VarietiesScreen.tsx'
import { LINKED_TITLE, methodsOf, PROVIDER_NAMES, type LoginProvider } from '@livejjim/web/src/lib/social-login.ts'
import { SocialTile } from '../ui/SocialTile.tsx'

export const SETTING_NEXT_BROADCAST = '다음에 시작하는 방송부터 적용돼요.'
export const PERMISSION_WORDS = {
  microphone: '방송 중 사장님 말(상품 번호·가격)을 듣고 상품을 등록하려고 마이크를 써요.',
  bluetooth: '라벨 프린터에 연결해 라벨을 찍으려고 블루투스를 써요.',
  notification: '음성 듣는 중이라는 알림을 보여 드리려고 해요.',
} as const

interface Done {
  readonly text: string
  /** 있으면 알림 막대에 "되돌리기"가 붙는다 */
  readonly undo?: () => Promise<Done>
}

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
  const { voice } = useServices()
  const { session, logout } = useSession()
  const view = useSyncExternalStore(voice.subscribe, voice.getView)
  const [labels, setLabels] = useState<LabelSettings | null>(null)
  const [auto, setAuto] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [why, setWhy] = useState(false)
  const { toast, show, hide } = useToast()
  const { p } = useKit()
  /** 연결된 간편 로그인 (null: 모름·간편 로그인을 안 쓰는 서버) */
  const [linked, setLinked] = useState<readonly LoginProvider[] | null>(null)

  useEffect(() => {
    if (onOpenLinked === undefined) return
    get<unknown>('/api/auth/methods').then(
      (value) => setLinked(methodsOf(value).providers.filter((item) => item.linked).map((item) => item.provider)),
      () => setLinked(null),
    )
  }, [onOpenLinked === undefined, linkedRefresh])

  useEffect(() => {
    get<LabelSettings>('/api/settings/labels').then(setLabels, () => setLabels(null))
    get<{ settings: Record<string, unknown> }>('/api/settings').then(
      (response) => setAuto(response.settings['print.autoOnConfirm'] !== false),
      () => setAuto(null),
    )
  }, [])

  const run = async (work: () => Promise<Done>) => {
    if (busy) return
    setBusy(true)
    hide()
    try {
      const done = await work()
      const undo = done.undo
      show(done.text, undo === undefined ? undefined : { actionLabel: '되돌리기', onAction: () => void run(undo) })
    } catch (caught) {
      show(isApiError(caught) ? caught.message : '저장하지 못했어요. 다시 눌러 주세요.', { problem: true })
    } finally {
      setBusy(false)
    }
  }

  const setLabelEnabled = async (enabled: boolean, previous: boolean): Promise<Done> => {
    const next = await put<LabelSettings & { changed: boolean }>('/api/settings/labels', { enabled })
    setLabels(next)
    const text = next.enabled ? '라벨 기능을 켰어요.' : `라벨 기능을 껐어요.${next.waiting > 0 ? ` 대기 중이던 ${String(next.waiting)}장은 출력하지 않아요.` : ''}`
    return { text, undo: () => setLabelEnabled(previous, enabled) }
  }

  const setAutoPrint = async (next: boolean, previous: boolean): Promise<Done> => {
    await patch<{ settings: Record<string, unknown> }>('/api/settings', { settings: { 'print.autoOnConfirm': next } })
    setAuto(next)
    return { text: `${next ? '자동 출력을 켰어요.' : '자동 출력을 껐어요.'} ${SETTING_NEXT_BROADCAST}`, undo: () => setAutoPrint(previous, next) }
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="settings-screen">
      <AppHeader title="설정" onBack={onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SETTINGS_GUTTER, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
        <SettingsGroup title="음성" label="음성">
          <ToggleRow
            title={VOICE_INSTANT_LABEL}
            subtitle="끄면 들린 말이 카드로 먼저 보이고, 등록을 눌러야 올라가요."
            on={view.instant}
            onChange={(next) => {
              const previous = view.instant
              voice.setInstant(next)
              hide()
              show(next ? '바로 등록을 켰어요.' : '바로 등록을 껐어요.', { actionLabel: '되돌리기', onAction: () => voice.setInstant(previous) })
            }}
          />
          {view.problem !== null ? (
            // 잘못 문장은 어디서나 같은 모양 (D-UX3-51)
            <ErrorLine>{view.problem}</ErrorLine>
          ) : null}
          {/* 내 품종 장부 (D-V3-127) — 직접 지은 이름도 알아듣게 */}
          {onOpenVarieties !== undefined ? <ListRow title={VARIETIES_TITLE} subtitle="키우는 품종 이름을 적어 두면 더 잘 알아들어요." onPress={onOpenVarieties} /> : null}
          {/* 권한 설명은 펼쳐야 보인다 (D-UX3-96 — 늘 보이던 세 줄을 접었다) */}
          <DetailToggle label="앱이 쓰는 권한" open={why} onPress={() => setWhy((open) => !open)} />
          {why ? (
            <View style={{ gap: SPACE.xs, paddingBottom: SPACE.xs }}>
              <GroupNote>{`마이크: ${PERMISSION_WORDS.microphone}`}</GroupNote>
              <GroupNote>{`블루투스: ${PERMISSION_WORDS.bluetooth}`}</GroupNote>
              <GroupNote>{`알림(안드로이드): ${PERMISSION_WORDS.notification}`}</GroupNote>
            </View>
          ) : null}
        </SettingsGroup>
        <SettingsGroup title="라벨" label="라벨">
          {labels === null ? (
            <Txt color="textSub">라벨 설정을 불러오지 못했어요.</Txt>
          ) : (
            <ToggleRow title="라벨 기능" on={labels.enabled} disabled={busy} onChange={(next) => void run(() => setLabelEnabled(next, labels.enabled))} />
          )}
          {auto !== null ? <ToggleRow title="1등 확정 때 라벨 자동 출력" subtitle="다음 방송부터 적용돼요." on={auto} disabled={busy} onChange={(next) => void run(() => setAutoPrint(next, auto))} /> : null}
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
          {onOpenLinked !== undefined && linked !== null ? (
            <ListRow
              title={LINKED_TITLE}
              ariaLabel={`${LINKED_TITLE} — ${linked.length === 0 ? '없음' : linked.map((provider) => PROVIDER_NAMES[provider]).join(', ')}`}
              right={
                linked.length === 0 ? undefined : (
                  <View style={{ flexDirection: 'row', gap: SPACE.xs }}>
                    {linked.map((provider) => (
                      <SocialTile key={provider} provider={provider} size={24} />
                    ))}
                  </View>
                )
              }
              onPress={onOpenLinked}
              testID="settings-linked"
            />
          ) : null}
        </SettingsGroup>
        {/* 로그아웃은 카드 아래 글자 단추 (토스 설정 맨 아래처럼) */}
        <TextButton label="로그아웃" align="flex-start" onPress={() => setAsking(true)} />
      </ScrollView>
      <Toast toast={toast} onDismiss={hide} />
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
