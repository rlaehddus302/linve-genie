// 방송 리포트 (KP1 RPT-01~RPT-08 — 웹 ReportPage와 같은 순서·문구, D-APPX-01): 돈 → 손님 → 지난 방송과 비교 → 몰린 상품 5개 → 품종 10개(더 보기) → 시간대 막대.
// 숫자만 — 손님 이름·연락처 없음. 낱말·계산은 웹 lib/report.ts를 그대로 쓴다(코어는 포맷만).
import { useEffect, useState, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { dateLong } from '@livejjim/web/src/lib/kst.ts'
import {
  LIVE_NOTE,
  NO_COMPARE,
  RECEIVED_HELP,
  REPORT_TITLE,
  SEALED_NOTE,
  VARIETY_FIRST,
  amountWords,
  barPercent,
  bucketLine,
  compareWords,
  recentName,
  rushWords,
  type CompareDiff,
  type ReportView,
} from '@livejjim/web/src/lib/report.ts'
import { get, isApiError, type ApiError } from '../api/client.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { DayPills, useRealDays } from '../ui/day-pills.tsx'
import { AppHeader, BigButton, Card, Txt, useKit } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'

export function ReportScreen({ initialDate, onBack }: { readonly initialDate?: string; readonly onBack: () => void }) {
  const { p } = useKit()
  const { days, date, setDate, error: daysError } = useRealDays(initialDate)
  const [view, setView] = useState<ReportView | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (date === null) return
    let alive = true
    setError(null)
    get<ReportView>(`/api/days/${date}/report`).then(
      (result) => {
        if (alive) setView(result)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [date, attempt])

  const shown = view !== null && view.date === date ? view : null
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="report-screen">
      <AppHeader title={REPORT_TITLE} onBack={onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.lg, paddingBottom: SPACE.xxxl, gap: SPACE.lg }}>
        {daysError !== null ? <Notice tone="danger" alert>{daysError.message}</Notice> : null}
        {days === null && daysError === null ? <Loading /> : null}
        {days !== null ? <DayPills days={days} date={date} onPick={setDate} /> : null}
        {date !== null ? <Txt color="textSub">{dateLong(date)}</Txt> : null}
        {error !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{error.message}</Notice>
            <BigButton label={RETRY_NOW} kind="secondary" onPress={() => setAttempt((n) => n + 1)} />
          </View>
        ) : null}
        {date !== null && shown === null && error === null ? <Loading text="리포트를 불러오는 중…" /> : null}
        {shown !== null ? <ReportBody view={shown} /> : null}
      </ScrollView>
    </View>
  )
}

export function ReportBody({ view }: { readonly view: ReportView }) {
  const { summary } = view
  return (
    <View style={{ gap: SPACE.lg }}>
      {view.live ? <Notice tone="info">{LIVE_NOTE}</Notice> : null}
      <Block title="돈">
        <NumberRow label="판매 금액" value={amountWords(summary.sales, '원')} hint="상품값만 더했어요. 배송비·할인·추가 금액은 빼요." />
        <NumberRow label="판매 수량" value={amountWords(summary.qty, '개')} />
        <NumberRow label="받은 돈" value={amountWords(summary.received, '원')} hint={RECEIVED_HELP} />
        <NumberRow label="아직 못 받은 돈" value={amountWords(summary.unpaid, '원')} hint="손님마다 낼 돈에서 받은 돈을 뺀 합이에요." />
        <NumberRow label="돌려줄 돈" value={amountWords(summary.refund, '원')} hint="더 받은 돈의 합이에요." />
      </Block>
      <Block title="손님">
        <NumberRow label="산 손님" value={amountWords(summary.buyers, '명')} />
        <NumberRow label="아직 다 내지 않은 손님" value={amountWords(summary.unpaidBuyers, '명')} />
        <NumberRow label="새 손님" value={amountWords(summary.newBuyers, '명')} hint="앞선 방송에서 산 적이 없는 손님이에요." />
        <NumberRow label="다시 온 손님" value={amountWords(summary.returningBuyers, '명')} hint="앞선 방송에서도 산 손님이에요." />
        <NumberRow label="알 수 없는 손님" value={amountWords(summary.unknownBuyers, '명')} hint="전화번호 없이 받은 문자찜이라 새 손님인지 알 수 없어요." />
      </Block>
      <Block title="지난 방송과 비교">
        <Compare view={view} />
      </Block>
      <Block title="몰린 상품">
        {view.sealed || view.rush === null ? (
          <Txt>{SEALED_NOTE}</Txt>
        ) : view.rush.length === 0 ? (
          <Txt>몰린 상품이 없어요.</Txt>
        ) : (
          <>
            <Txt step="caption" color="textSub">상품을 열고 30초 안에 찜한 손님이 많은 순이에요. 다음 방송 재고를 정할 때 참고하세요.</Txt>
            {view.rush.slice(0, 5).map((row) => {
              const words = rushWords(row)
              return (
                <View key={`${row.b}/${String(row.no)}`} style={{ gap: 2 }}>
                  <Txt weight="bold">{words.title}</Txt>
                  <Txt color="textSub">{words.detail}</Txt>
                </View>
              )
            })}
          </>
        )}
      </Block>
      <Block title="품종별 판매">
        <Varieties view={view} />
      </Block>
      <Block title="시간대별 판매">
        {view.sealed || view.buckets === null ? <Txt>{SEALED_NOTE}</Txt> : view.buckets.length === 0 ? <Txt>찜이 없어요.</Txt> : <Buckets view={view} />}
      </Block>
    </View>
  )
}

function Block({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Card label={title}>
      <Txt step="section" weight="bold" role="heading" aria-level={2}>
        {title}
      </Txt>
      {children}
    </Card>
  )
}

function NumberRow({ label, value, hint }: { readonly label: string; readonly value: string; readonly hint?: string }) {
  return (
    <View style={{ gap: 2 }} aria-label={`${label} ${value}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: SPACE.sm }}>
        <Txt>{label}</Txt>
        <Txt weight="heavy">{value}</Txt>
      </View>
      {hint !== undefined ? <Txt step="caption" color="textSub">{hint}</Txt> : null}
    </View>
  )
}

function diffLines(diff: CompareDiff, against: string): string[] {
  return [compareWords(diff.sales, '원', against), compareWords(diff.qty, '개', against), compareWords(diff.buyers, '명', against)]
}

function Compare({ view }: { readonly view: ReportView }) {
  const { last, recent } = view.compare
  if (last === null && recent === null) return <Txt>{NO_COMPARE}</Txt>
  return (
    <View style={{ gap: SPACE.md }}>
      {last !== null ? (
        <View style={{ gap: 2 }}>
          <Txt weight="bold">지난 방송 ({dateLong(last.date)})</Txt>
          {diffLines(last.diff, '지난 방송').map((line, index) => (
            <Txt key={index}>{line}</Txt>
          ))}
        </View>
      ) : null}
      {recent !== null ? (
        <View style={{ gap: 2 }}>
          <Txt weight="bold">{recentName(recent.count)}</Txt>
          {diffLines(recent.diff, recentName(recent.count)).map((line, index) => (
            <Txt key={index}>{line}</Txt>
          ))}
        </View>
      ) : null}
      <Txt step="caption" color="textSub">받은 돈은 날이 지나면 늘어서 비교하지 않아요.</Txt>
    </View>
  )
}

function Varieties({ view }: { readonly view: ReportView }) {
  const [all, setAll] = useState(false)
  if (view.varieties.length === 0) return <Txt>판매한 품종이 없어요.</Txt>
  const rows = all ? view.varieties : view.varieties.slice(0, VARIETY_FIRST)
  const more = view.varieties.length - VARIETY_FIRST
  return (
    <>
      {rows.map((row, index) => (
        <Txt key={`${String(index)}-${row.name}`}>
          <Txt weight="bold">{row.name}</Txt> · {amountWords(row.qty, '개')} · {amountWords(row.amount, '원')}
        </Txt>
      ))}
      {more > 0 ? <BigButton label={all ? '접기' : `더 보기 (${String(more)}개 더)`} kind="secondary" onPress={() => setAll((value) => !value)} /> : null}
    </>
  )
}

function Buckets({ view }: { readonly view: ReportView }) {
  const { p } = useKit()
  const rows = view.buckets ?? []
  const max = rows.reduce((top, row) => Math.max(top, row.amount), 0)
  return (
    <>
      <Txt step="caption" color="textSub">10분마다 판매 금액이에요. 막대가 길수록 많이 팔렸어요.</Txt>
      {rows.map((row) => (
        <View key={row.start} style={{ gap: SPACE.xs }}>
          <Txt>{bucketLine(row, view.date)}</Txt>
          <View aria-hidden style={{ height: 10, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: p.outline }}>
            <View style={{ height: 10, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: p.primary, width: `${String(barPercent(row.amount, max))}%` }} />
          </View>
        </View>
      ))}
    </>
  )
}
