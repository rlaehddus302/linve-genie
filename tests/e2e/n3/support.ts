// N3 E2E 공용 도우미 (test-e2e) — 입금 확인. S06b 도우미를 그대로 쓰고 시험 모드 가짜 원천·입금 조회를 더한다.
// 선택자·경로는 dev-notes "dev-server > 화면(dev-web)에게"·"dev-web > 화면(테스트)에게 — 선택자"의 약속.
// 기대값(사유 문장·메모·낱말)은 DEPOSIT_RULES(DP-5·DP-6·DP-8)와 acceptance.md에서 옮긴다.
import { expect, type Page } from '@playwright/test'
import { postJson, registerApi, scopeView, smsApi, writeEvent } from '../s06b/support.ts'

export * from '../s06b/support.ts'

/** KST "YYYY-MM-DD" (오늘에서 days일 전) */
export function kstDate(daysAgo: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - daysAgo * 86_400_000))
}

const usedDates = new Set<string>()
const dayOffset = Math.floor(Math.random() * 20)
/**
 * 입금 후보 창(입금 날짜 − 30일 ~ 입금 날짜, DP-4) 안의 지난 날짜. 다른 시험 파일이 쓰는 오늘·2005~2021년 날짜와 겹치지 않게 2~27일 전에서 고른다.
 * 한 프로세스 안에서는 같은 날짜를 두 번 주지 않는다.
 */
export function recentDate(): string {
  for (let i = 0; i < 26; i++) {
    const d = kstDate(2 + ((dayOffset + usedDates.size + i) % 26))
    if (!usedDates.has(d)) {
      usedDates.add(d)
      return d
    }
  }
  throw new Error('쓸 수 있는 최근 날짜가 없다')
}

/** 시험마다 다른 금액(다른 시험의 묶음과 남은 금액이 같아지지 않게) — 100원 단위 */
export function oddPrice(): number {
  return 10_000 + Math.floor(Math.random() * 400) * 100 + 30
}

/** 지금 + ms의 KST 오프셋 ISO (초 정밀도) — 시험용 입금 at */
export function kstIso(ms = 0): string {
  const t = new Date(Date.now() + ms)
  const k = new Date(t.getTime() + 9 * 3_600_000)
  return `${k.toISOString().slice(0, 19)}+09:00`
}

/** "2026-10-18T21:03:15+09:00" → "10/18 21:03:15" (DP-8, 초까지 받은 입금) */
export function shortKst(iso: string, seconds = true): string {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso)
  if (m === null) throw new Error(iso)
  return `${m[1]!}/${m[2]!} ${m[3]!}:${m[4]!}${seconds ? `:${m[5]!}` : ''}`
}

export function won(n: number): string {
  return `${n.toLocaleString('en-US')}원`
}

export interface Sale { b: string; date: string; buyer: string; remaining: number; total: number }

/**
 * 실제 방송(지난 날짜)에서 문자찜(메모 = 이름)으로 1등 하나 → 그 묶음.
 * 판매 시각 = 문자찜 이벤트의 서버 도착 시각(지금)이다 — 입금 at은 그 뒤여야 맞는다(DP-4).
 */
export async function smsSale(page: Page, opts: { memo: string; price?: number; date?: string; b?: string; no?: number; phone?: string }): Promise<Sale> {
  const date = opts.date ?? recentDate()
  let b = opts.b
  if (b === undefined) {
    const res = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), date, rehearsal: false, title: '입금 시험' })
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
    const body = res.body as Record<string, Record<string, unknown> | undefined>
    const id = body['result']?.['b'] ?? body['broadcast']?.['id'] ?? res.body['b'] ?? res.body['id']
    if (typeof id !== 'string') throw new Error(JSON.stringify(res.body))
    b = id
  }
  const no = opts.no ?? 15
  await registerApi(page, b, no, `상품${String(no)}`, opts.price ?? oddPrice())
  const phone = opts.phone ?? `010-${String(1000 + Math.floor(Math.random() * 9000))}-${String(1000 + Math.floor(Math.random() * 9000))}`
  await smsApi(page, { b, no, memo: opts.memo, phone })
  let found: { buyer: string; total: number; received: number } | undefined
  await expect.poll(async () => {
    const view = await scopeView(page, date, false)
    const mine = view.buyers.find((x) => x.kind === 'sms' && x.display.includes(opts.memo) && x.phoneLast4 === phone.slice(-4))
    found = mine === undefined ? undefined : view.settlements.find((s) => s.buyer === (mine.current ?? mine.id))
    return found?.total ?? 0
  }).toBeGreaterThan(0)
  return { b, date, buyer: found!.buyer, total: found!.total, remaining: found!.total - found!.received }
}

export interface DepositView {
  no: number
  source: { id: string; kind: string; label: string }
  at: string
  precision: string
  amount: number
  name: string
  status: 'REVIEW' | 'AUTO_APPLIED' | 'APPLIED' | 'IGNORED'
  applied: { date: string; buyer: string; buyerName: string; seq: number; auto: boolean } | null
  review?: { reason: string; twin: number | null; suggestions: { date: string; buyer: string; name: string; remaining: number }[]; preselect: { date: string; buyer: string } | null }
}

/** 가짜 원천 하나 (시험 모드) */
export async function fakeSource(page: Page, label?: string): Promise<string> {
  const res = await postJson(page, '/api/deposits/sources', { kind: 'FAKE', ...(label === undefined ? {} : { label }) })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  const id = (res.body as { id?: unknown; source?: { id?: unknown } }).id ?? (res.body as { source?: { id?: unknown } }).source?.id
  if (typeof id !== 'string') throw new Error(JSON.stringify(res.body))
  return id
}

export interface TestRow { key: string; at: string; amount: number; name: string }

/** 시험용 입금 넣기 → 다음 받아 오기(주기 1초)에 저장·맞추기. 넣은 key마다 입금이 생길 때까지 기다려 그 입금을 돌려준다 */
export async function deposit(page: Page, source: string, rows: TestRow[]): Promise<DepositView[]> {
  const res = await postJson(page, '/api/deposits/test/rows', { source, rows })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  let found: DepositView[] = []
  await expect.poll(async () => {
    const all = await deposits(page, 'REVIEW,AUTO_APPLIED,APPLIED,IGNORED', 200)
    found = rows.map((r) => all.find((d) => d.source.id === source && d.name === r.name.trim() && d.amount === r.amount && d.at === new Date(r.at).toISOString())).filter((d): d is DepositView => d !== undefined)
    return found.length
  }, { timeout: 15_000 }).toBe(rows.length)
  return found
}

export async function deposits(page: Page, status: string, limit = 50): Promise<DepositView[]> {
  const res = await page.request.get(`/api/deposits?status=${status}&limit=${String(limit)}`)
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as { deposits: DepositView[] }).deposits
}

export async function depositOne(page: Page, no: number): Promise<DepositView> {
  const res = await page.request.get(`/api/deposits/${String(no)}`)
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as { deposit: DepositView }).deposit
}

export async function reviewCount(page: Page): Promise<number> {
  const res = await page.request.get('/api/deposits/count')
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as { review: number }).review
}

/** 입금 목록 줄(PC 표의 row, 휴대폰 카드의 listitem) */
export function depositRow(page: Page, no: number, list: '확인 필요 입금' | '자동 확인됨·확인함 입금' | '무시한 입금' = '확인 필요 입금') {
  const container = page.getByRole('table', { name: list }).or(page.getByRole('list', { name: list }))
  return container.getByRole('row', { name: `입금 #${String(no)}`, exact: true }).or(container.getByRole('listitem').filter({ has: page.getByText(`입금 #${String(no)}`, { exact: true }) }))
}

export function depositTab(page: Page, name: RegExp) {
  return page.getByRole('tablist', { name: '입금 확인 목록' }).getByRole('tab', { name })
}

export { writeEvent }
