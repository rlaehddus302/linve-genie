// 설정 중 음성·라벨 (공통 디자인 바탕으로 개편한 본보기: 큰 질문 제목 · 묶음별 카드 · 켜고 끄기는 되돌리기 알림 · 로그아웃은 확인 판 · 맨 아래 큰 버튼) (APP-01 화면 범위). 나머지 설정은 "웹으로 열기". 로그아웃도 여기.
// - 음성: "번호와 가격이 들리면 바로 등록"(이 기기), 권한 설명 문장 보기.
// - 라벨: 라벨 기능 켬/끔(PUT /api/settings/labels), 1등 확정 때 라벨 자동 출력(PATCH /api/settings print.autoOnConfirm — 다음 방송부터).
import { View } from 'react-native'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { LabelSettings } from '@livejjim/web/src/api/print-types.ts'
import { get, isApiError, patch, put } from '../api/client.ts'
import { openExternal, openWeb } from '../lib/open-web.ts'
import { OPEN_IN_WEB, VOICE_INSTANT_LABEL } from '../lib/words.ts'
import { useServices, useSession } from '../services.tsx'
import { BigButton, BottomCTA, Card, ConfirmSheet, KitScreen, ListRow, Section, Toast, ToggleRow, Txt, useToast } from '../ui/kit/index.ts'

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

export function SettingsScreen({ onBack, policyUrl, onOpenDesign }: { readonly onBack: () => void; readonly policyUrl?: string; readonly onOpenDesign?: () => void }) {
  const { voice } = useServices()
  const { session, logout } = useSession()
  const view = useSyncExternalStore(voice.subscribe, voice.getView)
  const [labels, setLabels] = useState<LabelSettings | null>(null)
  const [auto, setAuto] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const { toast, show, hide } = useToast()

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
    <View style={{ flex: 1 }}>
      <KitScreen
        title="무엇을 바꿀까요?"
        testID="settings-screen"
        footer={
          <BottomCTA>
            <BigButton label="방송 목록으로 돌아가기" ariaLabel="방송 목록으로" icon="←" onPress={onBack} />
          </BottomCTA>
        }
      >
        <Section title="음성">
          <Card label="음성">
            <ToggleRow
              title={VOICE_INSTANT_LABEL}
              subtitle="끄면 들린 말은 카드로만 보이고, 등록을 누를 때 등록돼요."
              on={view.instant}
              onChange={(next) => {
                const previous = view.instant
                voice.setInstant(next)
                hide()
                show(next ? '바로 등록을 켰어요.' : '바로 등록을 껐어요.', { actionLabel: '되돌리기', onAction: () => voice.setInstant(previous) })
              }}
            />
            {view.problem !== null ? (
              <Txt color="dangerText" weight="bold" role="alert">
                {`⚠ ${view.problem}`}
              </Txt>
            ) : null}
            <Txt step="caption" color="textSub">{`마이크: ${PERMISSION_WORDS.microphone}`}</Txt>
            <Txt step="caption" color="textSub">{`블루투스: ${PERMISSION_WORDS.bluetooth}`}</Txt>
            <Txt step="caption" color="textSub">{`알림(안드로이드): ${PERMISSION_WORDS.notification}`}</Txt>
          </Card>
        </Section>
        <Section title="라벨">
          <Card label="라벨">
            {labels === null ? (
              <Txt color="textSub">라벨 설정을 불러오지 못했어요.</Txt>
            ) : (
              <ToggleRow title="라벨 기능" on={labels.enabled} disabled={busy} onChange={(next) => void run(() => setLabelEnabled(next, labels.enabled))} />
            )}
            {auto !== null ? <ToggleRow title="1등 확정 때 라벨 자동 출력" subtitle="다음에 시작하는 방송부터 적용돼요." on={auto} disabled={busy} onChange={(next) => void run(() => setAutoPrint(next, auto))} /> : null}
          </Card>
        </Section>
        <Section title="그 밖 설정" description="가게·감사 메시지·플랫폼 연결 같은 설정은 웹에서 해요.">
          <Card label="그 밖">
            <ListRow title="설정 전체" value={OPEN_IN_WEB} ariaLabel={`설정 전체 — ${OPEN_IN_WEB}`} onPress={() => void openWeb('/settings')} />
            {policyUrl !== undefined ? <ListRow title="개인정보처리방침" subtitle="기기 브라우저에서 열려요." onPress={() => void openExternal(policyUrl)} /> : null}
            {onOpenDesign !== undefined ? <ListRow title="디자인 견본 (개발용)" onPress={onOpenDesign} /> : null}
          </Card>
        </Section>
        <Section title="계정">
          <Card label="계정">
            {session.state === 'in' ? <Txt step="bodyLarge">{`${session.me.seller.name} · ${session.me.loginId}`}</Txt> : null}
            <BigButton label="로그아웃" kind="secondary" onPress={() => setAsking(true)} />
          </Card>
        </Section>
      </KitScreen>
      <Toast toast={toast} onDismiss={hide} bottomOffset={96} />
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
