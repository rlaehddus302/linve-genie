// O2 E2E 공용 도우미 (test-e2e) — 판매 방식·상품 옵션·지금 상품·확인 필요.
// 선택자는 역할·이름 기반(harness/sprints/O2/dev-notes.md "test-e2e에게"). 문장은 acceptance.md의 따옴표 그대로.
// 모든 E2E가 시험 계정 하나를 함께 쓴다 — 설정을 바꾼 시험은 끝에 resetSaleMode로 "번호로만 받기"·접수순으로 되돌린다.
import { expect, type Page } from '@playwright/test'
import { postJson, uniqueDate, writeEvent } from '../s06/support.ts'

export * from '../s06/support.ts'

export const NUMBERS_WORD = '번호로만 받기 (다육 등 — 기본)'
export const OPTIONS_WORD = '상품명·옵션도 받기 (의류·식품·케이스 등)'
export const NO_FOCUS = '지금 상품 없음 — 상품 이름을 쓴 댓글만 받아요'
export const FOCUS_GRACE = '15초 동안 상품 이름 없는 댓글은 확인 필요로 모아요'
export const SMS_TO_REVIEW = '찜이 생기지 않았어요 — 확인 필요로 보냈어요'

export interface OptionChoice { label: string; aliases?: string[]; price?: number }
export interface OptionItem { name: string; choices: OptionChoice[] }

export interface Variant { key: string; text: string; status: string; stock: number; remaining: number; price: number; winners: string[]; winnerClaims: string[]; waitlist: string[]; waitlistClaims: string[]; awaitingSuccession: boolean; conflict: boolean }
export interface OProduct { key: string; id: string; broadcast: string; no: number; name: string; price: number; stock: number; status: string; aliases: string[]; options: { name: string; choices: { label: string; aliases: string[]; price: number }[] }[]; hasOptions: boolean; variants: Variant[] }
export interface OClaim { id: string; seq: number; buyer: string; currentBuyer: string; product: string; no: number; status: string; origin: string; broadcast: string; qty: number; variant: string | null; amount: number | null; cancelRequested: boolean }
export interface OBroadcast { id: string; date: string; title: string; settings: Record<string, unknown>; focus: { product: string; no: number; productId: string; at: string } | null }
export interface OBuyer { id: string; display: string; current: string }
export interface Review { broadcast: string; item: string; buyer: string; currentBuyer: string; reason: string; product: string | null; no: number | null; options: [string, string][] | null; qty: number | null; seq: number; origin: 'chat' | 'sms'; buyerName: string; text: string | null; phoneLast4: string | null; date: string }
export interface ReviewsBody { rehearsal: boolean; reviews: Review[]; products: OProduct[]; broadcasts: OBroadcast[] }

/** 판매 방식 설정 (API) — OPTIONS면 겨루기 접수순과 함께 */
export async function setSaleMode(page: Page, mode: 'OPTIONS' | 'STRICT'): Promise<void> {
  if (!page.url().startsWith('http')) await page.goto('/')
  const settings = mode === 'OPTIONS' ? { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } : { 'claim.parseMode': 'STRICT' }
  const res = await page.request.patch('/api/settings', { data: { settings }, headers: { Origin: new URL(page.url()).origin } })
  expect(res.status(), await res.text()).toBe(200)
}

/** 시험 끝 정리: 번호로만 받기·접수순 (다른 시험이 기본 설정을 기대한다) */
export async function resetSaleMode(page: Page): Promise<void> {
  if (!page.url().startsWith('http')) return
  await page.request.patch('/api/settings', { data: { settings: { 'claim.parseMode': 'STRICT', 'contention.policy': 'ARRIVAL' } }, headers: { Origin: new URL(page.url()).origin } })
}

export async function serverSettings(page: Page): Promise<Record<string, unknown>> {
  const res = await page.request.get('/api/settings')
  expect(res.ok(), await res.text()).toBe(true)
  const body = await res.json() as { settings: Record<string, unknown> }
  return body.settings
}

/** 옵션 방송을 API로 만든다 (콘솔은 열지 않는다) */
export async function createBroadcast(page: Page, opts: { date?: string; rehearsal: boolean; title?: string; saleMode?: 'OPTIONS' | 'NUMBERS' }): Promise<{ b: string; date: string }> {
  if (!page.url().startsWith('http')) await page.goto('/')
  const date = opts.date ?? uniqueDate()
  const res = await postJson(page, '/api/broadcasts', {
    requestId: crypto.randomUUID(),
    date,
    rehearsal: opts.rehearsal,
    ...(opts.title === undefined ? {} : { title: opts.title }),
    ...(opts.saleMode === undefined ? {} : { saleMode: opts.saleMode }),
  })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  const b = (res.body['broadcast'] as Record<string, unknown> | undefined)?.['id'] ?? (res.body['result'] as Record<string, unknown> | undefined)?.['b'] ?? res.body['b'] ?? res.body['id']
  if (typeof b !== 'string') throw new Error(`방송 ID를 찾지 못함: ${JSON.stringify(res.body)}`)
  return { b, date }
}

/** 옵션 방송을 만들고 콘솔을 연다 */
export async function openOptionBroadcast(page: Page, opts: { date?: string; rehearsal?: boolean; title?: string } = {}): Promise<{ b: string; date: string }> {
  const made = await createBroadcast(page, { rehearsal: opts.rehearsal ?? true, saleMode: 'OPTIONS', ...(opts.date === undefined ? {} : { date: opts.date }), ...(opts.title === undefined ? {} : { title: opts.title }) })
  await page.goto(`/broadcasts/${encodeURIComponent(made.b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  return made
}

/** API로 옵션 상품 등록 (status를 적지 않으면 서버 기본 — 판매 중) */
export async function registerOptions(page: Page, b: string, product: { no: number; name: string; price: number; options?: OptionItem[]; stocks?: Record<string, number>; stock?: number; aliases?: string[]; status?: string }): Promise<Record<string, unknown>> {
  const res = await writeEvent(page, { type: 'product.register', b, ...product })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  return res.body
}

export const SIZES: OptionItem[] = [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }]

/** 닉네임마다 같은 가짜 채널 (sim_ + 영숫자) */
export function simChannel(nick: string): string {
  return `sim_${[...new TextEncoder().encode(nick)].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

/** 채팅 (리허설 방송) — 채널 ID로 구매자를 나눈다 */
export async function chat(page: Page, b: string, nick: string, text: string, channel = simChannel(nick)): Promise<void> {
  const res = await postJson(page, `/api/broadcasts/${b}/rehearsal/chat`, { requestId: crypto.randomUUID(), nick, text, channel })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}

export async function reviewsApi(page: Page, query: { broadcast?: string; rehearsal?: boolean } = {}): Promise<ReviewsBody> {
  const params = new URLSearchParams()
  if (query.broadcast !== undefined) params.set('broadcast', query.broadcast)
  if (query.rehearsal === true) params.set('rehearsal', 'true')
  const qs = params.toString()
  const res = await page.request.get(`/api/reviews${qs === '' ? '' : `?${qs}`}`)
  expect(res.ok(), await res.text()).toBe(true)
  return await res.json() as ReviewsBody
}

/** 확인 필요 항목이 n개가 될 때까지 (채팅은 비동기로 판정된다) */
export async function waitReviews(page: Page, b: string, rehearsal: boolean, n: number): Promise<Review[]> {
  let last: Review[] = []
  await expect.poll(async () => { last = (await reviewsApi(page, { broadcast: b, rehearsal })).reviews; return last.length }, { timeout: 15_000 }).toBe(n)
  return last
}

export interface OScope { products: OProduct[]; claims: OClaim[]; broadcasts: OBroadcast[]; buyers: OBuyer[] }
export async function oscope(page: Page, date: string, rehearsal: boolean): Promise<OScope> {
  const res = await page.request.get(`/api/days/${date}${rehearsal ? '?rehearsal=true' : ''}`)
  expect(res.ok(), await res.text()).toBe(true)
  return await res.json() as OScope
}

export async function productOf(page: Page, date: string, rehearsal: boolean, b: string, no: number): Promise<OProduct> {
  const s = await oscope(page, date, rehearsal)
  const p = s.products.find((x) => x.broadcast === b && x.no === no)
  if (p === undefined) throw new Error(`${String(no)}번 상품 없음`)
  return p
}

/** 활성 찜(확정·대기) 수가 n이 될 때까지 */
export async function waitClaims(page: Page, date: string, rehearsal: boolean, b: string, n: number): Promise<OClaim[]> {
  let last: OClaim[] = []
  await expect.poll(async () => {
    last = (await oscope(page, date, rehearsal)).claims.filter((c) => c.broadcast === b && (c.status === 'CONFIRMED' || c.status === 'WAITLISTED'))
    return last.length
  }, { timeout: 15_000 }).toBe(n)
  return last
}

export function buyerName(s: OScope, id: string): string {
  return s.buyers.find((x) => x.id === id)?.display ?? id
}

/** 확인 필요 화면 열기 */
export async function openReviews(page: Page, b: string, rehearsal: boolean): Promise<void> {
  await page.goto(`/reviews?broadcast=${encodeURIComponent(b)}${rehearsal ? '&rehearsal=true' : ''}`)
  await expect(page.getByRole('heading', { name: '확인 필요', level: 1 })).toBeVisible()
}

export function reviewList(page: Page) {
  return page.getByRole('list', { name: '확인 필요 목록' })
}

export function reviewLine(page: Page, n: number) {
  return reviewList(page).getByRole('listitem', { name: `${String(n)}번째 줄`, exact: true })
}
