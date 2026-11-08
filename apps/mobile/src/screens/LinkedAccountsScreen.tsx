// 설정 → 연동된 소셜 계정 (D-UX3-61, 사용자 지시 2026-11-07 "계정 설정에서 연동된 소셜 계정 보여주고 해지할 수 있도록 하자 … 우리가 함께 만들었던 ui 이용해서").
// - 공통 머리(‹·제목) 아래 카드 한 장: 연결된 간편 로그인마다 가린 이메일(없으면 "카카오 계정"), 그 아래 앱 아이콘 모양 로고·공급자 이름, 오른쪽 [해지].
// - [해지] → 가운데 팝업 "카카오 연결을 해지할까요?" / 회색 설명 — 왼쪽 [닫기], 오른쪽 [해지]. 해지하면 알림 막대 "카카오 연결을 해지했어요."와 새 목록.
// - 마지막 로그인 방법은 서버가 막는다(409 "마지막 로그인 방법은 끊을 수 없어요.") — 그 문장을 알림 막대로. 이미 끊겼으면(404) 목록을 새로 읽는다.
// - 서버: GET /api/auth/methods · POST /api/auth/unlink (D-L1-03 — 지금 세션은 남고, 그 공급자로 로그인한 다른 기기는 로그아웃).
import { useCallback, useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { accountLabel, LINKED_NONE, LINKED_TITLE, methodsOf, POPUP_CLOSE, PROVIDER_NAMES, UNLINK_GO, unlinkAskText, unlinkAskTitle, unlinkDone, type LoginMethods, type LoginProvider } from '@livejjim/web/src/lib/social-login.ts'
import { get, isApiError, post } from '../api/client.ts'
import { AppHeader, Card, PopupDialog, SmallButton, Toast, Txt, useKit, useToast } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { Loading } from '../ui/parts.tsx'
import { SocialTile } from '../ui/SocialTile.tsx'

const LOAD_FAILED = '연동된 계정을 불러오지 못했어요. 다시 열어 주세요.'
const UNLINK_FAILED = '해지하지 못했어요. 다시 눌러 주세요.'

export function LinkedAccountsScreen({ onBack }: { readonly onBack: () => void }) {
  const { p } = useKit()
  const [methods, setMethods] = useState<LoginMethods | null>(null)
  const [failed, setFailed] = useState(false)
  const [asking, setAsking] = useState<LoginProvider | null>(null)
  // 팝업이 닫히며 흐려지는 동안에도 같은 글 (D-UX3-54)
  const [shown, setShown] = useState<LoginProvider>('kakao')
  if (asking !== null && asking !== shown) setShown(asking)
  const [busy, setBusy] = useState(false)
  const { toast, show, hide } = useToast()

  const load = useCallback(() => {
    get<unknown>('/api/auth/methods').then(
      (value) => {
        setMethods(methodsOf(value))
        setFailed(false)
      },
      () => setFailed(true),
    )
  }, [])
  useEffect(load, [load])

  const unlink = async (provider: LoginProvider) => {
    if (busy) return
    setBusy(true)
    hide()
    try {
      setMethods(methodsOf(await post<unknown>('/api/auth/unlink', { provider })))
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl, gap: SPACE.md }}>
        {methods === null ? (
          failed ? (
            <Txt color="textSub">{LOAD_FAILED}</Txt>
          ) : (
            <Loading />
          )
        ) : linked.length === 0 ? (
          <Card>
            <Txt color="textSub">{LINKED_NONE}</Txt>
          </Card>
        ) : (
          <Card label={LINKED_TITLE} testID="linked-accounts">
            {linked.map((item, index) => (
              <View key={item.provider} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingTop: index === 0 ? 0 : SPACE.lg, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: p.line }} testID={`linked-${item.provider}`}>
                <View style={{ flex: 1, gap: SPACE.sm }}>
                  <Txt step="bodyLarge" weight="medium">
                    {item.label === '' ? accountLabel(item.provider) : item.label}
                  </Txt>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
                    <SocialTile provider={item.provider} size={20} />
                    <Txt step="caption" color="textSub">
                      {PROVIDER_NAMES[item.provider]}
                    </Txt>
                  </View>
                </View>
                <SmallButton label={UNLINK_GO} onPress={() => setAsking(item.provider)} disabled={busy} testID={`unlink-${item.provider}`} />
              </View>
            ))}
          </Card>
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
