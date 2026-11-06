// 택배 접수 (D-APPX-01 — 웹 ParcelsPage와 같은 규칙·문구, PARCEL_RULES PC-4~PC-8, D-T1-08·D-T1-11·D-T1-13·D-T1-18).
// 날짜(서버가 고른 날짜 먼저) → 세 무리: "보낼 수 있어요"(기본 모두 고름·줄마다 상자 크기) · "아직 못 보내요"(줄마다 이유) · "접수했어요"
// (택배 꼬리표·마지막 확인 시각·운송장 PDF·접수 취소). 주 버튼 "N개 택배 접수하기" → 한 번 더 묻기 → 같은 요청 번호로 한 번(끊기면 같은 번호로 다시).
// 운송장 PDF는 휴대폰 공유 시트로 넘긴다(프린트·카톡 등). 다른 기기의 접수·포장·입금은 실시간 알림으로 다시 읽고, 기다리는 줄이 있으면 30초마다 다시 읽는다.
// 이름은 서버가 정한 표시 이름(BUY-01)을 그대로, 글자로만 그린다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Linking, Pressable, ScrollView, View } from 'react-native'
import type { BookResponse, BookResult, BoxKind, ParcelDay, ParcelDays, ParcelRow } from '@livejjim/web/src/api/parcel-types.ts'
import { dateWords, kstToday } from '@livejjim/web/src/lib/kst.ts'
import {
  BOOKING_NOW,
  BOX_KINDS,
  GROUP_BOOKED,
  GROUP_EXCLUDED,
  GROUP_READY,
  NO_PARCEL_DATES,
  NOT_CANCELLABLE,
  NOTHING_BOOKED,
  NOTHING_EXCLUDED,
  NOTHING_READY,
  PARCEL_SHOWN_NOTE,
  PARCEL_TITLE,
  PENDING_POLL_MS,
  RETRY_FAILED,
  ROW_BOX_LABEL,
  WAYBILL_NOTE,
  DIRECT_CANCEL_DONE,
  DIRECT_CANCEL_LABEL,
  DIRECT_CANCEL_QUESTION,
  DIRECT_TAG,
  DIRECT_FIRST_KEY,
  DIRECT_FIRST_NOTE,
  EPOST_DIRECT_HOW,
  EPOST_FILE_AFTER,
  EPOST_FILE_PC,
  EPOST_FILE_PC_TITLE,
  EPOST_KIND_HOW,
  EPOST_KIND_LABEL,
  EPOST_FILE_HOW,
  EPOST_FILE_OPEN,
  EPOST_FILE_TITLE,
  EPOST_VISIT_URL,
  addressReason,
  directCancelDescription,
  epostFileBox,
  type EpostDirectKind,
  epostFileLabel,
  epostFileName,
  epostFilePath,
  showsEpostFile,
  boxWord,
  checkedWords,
  hasPending,
  hidesPackingTag,
  isExtraRow,
  isRetryable,
  parcelGroups,
  parcelLine,
  parcelTone,
  retryRows,
  screenReason,
} from '@livejjim/web/src/lib/parcel-words.ts'
import { PACKING_TONE } from '@livejjim/web/src/lib/packing-words.ts'
import type { PackingWord } from '@livejjim/web/src/api/types.ts'
import { get, getBytes, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import { formatWon, PAYMENT_WORD, RETRY_NOW } from '../lib/words.ts'
import { nativeShareFile } from '../native/index.ts'
import { useParcelVersion } from '../lib/parcel-version.ts'
import { Pill } from '../ui/day-pills.tsx'
import { AppHeader, BigButton, ButtonRow, Card, ConfirmSheet, Icon, Txt, useKit, useTabBarRoom } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice, Tag } from '../ui/parts.tsx'
import { ExtraCard, ExtraFacts, ExtraRowActions } from './ParcelExtra.tsx'

export const DATE_NOT_FOUND = '그 날짜는 택배를 접수할 수 없어요. 다른 날짜를 골라 주세요.'
export const SHARE_FAILED = '파일을 넘기지 못했어요. 다시 눌러 주세요.'

/** 접수 결과 요약 (웹과 같은 문장) */
export function bookSummary(results: readonly BookResult[]): string {
  const ok = results.filter((result) => result.ok).length
  const failed = results.length - ok
  if (failed === 0) return `${String(ok)}개 접수했어요.`
  if (ok === 0) return `${String(failed)}개는 접수하지 못했어요. 줄마다 이유를 확인해 주세요.`
  return `${String(ok)}개 접수했어요. ${String(failed)}개는 접수하지 못했어요 — 줄마다 이유를 확인해 주세요.`
}

export interface ParcelsNavigation {
  /** 배송지 보기 → 정산(그날 그 손님 자세히의 배송지 칸, D-UX3-35) */
  readonly openSettle?: (date: string, buyer: string) => void
  /** 택배 설정(보내는 사람·택배사) */
  readonly openSettings?: () => void
  /** 앱 안 우체국 화면 (D-UX3-37 — COUNTER 들고 가기·VISIT 가지러 오기) */
  readonly openEpost?: (date: string, kind: EpostDirectKind) => void
}

/** onBack이 없으면 아래 탭 "택배"(D-UX3-39) — 다른 탭과 같은 제목 줄, 아래 여백은 탭 막대만큼 */
export function ParcelsScreen({ onBack, initialDate, nav = {} }: { readonly onBack?: () => void; readonly initialDate?: string; readonly nav?: ParcelsNavigation }) {
  const { p } = useKit()
  const room = useTabBarRoom()
  const [days, setDays] = useState<ParcelDays | null>(null)
  const [date, setDate] = useState<string | null>(initialDate ?? null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [version, bump] = useParcelVersion(date)
  useEffect(() => {
    let alive = true
    get<ParcelDays>('/api/parcels/days').then(
      (result) => {
        if (!alive) return
        setDays(result)
        setError(null)
        setDate((current) => current ?? result.selected ?? result.dates[0]?.date ?? null)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt, version])
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="parcels-screen">
      {onBack !== undefined ? <AppHeader title={PARCEL_TITLE} onBack={onBack} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingTop: onBack === undefined ? 28 : 0, paddingBottom: SPACE.xxxl + (onBack === undefined ? room : 0), gap: SPACE.md }} scrollIndicatorInsets={{ bottom: onBack === undefined ? room : 0 }} keyboardShouldPersistTaps="handled">
        {error !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{error.message}</Notice>
            {days === null ? <BigButton kind="secondary" label={RETRY_NOW} onPress={() => setAttempt((n) => n + 1)} /> : null}
          </View>
        ) : null}
        {days === null && error === null ? <Loading /> : null}
        {days !== null && days.dates.length === 0 ? <Txt color="textSub">{NO_PARCEL_DATES}</Txt> : null}
        {days !== null && days.dates.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm }}>
            {days.dates.map((day) => (
              <Pill key={day.date} on={day.date === date} label={dateWords(day.date)} ariaLabel={`날짜 ${dateWords(day.date)} · 보낼 수 있어요 ${String(day.ready)} · 접수 ${String(day.booked)}`} onPress={() => setDate(day.date)} />
            ))}
          </ScrollView>
        ) : null}
        {date !== null ? <ParcelDayView key={date} date={date} version={version} onChanged={bump} nav={nav} /> : null}
        {days !== null ? (
          <ExtraCard
            date={date ?? kstToday()}
            onSaved={(saved) => {
              bump()
              setAttempt((n) => n + 1)
              if (saved !== date) setDate(saved)
            }}
          />
        ) : null}
      </ScrollView>
    </View>
  )
}

function useParcelDay(date: string, version: number) {
  const [day, setDay] = useState<ParcelDay | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(0)
  useEffect(() => {
    const mine = ++latest.current
    get<ParcelDay>(`/api/parcels/days/${date}`).then(
      (result) => {
        if (mine !== latest.current) return
        setDay(result)
        setError(null)
      },
      (caught: unknown) => {
        if (mine === latest.current && isApiError(caught)) setError(caught)
      },
    )
  }, [date, version, attempt])
  return { day, error, reload: () => setAttempt((n) => n + 1) }
}

/** 운송장 PDF 받아 공유 시트로 */
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function useWaybill() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (path: string, name: string, type = 'application/pdf') => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { bytes } = await getBytes(path)
      try {
        await nativeShareFile()(bytes, name, type)
      } catch {
        setError(SHARE_FAILED)
      }
    } catch (caught: unknown) {
      setError(isApiError(caught) ? caught.message : SHARE_FAILED)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function ParcelDayView({ date, version, onChanged, nav }: { readonly date: string; readonly version: number; readonly onChanged: () => void; readonly nav: ParcelsNavigation }) {
  const { day, error, reload } = useParcelDay(date, version)
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set())
  const [boxes, setBoxes] = useState<ReadonlyMap<string, BoxKind>>(new Map())
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [bookError, setBookError] = useState<ApiError | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [results, setResults] = useState<ReadonlyMap<string, string>>(new Map())
  const running = useRef(false)
  const pending = useRef<{ key: string; requestId: string } | null>(null)
  const waybills = useWaybill()
  const epostFile = useWaybill()

  const groups = useMemo(() => (day === null ? null : parcelGroups(day)), [day])
  const retry = useMemo(() => (day === null ? [] : retryRows(day)), [day])
  const chosen = groups === null ? [] : groups.ready.filter((row) => !unchecked.has(row.buyer))
  const boxOf = (row: ParcelRow): BoxKind => boxes.get(row.buyer) ?? row.box
  const blocked = day?.blocked ?? null
  // 계약 인증키가 없거나 택배사를 고르지 않았으면 자동 접수 대신 우체국 직접 접수가 먼저 (D-UX3-40): 키 안내 경고·고르기·상자 고르기·[N개 택배 접수하기]를 감추고 그 자리에 들고 가기·가지러 오기
  const directFirst = day !== null && (blocked?.code === 'NO_AUTO_BOOK' || blocked?.code === 'NO_CARRIER') && showsEpostFile(day) && nav.openEpost !== undefined

  // 택배사 답을 기다리는 줄이 있는 동안 30초마다 다시 읽는다 (D-T1-18)
  const waiting = day !== null && hasPending(day)
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(onChanged, PENDING_POLL_MS)
    return () => clearInterval(timer)
  }, [waiting, onChanged])

  const nextAction = () => {
    setSummary(null)
    setBookError(null)
  }

  const book = async (rows: readonly ParcelRow[]) => {
    if (running.current || rows.length === 0) return
    const items = rows.map((row) => ({ buyer: row.buyer, box: boxOf(row) }))
    const key = JSON.stringify(items)
    if (pending.current?.key !== key) pending.current = { key, requestId: newRequestId() }
    const { requestId } = pending.current
    running.current = true
    setBusy(true)
    setBookError(null)
    setSummary(null)
    try {
      const response = await withRetry(() => post<BookResponse>(`/api/parcels/days/${date}/book`, { requestId, items }))
      pending.current = null
      setSummary(bookSummary(response.results))
      setResults(new Map(response.results.flatMap((result) => (result.ok ? [] : [[result.buyer, result.message] as const]))))
    } catch (caught: unknown) {
      if (!isApiError(caught)) throw caught
      if (!caught.transient) pending.current = null
      setBookError(caught)
    } finally {
      running.current = false
      setBusy(false)
      onChanged()
    }
  }

  if (day === null || groups === null) {
    if (error !== null) {
      return error.status === 404 ? (
        <Txt>{DATE_NOT_FOUND}</Txt>
      ) : (
        <View style={{ gap: SPACE.sm }}>
          <Notice tone="danger" alert>{error.message}</Notice>
          <BigButton kind="secondary" label={RETRY_NOW} onPress={reload} />
        </View>
      )
    }
    return <Loading />
  }

  const toggle = (buyer: string) => {
    nextAction()
    setUnchecked((set) => {
      const next = new Set(set)
      if (next.has(buyer)) next.delete(buyer)
      else next.add(buyer)
      return next
    })
  }

  return (
    <View style={{ gap: SPACE.md }}>
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {directFirst ? null : blocked !== null ? (
        <View style={{ gap: SPACE.sm }}>
          <Notice tone="warning">{blocked.message}</Notice>
          {nav.openSettings !== undefined ? <BigButton kind="outline" label="설정으로" onPress={nav.openSettings} /> : null}
        </View>
      ) : null}
      {day.carrier !== null ? <Txt color="textSub">{`택배사: ${day.carrier.name}`}</Txt> : null}

      <Card label={GROUP_READY}>
        <Txt step="section" weight="bold">{`${GROUP_READY} · ${String(groups.ready.length)}개`}</Txt>
        {groups.ready.length === 0 ? <Txt color="textSub">{NOTHING_READY}</Txt> : null}
        {directFirst ? (
          <View style={{ gap: SPACE.sm }}>
            <Txt>{EPOST_DIRECT_HOW}</Txt>
            <Txt step="caption" color="textSub">{`${EPOST_KIND_LABEL.COUNTER}: ${EPOST_KIND_HOW.COUNTER}`}</Txt>
            <Txt step="caption" color="textSub">{`${EPOST_KIND_LABEL.VISIT}: ${EPOST_KIND_HOW.VISIT}`}</Txt>
            <ButtonRow>
              <BigButton kind="outline" label={EPOST_KIND_LABEL.VISIT} onPress={() => nav.openEpost?.(date, 'VISIT')} />
              <BigButton label={EPOST_KIND_LABEL.COUNTER} onPress={() => nav.openEpost?.(date, 'COUNTER')} />
            </ButtonRow>
            <Txt step="caption" color="textSub">{epostFileBox(day.box)}</Txt>
          </View>
        ) : null}
        {directFirst
          ? groups.ready.map((row) => (
              <View key={row.buyer} style={{ gap: SPACE.xs, paddingVertical: SPACE.xs }}>
                <Txt weight="bold">{row.name}</Txt>
                {isExtraRow(row) ? <ExtraFacts row={row} /> : <RowFacts row={row} />}
                {isExtraRow(row) ? <ExtraRowActions date={date} row={row} disabled={busy} onChanged={onChanged} /> : null}
              </View>
            ))
          : null}
        {directFirst ? null : groups.ready.map((row) => (
          <View key={row.buyer} style={{ gap: SPACE.xs, paddingVertical: SPACE.xs }}>
            <PickRow on={!unchecked.has(row.buyer)} name={row.name} disabled={busy} onPress={() => toggle(row.buyer)} />
            {isExtraRow(row) ? <ExtraFacts row={row} /> : <RowFacts row={row} />}
            <Txt step="caption" color="textSub">{ROW_BOX_LABEL}</Txt>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.xs }}>
              {BOX_KINDS.map((box) => (
                <Pill
                  key={box}
                  on={boxOf(row) === box}
                  label={boxWord(box)}
                  ariaLabel={`${row.name} ${ROW_BOX_LABEL} ${boxWord(box)}`}
                  onPress={() => {
                    if (busy) return
                    nextAction()
                    setBoxes((map) => new Map(map).set(row.buyer, box))
                  }}
                />
              ))}
            </ScrollView>
            {row.parcel?.state === 'CANCELLED' ? <Tag tone={parcelTone(row.parcel)}>{parcelLine(row.parcel)}</Tag> : null}
            {isExtraRow(row) ? <ExtraRowActions date={date} row={row} disabled={busy} onChanged={onChanged} /> : null}
          </View>
        ))}
        {directFirst ? (
          <View style={{ gap: SPACE.xs }}>
            <Txt step="caption" color="textSub">{DIRECT_FIRST_NOTE}</Txt>
            {nav.openSettings !== undefined ? <BigButton kind="outline" label={DIRECT_FIRST_KEY} onPress={nav.openSettings} /> : null}
          </View>
        ) : (
          <BigButton label={`${String(chosen.length)}개 택배 접수하기`} disabled={blocked !== null || chosen.length === 0} busy={busy} onPress={() => setAsking(true)} />
        )}
        {busy ? <Txt step="caption" color="textSub">{BOOKING_NOW}</Txt> : null}
        {summary !== null ? <Notice tone={results.size === 0 ? 'success' : 'warning'}>{summary}</Notice> : null}
        {bookError !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{bookError.message}</Notice>
            <BigButton kind="outline" label="다시 보내기" onPress={() => void book(chosen)} />
          </View>
        ) : null}
      </Card>

      {showsEpostFile(day) ? (
        <Card label={directFirst ? EPOST_FILE_PC_TITLE : EPOST_FILE_TITLE}>
          <Txt step="section" weight="bold">{directFirst ? EPOST_FILE_PC_TITLE : EPOST_FILE_TITLE}</Txt>
          {directFirst ? (
            <>
              <Txt>{EPOST_FILE_PC}</Txt>
              <BigButton kind="outline" label={epostFileLabel(groups.ready.length)} busy={epostFile.busy} onPress={() => void epostFile.run(epostFilePath(date), epostFileName(date), XLSX_TYPE)} />
            </>
          ) : nav.openEpost !== undefined ? (
            <>
              <Txt>{EPOST_DIRECT_HOW}</Txt>
              <Txt step="caption" color="textSub">{`${EPOST_KIND_LABEL.COUNTER}: ${EPOST_KIND_HOW.COUNTER}`}</Txt>
              <Txt step="caption" color="textSub">{`${EPOST_KIND_LABEL.VISIT}: ${EPOST_KIND_HOW.VISIT}`}</Txt>
              <ButtonRow>
                <BigButton kind="outline" label={EPOST_KIND_LABEL.VISIT} onPress={() => nav.openEpost?.(date, 'VISIT')} />
                <BigButton label={EPOST_KIND_LABEL.COUNTER} onPress={() => nav.openEpost?.(date, 'COUNTER')} />
              </ButtonRow>
              <Txt step="caption" color="textSub">{epostFileBox(day.box)}</Txt>
              <Txt step="caption" color="textSub">{EPOST_FILE_PC}</Txt>
              <BigButton kind="outline" label={epostFileLabel(groups.ready.length)} busy={epostFile.busy} onPress={() => void epostFile.run(epostFilePath(date), epostFileName(date), XLSX_TYPE)} />
            </>
          ) : (
            <>
              <Txt>{EPOST_FILE_HOW}</Txt>
              <Txt step="caption" color="textSub">{epostFileBox(day.box)}</Txt>
              <Txt step="caption" color="textSub">{EPOST_FILE_AFTER}</Txt>
              <ButtonRow>
                <BigButton kind="outline" label={EPOST_FILE_OPEN} onPress={() => void Linking.openURL(EPOST_VISIT_URL)} />
                <BigButton label={epostFileLabel(groups.ready.length)} busy={epostFile.busy} onPress={() => void epostFile.run(epostFilePath(date), epostFileName(date), XLSX_TYPE)} />
              </ButtonRow>
            </>
          )}
          {epostFile.error !== null ? <Notice tone="danger" alert>{epostFile.error}</Notice> : null}
        </Card>
      ) : null}

      <Card label={GROUP_EXCLUDED}>
        <Txt step="section" weight="bold">{`${GROUP_EXCLUDED} · ${String(groups.excluded.length)}개`}</Txt>
        {groups.excluded.length === 0 ? <Txt color="textSub">{NOTHING_EXCLUDED}</Txt> : null}
        {groups.excluded.map((row) => {
          const reason = screenReason(row)
          const text = reason === '' ? (results.get(row.buyer) ?? '') : reason
          const unknown = row.parcel?.state === 'UNKNOWN'
          return (
            <View key={row.buyer} style={{ gap: SPACE.xs, paddingVertical: SPACE.xs }}>
              <Txt weight="bold">{row.name}</Txt>
              {isExtraRow(row) ? <ExtraFacts row={row} /> : <RowFacts row={row} />}
              {text !== '' ? <Txt color={row.parcel?.state === 'FAILED' ? 'dangerText' : 'text'}>{text}</Txt> : null}
              {unknown && isRetryable(row.parcel) ? <BigButton kind="outline" label="다시 확인" ariaLabel={`${row.name} 다시 확인`} disabled={busy || blocked !== null} onPress={() => void book([row])} /> : null}
              {addressReason(row) && !isExtraRow(row) && nav.openSettle !== undefined ? <BigButton kind="outline" label="배송지 보기" ariaLabel={`${row.name} 배송지 보기`} onPress={() => nav.openSettle?.(date, row.buyer)} /> : null}
              {isExtraRow(row) && !isRetryable(row.parcel) && row.parcel?.state !== 'PENDING' ? <ExtraRowActions date={date} row={row} disabled={busy} onChanged={onChanged} /> : null}
            </View>
          )
        })}
        {retry.length > 0 ? <BigButton kind="outline" label={RETRY_FAILED} disabled={busy || blocked !== null} onPress={() => void book(retry)} /> : null}
      </Card>

      <Card label={GROUP_BOOKED}>
        <Txt step="section" weight="bold">{`${GROUP_BOOKED} · ${String(groups.booked.length)}개`}</Txt>
        <Txt step="caption" color="textSub">{WAYBILL_NOTE}</Txt>
        {groups.booked.length === 0 ? <Txt color="textSub">{NOTHING_BOOKED}</Txt> : null}
        {groups.booked.length > 0 ? (
          <BigButton kind="outline" label="운송장 전부 PDF" busy={waybills.busy} onPress={() => void waybills.run(`/api/parcels/days/${date}/waybills.pdf`, `운송장-${date}-전부.pdf`)} />
        ) : null}
        {waybills.error !== null ? <Notice tone="danger" alert>{waybills.error}</Notice> : null}
        {groups.booked.map((row) => (
          <BookedRow key={row.buyer} date={date} row={row} onChanged={onChanged} onAction={nextAction} />
        ))}
      </Card>

      <ConfirmSheet
        visible={asking}
        question={`${String(chosen.length)}개를 택배로 접수할까요?`}
        description={PARCEL_SHOWN_NOTE}
        confirmLabel="접수하기"
        cancelLabel="닫기"
        busy={busy}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false)
          void book(chosen)
        }}
      />
    </View>
  )
}

function PickRow({ on, name, disabled, onPress }: { readonly on: boolean; readonly name: string; readonly disabled: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Pressable role="checkbox" aria-checked={on} aria-label={`${name} 고르기`} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: 44, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <View style={{ width: 28, height: 28, borderRadius: RADIUS.sm, borderCurve: 'continuous', borderWidth: 2, borderColor: on ? p.primary : p.outline, backgroundColor: on ? p.primary : p.surface, alignItems: 'center', justifyContent: 'center' }}>
        {on ? <Icon name="check" color={p.onPrimary} size={18} /> : null}
      </View>
      <Txt weight="bold">{name}</Txt>
    </Pressable>
  )
}

/** 줄의 사실: 상품 수·최종 금액·입금 상태 말·포장 상태 말 */
function RowFacts({ row }: { readonly row: ParcelRow }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, alignItems: 'center' }}>
      <Txt step="caption">{`상품 ${String(row.itemCount)}개 · ${formatWon(row.total)}`}</Txt>
      <Tag tone={row.payment === 'PAID' ? 'success' : row.payment === 'UNPAID' ? 'danger' : 'warning'}>{PAYMENT_WORD[row.payment]}</Tag>
      {hidesPackingTag(row.packing, row.parcel) ? null : <Tag tone={PACKING_TONE[row.packing as PackingWord] ?? 'info'}>{row.packing}</Tag>}
    </View>
  )
}

function BookedRow({ date, row, onChanged, onAction }: { readonly date: string; readonly row: ParcelRow; readonly onChanged: () => void; readonly onAction: () => void }) {
  const parcel = row.parcel
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState(false)
  const pending = useRef<string | null>(null)
  const running = useRef(false)
  const waybill = useWaybill()
  const checked = parcel === null ? null : checkedWords(parcel)
  const cancellable = parcel === null || parcel.cancellable
  // 우체국 직접 접수(D-UX3-37): 운송장은 우체국이 붙인다 — 라이브찜 운송장 PDF는 없고, [기록 지우기]는 라이브찜 기록만 지운다
  const direct = parcel?.direct === 'VISIT' || parcel?.direct === 'COUNTER'

  const cancel = async () => {
    if (running.current) return
    pending.current ??= newRequestId()
    const requestId = pending.current
    running.current = true
    setBusy(true)
    setError(null)
    try {
      await withRetry(() => post(`/api/parcels/days/${date}/cancel`, { requestId, buyer: row.buyer }))
      pending.current = null
      setDone(true)
      onChanged()
    } catch (caught: unknown) {
      if (!isApiError(caught)) throw caught
      pending.current = null
      setError(caught)
      if (caught.status === 409) onChanged()
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  return (
    <View style={{ gap: SPACE.xs, paddingVertical: SPACE.xs }}>
      <Txt weight="bold">{row.name}</Txt>
      {isExtraRow(row) ? <ExtraFacts row={row} /> : <RowFacts row={row} />}
      {parcel !== null ? <Tag tone={parcelTone(parcel)}>{parcelLine(parcel)}</Tag> : null}
      {direct ? <Tag tone="info">{DIRECT_TAG}</Tag> : null}
      {checked !== null ? <Txt step="caption" color="textSub">{checked}</Txt> : null}
      <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
        {direct ? null : (
        <BigButton
          kind="outline"
          label="운송장 PDF"
          ariaLabel={`${row.name} 운송장 PDF`}
          busy={waybill.busy}
          onPress={() => {
            onAction()
            setDone(false)
            setError(null)
            void waybill.run(withQuery(`/api/parcels/days/${date}/waybill.pdf`, { buyer: row.buyer }), `운송장-${date}.pdf`)
          }}
        />
        )}
        {cancellable ? (
          <BigButton
            kind="outline"
            label={direct ? DIRECT_CANCEL_LABEL : '접수 취소'}
            ariaLabel={`${row.name} ${direct ? DIRECT_CANCEL_LABEL : '접수 취소'}`}
            busy={busy}
            onPress={() => {
              onAction()
              setDone(false)
              setError(null)
              setAsking(true)
            }}
          />
        ) : null}
      </View>
      {!cancellable ? <Txt step="caption" color="textSub">{NOT_CANCELLABLE}</Txt> : null}
      {done ? <Notice tone="success">{direct ? DIRECT_CANCEL_DONE : '접수를 취소했어요.'}</Notice> : null}
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {waybill.error !== null ? <Notice tone="danger" alert>{waybill.error}</Notice> : null}
      <ConfirmSheet
        visible={asking}
        question={direct ? DIRECT_CANCEL_QUESTION : '택배 접수를 취소할까요?'}
        description={direct ? directCancelDescription(row.name) : `${row.name}님의 택배 접수를 취소할까요? 택배사가 아직 가져가지 않았을 때만 취소돼요.`}
        confirmLabel={direct ? '지우기' : '취소하기'}
        cancelLabel="닫기"
        danger
        busy={busy}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false)
          void cancel()
        }}
      />
    </View>
  )
}
