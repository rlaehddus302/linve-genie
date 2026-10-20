// S06 E2E 공용 도우미 (test-e2e). S05 도우미를 그대로 쓰고 새 화면(문자찜 입력·구매자·정산)용을 더한다.
// 선택자는 역할·이름 기반(dev-notes "화면(테스트)에게 — 선택자 주의").
import { expect, type Page } from '@playwright/test'
import { postJson } from '../s05/support.ts'

export * from '../s05/support.ts'

export function menu(page: Page) {
  return page.getByRole('navigation', { name: '메뉴' })
}

/** 쓰기 (POST /api/events) — 범위 쓰기(구매자·정산)는 date·rehearsal 검색값 */
export async function writeEvent(page: Page, event: Record<string, unknown>, scope?: { date: string; rehearsal: boolean }): Promise<{ status: number; body: Record<string, unknown> }> {
  const query = scope === undefined ? '' : `?date=${scope.date}${scope.rehearsal ? '&rehearsal=true' : ''}`
  return await postJson(page, `/api/events${query}`, { requestId: crypto.randomUUID(), ...event })
}

/** API로 문자찜 */
export async function smsApi(page: Page, event: { b: string; no: number; received?: string; phone?: string; memo?: string; buyer?: string }): Promise<Record<string, unknown>> {
  const res = await writeEvent(page, { type: 'sms', ...event })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  return res.body
}

/** 문자찜 입력 화면을 열고 제목으로 방송을 고른다 (그 방송 범위의 전체 조회가 끝나 입력 칸이 준비될 때까지) */
export async function openSms(page: Page, title: string): Promise<void> {
  if (!page.url().startsWith('http')) await page.goto('/')
  const list = await (await page.request.get('/api/broadcasts')).json() as { broadcasts: { title: string; date: string; rehearsal: boolean }[] }
  const target = list.broadcasts.find((x) => x.title === title)
  if (target === undefined) throw new Error(`방송 ${title} 없음`)
  await page.goto('/sms')
  const region = page.getByRole('region', { name: '고른 방송' })
  await region.getByRole('button', { name: /^방송 (바꾸기|고르기)$/ }).click()
  const dlg = page.getByRole('dialog', { name: '방송 고르기' })
  const loaded = page.waitForResponse((r) => {
    const url = new URL(r.url())
    return url.pathname === `/api/days/${target.date}` && (url.searchParams.get('rehearsal') === 'true') === target.rehearsal && r.ok()
  })
  await dlg.getByRole('button', { name: new RegExp(`^${title} ·`) }).click()
  await expect(dlg).toHaveCount(0)
  await loaded
  await expect(region).toContainText(title)
  await expect(page.getByRole('region', { name: '최근 넣은 문자찜' })).toBeVisible()
  await expect(smsField(page, '번호')).toBeFocused()
}

/**
 * 지금(한국 시각)보다 seconds초 이른 "HH:MM:SS". 받은 시각은 입력 시각에 가장 가까운 날짜로 읽으므로(D-023·D-089),
 * 고정 시각('00:00:01')을 쓰면 정오 뒤에는 "내일"로 읽혀 늦은 시각 확인 창이 뜬다 — 시험이 벽시계에 따라 달라지지 않게 쓴다.
 */
export function kstTimeAgo(seconds = 60): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.now() - seconds * 1000))
  const part = (t: string): string => parts.find((x) => x.type === t)?.value ?? '00'
  return `${part('hour')}:${part('minute')}:${part('second')}`
}

export function smsField(page: Page, name: '번호' | '받은 시각' | '전화번호' | '메모' | '구매자 고르기') {
  return page.getByLabel(name, { exact: true })
}

/** 화면에서 문자찜 넣기 (결과 카드가 바뀔 때까지) */
export async function smsUi(page: Page, opts: { no: number; received?: string; phone?: string; memo?: string }): Promise<void> {
  await smsField(page, '번호').fill(String(opts.no))
  if (opts.received !== undefined) await smsField(page, '받은 시각').fill(opts.received)
  if (opts.phone !== undefined) await smsField(page, '전화번호').fill(opts.phone)
  if (opts.memo !== undefined) await smsField(page, '메모').fill(opts.memo)
  await page.getByRole('button', { name: `${String(opts.no)}번에 문자찜 넣기` }).click()
  await expect(smsField(page, '번호')).toHaveValue('')
  await expect(page.getByRole('region', { name: '넣은 결과' })).toContainText(`${String(opts.no)}번`)
}

/** 범위 조회의 구매자·정산·찜 */
export interface ScopeBuyer { id: string; kind: string; current: string; mergedInto: string | null; merged: string[]; display: string; phoneLast4: string | null; items: unknown[]; subtotal: number; blocked: boolean }
export interface ScopeSettlement { buyer: string; subtotal: number; shipping: number; total: number; received: number; refundDue: number; payment: string; items: unknown[]; records: { kind: string; amount: number }[] }
export interface ScopeClaim { id: string; seq: number; buyer: string; currentBuyer: string; product: string; no: number; status: string; origin: string; broadcast: string }

export async function scopeView(page: Page, date: string, rehearsal: boolean): Promise<{ buyers: ScopeBuyer[]; settlements: ScopeSettlement[]; claims: ScopeClaim[]; products: { id: string; key: string; no: number; status: string; winners: string[]; waitlist: string[] }[] }> {
  const res = await page.request.get(`/api/days/${date}${rehearsal ? '?rehearsal=true' : ''}`)
  expect(res.ok(), await res.text()).toBe(true)
  return await res.json() as never
}

/** 리허설 채팅으로 시청자 찜 (채널 ID 지정) */
export async function viewerClaim(page: Page, b: string, nick: string, text: string, channel: string): Promise<void> {
  const res = await postJson(page, `/api/broadcasts/${b}/rehearsal/chat`, { requestId: crypto.randomUUID(), nick, text, channel })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}

/** API로 상품 등록 */
export async function registerApi(page: Page, b: string, no: number, name: string, price: number): Promise<void> {
  const res = await writeEvent(page, { type: 'product.register', b, no, name, price })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}

/** 화면 상태 글자 검사용 — 375px 공통 (AC-S06-02) */
export async function noHorizontalScroll(page: Page): Promise<void> {
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width)
}
