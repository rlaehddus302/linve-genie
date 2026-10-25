// CRM1 E2E 공용 도우미 (test-e2e) — 노쇼·단골 관리(손님 기록·꼬리표·메모·"모든 손님"·콘솔 주의 꼬리표).
// 손님 기록은 판매자의 모든 실제 날짜를 넘어 모이므로, 시험마다 새 판매자(/_e2e/sellers)로 시작한다 — 다른 시험의 방송이 섞이지 않게.
// 실제 날짜의 유튜브 구매자는 시험 모드 경로 POST /api/deposits/test/chat(수집 함수 그대로, N3 dev-notes)로 만든다.
// 기대값은 acceptance.md(AC-CRM1-*)와 D-CRM1-*에서 옮긴다. 선택자는 역할·이름(dev-notes "화면 계약").
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { loginNewSeller, type Seller } from '../i3/support.ts'
import { history, postJson, registerApi, scopeView, smsApi, writeEvent } from '../s06b/support.ts'

export * from '../s06b/support.ts'
export { loginNewSeller, type Seller } from '../i3/support.ts'

/** KST "YYYY-MM-DD" (오늘에서 days일 전) */
export function kstDate(daysAgo: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - daysAgo * 86_400_000))
}

const WEEK = '일월화수목금토'
/** 손님 기록의 날짜 문장 (D-CRM1-06) — 올해면 "10월 15일(목)", 아니면 "2025년 12월 29일(월)". 올해 = 오늘(KST)의 연도 */
export function customerDateKo(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const dow = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!
  const thisYear = Number(kstDate(0).slice(0, 4))
  return `${y === thisYear ? '' : `${String(y)}년 `}${String(m)}월 ${String(d)}일(${dow})`
}

export function won(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`
}

/** 방송(실제·리허설)을 API로 만든다 — 화면은 옮기지 않는다 */
export async function broadcast(page: Page, date: string, rehearsal = false, title = '1부'): Promise<string> {
  const res = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), date, rehearsal, title })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  const body = res.body as Record<string, Record<string, unknown> | undefined>
  const b = body['result']?.['b'] ?? body['broadcast']?.['id'] ?? res.body['b'] ?? res.body['id']
  if (typeof b !== 'string') throw new Error(JSON.stringify(res.body))
  return b
}

let msg = 0
/** 실제(또는 리허설) 방송에 시청자 채팅 한 줄 (유튜브 수집 경로) */
export async function chat(page: Page, b: string, ch: string, nick: string, text: string): Promise<void> {
  msg += 1
  const res = await postJson(page, '/api/deposits/test/chat', { b, id: `crm1-${String(Date.now())}-${String(msg)}`, ch, nick, text })
  expect([res.status, res.body['recorded']], JSON.stringify(res.body)).toEqual([200, true])
}

/** 그 범위에서 구매자의 지금의 구매자 ID (유튜브 = 채널 ID로 찾는다) */
export async function currentOf(page: Page, date: string, rehearsal: boolean, id: string): Promise<string> {
  const view = await scopeView(page, date, rehearsal)
  const b = view.buyers.find((x) => x.id === id)
  if (b === undefined) throw new Error(`구매자 ${id} 없음`)
  return b.current ?? b.id
}

/** 범위의 묶음 정산 (지금의 구매자) */
export async function settlementOf(page: Page, date: string, buyer: string, rehearsal = false) {
  const s = (await scopeView(page, date, rehearsal)).settlements.find((x) => x.buyer === buyer)
  if (s === undefined) throw new Error(`정산 ${buyer} 없음`)
  return s
}

/** 묶음 전체(배송비 포함)를 입금으로 적는다 → 입금 완료 */
export async function payAll(page: Page, date: string, buyer: string, rehearsal = false): Promise<void> {
  const s = await settlementOf(page, date, buyer, rehearsal)
  const due = s.total - s.received
  expect(due, JSON.stringify(s)).toBeGreaterThan(0)
  const res = await writeEvent(page, { type: 'settlement.payment', buyer, date, amount: due }, { date, rehearsal })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  await expect.poll(async () => (await settlementOf(page, date, buyer, rehearsal)).payment).toBe('PAID')
}

export interface Sale { b: string; date: string; buyer: string }

/**
 * 실제 날짜 하나에 유튜브 시청자(채널 ch)가 상품들을 1등으로 찜한다. prices 합 = 상품 합계.
 * paid면 묶음 전체를 입금 완료로 적는다. 같은 날짜에 이미 방송이 있으면 b를 넘긴다.
 */
export async function youtubeSale(page: Page, opts: { date: string; ch: string; nick: string; prices: number[]; paid: boolean; b?: string; firstNo?: number }): Promise<Sale> {
  const b = opts.b ?? (await broadcast(page, opts.date))
  let no = opts.firstNo ?? 10 + Math.floor(Math.random() * 80) * 10
  for (const price of opts.prices) {
    await registerApi(page, b, no, `상품${String(no)}`, price)
    await chat(page, b, opts.ch, opts.nick, String(no))
    no += 1
  }
  await expect.poll(async () => (await scopeView(page, opts.date, false)).buyers.find((x) => x.id === opts.ch)?.subtotal ?? -1).toBeGreaterThanOrEqual(opts.prices.reduce((a, c) => a + c, 0))
  const buyer = await currentOf(page, opts.date, false, opts.ch)
  if (opts.paid) await payAll(page, opts.date, buyer)
  return { b, date: opts.date, buyer }
}

/** 실제 날짜에 문자찜(전화번호 또는 메모) 한 건씩 — 구매자 ID */
export async function smsSale(page: Page, opts: { date: string; phone?: string; memo?: string; prices: number[]; paid: boolean; b?: string; firstNo?: number }): Promise<Sale> {
  const b = opts.b ?? (await broadcast(page, opts.date))
  let no = opts.firstNo ?? 500 + Math.floor(Math.random() * 40) * 10
  let buyer: string | null = null
  for (const price of opts.prices) {
    await registerApi(page, b, no, `상품${String(no)}`, price)
    await smsApi(page, { b, no, ...(opts.phone === undefined ? {} : { phone: opts.phone }), ...(opts.memo === undefined ? {} : { memo: opts.memo }) })
    const view = await scopeView(page, opts.date, false)
    const claim = view.claims.filter((c) => c.no === no).sort((x, y) => y.seq - x.seq)[0]
    if (claim === undefined) throw new Error(`찜 ${String(no)} 없음`)
    buyer = claim.currentBuyer
    no += 1
  }
  if (buyer === null) throw new Error('찜 없음')
  if (opts.paid) await payAll(page, opts.date, buyer)
  return { b, date: opts.date, buyer }
}

/** 손님 관리 설정 (API) */
export async function customerSettings(page: Page, settings: { regularCount: number; regularAmount: number | null; waitDays: number }): Promise<void> {
  const res = await page.request.put('/api/customer-settings', { data: settings, headers: { Origin: new URL(page.url()).origin } })
  expect(res.ok(), await res.text()).toBe(true)
}

export interface DayCustomer { buyer: string; purchaseDays: number; purchaseTotal: number; lastPurchase: string | null; unpaidDays: number; lastUnpaid: string | null; cancels: number; regular: boolean; caution: boolean }

export async function dayCustomers(page: Page, date: string): Promise<{ today: string; customers: DayCustomer[] }> {
  const res = await page.request.get(`/api/days/${date}/customers`)
  expect(res.ok(), await res.text()).toBe(true)
  return await res.json() as { today: string; customers: DayCustomer[] }
}

/** 판매자의 모든 범위 이벤트 수 (날짜 목록 — 실제·리허설) */
export async function eventCount(page: Page, dates: readonly { date: string; rehearsal: boolean }[]): Promise<number> {
  let n = 0
  for (const d of dates) n += (await history(page, d.date, d.rehearsal)).length
  return n
}

/** 새 판매자로 새 브라우저 컨텍스트(폭 지정)에서 로그인 */
export async function sellerOn(browser: Browser, baseURL: string, viewport: { width: number; height: number }): Promise<{ page: Page; context: BrowserContext; seller: Seller }> {
  const context = await browser.newContext({ baseURL, viewport, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  const page = await context.newPage()
  const seller = await loginNewSeller(page)
  return { page, context, seller }
}

/** 같은 판매자로 다른 컨텍스트(다른 기기)에서 로그인 */
export async function sameSellerOn(browser: Browser, baseURL: string, seller: Seller, viewport: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('아이디').fill(seller.loginId)
  await page.getByLabel('비밀번호').fill(seller.password)
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page.getByRole('navigation', { name: '메뉴' })).toBeVisible()
  return page
}

/** 구매자 목록 (휴대폰 list / PC table) */
export function buyerRows(page: Page) {
  const wide = (page.viewportSize()?.width ?? 0) >= 768
  return wide ? page.getByRole('table', { name: '구매자' }).locator('tbody tr') : page.getByRole('list', { name: '구매자' }).getByRole('listitem')
}

export function customerRows(page: Page) {
  const wide = (page.viewportSize()?.width ?? 0) >= 768
  return wide ? page.getByRole('table', { name: '손님' }).locator('tbody tr') : page.getByRole('list', { name: '손님' }).getByRole('listitem')
}

/**
 * 가로 스크롤 0(문서 전체) · roots 안의 누르는 것 44px 이상 · 글자 잘림(가로 넘침) 없음 · 화면 밖으로 나간 단추 없음 (AC-CRM1-28).
 * roots = 이번 스프린트가 더한 곳(손님 기록 칸·정렬·거르기·모든 손님·손님 관리)만 — 다른 스프린트 화면은 그 스프린트 시험이 본다.
 */
export async function phoneLayoutOk(page: Page, where: string, roots: readonly string[]): Promise<void> {
  const report = await page.evaluate((sels) => {
    const out: string[] = []
    const doc = document.documentElement
    if (doc.scrollWidth > doc.clientWidth) out.push(`가로 스크롤 ${String(doc.scrollWidth)} > ${String(doc.clientWidth)}`)
    const scopes = sels.flatMap((sel) => Array.from(document.querySelectorAll<HTMLElement>(sel)))
    if (scopes.length === 0) out.push(`잴 곳 없음: ${sels.join(', ')}`)
    for (const scope of scopes) {
      for (const el of Array.from(scope.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]), textarea, select'))) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)
        if (r.height < 43.5) out.push(`작은 누름 ${String(Math.round(r.height))}px: ${name}`)
        if (r.right > doc.clientWidth + 0.5 || r.left < -0.5) out.push(`화면 밖: ${name}`)
      }
      for (const el of Array.from(scope.querySelectorAll<HTMLElement>('*'))) {
        if ((el.textContent ?? '').trim() === '') continue
        const style = getComputedStyle(el)
        if (style.display === 'inline') continue
        if (el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'auto' && style.overflowX !== 'scroll') out.push(`잘림: ${(el.textContent ?? '').trim().slice(0, 30)}`)
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.right > doc.clientWidth + 0.5) out.push(`화면 밖 글: ${(el.textContent ?? '').trim().slice(0, 30)}`)
      }
    }
    return [...new Set(out)]
  }, roots)
  expect(report, where).toEqual([])
}

export { bigText, expectBig } from '../mob1/support.ts'
