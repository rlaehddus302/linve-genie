// 방송 일정·방송 알림 (D-APPX-01 — 웹 ScheduleSettings·AlertCounts와 같은 규칙·문구, KP1 SCH-01~SCH-03).
// 다가오는 방송(최대 10개)을 적고 고치고 지운다 — 적거나 바꾸면 바로 저장된다. 공개 일정 페이지를 켜면 로그인 없는 주소가 생기고,
// 그 주소를 카톡·인스타로 보낼 수 있다(휴대폰 공유). 방송 알림은 손님이 공개 페이지에서 직접 신청한 "수"만 보인다(번호 목록 없음).
// 아직 문자는 보내지 않는다(D-KP1-20) — 그 한 줄을 늘 보인다.
import { useEffect, useState } from 'react'
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
import { del, get, isApiError, post, put, type ApiError } from '../api/client.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { AppHeader, BigButton, BottomSheet, Card, ConfirmSheet, TextField, ToggleRow, Txt, useKit } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'

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
  const [view, setView] = useState<ScheduleView | null>(null)
  const [alerts, setAlerts] = useState<AlertCounts | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [removing, setRemoving] = useState<ScheduleItem | null>(null)
  const [renewing, setRenewing] = useState(false)
  const [channel, setChannel] = useState('')

  useEffect(() => {
    let alive = true
    get<ScheduleView>('/api/schedule').then(
      (result) => {
        if (!alive) return
        setView(result)
        setChannel(result.page.channelUrl ?? '')
        setError(null)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    get<AlertCounts>('/api/schedule/alerts').then(
      (result) => {
        if (alive) setAlerts(result)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [attempt])

  const run = async (call: () => Promise<ScheduleView>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const next = await call()
      setView(next)
      setChannel(next.page.channelUrl ?? '')
      return true
    } catch (caught: unknown) {
      if (isApiError(caught)) setError(caught)
      return false
    } finally {
      setBusy(false)
    }
  }
  const savePage = (enabled: boolean) => void run(() => put<ScheduleView>('/api/schedule/page', { enabled, channelUrl: channel.trim() === '' ? null : channel.trim() }))

  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="schedule-screen">
      <AppHeader title={SCHEDULE_TITLE} onBack={onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: SPACE.xxxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
        <Txt color="textSub">{SCHEDULE_HINT}</Txt>
        {error !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{error.message}</Notice>
            {view === null ? <BigButton kind="secondary" label={RETRY_NOW} onPress={() => setAttempt((n) => n + 1)} /> : null}
          </View>
        ) : null}
        {view === null && error === null ? <Loading /> : null}
        {view !== null ? (
          <>
            <Card label="다가오는 방송">
              <Txt step="section" weight="bold">다가오는 방송</Txt>
              {view.items.length === 0 ? <Txt color="textSub">{SCHEDULE_EMPTY}</Txt> : null}
              {view.items.map((item) => (
                <View key={item.id} style={{ gap: SPACE.xs, paddingVertical: SPACE.xs }}>
                  <Txt weight="bold">{scheduleWhen(item)}</Txt>
                  <Txt>{item.title}</Txt>
                  {item.intro !== '' ? <Txt step="caption" color="textSub">{item.intro}</Txt> : null}
                  <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
                    <BigButton kind="outline" label="고치기" ariaLabel={`${scheduleWhen(item)} 고치기`} onPress={() => setDraft({ id: item.id, date: item.date, time: item.time, title: item.title, intro: item.intro })} />
                    <BigButton kind="outline" label="지우기" ariaLabel={`${scheduleWhen(item)} 지우기`} onPress={() => setRemoving(item)} />
                  </View>
                </View>
              ))}
              {scheduleFull(view) ? <Txt color="textSub">{SCHEDULE_FULL_MESSAGE}</Txt> : <BigButton label="방송 적기" onPress={() => setDraft(EMPTY_DRAFT)} />}
            </Card>

            <Card label="공개 일정 페이지">
              <ToggleRow title={PAGE_SWITCH_LABEL} subtitle={PAGE_HINT} on={view.page.enabled} disabled={busy} onChange={savePage} />
              <TextField label={CHANNEL_LABEL} value={channel} onChangeText={setChannel} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
              {channel.trim() !== (view.page.channelUrl ?? '') ? <BigButton kind="outline" label="채널 주소 저장" busy={busy} onPress={() => savePage(view.page.enabled)} /> : null}
              {view.page.enabled && view.page.url !== null ? (
                <View style={{ gap: SPACE.sm }}>
                  <Txt selectable weight="bold">{view.page.url}</Txt>
                  <BigButton label="주소 보내기" onPress={() => void Share.share({ message: view.page.url ?? '' })} />
                  <BigButton kind="outline" label={RENEW_LABEL} onPress={() => setRenewing(true)} />
                </View>
              ) : null}
            </Card>

            <Card label={ALERTS_TITLE}>
              <Txt step="section" weight="bold">{ALERTS_TITLE}</Txt>
              <Txt step="caption" color="textSub">{ALERTS_HINT}</Txt>
              {alerts !== null ? (
                <>
                  <Txt>{`${ALERT_WORDS.active} ${String(alerts.active)}명`}</Txt>
                  <Txt>{`${ALERT_WORDS.pending} ${String(alerts.pending)}명`}</Txt>
                  <Txt>{`${ALERT_WORDS.withdrawn} ${String(alerts.withdrawn)}명`}</Txt>
                </>
              ) : null}
              <Notice tone="info">{ALERTS_NOT_SENDING}</Notice>
            </Card>
          </>
        ) : null}
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
        question="이 방송을 지울까요?"
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
      title={draft.id === null ? '방송 적기' : '방송 고치기'}
      actions={
        <>
          <BigButton kind="secondary" label="닫기" onPress={onClose} />
          <BigButton label="저장" busy={busy} onPress={() => onSave(value)} />
        </>
      }
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
