// 택배 접수 (D-APPX-01 — 웹 ParcelsPage와 같은 규칙·문구, PARCEL_RULES PC-4~PC-8, D-T1-08·D-T1-11·D-T1-13·D-T1-18).
// 날짜(서버가 고른 날짜 먼저) → 세 무리: "보낼 수 있어요"(기본 모두 고름·줄마다 상자 크기) · "아직 못 보내요"(줄마다 이유) · "접수했어요"
// (택배 꼬리표·마지막 확인 시각·운송장 PDF·접수 취소). 주 버튼 "N개 택배 접수하기" → 한 번 더 묻기 → 같은 요청 번호로 한 번(끊기면 같은 번호로 다시).
// 운송장 PDF는 휴대폰 공유 시트로 넘긴다(프린트·카톡 등). 다른 기기의 접수·포장·입금은 실시간 알림으로 다시 읽고, 기다리는 줄이 있으면 30초마다 다시 읽는다.
// 이름은 서버가 정한 표시 이름(BUY-01)을 그대로, 글자로만 그린다.
// 토스식 다듬기 (D-UX3-94): 쪽 여백 20·카드 사이 16, 카드 이름은 회색 본문, 줄 이름은 보통 굵기, 줄마다 붙는 일은 작은 회색 단추(큰 단추를 줄마다 쌓지 않음),
// 입금·포장 상태는 꼬리표 대신 색 글자, 파일 받기는 줄, 곁길 일([설정으로]·[인증키 넣기]·[운송장 전부 PDF])은 글자 단추.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Linking, ScrollView, View } from 'react-native'
import type { BookResponse, BookResult, BoxKind, ParcelDay, ParcelDays, ParcelRow } from '@livejjim/web/src/api/parcel-types.ts'
import { dateWords, kstToday } from '@livejjim/web/src/lib/kst.ts'
import {
  BOOKING_NOW,
  BOX_KINDS,
  GROUP_BOOKED,
  GROUP_EXCLUDED,
  GROUP_READY,
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
  EPOST_FILE_AFTER,
  EPOST_FILE_PC,
  EPOST_FILE_PC_TITLE,
  EPOST_FILE_HOW,
  EPOST_FILE_OPEN,
  EPOST_FILE_TITLE,
  EPOST_VISIT_URL,
  addressReason,
  directCancelDescription,
  epostFileBox,
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
import { getBytes, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import { formatWon, PAYMENT_WORD, RETRY_NOW } from '../lib/words.ts'
import { nativeShareFile } from '../native/index.ts'
import { useParcelVersion } from '../lib/parcel-version.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { Pill } from '../ui/day-pills.tsx'
import { AppHeader, Appear, BigButton, ButtonRow, Card, ConfirmSheet, Icon, Txt, useKit, useTabBarRoom, Tap } from '../ui/kit/index.ts'
import { RADIUS, GUTTER, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { Loading, Notice, Tag } from '../ui/parts.tsx'
import { Late, useCameLate } from '../ui/late.tsx'
import { RowAction, RowActions, TextAction } from './ParcelAddress.tsx'
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
  /** 우체국 창구소포 사전접수 (앱 안 화면 자동 입력 — EP1 PC-9). 여러 명이면 한 신청서에 차례로 넣는다 (D-EP1-19) */
  readonly openEpost?: (date: string, buyers: readonly string[]) => void
}

// ── 우체국 창구소포 간편사전접수 (EP1 PC-9 — 앱 안 들고 가기·가지러 오기 화면 자리, D-EP1-21) ──
export const EPOST_INTRO = '계약하지 않아도 돼요. 고른 주문을 [N명 우체국 사전접수]로 우체국 신청서 하나에 차례로 넣어 드려요(한 명씩은 줄의 [우체국 사전접수]). 약관 동의·[필수동의]·[접수신청]은 직접 눌러 주세요.'
export const EPOST_GROUP = '우체국에 사전접수했어요'
export const EPOST_FILLED_NOTE = '우체국 입력 완료 · 신청했는지 확인해 주세요'
export const EPOST_WINDOW_FILE_LABEL = '창구소포 주소 파일 (엑셀)'
export const EPOST_WINDOW_FILE_NOTE = '창구소포(들고 가기)는 이 파일을 PC 인터넷우체국 창구소포 사전접수의 [파일 접수]에 올려요. 휴대폰에서는 파일 접수가 안 돼요.'
/** 한 신청서에 넣는 받는 분 상한 (EpostScreen과 같음 — D-EP1-19) */
export const EPOST_BATCH_MAX = 50

/** onBack이 없으면 아래 탭 "택배"(D-UX3-39) — 다른 탭과 같은 제목 줄, 아래 여백은 탭 막대만큼 */
export function ParcelsScreen({ onBack, initialDate, nav = {}, topGap = 28 }: { readonly onBack?: () => void; readonly initialDate?: string; readonly nav?: ParcelsNavigation; readonly topGap?: number }) {
  const { p } = useKit()
  const room = useTabBarRoom()
  const [picked, setDate] = useState<string | null>(initialDate ?? null)
  const [attempt, setAttempt] = useState(0)
  // 다시 오면 기억해 둔 날짜 목록으로 바로 그리고 뒤에서 조용히 다시 받는다 (D-UX4-77)
  const { data: days, error, reload: reloadDays, checked } = useCachedGet<ParcelDays>('/api/parcels/days', attempt)
  // 판매 기록이 없어도 오늘 날짜로 택배 화면을 다 보인다 (D-UX3-64)
  const date = picked ?? (days === null ? null : (days.selected ?? days.dates[0]?.date ?? kstToday()))
  // 날짜는 서버에서 새로 받은 목록으로 한 번 정하고, 그 뒤로는 바꾸지 않는다 — 기억해 둔 목록만 있는 동안은 따라간다
  useEffect(() => {
    if (picked === null && date !== null && checked) setDate(date)
  }, [picked, date, checked])
  const [version, bump] = useParcelVersion(date)
  // 실시간 알림으로 그날 목록을 다시 받을 때 날짜 목록(보낼 수 있어요·접수 수)도 다시 받는다
  useEffect(() => {
    if (version > 0) void reloadDays()
  }, [version, reloadDays])
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="parcels-screen">
      {onBack !== undefined ? <AppHeader title={PARCEL_TITLE} onBack={onBack} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: onBack === undefined ? topGap : SPACE.sm, paddingBottom: SPACE.xxxl + (onBack === undefined ? room : 0), gap: SPACE.lg }} scrollIndicatorInsets={{ bottom: onBack === undefined ? room : 0 }} keyboardShouldPersistTaps="handled">
        {error !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{error.message}</Notice>
            {days === null ? <BigButton kind="secondary" label={RETRY_NOW} onPress={() => setAttempt((n) => n + 1)} /> : null}
          </View>
        ) : null}
        {days === null && error === null ? <Loading /> : null}
        {/* 서버에서 받은 뒤에야 생기는 날짜 줄·추가 카드는 부드럽게 (D-UX4-112) */}
        <Late>
          {days !== null && days.dates.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm, paddingVertical: SPACE.xs }}>
              {days.dates.map((day) => (
                <Pill key={day.date} on={day.date === date} label={dateWords(day.date)} ariaLabel={`날짜 ${dateWords(day.date)} · 보낼 수 있어요 ${String(day.ready)} · 접수 ${String(day.booked)}`} onPress={() => setDate(day.date)} />
              ))}
            </ScrollView>
          ) : null}
        </Late>
        {date !== null ? <ParcelDayView key={date} date={date} version={version} onChanged={bump} nav={nav} /> : null}
        <Late>
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
        </Late>
      </ScrollView>
    </View>
  )
}

function useParcelDay(date: string, version: number) {
  // 기억해 둔 그날 택배 목록을 바로 보이고 뒤에서 다시 받는다 (D-UX4-77)
  const { data: day, error, reload } = useCachedGet<ParcelDay>(`/api/parcels/days/${date}`, version)
  return { day, error, reload: () => void reload() }
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
  const windowFile = useWaybill()

  const groups = useMemo(() => (day === null ? null : parcelGroups(day)), [day])
  const retry = useMemo(() => (day === null ? [] : retryRows(day)), [day])
  const chosen = groups === null ? [] : groups.ready.filter((row) => !unchecked.has(row.buyer))
  const epostChosen = chosen.filter((row) => !isExtraRow(row))
  const epostRows = day?.epost ?? []
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

  // 불러온 뒤에야 생긴 그날 택배 목록은 부드럽게 — 기억해 둔 목록으로 처음부터 그리면 바로 (D-UX4-112)
  const late = useCameLate(day !== null && groups !== null)
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

  const fileRows = (
    <>
      <FileRow label={EPOST_WINDOW_FILE_LABEL} sub={EPOST_WINDOW_FILE_NOTE} busy={windowFile.busy} onPress={() => void windowFile.run(`/api/parcels/days/${date}/epost-addresses.xlsx`, `우체국-주소-${date}.xlsx`, XLSX_TYPE)} />
      {windowFile.error !== null ? <Notice tone="danger" alert>{windowFile.error}</Notice> : null}
      <FileRow label={epostFileLabel(groups.ready.length)} sub={`${EPOST_FILE_PC} ${epostFileBox(day.box)}`} busy={epostFile.busy} onPress={() => void epostFile.run(epostFilePath(date), epostFileName(date), XLSX_TYPE)} />
    </>
  )

  return (
    <Appear instant={!late} style={{ gap: SPACE.lg }}>
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {directFirst ? null : blocked !== null ? (
        <View style={{ gap: SPACE.xs }}>
          <Notice tone="warning">{blocked.message}</Notice>
          {nav.openSettings !== undefined ? <TextAction label="설정으로" onPress={nav.openSettings} /> : null}
        </View>
      ) : null}

      <Card label={GROUP_READY}>
        <GroupHead title={`${GROUP_READY} · ${String(groups.ready.length)}개`} right={day.carrier !== null ? <Txt step="caption" color="textSub">{`택배사: ${day.carrier.name}`}</Txt> : undefined} />
        {groups.ready.length === 0 ? <Txt color="textSub">{NOTHING_READY}</Txt> : null}
        {directFirst ? <Txt color="textSub">{EPOST_INTRO}</Txt> : null}
        {groups.ready.length > 0 ? (
          <View style={{ gap: SPACE.lg }}>
            {directFirst
              ? groups.ready.map((row) =>
                  isExtraRow(row) ? (
                    <View key={row.buyer} style={{ gap: SPACE.sm }}>
                      <Txt step="bodyLarge" weight="book">{row.name}</Txt>
                      <ExtraFacts row={row} />
                      <ExtraRowActions date={date} row={row} disabled={busy} onChanged={onChanged} />
                    </View>
                  ) : (
                    <View key={row.buyer} style={{ gap: SPACE.sm }}>
                      <PickRow on={!unchecked.has(row.buyer)} name={row.name} disabled={busy} onPress={() => toggle(row.buyer)} />
                      <View style={{ paddingLeft: PICK_INDENT, gap: SPACE.sm }}>
                        <RowFacts row={row} />
                        {row.epost?.state === 'FILLED' ? <Tag tone="warning">{EPOST_FILLED_NOTE}</Tag> : null}
                        <RowActions>
                          {row.epost?.state === 'FILLED' ? <EpostClear date={date} row={row} onChanged={onChanged} label="입력 기록 지우기" /> : null}
                          <RowAction label="우체국 사전접수" ariaLabel={`${row.name} 우체국 사전접수`} onPress={() => nav.openEpost?.(date, [row.buyer])} />
                        </RowActions>
                      </View>
                    </View>
                  ),
                )
              : groups.ready.map((row) => (
                  <View key={row.buyer} style={{ gap: SPACE.sm }}>
                    <PickRow on={!unchecked.has(row.buyer)} name={row.name} disabled={busy} onPress={() => toggle(row.buyer)} />
                    <View style={{ paddingLeft: PICK_INDENT, gap: SPACE.sm }}>
                      {isExtraRow(row) ? <ExtraFacts row={row} /> : <RowFacts row={row} />}
                      {/* 크기 알약만 (D-UX3-94 — 옛: 알약 위 "택배 크기" 글줄. 이름은 단추 이름에 그대로) */}
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
                  </View>
                ))}
          </View>
        ) : null}
        {directFirst ? (
          <View style={{ gap: SPACE.sm, marginTop: SPACE.xs }}>
            <BigButton label={`${String(epostChosen.length)}명 우체국 사전접수`} disabled={epostChosen.length === 0} onPress={() => nav.openEpost?.(date, epostChosen.slice(0, EPOST_BATCH_MAX).map((row) => row.buyer))} />
            <Txt step="caption" color="textSub">{DIRECT_FIRST_NOTE}</Txt>
            {nav.openSettings !== undefined ? <TextAction label={DIRECT_FIRST_KEY} onPress={nav.openSettings} /> : null}
          </View>
        ) : (
          <View style={{ marginTop: SPACE.xs }}>
            <BigButton label={`${String(chosen.length)}개 택배 접수하기`} disabled={blocked !== null || chosen.length === 0} busy={busy} onPress={() => setAsking(true)} />
          </View>
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
          <GroupHead title={directFirst ? EPOST_FILE_PC_TITLE : EPOST_FILE_TITLE} />
          {directFirst || nav.openEpost !== undefined ? (
            // 파일 받기는 큰 단추 대신 줄 (D-UX3-94): 이름 · 짧은 설명 · ›
            <View style={{ marginHorizontal: -SPACE.sm }}>{fileRows}</View>
          ) : (
            <>
              <Txt color="textSub">{EPOST_FILE_HOW}</Txt>
              <Txt step="caption" color="textSub">{`${epostFileBox(day.box)} ${EPOST_FILE_AFTER}`}</Txt>
              <ButtonRow>
                <BigButton kind="outline" label={EPOST_FILE_OPEN} onPress={() => void Linking.openURL(EPOST_VISIT_URL)} />
                <BigButton label={epostFileLabel(groups.ready.length)} busy={epostFile.busy} onPress={() => void epostFile.run(epostFilePath(date), epostFileName(date), XLSX_TYPE)} />
              </ButtonRow>
            </>
          )}
          {epostFile.error !== null ? <Notice tone="danger" alert>{epostFile.error}</Notice> : null}
        </Card>
      ) : null}

      {epostRows.length > 0 ? (
        <Card label={EPOST_GROUP}>
          <GroupHead title={`${EPOST_GROUP} · ${String(epostRows.length)}개`} />
          <View style={{ gap: SPACE.lg }}>
            {epostRows.map((row) => (
              <View key={row.buyer} style={{ gap: SPACE.sm }}>
                <Txt step="bodyLarge" weight="book">{row.name}</Txt>
                <RowFacts row={row} />
                <Tag tone="success">{`${row.epost?.word ?? ''} · 접수번호 ${row.epost?.receiptNo ?? ''}`}</Tag>
                <RowActions>
                  <EpostClear date={date} row={row} onChanged={onChanged} label="접수 기록 지우기" />
                </RowActions>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <Card label={GROUP_EXCLUDED}>
        <GroupHead title={`${GROUP_EXCLUDED} · ${String(groups.excluded.length)}개`} />
        {groups.excluded.length === 0 ? <Txt color="textSub">{NOTHING_EXCLUDED}</Txt> : null}
        {groups.excluded.length > 0 ? (
          <View style={{ gap: SPACE.lg }}>
            {groups.excluded.map((row) => {
              const reason = screenReason(row)
              const text = reason === '' ? (results.get(row.buyer) ?? '') : reason
              const unknown = row.parcel?.state === 'UNKNOWN'
              const retryable = unknown && isRetryable(row.parcel)
              const address = addressReason(row) && !isExtraRow(row) && nav.openSettle !== undefined
              return (
                <View key={row.buyer} style={{ gap: SPACE.sm }}>
                  <Txt step="bodyLarge" weight="book">{row.name}</Txt>
                  {isExtraRow(row) ? <ExtraFacts row={row} /> : <RowFacts row={row} />}
                  {text !== '' ? <Txt color={row.parcel?.state === 'FAILED' ? 'dangerText' : 'text'}>{text}</Txt> : null}
                  {retryable || address ? (
                    <RowActions>
                      {retryable ? <RowAction label="다시 확인" ariaLabel={`${row.name} 다시 확인`} disabled={busy || blocked !== null} onPress={() => void book([row])} /> : null}
                      {address ? <RowAction label="배송지 보기" ariaLabel={`${row.name} 배송지 보기`} onPress={() => nav.openSettle?.(date, row.buyer)} /> : null}
                    </RowActions>
                  ) : null}
                  {isExtraRow(row) && !isRetryable(row.parcel) && row.parcel?.state !== 'PENDING' ? <ExtraRowActions date={date} row={row} disabled={busy} onChanged={onChanged} /> : null}
                </View>
              )
            })}
          </View>
        ) : null}
        {retry.length > 0 ? <BigButton kind="outline" label={RETRY_FAILED} disabled={busy || blocked !== null} onPress={() => void book(retry)} /> : null}
      </Card>

      <Card label={GROUP_BOOKED}>
        {/* 운송장 전부 PDF는 카드 오른쪽 위 글자 단추 (D-UX3-94 — 옛: 큰 회색 단추) */}
        <GroupHead title={`${GROUP_BOOKED} · ${String(groups.booked.length)}개`} right={groups.booked.length > 0 ? <TextAction label="운송장 전부 PDF" chevron={false} disabled={waybills.busy} onPress={() => void waybills.run(`/api/parcels/days/${date}/waybills.pdf`, `운송장-${date}-전부.pdf`)} /> : undefined} />
        {groups.booked.length === 0 ? <Txt color="textSub">{NOTHING_BOOKED}</Txt> : <Txt step="caption" color="textSub">{WAYBILL_NOTE}</Txt>}
        {waybills.error !== null ? <Notice tone="danger" alert>{waybills.error}</Notice> : null}
        {groups.booked.length > 0 ? (
          <View style={{ gap: SPACE.lg }}>
            {groups.booked.map((row) => (
              <BookedRow key={row.buyer} date={date} row={row} onChanged={onChanged} onAction={nextAction} />
            ))}
          </View>
        ) : null}
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
    </Appear>
  )
}

/** 카드 안 묶음 이름 (홈 "내 방송"처럼 회색 본문, D-UX3-94) + 오른쪽 조각 */
function GroupHead({ title, right }: { readonly title: string; readonly right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md, minHeight: 24 }}>
      <View style={{ flex: 1 }}>
        <Txt step="body" weight="regular" color="textSub" role="heading" aria-level={2}>
          {title}
        </Txt>
      </View>
      {right}
    </View>
  )
}

/** 파일 받기 줄 (D-UX3-94): 이름 · 짧은 설명 · 오른쪽 › (받는 중이면 도는 표) */
function FileRow({ label, sub, busy, onPress }: { readonly label: string; readonly sub: string; readonly busy: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap role="button" aria-label={label} aria-busy={busy} disabled={busy} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: TOUCH.min, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt step="bodyLarge" weight="book">{label}</Txt>
        <Txt step="caption" color="textSub">{sub}</Txt>
      </View>
      {busy ? <ActivityIndicator size="small" color={p.textSub} /> : <Icon name="chevron" color={p.textSub} size={18} />}
    </Tap>
  )
}

/** 고르기 표 폭 + 사이 — 줄 아래 사실·단추를 이름 글자 줄에 맞춘다 */
const PICK_BOX = 24
const PICK_INDENT = PICK_BOX + SPACE.md

function PickRow({ on, name, disabled, onPress }: { readonly on: boolean; readonly name: string; readonly disabled: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    // 토스 체크처럼 둥근 표 + 보통 굵기 이름 (D-UX3-94 — 옛: 각진 표·굵은 이름)
    <Tap role="checkbox" aria-checked={on} aria-label={`${name} 고르기`} disabled={disabled} onPress={onPress} hitSlop={4} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: 40, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <View style={{ width: PICK_BOX, height: PICK_BOX, borderRadius: PICK_BOX / 2, borderCurve: 'continuous', borderWidth: on ? 0 : 2, borderColor: p.softPressed, backgroundColor: on ? p.primary : p.surface, alignItems: 'center', justifyContent: 'center' }}>
        {on ? <Icon name="check" color={p.onPrimary} size={15} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Txt step="bodyLarge" weight="book" numberOfLines={1}>{name}</Txt>
      </View>
    </Tap>
  )
}

/** 줄의 사실: 상품 수·최종 금액 · 입금 상태 말 · 포장 상태 말 — 꼬리표 대신 한 줄 색 글자 (D-UX3-94) */
function RowFacts({ row }: { readonly row: ParcelRow }) {
  const { tones } = useKit()
  const pay = row.payment === 'PAID' ? 'success' : row.payment === 'UNPAID' ? 'danger' : 'warning'
  const packing = hidesPackingTag(row.packing, row.parcel) ? null : (PACKING_TONE[row.packing as PackingWord] ?? 'info')
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: SPACE.xs }}>
      <Txt step="caption" color="textSub">{`상품 ${String(row.itemCount)}개 · ${formatWon(row.total)}`}</Txt>
      <Txt step="caption" color="textSub" aria-hidden>·</Txt>
      <Txt step="caption" weight="medium" ink={tones[pay].fg}>{PAYMENT_WORD[row.payment]}</Txt>
      {packing === null ? null : (
        <>
          <Txt step="caption" color="textSub" aria-hidden>·</Txt>
          <Txt step="caption" weight="medium" ink={tones[packing].fg}>{row.packing}</Txt>
        </>
      )}
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

  const cancelLabel = direct ? DIRECT_CANCEL_LABEL : '접수 취소'
  return (
    <View style={{ gap: SPACE.sm }}>
      <Txt step="bodyLarge" weight="book">{row.name}</Txt>
      {isExtraRow(row) ? <ExtraFacts row={row} /> : <RowFacts row={row} />}
      {parcel !== null || direct ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.xs }}>
          {parcel !== null ? <Tag tone={parcelTone(parcel)}>{parcelLine(parcel)}</Tag> : null}
          {direct ? <Tag tone="info">{DIRECT_TAG}</Tag> : null}
        </View>
      ) : null}
      {checked !== null ? <Txt step="caption" color="textSub">{checked}</Txt> : null}
      {/* 작은 회색 단추 좌우로: 취소(부정)는 왼쪽, 운송장 PDF는 오른쪽 (D-UX4-01·D-UX3-94 — 옛: 큰 단추 [운송장 PDF][접수 취소]) */}
      {cancellable || !direct ? (
        <RowActions>
          {cancellable ? (
            <RowAction
              label={cancelLabel}
              ariaLabel={`${row.name} ${cancelLabel}`}
              busy={busy}
              onPress={() => {
                onAction()
                setDone(false)
                setError(null)
                setAsking(true)
              }}
            />
          ) : null}
          {direct ? null : (
            <RowAction
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
        </RowActions>
      ) : null}
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

/** 우체국 기록 지우기 (EP1 PC-9 2): 우체국에서 신청을 취소했거나, 입력만 하고 신청하지 않았을 때. 한 번 더 묻는다 */
function EpostClear({ date, row, onChanged, label }: { readonly date: string; readonly row: ParcelRow; readonly onChanged: () => void; readonly label: string }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const received = row.epost?.state === 'RECEIVED'
  const clear = async () => {
    setBusy(true)
    setError(null)
    try {
      await withRetry(() => post(`/api/parcels/days/${date}/epost`, { requestId: newRequestId(), buyer: row.buyer, action: 'CLEAR' }))
      onChanged()
    } catch (caught: unknown) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: SPACE.xs }}>
      <RowAction label={label} ariaLabel={`${row.name} ${label}`} busy={busy} onPress={() => setAsking(true)} />
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      <ConfirmSheet
        visible={asking}
        question={received ? '우체국 접수 기록을 지울까요?' : '우체국 입력 기록을 지울까요?'}
        description={received ? `${row.name}님 주문의 접수번호를 지워요. 우체국 화면에서 신청을 먼저 취소했을 때만 지워 주세요. 지우면 다시 접수할 수 있어요.` : `${row.name}님 주문을 우체국 화면에 입력만 하고 신청하지 않았을 때 지워 주세요.`}
        confirmLabel="지우기"
        cancelLabel="닫기"
        danger
        busy={busy}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false)
          void clear()
        }}
      />
    </View>
  )
}
