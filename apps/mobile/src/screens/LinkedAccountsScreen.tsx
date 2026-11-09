// 설정 → 연동된 소셜 계정 (D-UX3-61, 사용자 지시 2026-11-07 "계정 설정에서 연동된 소셜 계정 보여주고 해지할 수 있도록 하자 … 우리가 함께 만들었던 ui 이용해서").
// - 공통 머리(‹·제목) 아래 카드 한 장: 연결된 간편 로그인마다 가린 이메일(없으면 "카카오 계정"), 그 아래 앱 아이콘 모양 로고·공급자 이름, 오른쪽 [해지].
// - [해지] → 가운데 팝업 "카카오 연결을 해지할까요?" / 회색 설명 — 왼쪽 [닫기], 오른쪽 [해지]. 해지하면 알림 막대 "카카오 연결을 해지했어요."와 새 목록.
// - 마지막 로그인 방법은 서버가 막는다(409 "마지막 로그인 방법은 끊을 수 없어요.") — 그 문장을 알림 막대로. 이미 끊겼으면(404) 목록을 새로 읽는다.
// - 서버: GET /api/auth/methods · POST /api/auth/unlink (D-L1-03 — 지금 세션은 남고, 그 공급자로 로그인한 다른 기기는 로그아웃).
// - 모양 (D-UX3-96): 줄 사이 선을 빼고 토스 목록처럼 — 왼쪽 앱 아이콘 로고(34), 이름·공급자, 오른쪽 글자 단추 [해지].
import { useCallback, useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { accountLabel, LINKED_NONE, LINKED_TITLE, methodsOf, POPUP_CLOSE, PROVIDER_NAMES, UNLINK_GO, unlinkAskText, unlinkAskTitle, unlinkDone, type LoginMethods, type LoginProvider } from '@livejjim/web/src/lib/social-login.ts'
import { isApiError, post } from '../api/client.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { AppHeader, PopupDialog, Toast, Txt, useKit, useToast } from '../ui/kit/index.ts'
import { SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { GroupNote, SETTINGS_GUTTER, SettingsGroup, TextButton } from './settings/Group.tsx'
import { Loading } from '../ui/parts.tsx'
import { SocialTile } from '../ui/SocialTile.tsx'

const LOAD_FAILED = '연동된 계정을 불러오지 못했어요. 다시 열어 주세요.'
const UNLINK_FAILED = '해지하지 못했어요. 다시 눌러 주세요.'

export function LinkedAccountsScreen({ onBack }: { readonly onBack: () => void }) {
  const { p } = useKit()
  // 기억해 둔 목록을 바로 보이고 뒤에서 다시 받는다 (D-UX4-77) — 설정 화면의 연동 줄과 같은 기억을 쓴다
  const { data: raw, error, reload, set: setRaw } = useCachedGet<unknown>('/api/auth/methods')
  const methods = useMemo<LoginMethods | null>(() => (raw === null ? null : methodsOf(raw)), [raw])
  const failed = error !== null
  const [asking, setAsking] = useState<LoginProvider | null>(null)
  // 팝업이 닫히며 흐려지는 동안에도 같은 글 (D-UX3-54)
  const [shown, setShown] = useState<LoginProvider>('kakao')
  if (asking !== null && asking !== shown) setShown(asking)
  const [busy, setBusy] = useState(false)
  const { toast, show, hide } = useToast()

  const load = useCallback(() => void reload(), [reload])

  const unlink = async (provider: LoginProvider) => {
    if (busy) return
    setBusy(true)
    hide()
    try {
      setRaw(await post<unknown>('/api/auth/unlink', { provider }))
      setAsking(null)
      show(unlinkDone(provider))
    } catch (caught: unknown) {
      setAsking(null)
      if (isApiError(caught) && caught.status === 404) {
        // 다른 기기에서 이미 끊었다
        load()
        show(unlinkDone(provider))
      } else {
        show(isApiError(caught) && !caught.network ? caught.message : UNLINK_FAILED, { problem: true })
      }
    } finally {
      setBusy(false)
    }
  }

  const linked = methods?.providers.filter((item) => item.linked) ?? []
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="linked-accounts-screen">
      <AppHeader title={LINKED_TITLE} onBack={onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SETTINGS_GUTTER, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl, gap: SPACE.md }}>
        {methods === null ? (
          failed ? (
            <Txt color="textSub">{LOAD_FAILED}</Txt>
          ) : (
            <Loading />
          )
        ) : linked.length === 0 ? (
          <SettingsGroup>
            <GroupNote>{LINKED_NONE}</GroupNote>
          </SettingsGroup>
        ) : (
          <SettingsGroup label={LINKED_TITLE} testID="linked-accounts">
            {linked.map((item) => (
              <View key={item.provider} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: TOUCH.min + SPACE.sm }} testID={`linked-${item.provider}`}>
                <SocialTile provider={item.provider} size={34} />
                <View style={{ flex: 1, gap: 1 }}>
                  <Txt step="bodyLarge" weight="book" numberOfLines={1}>
                    {item.label === '' ? accountLabel(item.provider) : item.label}
                  </Txt>
                  <Txt step="caption" color="textSub">
                    {PROVIDER_NAMES[item.provider]}
                  </Txt>
                </View>
                <TextButton label={UNLINK_GO} onPress={() => setAsking(item.provider)} disabled={busy} testID={`unlink-${item.provider}`} />
              </View>
            ))}
          </SettingsGroup>
        )}
      </ScrollView>
      <PopupDialog
        visible={asking !== null}
        message={unlinkAskTitle(shown)}
        description={unlinkAskText(shown)}
        cancelLabel={POPUP_CLOSE}
        confirmLabel={UNLINK_GO}
        busy={busy}
        onCancel={() => {
          if (!busy) setAsking(null)
        }}
        onConfirm={() => void unlink(shown)}
      />
      <Toast toast={toast} onDismiss={hide} />
    </View>
  )
}
