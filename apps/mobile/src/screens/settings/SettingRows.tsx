// 설정 줄 조각 (D-UX4-201): 전체 탭과 설정 화면이 같은 스위치·줄을 쓴다 — 음성 바로 등록, 라벨 기능·자동 출력, 연동된 계정 로고, 앱이 쓰는 권한.
// 저장·되돌리기 알림(run·toast)은 부르는 화면이 useSettingsActions로 하나 두고 넘긴다.
import { useMemo, useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import type { LabelSettings } from '@livejjim/web/src/api/print-types.ts'
import { methodsOf, type LoginProvider } from '@livejjim/web/src/lib/social-login.ts'
import { isApiError, patch, put } from '../../api/client.ts'
import { useCachedGet } from '../../lib/cached-get.ts'
import { VOICE_INSTANT_LABEL } from '../../lib/words.ts'
import { useServices, useSession } from '../../services.tsx'
import { Appear, ErrorLine, ListRow, ToggleRow, Txt, useToast } from '../../ui/kit/index.ts'
import type { TxtProps } from '../../ui/kit/theme.tsx'
import { SPACE } from '../../ui/kit/tokens.ts'
import { Late, useCameLate } from '../../ui/late.tsx'
import { SocialTile } from '../../ui/SocialTile.tsx'
import { DetailToggle, GroupNote } from './Group.tsx'

export const SETTING_NEXT_BROADCAST = '다음에 시작하는 라이브부터 적용돼요.'
export const PERMISSION_WORDS = {
  microphone: '라이브 중 사장님 말을 받아쓸 때 마이크를 써요.',
  bluetooth: '라벨 프린터에 연결해 라벨을 찍으려고 블루투스를 써요.',
  notification: '음성 인식 중이라는 알림을 보여 드리려고 해요.',
} as const

export interface Done {
  readonly text: string
  /** 있으면 알림 막대에 "되돌리기"가 붙는다 */
  readonly undo?: () => Promise<Done>
}

/** 줄 이름 굵기 — 설정 화면은 중간, 전체 탭은 토스 "전체" 줄처럼 보통(book) */
type TitleWeight = NonNullable<TxtProps['weight']>

/** 저장 한 번에 하나 · 끝나면 알림(되돌리기 붙음) · 실패하면 빨간 알림 */
export function useSettingsActions() {
  const [busy, setBusy] = useState(false)
  const { toast, show, hide } = useToast()
  const run = async (work: () => Promise<Done>): Promise<void> => {
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
  return { busy, run, toast, show, hide }
}
export type SettingsActions = ReturnType<typeof useSettingsActions>

/** 음성: 번호와 가격이 들리면 바로 등록(이 기기) — 화면으로 상품을 등록하는 가게는 안내 줄. 문제가 있으면 그 아래 빨간 줄 */
export function VoiceInstantRow({ act, titleWeight }: { readonly act: SettingsActions; readonly titleWeight?: TitleWeight }) {
  const { voice } = useServices()
  const { session } = useSession()
  const view = useSyncExternalStore(voice.subscribe, voice.getView)
  return (
    <>
      {session.state === 'in' && session.me.screenProducts ? (
        <ListRow title="상품 자동 등록" subtitle="유튜브 라이브의 화면과 음성을 보고 상품을 등록해요." />
      ) : (
        <ToggleRow
          title={VOICE_INSTANT_LABEL}
          subtitle="끄면 인식한 말이 카드로 먼저 보이고, 등록을 눌러야 올라가요."
          on={view.instant}
          titleWeight={titleWeight}
          onChange={(next) => {
            const previous = view.instant
            voice.setInstant(next)
            act.hide()
            act.show(next ? '바로 등록을 켰어요.' : '바로 등록을 껐어요.', { actionLabel: '되돌리기', onAction: () => voice.setInstant(previous) })
          }}
        />
      )}
      {/* 잘못 문장은 어디서나 같은 모양 (D-UX3-51) */}
      {view.problem !== null ? <ErrorLine>{view.problem}</ErrorLine> : null}
    </>
  )
}

/** 라벨: 라벨 기능 켬/끔(PUT /api/settings/labels), 1등 확정 때 라벨 자동 출력(PATCH /api/settings print.autoOnConfirm — 다음 방송부터) */
export function LabelToggleRows({ act, titleWeight }: { readonly act: SettingsActions; readonly titleWeight?: TitleWeight }) {
  // 설정 값은 기억해 둔 것을 바로 보이고 뒤에서 다시 받는다 (D-UX4-77) — 못 받으면 그 줄을 숨긴다
  const { data: labels, set: setLabels } = useCachedGet<LabelSettings>('/api/settings/labels')
  // 서버에서 받은 뒤에야 생기는 줄은 부드럽게 — 기억해 둔 설정으로 처음부터 그리면 바로 (D-UX4-112)
  const labelsLate = useCameLate(labels !== null)
  const { data: settings, set: setSettings } = useCachedGet<{ settings: Record<string, unknown> }>('/api/settings')
  const auto = settings === null ? null : settings.settings['print.autoOnConfirm'] !== false

  const setLabelEnabled = async (enabled: boolean, previous: boolean): Promise<Done> => {
    const next = await put<LabelSettings & { changed: boolean }>('/api/settings/labels', { enabled })
    setLabels(next)
    const text = next.enabled ? '라벨 기능을 켰어요.' : `라벨 기능을 껐어요.${next.waiting > 0 ? ` 대기 중이던 ${String(next.waiting)}장은 출력하지 않아요.` : ''}`
    return { text, undo: () => setLabelEnabled(previous, enabled) }
  }

  const setAutoPrint = async (next: boolean, previous: boolean): Promise<Done> => {
    await patch<{ settings: Record<string, unknown> }>('/api/settings', { settings: { 'print.autoOnConfirm': next } })
    setSettings((old) => ({ settings: { ...(old?.settings ?? {}), 'print.autoOnConfirm': next } }))
    return { text: `${next ? '자동 출력을 켰어요.' : '자동 출력을 껐어요.'} ${SETTING_NEXT_BROADCAST}`, undo: () => setAutoPrint(previous, next) }
  }

  return (
    <>
      {labels === null ? (
        <Txt color="textSub">라벨 설정을 불러오지 못했어요.</Txt>
      ) : (
        <Appear instant={!labelsLate}>
          <ToggleRow title="라벨 기능" on={labels.enabled} disabled={act.busy} titleWeight={titleWeight} onChange={(next) => void act.run(() => setLabelEnabled(next, labels.enabled))} />
        </Appear>
      )}
      <Late>{auto !== null ? <ToggleRow title="1등 확정 때 라벨 자동 출력" subtitle="다음 라이브부터 적용돼요." on={auto} disabled={act.busy} titleWeight={titleWeight} onChange={(next) => void act.run(() => setAutoPrint(next, auto))} /> : null}</Late>
    </>
  )
}

/** 연결된 간편 로그인 (null: 모름·간편 로그인을 안 쓰는 서버·열 화면이 없음) */
export function useLinkedProviders(enabled: boolean, refresh: number): readonly LoginProvider[] | null {
  const methods = useCachedGet<unknown>(enabled ? '/api/auth/methods' : null, refresh).data
  return useMemo(() => (methods === null ? null : methodsOf(methods).providers.filter((item) => item.linked).map((item) => item.provider)), [methods])
}

/** 연동된 소셜 계정 줄 오른쪽 로고들 (D-UX3-61) */
export function LinkedLogos({ linked }: { readonly linked: readonly LoginProvider[] }) {
  if (linked.length === 0) return null
  return (
    <View style={{ flexDirection: 'row', gap: SPACE.xs }}>
      {linked.map((provider) => (
        <SocialTile key={provider} provider={provider} size={24} />
      ))}
    </View>
  )
}

/** 앱이 쓰는 권한 — 펼쳐야 보인다 (D-UX3-96) */
export function PermissionNotes() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <DetailToggle label="앱이 쓰는 권한" open={open} onPress={() => setOpen((was) => !was)} />
      {open ? (
        <View style={{ gap: SPACE.xs, paddingBottom: SPACE.xs }}>
          <GroupNote>{`마이크: ${PERMISSION_WORDS.microphone}`}</GroupNote>
          <GroupNote>{`블루투스: ${PERMISSION_WORDS.bluetooth}`}</GroupNote>
          <GroupNote>{`알림(안드로이드): ${PERMISSION_WORDS.notification}`}</GroupNote>
        </View>
      ) : null}
    </>
  )
}
