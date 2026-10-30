// KP1 방송 리포트·방송 일정·방송 알림 화면 (AC-KP1-19·20·23, RPT-07·08, SCH-01·02·03).
// 서버 계약은 harness/sprints/KP1/contract.md §3.6·§3.7 — 가짜 서버가 그 모양으로 답한다.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlertCountsSection } from '../src/components/AlertCounts.tsx'
import { ReportBody, ReportPage } from '../src/components/ReportPage.tsx'
import { ScheduleSettings } from '../src/components/ScheduleSettings.tsx'
import {
  LIVE_NOTE,
  NO_COMPARE,
  RECEIVED_HELP,
  SEALED_NOTE,
  barPercent,
  bucketWords,
  compareWords,
  type ReportView,
} from '../src/lib/report.ts'
import { parseRoute, routePath, menuOf } from '../src/lib/router.ts'
import { SCHEDULE_FULL_MESSAGE, scheduleWhen, type ScheduleView } from '../src/lib/schedule.ts'
import { FakeServer, apiError, flush } from './support.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const REPORT: ReportView = {
  date: '2026-10-31',
  live: false,
  sealed: false,
  summary: { sales: 512_000, qty: 41, received: 430_000, unpaid: 90_000, refund: 3_000, buyers: 25, unpaidBuyers: 4, newBuyers: 10, returningBuyers: 13, unknownBuyers: 2 },
  compare: {
    last: { date: '2026-10-24', sales: 500_000, qty: 41, buyers: 27, diff: { sales: 12_000, qty: 0, buyers: -2 } },
    recent: { count: 4, sales: 480_000, qty: 40, buyers: 24, diff: { sales: 32_000, qty: 1, buyers: 1 } },
  },
  rush: [1, 2, 3, 4, 5].map((no) => ({ b: 'B1', no, name: `금황${String(no)}`, buyers: 10 - no, waiting: no === 1 ? 3 : 0 })),
  varieties: Array.from({ length: 12 }, (_, i) => ({ name: `품종${String(i + 1)}`, qty: 12 - i, amount: (12 - i) * 1000 })),
  buckets: [
    { start: '2026-10-31 20:00', qty: 3, amount: 15_000 },
    { start: '2026-10-31 23:50', qty: 1, amount: 5_000 },
    { start: '2026-11-01 00:00', qty: 1, amount: 7_000 },
  ],
}

describe('리포트 낱말 (RPT-08, 계약서 §4)', () => {
  it('비교 문장: 많아요·적어요·같아요, 천 단위 쉼표, 백분율 없음', () => {
    expect(compareWords(12_000, '원')).toBe('지난 방송보다 12,000원 많아요')
    expect(compareWords(-2, '명')).toBe('지난 방송보다 2명 적어요')
    expect(compareWords(0, '개')).toBe('지난 방송과 같아요')
    expect(compareWords(1_500, '개', '최근 4번 평균')).toBe('최근 4번 평균보다 1,500개 많아요')
  })

  it('10분 칸 이름: 같은 날은 시각만, 자정을 넘기면 "다음날"', () => {
    expect(bucketWords('2026-10-31 20:00', '2026-10-31')).toBe('20:00~20:10')
    expect(bucketWords('2026-10-31 23:50', '2026-10-31')).toBe('23:50~00:00')
    expect(bucketWords('2026-11-01 00:10', '2026-10-31')).toBe('다음날 00:10~00:20')
    expect(bucketWords('2026-12-31 23:50', '2026-12-31')).toBe('23:50~00:00')
    expect(bucketWords('2027-01-01 00:00', '2026-12-31')).toBe('다음날 00:00~00:10')
  })

  it('막대 길이: 가장 큰 칸 100, 0은 0, 작아도 보이게 2 이상', () => {
    expect(barPercent(15_000, 15_000)).toBe(100)
    expect(barPercent(0, 15_000)).toBe(0)
    expect(barPercent(1, 1_000_000)).toBe(2)
    expect(barPercent(5, 0)).toBe(0)
  })
})

describe('리포트 주소 (AC-KP1-19)', () => {
  it('/report?date= 를 읽고 다시 쓴다 — 정산 메뉴 아래', () => {
    const route = parseRoute('/report', '?date=2026-10-31')
    expect(route).toEqual({ name: 'report', date: '2026-10-31' })
    expect(routePath(route)).toBe('/report?date=2026-10-31')
    expect(menuOf(route)).toBe('settlements')
    expect(parseRoute('/report', '?date=31-10')).toEqual({ name: 'report' })
  })
})

describe('리포트 화면 (AC-KP1-19, RPT-07)', () => {
  it('순서: 돈 → 손님 → 비교 → 몰린 상품 → 품종 → 시간대', () => {
    render(<ReportBody view={REPORT} />)
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(titles).toEqual(['돈', '손님', '지난 방송과 비교', '몰린 상품', '품종별 판매', '시간대별 판매'])
  })

  it('금액은 천 단위 쉼표, 받은 돈 옆 설명 한 줄', () => {
    render(<ReportBody view={REPORT} />)
    expect(screen.getByText('512,000원')).toBeTruthy()
    expect(screen.getByText(new RegExp(RECEIVED_HELP))).toBeTruthy()
    expect(screen.getByText('지난 방송보다 12,000원 많아요')).toBeTruthy()
    expect(screen.getByText('지난 방송과 같아요')).toBeTruthy()
    expect(screen.getByText('지난 방송보다 2명 적어요')).toBeTruthy()
    expect(screen.getByText('최근 4번 평균보다 32,000원 많아요')).toBeTruthy()
  })

  it('품종은 10개 + "더 보기", 누르면 전부', () => {
    render(<ReportBody view={REPORT} />)
    const list = screen.getByRole('list', { name: '품종 목록' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(10)
    fireEvent.click(screen.getByRole('button', { name: '더 보기 (2개 더)' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(12)
  })

  it('몰린 상품은 많아야 5개, 시간대 막대는 글로도 읽힌다', () => {
    render(<ReportBody view={{ ...REPORT, rush: [...(REPORT.rush ?? []), { b: 'B1', no: 9, name: '여섯째', buyers: 1, waiting: 0 }] }} />)
    expect(within(screen.getByRole('list', { name: '몰린 상품 목록' })).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByText('1번 금황1')).toBeTruthy()
    expect(screen.getByText(/열고 30초 안에 9명 · 기다린 손님 3명/)).toBeTruthy()
    const buckets = screen.getByRole('list', { name: '시간대별 판매 목록' })
    expect(within(buckets).getByText('20:00~20:10 · 3개 · 15,000원')).toBeTruthy()
    expect(within(buckets).getByText('다음날 00:00~00:10 · 1개 · 7,000원')).toBeTruthy()
  })

  it('앞선 방송이 없으면 "처음 방송이라 비교할 게 없어요", 방송 중이면 한 줄', () => {
    render(<ReportBody view={{ ...REPORT, live: true, compare: { last: null, recent: null } }} />)
    expect(screen.getByText(NO_COMPARE)).toBeTruthy()
    expect(screen.getByText(LIVE_NOTE)).toBeTruthy()
  })

  it('봉인 날짜: 몰린 상품·시간대 자리에 "보관 기간이 지나 볼 수 없어요.", 돈·품종은 보인다', () => {
    render(<ReportBody view={{ ...REPORT, sealed: true, rush: null, buckets: null }} />)
    expect(screen.getAllByText(SEALED_NOTE)).toHaveLength(2)
    expect(screen.getByText('512,000원')).toBeTruthy()
    expect(screen.getByRole('list', { name: '품종 목록' })).toBeTruthy()
  })

  it('상품 이름은 글자 그대로(태그로 읽지 않는다)', () => {
    const { container } = render(<ReportBody view={{ ...REPORT, varieties: [{ name: '<img src=x onerror=alert(1)>', qty: 1, amount: 1000 }] }} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy()
  })

  it('서버에서 받아 보인다 — 오류는 서버 문장', async () => {
    const server = new FakeServer()
      .on('GET', /^\/api\/days\/2026-10-31\/report$/, () => ({ body: REPORT }))
      .on('GET', /^\/api\/days\/2026-10-30\/report$/, () => apiError(404, 'NOT_FOUND', '이 날짜에는 방송이 없어요.'))
    vi.stubGlobal('fetch', server.fetch)
    render(<ReportPage date="2026-10-31" navigate={() => {}} />)
    await act(() => flush())
    expect(screen.getByText('512,000원')).toBeTruthy()
    cleanup()
    render(<ReportPage date="2026-10-30" navigate={() => {}} />)
    await act(() => flush())
    expect(screen.getByRole('alert').textContent).toContain('이 날짜에는 방송이 없어요.')
  })
})

// ── 방송 일정 ─────────────────────────────────────────────────────────

const item = (n: number) => ({ id: `s${String(n)}`, date: '2026-11-03', time: `2${String(n % 4)}:00`, startsAt: '2026-11-03T11:00:00.000Z', title: `방송 ${String(n)}`, intro: '' })

function scheduleView(patch: Partial<ScheduleView> = {}): ScheduleView {
  return { page: { enabled: false, url: null, channelUrl: null }, items: [], max: 10, ...patch }
}

describe('방송 일정 (AC-KP1-20, SCH-01·02)', () => {
  it('일정 한 줄: "11월 3일(화) 20:00"', () => {
    expect(scheduleWhen({ date: '2026-11-03', time: '20:00' })).toBe('11월 3일(화) 20:00')
  })

  it('적기: 날짜·시각·제목·소개를 그대로 보내고 목록이 바뀐다', async () => {
    let view = scheduleView()
    const server = new FakeServer()
      .on('GET', /^\/api\/schedule$/, () => ({ body: view }))
      .on('POST', /^\/api\/schedule\/items$/, (call) => {
        view = scheduleView({ items: [{ id: 's1', startsAt: '2026-11-03T11:00:00.000Z', ...(call.body as { date: string; time: string; title: string; intro: string }) }] })
        return { body: view }
      })
    vi.stubGlobal('fetch', server.fetch)
    render(<ScheduleSettings />)
    await act(() => flush())
    const form = screen.getByRole('form', { name: '새 일정 적기' })
    fireEvent.change(within(form).getByLabelText('날짜'), { target: { value: '2026-11-03' } })
    fireEvent.change(within(form).getByLabelText('시작 시각'), { target: { value: '20:00' } })
    fireEvent.change(within(form).getByLabelText('제목'), { target: { value: '다육이 새로 왔어요' } })
    fireEvent.click(within(form).getByRole('button', { name: '일정 적기' }))
    await act(() => flush())
    expect(server.callsTo('POST', /^\/api\/schedule\/items$/)[0]?.body).toEqual({ date: '2026-11-03', time: '20:00', title: '다육이 새로 왔어요', intro: '' })
    expect(within(screen.getByRole('list', { name: '다가오는 방송 목록' })).getByText('다육이 새로 왔어요')).toBeTruthy()
    expect(screen.getByText('일정을 적었어요.')).toBeTruthy()
  })

  it('휴대폰 번호 모양은 서버 문장 그대로 제목 칸 아래에', async () => {
    const phone = '전화번호는 적을 수 없어요. 번호를 빼고 적어 주세요.'
    const server = new FakeServer()
      .on('GET', /^\/api\/schedule$/, () => ({ body: scheduleView() }))
      .on('POST', /^\/api\/schedule\/items$/, () => apiError(400, 'INVALID_INPUT', '입력을 확인해 주세요.', [{ field: 'title', message: phone }]))
    vi.stubGlobal('fetch', server.fetch)
    render(<ScheduleSettings />)
    await act(() => flush())
    const form = screen.getByRole('form', { name: '새 일정 적기' })
    fireEvent.change(within(form).getByLabelText('제목'), { target: { value: '문의 010-1234-5678' } })
    fireEvent.click(within(form).getByRole('button', { name: '일정 적기' }))
    await act(() => flush())
    expect(within(form).getByLabelText('제목').getAttribute('aria-invalid')).toBe('true')
    expect(within(form).getByText(phone)).toBeTruthy()
  })

  it('41자 제목도 화면이 자르지 않고 보낸다(서버가 거절)', async () => {
    const server = new FakeServer()
      .on('GET', /^\/api\/schedule$/, () => ({ body: scheduleView() }))
      .on('POST', /^\/api\/schedule\/items$/, () => apiError(400, 'INVALID_INPUT', '입력을 확인해 주세요.', [{ field: 'title', message: '제목은 1~40자로 적어 주세요.' }]))
    vi.stubGlobal('fetch', server.fetch)
    render(<ScheduleSettings />)
    await act(() => flush())
    const form = screen.getByRole('form', { name: '새 일정 적기' })
    fireEvent.change(within(form).getByLabelText('제목'), { target: { value: '가'.repeat(41) } })
    expect(within(form).getByText('41/40자')).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: '일정 적기' }))
    await act(() => flush())
    expect((server.callsTo('POST', /^\/api\/schedule\/items$/)[0]?.body as { title: string }).title).toHaveLength(41)
    expect(within(form).getByText('제목은 1~40자로 적어 주세요.')).toBeTruthy()
  })

  it('10개가 차면 미리 알리고, 11번째는 서버 문장', async () => {
    const full = scheduleView({ items: Array.from({ length: 10 }, (_, i) => item(i + 1)) })
    const server = new FakeServer()
      .on('GET', /^\/api\/schedule$/, () => ({ body: full }))
      .on('POST', /^\/api\/schedule\/items$/, () => apiError(409, 'SCHEDULE_FULL', SCHEDULE_FULL_MESSAGE))
    vi.stubGlobal('fetch', server.fetch)
    render(<ScheduleSettings />)
    await act(() => flush())
    expect(screen.getByText(SCHEDULE_FULL_MESSAGE)).toBeTruthy()
    const form = screen.getByRole('form', { name: '새 일정 적기' })
    fireEvent.click(within(form).getByRole('button', { name: '일정 적기' }))
    await act(() => flush())
    expect(screen.getAllByText(SCHEDULE_FULL_MESSAGE)).toHaveLength(1)
    expect(screen.getByRole('alert').textContent).toContain(SCHEDULE_FULL_MESSAGE)
  })

  it('공개 켜기 → 주소·복사·새 주소(옛 주소가 안 된다는 확인)', async () => {
    let view = scheduleView()
    const server = new FakeServer()
      .on('GET', /^\/api\/schedule$/, () => ({ body: view }))
      .on('PUT', /^\/api\/schedule\/page$/, (call) => {
        const enabled = (call.body as { enabled: boolean }).enabled
        view = scheduleView({ page: { enabled, url: enabled ? 'https://app.example/s/AAA' : null, channelUrl: null } })
        return { body: view }
      })
      .on('POST', /^\/api\/schedule\/page\/renew$/, () => {
        view = scheduleView({ page: { enabled: true, url: 'https://app.example/s/BBB', channelUrl: null } })
        return { body: view }
      })
    vi.stubGlobal('fetch', server.fetch)
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<ScheduleSettings />)
    await act(() => flush())
    fireEvent.click(screen.getByRole('checkbox', { name: /방송 일정 공개/ }))
    await act(() => flush())
    expect(server.callsTo('PUT', /^\/api\/schedule\/page$/)[0]?.body).toEqual({ enabled: true, channelUrl: null })
    expect(screen.getByText('https://app.example/s/AAA')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '주소 복사' }))
    await act(() => flush())
    expect(writeText).toHaveBeenCalledWith('https://app.example/s/AAA')
    expect(screen.getByText('주소를 복사했어요.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '새 주소 만들기' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/지금 주소는 더 이상 열리지 않아요/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '새 주소 만들기' }))
    await act(() => flush())
    expect(server.callsTo('POST', /^\/api\/schedule\/page\/renew$/)).toHaveLength(1)
    expect(screen.getByText('https://app.example/s/BBB')).toBeTruthy()
    expect(screen.queryByText('https://app.example/s/AAA')).toBeNull()
  })
})

describe('방송 알림 (AC-KP1-23)', () => {
  it('세 가지 수만 — 쉬운 낱말, 영어 상태값·번호 목록·내려받기 없음', async () => {
    const server = new FakeServer().on('GET', /^\/api\/schedule\/alerts$/, () => ({ body: { pending: 3, active: 1_200, withdrawn: 0 } }))
    vi.stubGlobal('fetch', server.fetch)
    const { container } = render(<AlertCountsSection />)
    await act(() => flush())
    expect(screen.getByText('신청 기다림')).toBeTruthy()
    expect(screen.getByText('3명')).toBeTruthy()
    expect(screen.getByText('받는 중')).toBeTruthy()
    expect(screen.getByText('1,200명')).toBeTruthy()
    expect(screen.getByText('그만 받음')).toBeTruthy()
    expect(container.textContent).not.toMatch(/PENDING|ACTIVE|WITHDRAWN|010/)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})
