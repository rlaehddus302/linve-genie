// KP1 단골 만들기 E2E 공용 도우미 (test-e2e) — 손님 장부·콘솔 손님 표시·손님 엑셀·방송 리포트·방송 일정.
// 기대 문장은 harness/sprints/KP1/acceptance.md·docs/spec/CUSTOMER_RULES.md·SPEC RPT/SCH 따옴표 그대로.
// - 장부·손님 기록은 판매자의 모든 실제 날짜를 넘어 모이므로 시험마다 새 판매자(loginNewSeller)로 시작한다.
// - 실제 날짜의 유튜브 구매자는 시험 모드 경로 POST /api/deposits/test/chat(수집 함수 그대로 — CRM1 도우미)로 만든다.
// - 구매자 링크(/r/<토큰>)는 로그인하지 않은 새 브라우저 문맥으로 연다(서버 HTML, 스크립트 없음).
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'

export { broadcast, chat, customerSettings, kstDate, loginNewSeller, payAll, scopeView, smsSale, won, writeEvent, youtubeSale, sameSellerOn, type Seller, type Sale } from '../crm1/support.ts'
export { noHorizontalScroll, postJson, registerApi, xlsxRows, downloadBytes } from '../i2/support.ts'
export { endBroadcast } from '../n4b/support.ts'
export { packAll } from '../t1/support.ts'
import { postJson } from '../i2/support.ts'

export const PC = { width: 1280, height: 900 } as const
export const PHONE = { width: 375, height: 812 } as const
export const VIEWPORTS = [
  { name: 'PC', viewport: PC },
  { name: '375px', viewport: PHONE },
] as const

/** 시험 배송지 — 받는 분 홍길동(가리면 홍*동)·연락처 끝 5678 (AC-KP1-05·08의 값) */
export const ADDRESS = { name: '홍길동', phone: '010-1234-5678', address: '서울특별시 중구 세종대로 110', detail: '101동 202호', zip: '04524' } as const

// ── 스펙 문장 (CUSTOMER_RULES CR-2·CR-3·CR-4·CR-5, acceptance) ─────────────
export const CONSENT_TITLE = '다음 주문에도 이 배송지 쓰기 (선택)'
export const consentBody = (shop: string, period: string) =>
  `${shop}가 받는 분·연락처·주소를 다음 주문 배송지로 쓰려고 마지막 주문 뒤 ${period} 동안 보관해요. 그 뒤엔 지워요. 언제든 이 링크나 판매자에게 지워 달라고 할 수 있어요. 고르지 않아도 이번 주문은 그대로 보내요.`
export const SAVED_LINE = '저장해 둔 배송지가 있어요 (받는 분 홍*동 · 연락처 끝 5678)'
export const DELETE_SAVED = '저장한 정보 지우기'
export const DELETE_ASK = '저장한 배송지를 지울까요? 이번 주문 배송지는 그대로예요.'
export const DELETED = '지웠어요.'
export const LINK_PREFILL = '지난번 배송지로 보낼게요 (받는 분 홍*동 · 연락처 끝 5678). 바뀌었으면 다시 적어 주세요.'
export const PREFILL_TITLE = '지난 주문 배송지예요 — 확인해 주세요'
export const LINK_ACCOUNT = '다른 계정도 잇기'
export const CODE_INTRO = '라이브 방송 채팅에 아래 두 낱말만 쳐 주세요. 24시간 동안 한 번 쓸 수 있어요.'
export const LINKED_PREFIX = '이 손님이 직접 이은 계정: '
export const BADGES_LABEL = '방송 화면에 손님 표시'
export const BADGES_HELP = '방송 화면을 녹화하거나 송출 화면에 띄운다면 꺼 주세요. 손님에게 보이면 안 되는 표시예요.'
export const XLSX_CONTACT = '연락처·주소도 넣기'
export const XLSX_WARNING = '연락처가 든 파일은 다른 사람에게 보내지 마세요.'
export const NO_COMPARE = '처음 방송이라 비교할 게 없어요'
export const LIVE_NOTE = '방송 중이라 숫자가 바뀌고 있어요'
export const SCHEDULE_FULL = '다가오는 방송은 10개까지 적을 수 있어요.'
export const PHONE_RULE = '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.'

/** 개발 용어·영어 상태값 (CLAUDE.md 절대 규칙 8) — 화면에 보이면 안 된다 */
export const DEV_WORDS = /(?<![A-Za-z0-9_])(PENDING|ACTIVE|WITHDRAWN|EXPIRED|UNCONFIRMED|CONFIRMED|AGREE|WITHDRAW|EXPIRE|SELLER_DELETE|RECEIPT_LINK|NO_LEDGER|LEDGER_CHANGED|undefined|null|NaN)(?![A-Za-z0-9_])/

// ── 판매자 쪽 API ─────────────────────────────────────────────────────

/** 택배 설정(가짜 택배사) — 묶음 배송지 칸이 쓰이는 판매자로 (T1과 같은 값) */
export async function parcelSettings(page: Page): Promise<void> {
  const res = await page.request.put('/api/parcels/settings', {
    data: { carrier: 'FAKE', sender: { name: '다육이네', phone: '031-123-4567', address: '경기도 수원시 팔달구 효원로 1', detail: '1층', zip: '16490' }, box: '소' },
    headers: { Origin: new URL(page.url()).origin },
  })
  expect(res.status(), await res.text()).toBe(200)
}

/** 장부 설정 (API) */
export async function ledgerSettings(page: Page, settings: { months: 6 | 12 | 24 | 36; consoleBadges: boolean }): Promise<void> {
  const res = await page.request.put('/api/ledger-settings', { data: settings, headers: { Origin: new URL(page.url()).origin } })
  expect(res.status(), await res.text()).toBe(200)
}

/** 그 구매자의 확인서 링크 주소 (N4b 경로) */
export async function makeLink(page: Page, date: string, buyer: string): Promise<string> {
  const made = await postJson(page, `/api/days/${date}/receipt-links`, { requestId: crypto.randomUUID(), buyer })
  expect(made.status, JSON.stringify(made.body)).toBe(200)
  return (made.body['link'] as { url: string }).url
}

export interface LedgerPrefillView { ledgerId: string; updatedAt: string; name: string; phone: string; address: string; detail: string; zip: string }
export interface BundleView { address: { name: string; phone: string; address: string; source: string; confirmed: boolean } | null; ledger?: LedgerPrefillView | null; row: { address?: unknown; reason?: string | null } }

export async function bundleOf(page: Page, date: string, buyer: string): Promise<BundleView> {
  const res = await page.request.get(`/api/parcels/days/${date}/bundle?buyer=${encodeURIComponent(buyer)}`)
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as { bundle: BundleView }).bundle
}

/** 택배 목록에서 그 묶음 줄 (사유 코드 확인 — PC-4) */
export interface ParcelRowLite { buyer: string; reason: string | null; ready: boolean; address?: string }
export async function parcelRowOf(page: Page, date: string, buyer: string): Promise<ParcelRowLite | undefined> {
  const res = await page.request.get(`/api/parcels/days/${date}`)
  expect(res.status(), await res.text()).toBe(200)
  const day = (await res.json()) as Record<string, ParcelRowLite[] | unknown>
  for (const group of ['ready', 'excluded', 'booked']) {
    const rows = day[group]
    if (!Array.isArray(rows)) continue
    const row = (rows as ParcelRowLite[]).find((r) => r.buyer === buyer)
    if (row !== undefined) return row
  }
  return undefined
}

/** "모든 손님"에서 이름으로 손님 ID */
export async function customerIdOf(page: Page, name: string): Promise<string> {
  const res = await page.request.get('/api/customers?sort=total&filter=all')
  expect(res.status(), await res.text()).toBe(200)
  const body = (await res.json()) as { customers?: { id: string; name: string }[]; rows?: { id: string; name: string }[] }
  const rows = body.customers ?? body.rows ?? []
  const row = rows.find((r) => r.name === name)
  if (row === undefined) throw new Error(`손님 ${name} 없음: ${JSON.stringify(rows.map((r) => r.name))}`)
  return row.id
}

export async function allCustomers(page: Page): Promise<{ id: string; name: string; kindLabel: string }[]> {
  const res = await page.request.get('/api/customers?sort=total&filter=all')
  expect(res.status(), await res.text()).toBe(200)
  const body = (await res.json()) as { customers?: { id: string; name: string; kindLabel: string }[]; rows?: { id: string; name: string; kindLabel: string }[] }
  return body.customers ?? body.rows ?? []
}

export async function customerLedger(page: Page, id: string): Promise<unknown> {
  const res = await page.request.get(`/api/customers/${encodeURIComponent(id)}`)
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as { ledger?: unknown }).ledger ?? null
}

// ── 구매자 링크 (로그인 없는 새 문맥) ──────────────────────────────────

/** 로그인하지 않은 구매자 브라우저 (폭은 판매자 화면과 같게) */
export async function buyerBrowser(browser: Browser, like: Page, viewport: { width: number; height: number }): Promise<{ page: Page; context: BrowserContext }> {
  const phone = viewport.width < 768
  const context = await browser.newContext({ baseURL: new URL(like.url()).origin, viewport, isMobile: phone, hasTouch: phone, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  return { page: await context.newPage(), context }
}

export function addressForm(page: Page): Locator {
  return page.locator('#address')
}

export function consentBox(page: Page): Locator {
  return addressForm(page).getByRole('checkbox', { name: CONSENT_TITLE })
}

/** 링크 배송지 양식을 채워 보낸다 (keep = "다음 주문에도" 고르기) */
export async function sendAddress(page: Page, keep: boolean, address: { name: string; phone: string; address: string; detail?: string; zip?: string } = ADDRESS): Promise<void> {
  const form = addressForm(page)
  await form.getByLabel('받는 분').fill(address.name)
  await form.getByLabel('연락처').fill(address.phone)
  await form.getByLabel('주소', { exact: true }).fill(address.address)
  if (address.detail !== undefined) await form.getByLabel('상세 주소').fill(address.detail)
  if (address.zip !== undefined) await form.getByLabel(/^우편번호/).fill(address.zip)
  if (keep) await consentBox(page).check()
  await form.getByRole('button', { name: '배송지 보내기' }).click()
  await expect(page.getByText('배송지를 받았어요')).toBeVisible()
}

export function ledgerSection(page: Page): Locator {
  return page.locator('#ledger')
}

// ── 판매자 화면 ─────────────────────────────────────────────────────────

/** 묶음 자세히(정산 화면)의 배송지 칸 */
export async function openBundle(page: Page, date: string, buyer: string): Promise<Locator> {
  await page.goto(`/settlements?date=${date}&buyer=${encodeURIComponent(buyer)}`)
  const region = page.getByRole('region', { name: '배송지', exact: true })
  await expect(region).toBeVisible()
  return region
}

export function chatRow(page: Page, nick: string): Locator {
  return page.getByRole('list', { name: '채팅 메시지' }).getByRole('listitem').filter({ hasText: nick })
}

export const BADGES_PATH = /\/api\/days\/\d{4}-\d{2}-\d{2}\/customer-badges(\?|$)/

/** 그 요청의 물은 구매자들 */
export function buyersOf(url: string): string[] {
  return new URL(url).searchParams.getAll('buyer')
}

/** 콘솔 열기 (빠른 입력이 보일 때까지) */
export async function openConsole(page: Page, b: string): Promise<void> {
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeVisible()
}

/** 설정 "손님 관리" 칸과 저장 막대 */
export function customerSection(page: Page): Locator {
  return page.getByRole('region', { name: '손님 관리', exact: true })
}
export function saveButton(page: Page): Locator {
  return page.getByRole('region', { name: '저장', exact: true }).getByRole('button', { name: '저장', exact: true })
}

/** 가로 넘침 없음 (문서 전체) */
export async function noOverflow(page: Page, where: string): Promise<void> {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(size.scroll, `${where}: 가로 넘침`).toBeLessThanOrEqual(size.client)
}

/** 등록 이벤트 (재고 지정) */
export async function registerStock(page: Page, b: string, no: number, name: string, price: number, stock: number): Promise<void> {
  const res = await postJson(page, '/api/events', { requestId: crypto.randomUUID(), type: 'product.register', b, no, name, price, stock })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}
