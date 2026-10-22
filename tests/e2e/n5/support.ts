// N5 E2E 공용 도우미 (test-e2e): 요금 화면·시험 결제·시험용 이용권.
// 선택자는 역할·이름 기반(dev-notes "## dev-web" — test-e2e에게). 기대 문장은 BILLING_RULES BL-9·acceptance가 따옴표로 정한 글자.
// 요금 시험은 제목에 @billing을 달아 chromium-billing 묶음(요금 기능을 켠 E2E 서버, 시험 결제)에서만 돈다.
import { expect, type Locator, type Page } from '@playwright/test'

export * from '../s06b/support.ts'

/** BL-4 1.5 / BL-9 2 NO_PASS 문장 */
export const NO_PASS_SENTENCE = '이용권이 없어 실제 방송을 시작할 수 없어요. 요금 화면에서 이용권을 산 뒤 다시 시작해 주세요. 리허설은 언제든 할 수 있어요.'
/** BL-9 1 시작할 이용권 없음 띠 */
export const NO_PASS_BANNER = '이용권이 없어 새 실제 방송을 시작할 수 없어요. 리허설은 할 수 있어요.'
/** BL-6 7 조회 실패 */
export const LOOKUP_FAILED = "결제를 확인하지 못했어요. 잠시 뒤 '다시 확인'을 눌러 주세요."

const DAY_MS = 86_400_000

/** KST "11/19 20:31" (NFR-07 — 달·날은 앞 0 없이, 시·분은 두 자리). 스펙 예시 모양으로 시험이 따로 계산한다 */
export function kst(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(d.getUTCMonth() + 1)}/${String(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

export { DAY_MS }

async function send(page: Page, method: 'POST' | 'PUT', path: string, data: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const origin = new URL(page.url()).origin
  const res = await page.request.fetch(path, { method, data, headers: { Origin: origin } })
  const text = await res.text()
  return { status: res.status(), body: (text === '' ? {} : JSON.parse(text)) as Record<string, unknown> }
}

export interface BillingStatusLike {
  now: string
  flat: { active: boolean; until: string | null; endedAt: string | null }
  balances: { DAYS: number; ORDERS: number; LABELS: number }
  window: { from: string; until: string } | null
  start: { allowed: boolean; mode?: string; useDay?: boolean }
  banners: { kind: string }[]
  business: { masked: string; complete: boolean } | null
}

/** 요금 상태 (기대값 계산이 아니라 시험의 전제 확인용) */
export async function billingStatus(page: Page): Promise<BillingStatusLike> {
  const res = await page.request.get('/api/billing')
  expect(res.ok(), await res.text()).toBe(true)
  return await res.json() as BillingStatusLike
}

/** 시험용 운영자 이용권 (AC-N5-40 — 다른 기기·운영자가 준 것과 같다) */
export async function testGrant(page: Page, grant: { kind: 'FLAT_30D' | 'DAYS' | 'ORDERS' | 'LABELS'; quantity?: number; reason?: string; at?: string }): Promise<void> {
  const res = await send(page, 'POST', '/api/billing/test/grants', { reason: '시험', ...grant })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}

/** 가짜 결제 서버 조회 실패·취소 실패·발행 실패 켜고 끄기 */
export async function testGateway(page: Page, flags: { lookupFailure?: boolean; cancelFailure?: boolean; issueFailure?: boolean }): Promise<void> {
  const res = await send(page, 'PUT', '/api/billing/test/gateway', flags)
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}

/** 가짜 결제 서버에서 그 결제를 완료하고 서명한 웹훅을 넣는다 (화면 밖 — 포트원이 보낸 것처럼) */
export async function payAndWebhook(page: Page, paymentId: string): Promise<void> {
  const paid = await send(page, 'POST', `/api/billing/test/payments/${encodeURIComponent(paymentId)}`, { action: 'PAID', method: 'CARD' })
  expect(paid.status, JSON.stringify(paid.body)).toBeLessThan(300)
  const hook = await send(page, 'POST', `/api/billing/test/payments/${encodeURIComponent(paymentId)}/webhook`, {})
  expect(hook.status, JSON.stringify(hook.body)).toBeLessThan(300)
}

export { send as sendJson }

/** 결제 내역 (API) */
export async function paymentsApi(page: Page): Promise<{ type: string; paymentId?: string; itemName?: string; state?: string; refundable?: boolean }[]> {
  const res = await page.request.get('/api/billing/payments?limit=100')
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as { items: never[] }).items
}

/** 쓴 내역 (API) */
export async function usageApi(page: Page): Promise<{ id: number; kind: string; at: string; broadcast: { id: string; title: string; date: string } | null; windowUntil: string | null }[]> {
  const res = await page.request.get('/api/billing/usage?limit=100')
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as { items: never[] }).items
}

export async function openBilling(page: Page): Promise<void> {
  await page.goto('/billing')
  await expect(page.getByRole('heading', { level: 1, name: '요금' })).toBeVisible()
  await expect(page.locator('.billing-cell')).toHaveCount(4)
}

/** 이용 상태 칸 하나 (dt 정액제·방송 일권·주문 건권·라벨 장권) */
export function statusCell(page: Page, label: '정액제' | '방송 일권' | '주문 건권' | '라벨 장권'): Locator {
  return page.locator('.billing-cell').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd')
}

/** "이용권 사기" 아래 결제 결과 문장 */
export function payResult(page: Page): Locator {
  return page.locator('.billing-result-area').first()
}

/** 홈의 새 방송 칸을 연다 */
export async function openNewForm(page: Page): Promise<Locator> {
  const form = page.getByRole('form', { name: '새 방송' })
  if ((await form.count()) === 0) await page.getByRole('button', { name: '새 방송 시작' }).click()
  await expect(form).toBeVisible()
  return form
}

export type TestChoice = '결제 완료(카드)' | '결제 완료(계좌이체)' | '결제 실패' | '금액을 바꿔 결제' | '창 닫기'

/**
 * 요금 화면에서 항목을 사서 시험 결제 창에서 고른다. 결제 ID(시험 결제 창을 연 주문)를 돌려준다.
 * 결제 전 확인 창의 기본(카드·약관 해제)을 확인한 뒤 수단을 고르고 약관을 체크한다.
 */
export async function buy(page: Page, itemName: string, choice: TestChoice, method: '카드' | '계좌이체' = '카드'): Promise<string> {
  await page.getByRole('button', { name: `${itemName} 사기` }).click()
  const dlg = page.getByRole('dialog', { name: `${itemName} 사기` })
  await expect(dlg).toBeVisible()
  await expect(dlg.getByRole('radio', { name: '카드' })).toBeChecked()
  await expect(dlg.getByRole('checkbox', { name: '이용권 약관과 환불 규정을 읽었어요' })).not.toBeChecked()
  await expect(dlg.getByRole('button', { name: '결제하기' })).toBeDisabled()
  if (method === '계좌이체') await dlg.getByRole('radio', { name: '계좌이체' }).check()
  await dlg.getByRole('checkbox', { name: '이용권 약관과 환불 규정을 읽었어요' }).check()
  const ordered = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/billing/orders' && r.request().method() === 'POST')
  await dlg.getByRole('button', { name: '결제하기' }).click()
  const res = await ordered
  expect(res.ok(), await res.text()).toBe(true)
  const { paymentId } = (await res.json()) as { paymentId: string }
  const test = page.getByRole('dialog', { name: '시험 결제 — 실제로 돈이 나가지 않아요' })
  await expect(test).toBeVisible()
  await expect(dlg).toHaveCount(0)
  await test.getByRole('button', { name: choice }).click()
  await expect(test).toHaveCount(0)
  return paymentId
}
