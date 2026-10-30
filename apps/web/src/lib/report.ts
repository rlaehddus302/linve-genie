// 방송 리포트 (KP1 RPT-01~RPT-08, AC-KP1-19, D-KP1-09~14): 서버 `GET /api/days/:date/report`의 응답 모양과 화면 낱말.
// 서버 모듈을 가져오지 않고 계약서(harness/sprints/KP1/contract.md §3.6·§4)의 모양을 여기 따로 적는다.
// 금액은 정수 원 — 화면에는 천 단위 쉼표로만 바꿔 보인다(계산하지 않는다). 손님 이름·연락처는 응답에 없다.
import { get } from '../api/client.ts'
import { groupDigits } from './money.ts'

/** RPT-02·RPT-03 (골든 report/summary.json의 out) */
export interface ReportSummary {
  readonly sales: number
  readonly qty: number
  readonly received: number
  readonly unpaid: number
  readonly refund: number
  readonly buyers: number
  readonly unpaidBuyers: number
  readonly newBuyers: number
  readonly returningBuyers: number
  readonly unknownBuyers: number
}

export interface CompareDiff {
  readonly sales: number
  readonly qty: number
  readonly buyers: number
}

/** 바로 앞 실제 방송 날짜와 비교 (RPT-08) */
export interface CompareLast {
  readonly date: string
  readonly sales: number
  readonly qty: number
  readonly buyers: number
  readonly diff: CompareDiff
}

/** 앞선 4번(모자라면 있는 만큼)의 평균과 비교 (RPT-08 — 정수 나눗셈 몫) */
export interface CompareRecent {
  readonly count: number
  readonly sales: number
  readonly qty: number
  readonly buyers: number
  readonly diff: CompareDiff
}

/** 몰린 상품 (RPT-06): b = 방송 ID, no = 상품 번호 */
export interface RushRow {
  readonly b: string
  readonly no: number
  readonly name: string
  readonly buyers: number
  readonly waiting: number
}

/** 품종별 판매 (RPT-05) */
export interface VarietyRow {
  readonly name: string
  readonly qty: number
  readonly amount: number
}

/** 시간대별 판매 (RPT-04): start = 'YYYY-MM-DD HH:MM'(KST, 10분 칸 시작) */
export interface BucketRow {
  readonly start: string
  readonly qty: number
  readonly amount: number
}

export interface ReportView {
  readonly date: string
  /** 그날 끝나지 않은 실제 회차가 있다 */
  readonly live: boolean
  /** 30일 봉인 날짜 — buckets·rush가 null */
  readonly sealed: boolean
  readonly summary: ReportSummary
  readonly compare: { readonly last: CompareLast | null; readonly recent: CompareRecent | null }
  readonly rush: readonly RushRow[] | null
  readonly varieties: readonly VarietyRow[]
  readonly buckets: readonly BucketRow[] | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 그 날짜의 리포트 (판매자만 — 보조자는 서버가 403) */
export function fetchReport(date: string): Promise<ReportView> {
  if (!DATE_RE.test(date)) return Promise.reject(new RangeError('날짜 모양이 아니다'))
  return get<ReportView>(`/api/days/${date}/report`)
}

// ── 화면 낱말 (계약서 §4) ─────────────────────────────────────────────

export const REPORT_TITLE = '방송 리포트'
export const TODAY_REPORT = '오늘 리포트 보기'
export const LIVE_NOTE = '방송 중이라 숫자가 바뀌고 있어요'
export const SEALED_NOTE = '보관 기간이 지나 볼 수 없어요.'
export const NO_COMPARE = '처음 방송이라 비교할 게 없어요'
export const RECEIVED_HELP = '받은 돈은 배송비를 포함해요'
/** 날짜 없이 연 리포트 주소 (가정 — 정산 화면으로 안내) */
export const NO_DATE_NOTE = '볼 날짜가 없어요. 정산 화면에서 날짜를 고른 뒤 "방송 리포트"를 눌러 주세요.'
/** 품종 처음에 보이는 수 (RPT-07) */
export const VARIETY_FIRST = 10

export type CountUnit = '원' | '개' | '명'

/** 수 + 단위: 금액은 천 단위 쉼표 ("12,000원"), 개수·사람도 쉼표 ("1,200개") */
export function amountWords(value: number, unit: CountUnit): string {
  return `${groupDigits(value)}${unit}`
}

/**
 * 비교 문장 (RPT-08): "지난 방송보다 12,000원 많아요" · "…적어요" · "지난 방송과 같아요".
 * against는 비교 대상 이름 (기본 "지난 방송", 평균은 "최근 4번 평균"). 백분율은 내지 않는다.
 */
export function compareWords(diff: number, unit: CountUnit, against = '지난 방송'): string {
  if (diff === 0) return `${against}과 같아요`
  return `${against}보다 ${amountWords(Math.abs(diff), unit)} ${diff > 0 ? '많아요' : '적어요'}`
}

/** 평균 비교 대상 이름 ("최근 4번 평균", 하나면 "최근 1번 평균") */
export function recentName(count: number): string {
  return `최근 ${String(count)}번 평균`
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * 10분 칸 이름: "20:00~20:10". 리포트 날짜와 다른 날(자정을 넘긴 방송)이면 앞에 "다음날 "(그 다음 날) 또는 날짜를 붙인다.
 * 모양이 틀린 값은 그대로 보인다.
 */
export function bucketWords(start: string, reportDate: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(start)
  if (m === null) return start
  const [, day, hh, mm] = m as unknown as [string, string, string, string]
  const from = Number(hh) * 60 + Number(mm)
  const to = (from + 10) % (24 * 60)
  const range = `${hh}:${mm}~${pad(Math.floor(to / 60))}:${pad(to % 60)}`
  if (day === reportDate) return range
  return `${nextDay(reportDate) === day ? '다음날' : `${String(Number(day.slice(5, 7)))}월 ${String(Number(day.slice(8, 10)))}일`} ${range}`
}

function nextDay(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (m === null) return null
  const next = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1))
  return `${String(next.getUTCFullYear())}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

/** 시간대 막대 한 줄의 글 (막대를 못 보는 사람도 읽게): "20:00~20:10 · 3개 · 15,000원" */
export function bucketLine(row: BucketRow, reportDate: string): string {
  return `${bucketWords(row.start, reportDate)} · ${amountWords(row.qty, '개')} · ${amountWords(row.amount, '원')}`
}

/** 막대 길이 (가장 큰 칸 = 100). 0이 아닌 칸은 적어도 2 — 보이게 */
export function barPercent(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0
  return Math.max(2, Math.round((value / max) * 100))
}

/** 몰린 상품 한 줄: "3번 금황" + "30초 안에 8명 · 기다린 손님 3명" */
export function rushWords(row: RushRow): { readonly title: string; readonly detail: string } {
  const name = row.name.trim() === '' ? '이름 없음' : row.name
  return {
    title: `${String(row.no)}번 ${name}`,
    detail: `열고 30초 안에 ${amountWords(row.buyers, '명')}${row.waiting > 0 ? ` · 기다린 손님 ${amountWords(row.waiting, '명')}` : ''}`,
  }
}
