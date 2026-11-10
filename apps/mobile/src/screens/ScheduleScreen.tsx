// 방송 일정·방송 알림 (D-APPX-01 — 웹 ScheduleSettings·AlertCounts와 같은 규칙·문구, KP1 SCH-01~SCH-03).
// 다가오는 방송(최대 10개)을 적고 고치고 지운다 — 적거나 바꾸면 바로 저장된다. 공개 일정 페이지를 켜면 로그인 없는 주소가 생기고,
// 그 주소를 카톡·인스타로 보낼 수 있다(휴대폰 공유). 방송 알림은 손님이 공개 페이지에서 직접 신청한 "수"만 보인다(번호 목록 없음).
// 아직 문자는 보내지 않는다(D-KP1-20) — 그 한 줄을 늘 보인다.
// 모양 (D-UX3-96): 흰 묶음 카드(카드 안 작은 회색 이름). 방송 줄마다 붙던 큰 단추 둘은 오른쪽 글자 단추 [지우기]·[고치기]로(부정 왼쪽),
// 주소 단추 둘은 위아래로 쌓지 않고 한 줄에 — [새 주소 만들기](왼쪽) · [주소 보내기](오른쪽). 알림 신청 수는 이름 · 오른쪽 "n명" 줄로.
import { useEffect, useRef, useState } from 'react'
import { ScrollView, Share, View } from 'react-native'
import {
  ALERT_WORDS,
  ALERTS_HINT,
  ALERTS_NOT_SENDING,
  ALERTS_TITLE,
  CHANNEL_LABEL,
  INTRO_MAX,
  PAGE_HINT,
  PAGE_SWITCH_LABEL,
  RENEW_CONFIRM,
  RENEW_LABEL,
  SCHEDULE_EMPTY,
  SCHEDULE_FULL_MESSAGE,
  SCHEDULE_HINT,
  SCHEDULE_TITLE,
  TITLE_MAX,
  scheduleFull,
  scheduleWhen,
  type AlertCounts,
  type ScheduleItem,
  type ScheduleView,
} from '@livejjim/web/src/lib/schedule.ts'
import { del, isApiError, post, put, type ApiError } from '../api/client.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { AppHeader, BigButton, BottomSheet, ButtonRow, ConfirmSheet, TextField, ToggleRow, Txt, useKit } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { GroupNote, SETTINGS_GUTTER, SettingsGroup, TextButton, ValueRow } from './settings/Group.tsx'
import { Late } from '../ui/late.tsx'

interface Draft {
  readonly id: string | null
  readonly date: string
  readonly time: string
  readonly title: string
  readonly intro: string
}

const EMPTY_DRAFT: Draft = { id: null, date: '', time: '20:00', title: '', intro: '' }

export function ScheduleScreen({ onBack }: { readonly onBack: () => void }) {
  const { p } = useKit()
  // 기억해 둔 일정을 바로 보이고 뒤에서 다시 받는다 (D-UX4-77)
  const { data: view, error: loadError, reload, set: setView } = useCachedGet<ScheduleView>('/api/schedule')
  const { data: alerts } = useCachedGet<AlertCounts>('/api/schedule/alerts')
  const [writeError, setWriteError] = useState<ApiError | null>(null)
  const error = writeError ?? loadError
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [removing, setRemoving] = useState<ScheduleItem | null>(null)
  const [renewing, setRenewing] = useState(false)
  const serverChannel = view?.page.channelUrl ?? ''
  const [channel, setChannel] = useState(serverChannel)
  // 서버의 채널 주소가 바뀌면(처음 받음·뒤에서 다시 받음) 칸도 맞춘다 — 판매자가 고치던 중이면 그대로 둔다
  const seenChannel = useRef(serverChannel)
  useEffect(() => {
    const before = seenChannel.current
    if (before === serverChannel) return
    seenChannel.current = serverChannel
    setChannel((typed) => (typed === before ? serverChannel : typed))
  }, [serverChannel])

  const run = async (call: () => Promise<ScheduleView>): Promise<boolean> => {
    setBusy(true)
    setWriteError(null)
    try {
      const next = await call()
      setView(next)
      setChannel(next.page.channelUrl ?? '')
      return true
    } catch (caught: unknown) {
      if (isApiError(caught)) setWriteError(caught)
      return false
    } finally {
      setBusy(false)
    }
  }
  const savePage = (enabled: boolean) => void run(() => put<ScheduleView>('/api/schedule/page', { enabled, channelUrl: channel.trim() === '' ? null : channel.trim() }))

  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="schedule-screen">
      <AppHeader title={SCHEDULE_TITLE} onBack={onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SETTINGS_GUTTER, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: SPACE.xs }}>
          <GroupNote>{SCHEDULE_HINT}</GroupNote>
        </View>
        {error !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{error.message}</Notice>
            {view === null ? <BigButton kind="secondary" label={RETRY_NOW} onPress={() => void reload()} /> : null}
          </View>
        ) : null}
        {view === null && error === null ? <Loading /> : null}
        {/* 서버에서 받은 뒤에야 생기는 묶음은 부드럽게 — 기억해 둔 자료로 처음부터 그리면 바로 (D-UX4-112) */}
        <Late style={{ gap: SPACE.md }}>
          {view !== null ? (
            <>
              <SettingsGroup title="다가오는 라이브" label="다가오는 라이브">
                {view.items.length === 0 ? <GroupNote>{SCHEDULE_EMPTY}</GroupNote> : null}
                {view.items.map((item) => (
                  <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.xs }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt step="bodyLarge" weight="medium">{scheduleWhen(item)}</Txt>
                      <Txt step="body" color="textSub" numberOfLines={1}>{item.title}</Txt>
                      {item.intro !== '' ? <Txt step="caption" color="textSub" numberOfLines={2}>{item.intro}</Txt> : null}
                    </View>
                    {/* 부정(지우기) 왼쪽, 긍정(고치기) 오른쪽 (D-UX4-01) */}
                    <TextButton label="지우기" ariaLabel={`${scheduleWhen(item)} 지우기`} onPress={() => setRemoving(item)} />
                    <TextButton label="고치기" ariaLabel={`${scheduleWhen(item)} 고치기`} color="primaryText" onPress={() => setDraft({ id: item.id, date: item.date, time: item.time, title: item.title, intro: item.intro })} />
                  </View>
                ))}
                {scheduleFull(view) ? <GroupNote>{SCHEDULE_FULL_MESSAGE}</GroupNote> : <BigButton kind="outline" label="라이브 적기" onPress={() => setDraft(EMPTY_DRAFT)} />}
              </SettingsGroup>

              <SettingsGroup title="공개 일정 페이지" label="공개 일정 페이지">
                <ToggleRow title={PAGE_SWITCH_LABEL} subtitle={PAGE_HINT} on={view.page.enabled} disabled={busy} onChange={savePage} />
                <TextField label={CHANNEL_LABEL} value={channel} onChangeText={setChannel} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
                {channel.trim() !== (view.page.channelUrl ?? '') ? <TextButton label="채널 주소 저장" color="primaryText" align="flex-end" busy={busy} onPress={() => savePage(view.page.enabled)} /> : null}
                {view.page.enabled && view.page.url !== null ? (
                  <View style={{ gap: SPACE.sm }}>
                    <View style={{ padding: SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: p.surfaceAlt }}>
                      <Txt selectable weight="medium">{view.page.url}</Txt>
                    </View>
                    {/* 단추 둘은 한 줄에 — 새 주소(옛 주소가 안 열림)는 왼쪽, 보내기는 오른쪽 (D-UX4-01) */}
                    <ButtonRow>
                      <BigButton kind="outline" label={RENEW_LABEL} onPress={() => setRenewing(true)} />
                      <BigButton label="주소 보내기" onPress={() => void Share.share({ message: view.page.url ?? '' })} />
                    </ButtonRow>
                  </View>
                ) : null}
              </SettingsGroup>

              <SettingsGroup title={ALERTS_TITLE} label={ALERTS_TITLE}>
                <Late style={{ gap: SPACE.sm }}>
                  {alerts !== null ? (
                    <>
                      <ValueRow title={ALERT_WORDS.active} value={`${String(alerts.active)}명`} testID="alerts-active" />
                      <ValueRow title={ALERT_WORDS.pending} value={`${String(alerts.pending)}명`} testID="alerts-pending" />
                      <ValueRow title={ALERT_WORDS.withdrawn} value={`${String(alerts.withdrawn)}명`} testID="alerts-withdrawn" />
                    </>
                  ) : null}
                </Late>
                <GroupNote>{ALERTS_HINT}</GroupNote>
                <GroupNote>{ALERTS_NOT_SENDING}</GroupNote>
              </SettingsGroup>
            </>
          ) : null}
        </Late>
      </ScrollView>

      {draft !== null ? (
        <DraftSheet
          draft={draft}
          busy={busy}
          error={error}
          onClose={() => setDraft(null)}
          onSave={(next) => {
            const body = { date: next.date.trim(), time: next.time.trim(), title: next.title.trim(), intro: next.intro.trim() }
            void run(() => (next.id === null ? post<ScheduleView>('/api/schedule/items', body) : put<ScheduleView>(`/api/schedule/items/${encodeURIComponent(next.id)}`, body))).then((ok) => {
              if (ok) setDraft(null)
            })
          }}
        />
      ) : null}
      <ConfirmSheet
        visible={removing !== null}
        question="이 라이브를 지울까요?"
        description={removing === null ? '' : `${scheduleWhen(removing)} ${removing.title}`}
        confirmLabel="지우기"
        danger
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const item = removing
          if (item === null) return
          void run(() => del<ScheduleView>(`/api/schedule/items/${encodeURIComponent(item.id)}`, {})).then(() => setRemoving(null))
        }}
      />
      <ConfirmSheet
        visible={renewing}
        question={RENEW_LABEL}
        description={RENEW_CONFIRM}
        confirmLabel={RENEW_LABEL}
        busy={busy}
        onCancel={() => setRenewing(false)}
        onConfirm={() => void run(() => post<ScheduleView>('/api/schedule/page/renew', {})).then(() => setRenewing(false))}
      />
    </View>
  )
}

function DraftSheet({ draft, busy, error, onClose, onSave }: { readonly draft: Draft; readonly busy: boolean; readonly error: ApiError | null; readonly onClose: () => void; readonly onSave: (draft: Draft) => void }) {
  const [value, setValue] = useState(draft)
  const set = (patch: Partial<Draft>) => setValue((current) => ({ ...current, ...patch }))
  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={draft.id === null ? '라이브 적기' : '라이브 고치기'}
      actions={<BigButton label="저장" busy={busy} onPress={() => onSave(value)} />}
    >
      <View style={{ gap: SPACE.md }}>
        <TextField label="날짜" value={value.date} onChangeText={(date) => set({ date })} placeholder="2026-11-03" keyboardType="numbers-and-punctuation" error={error?.problemFor('date')?.message ?? null} />
        <TextField label="시각" value={value.time} onChangeText={(time) => set({ time })} placeholder="20:00" keyboardType="numbers-and-punctuation" error={error?.problemFor('time')?.message ?? null} />
        <TextField label="제목" value={value.title} onChangeText={(title) => set({ title: title.slice(0, TITLE_MAX) })} placeholder="화요일 저녁 다육 라이브" error={error?.problemFor('title')?.message ?? null} />
        <TextField label="소개(선택)" value={value.intro} onChangeText={(intro) => set({ intro: intro.slice(0, INTRO_MAX) })} multiline error={error?.problemFor('intro')?.message ?? null} />
        {error !== null && ['date', 'time', 'title', 'intro'].every((field) => error.problemFor(field) === undefined) ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      </View>
    </BottomSheet>
  )
}
