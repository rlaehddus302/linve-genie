// 방송 일정·방송 알림 (KP1 SCH-01~SCH-03, AC-KP1-20·21·23, D-KP1-15·16): 서버 `/api/schedule*`의 응답 모양과 화면 낱말.
// 서버 모듈을 가져오지 않고 계약서(harness/sprints/KP1/contract.md §3.7·§4)의 모양을 여기 따로 적는다.
// 판매자에겐 알림 신청 "수"만 — 번호 목록·내려받기·대신 넣기 경로가 없다(SCH-03, AC-KP1-23).
import { del, get, post, put } from '../api/client.ts'

export interface ScheduleItem {
  readonly id: string
  /** KST 날짜 YYYY-MM-DD */
  readonly date: string
  /** KST 시각 HH:MM */
  readonly time: string
  /** UTC ISO */
  readonly startsAt: string
  readonly title: string
  readonly intro: string
}

export interface ScheduleView {
  readonly page: {
    readonly enabled: boolean
    /** 공개 주소 (켜졌을 때만) */
    readonly url: string | null
    readonly channelUrl: string | null
  }
  /** 다가오는 일정만, 시각 순 */
  readonly items: readonly ScheduleItem[]
  readonly max: number
}

export interface ScheduleInput {
  readonly date: string
  readonly time: string
  readonly title: string
  readonly intro: string
}

export interface AlertCounts {
  readonly pending: number
  readonly active: number
  readonly withdrawn: number
}

export function fetchSchedule(): Promise<ScheduleView> {
  return get<ScheduleView>('/api/schedule')
}

/** 공개 페이지 켜기·끄기와 채널 주소 (빈 글은 null) */
export function saveSchedulePage(enabled: boolean, channelUrl: string | null): Promise<ScheduleView> {
  const url = channelUrl === null || channelUrl.trim() === '' ? null : channelUrl.trim()
  return put<ScheduleView>('/api/schedule/page', { enabled, channelUrl: url })
}

/** 새 주소 만들기 — 옛 주소는 열리지 않는다 */
export function renewSchedulePage(): Promise<ScheduleView> {
  return post<ScheduleView>('/api/schedule/page/renew', {})
}

export function addScheduleItem(input: ScheduleInput): Promise<ScheduleView> {
  return post<ScheduleView>('/api/schedule/items', input)
}

export function editScheduleItem(id: string, input: ScheduleInput): Promise<ScheduleView> {
  return put<ScheduleView>(`/api/schedule/items/${encodeURIComponent(id)}`, input)
}

export function removeScheduleItem(id: string): Promise<ScheduleView> {
  return del<ScheduleView>(`/api/schedule/items/${encodeURIComponent(id)}`, {})
}

export function fetchAlertCounts(): Promise<AlertCounts> {
  return get<AlertCounts>('/api/schedule/alerts')
}

// ── 화면 낱말 ─────────────────────────────────────────────────────────

export const SCHEDULE_TITLE = '방송 일정'
export const ALERTS_TITLE = '방송 알림'
export const SCHEDULE_HINT = '다음 방송을 적어 두면 공개 일정 페이지에 보여요. 판매 규칙·판정과는 상관없어요.'
export const SCHEDULE_FULL_MESSAGE = '다가오는 방송은 10개까지 적을 수 있어요.'
export const SCHEDULE_EMPTY = '적어 둔 다가오는 방송이 없어요.'
export const PAGE_SWITCH_LABEL = '방송 일정 공개'
export const PAGE_HINT = '켜면 로그인 없이 누구나 볼 수 있는 주소가 생겨요. 가게 이름·다가오는 방송·채널 주소만 보여요.'
export const CHANNEL_LABEL = '유튜브 채널 주소 (비워도 돼요)'
export const RENEW_LABEL = '새 주소 만들기'
/** 새 주소 만들기 확인 한 줄 (옛 주소가 안 된다는 것) */
export const RENEW_CONFIRM = '새 주소를 만들면 지금 주소는 더 이상 열리지 않아요. 새 주소를 만들까요?'
export const COPY_LABEL = '주소 복사'
export const COPIED = '주소를 복사했어요.'
export const COPY_FAILED = '복사하지 못했어요. 주소를 길게 눌러 직접 복사해 주세요.'
export const ALERTS_HINT = '공개 일정 페이지에서 손님이 직접 신청한 수예요. 번호는 보이지 않아요.'
/** 아직 아무 문자도 보내지 않는다 (D-KP1-20, UX-KP1-012) */
export const ALERTS_NOT_SENDING = '아직 문자를 보내지 않아요. 보내기는 준비 중이에요.'
/** 방송 일정은 칸마다 바로 저장된다 — 아래 저장 막대와 따로 (UX-KP1-003) */
export const SCHEDULE_INSTANT = '방송 일정은 적거나 바꾸면 바로 저장돼요. 아래 [저장]은 누르지 않아도 돼요.'

/** 알림 신청 상태 → 화면 낱말 (영어 상태값을 화면에 내지 않는다) */
export const ALERT_WORDS = { pending: '번호 확인 전', active: '받는 중', withdrawn: '그만 받음' } as const

/** 제목 1~40자, 소개 0~100자 (SCH-01) — 화면은 입력 길이만 막고, 거절 문장은 서버가 준다 */
export const TITLE_MAX = 40
export const INTRO_MAX = 100

/** 일정 한 줄: "11월 3일(화) 20:00" */
export function scheduleWhen(item: Pick<ScheduleItem, 'date' | 'time'>): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(item.date)
  if (m === null) return `${item.date} ${item.time}`
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  return `${String(Number(m[2]))}월 ${String(Number(m[3]))}일(${'일월화수목금토'[day] ?? ''}) ${item.time}`
}

/** 다가오는 일정이 꽉 찼나 (새로 적기를 막고 문장을 보인다) */
export function scheduleFull(view: Pick<ScheduleView, 'items' | 'max'>): boolean {
  return view.items.length >= view.max
}
