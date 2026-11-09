// 방송 리포트 (KP1 RPT-01~RPT-08 — 웹 ReportPage와 같은 순서·문구, D-APPX-01): 돈 → 손님 → 지난 방송과 비교 → 몰린 상품 5개 → 품종 10개(더 보기) → 시간대 막대.
// 숫자만 — 손님 이름·연락처 없음. 낱말·계산은 웹 lib/report.ts를 그대로 쓴다(코어는 포맷만).
// 리포트 화면 (D-UX3-93, 홈처럼 다듬기): 판매 금액은 맨 위 큰 숫자, 나머지는 회색 이름 - 오른쪽 값 줄. 뻔한 설명 글은 뺐다(받은 돈·알 수 없는 손님처럼 헷갈리는 것만 남김).
// 날짜 알약 아래 긴 날짜 줄(알약과 겹침)·"더 보기" 큰 단추도 뺐다 → 글자 단추
import { useState } from 'react'
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
import { useCachedGet } from '../lib/cached-get.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { DayPills, useRealDays } from '../ui/day-pills.tsx'
import { AppHeader, BigButton, Txt, useKit } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { CARD_GAP, PAGE_SIDE, SectionCard, TextLink, ValueLine } from './order-parts.tsx'

export function ReportScreen({ initialDate, onBack }: { readonly initialDate?: string; readonly onBack: () => void }) {
  const { p } = useKit()
  const { days, date, setDate, error: daysError } = useRealDays(initialDate)
  // 기억해 둔 리포트를 바로 보이고 뒤에서 다시 받는다 (D-UX4-77)
  const { data: view, error, reload } = useCachedGet<ReportView>(date === null ? null : `/api/days/${date}/report`)

  const shown = view !== null && view.date === date ? view : null
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="report-screen">
      <AppHeader title={REPORT_TITLE} onBack={onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: PAGE_SIDE, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl, gap: CARD_GAP }}>
        {daysError !== null ? <Notice tone="danger" alert>{daysError.message}</Notice> : null}
        {days === null && daysError === null ? <Loading /> : null}
        {days !== null ? <DayPills days={days} date={date} onPick={setDate} /> : null}
        {error !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{error.message}</Notice>
            <BigButton label={RETRY_NOW} kind="secondary" onPress={() => void reload()} />
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
    <View style={{ gap: CARD_GAP }}>
      {view.live ? <Notice tone="info">{LIVE_NOTE}</Notice> : null}
      <SectionCard title="돈" label="돈">
        {/* 이 방송의 가장 중요한 숫자 하나는 크게 */}
        <View aria-label={`판매 금액 ${amountWords(summary.sales, '원')}`} style={{ gap: 2 }}>
          <Txt step="number" weight="bold">{amountWords(summary.sales, '원')}</Txt>
          <Txt step="caption" color="textSub">판매 금액 · 상품값만 (배송비·할인·추가 빼고)</Txt>
        </View>
        <ValueLine label="판매 수량" value={amountWords(summary.qty, '개')} />
        <ValueLine label="받은 돈" value={amountWords(summary.received, '원')} sub={RECEIVED_HELP} />
        <ValueLine label="아직 못 받은 돈" value={amountWords(summary.unpaid, '원')} strong={summary.unpaid > 0} />
        <ValueLine label="돌려줄 돈" value={amountWords(summary.refund, '원')} />
      </SectionCard>
      <SectionCard title="손님" label="손님">
        <ValueLine label="산 손님" value={amountWords(summary.buyers, '명')} />
        <ValueLine label="아직 다 내지 않은 손님" value={amountWords(summary.unpaidBuyers, '명')} />
        <ValueLine label="새 손님" value={amountWords(summary.newBuyers, '명')} />
        <ValueLine label="다시 온 손님" value={amountWords(summary.returningBuyers, '명')} />
        <ValueLine label="알 수 없는 손님" value={amountWords(summary.unknownBuyers, '명')} sub="전화번호 없이 받은 문자찜이라 새 손님인지 알 수 없어요." />
      </SectionCard>
      <SectionCard title="지난 방송과 비교" label="지난 방송과 비교">
        <Compare view={view} />
      </SectionCard>
      <SectionCard title="몰린 상품" label="몰린 상품">
        {view.sealed || view.rush === null ? (
          <Txt color="textSub">{SEALED_NOTE}</Txt>
        ) : view.rush.length === 0 ? (
          <Txt color="textSub">몰린 상품이 없어요.</Txt>
        ) : (
          view.rush.slice(0, 5).map((row) => {
            const words = rushWords(row)
            return (
              <View key={`${row.b}/${String(row.no)}`} style={{ gap: 2 }}>
                <Txt step="bodyLarge" weight="book">{words.title}</Txt>
                <Txt step="caption" color="textSub">{words.detail}</Txt>
              </View>
            )
          })
        )}
      </SectionCard>
      <SectionCard title="품종별 판매" label="품종별 판매">
        <Varieties view={view} />
      </SectionCard>
      <SectionCard title="시간대별 판매 (10분마다)" label="시간대별 판매">
        {view.sealed || view.buckets === null ? <Txt color="textSub">{SEALED_NOTE}</Txt> : view.buckets.length === 0 ? <Txt color="textSub">찜이 없어요.</Txt> : <Buckets view={view} />}
      </SectionCard>
    </View>
  )
}

function diffLines(diff: CompareDiff, against: string): string[] {
  return [compareWords(diff.sales, '원', against), compareWords(diff.qty, '개', against), compareWords(diff.buyers, '명', against)]
}

function Compare({ view }: { readonly view: ReportView }) {
  const { last, recent } = view.compare
  if (last === null && recent === null) return <Txt color="textSub">{NO_COMPARE}</Txt>
  return (
    <View style={{ gap: SPACE.lg }}>
      {last !== null ? (
        <View style={{ gap: SPACE.xs }}>
          <Txt step="caption" color="textSub">지난 방송 ({dateLong(last.date)})</Txt>
          {diffLines(last.diff, '지난 방송').map((line, index) => (
            <Txt key={index} step="bodyLarge" weight="book">{line}</Txt>
          ))}
        </View>
      ) : null}
      {recent !== null ? (
        <View style={{ gap: SPACE.xs }}>
          <Txt step="caption" color="textSub">{recentName(recent.count)}</Txt>
          {diffLines(recent.diff, recentName(recent.count)).map((line, index) => (
            <Txt key={index} step="bodyLarge" weight="book">{line}</Txt>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function Varieties({ view }: { readonly view: ReportView }) {
  const [all, setAll] = useState(false)
  if (view.varieties.length === 0) return <Txt color="textSub">판매한 품종이 없어요.</Txt>
  const rows = all ? view.varieties : view.varieties.slice(0, VARIETY_FIRST)
  const more = view.varieties.length - VARIETY_FIRST
  return (
    <>
      {rows.map((row, index) => (
        <View key={`${String(index)}-${row.name}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: SPACE.sm }}>
          <Txt step="bodyLarge" weight="book">{row.name}</Txt>
          <Txt step="body" color="textSub">{`${amountWords(row.qty, '개')} · ${amountWords(row.amount, '원')}`}</Txt>
        </View>
      ))}
      {more > 0 ? <TextLink label={all ? '접기' : `더 보기 (${String(more)}개 더)`} onPress={() => setAll((value) => !value)} /> : null}
    </>
  )
}

function Buckets({ view }: { readonly view: ReportView }) {
  const { p } = useKit()
  const rows = view.buckets ?? []
  const max = rows.reduce((top, row) => Math.max(top, row.amount), 0)
  return (
    <>
      {rows.map((row) => (
        <View key={row.start} style={{ gap: SPACE.xs + 2 }}>
          <Txt step="body">{bucketLine(row, view.date)}</Txt>
          <View aria-hidden style={{ height: 8, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: p.surfaceAlt }}>
            <View style={{ height: 8, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: p.primary, width: `${String(barPercent(row.amount, max))}%` }} />
          </View>
        </View>
      ))}
    </>
  )
}
