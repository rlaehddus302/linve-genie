// SMS3 휴대폰 알림 받기 E2E 도우미 (test-e2e).
// 가짜 기기 = 세션 쿠키 없는 새 요청 맥락이 받기 토큰 하나로 POST /api/inbox/messages (SPEC ORD-13 C-04 — 화면 주소의 /api 그대로).
// 판매자는 시험마다 새로(/_e2e/sellers) — 받기 토큰·입금 원천·입금 목록이 판매자마다라 다른 시험과 섞이지 않는다.
// 기대값(문구)은 SPEC ORD-13 "화면 문구"·acceptance.md AC-SMS3-*·DEPOSIT_RULES DP-8에서 옮긴다. 화면 코드를 보고 정하지 않는다.
import { expect, request as pwRequest, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { loginNewSeller, type Seller } from '../i3/support.ts'
import { postJson, scopeView, writeEvent } from '../s06b/support.ts'

export { loginNewSeller, type Seller } from '../i3/support.ts'
export { postJson, scopeView, writeEvent, history } from '../s06b/support.ts'
export { depositRow, depositTab, deposits, depositOne, type DepositView } from '../n3/support.ts'

export const PC = { width: 1280, height: 860 } as const
export const PHONE = { width: 375, height: 812 } as const
export type Width = 'PC' | '375'

/** KST 오늘 "YYYY-MM-DD" */
export function kstToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/** 시험마다 다른 휴대폰 번호 (뒤 4자리 고정 가능) */
export function phoneNo(last4?: string): string {
  const mid = String(2000 + Math.floor(Math.random() * 7000))
  const tail = last4 ?? String(1000 + Math.floor(Math.random() * 9000))
  return `010-${mid}-${tail}`
}

/** 새 판매자로 그 폭의 새 브라우저 맥락에서 로그인 */
export async function sellerAt(browser: Browser, baseURL: string, width: Width): Promise<{ page: Page; context: BrowserContext; seller: Seller }> {
  const viewport = width === 'PC' ? PC : PHONE
  const context = await browser.newContext({ baseURL, viewport, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...(width === '375' ? { isMobile: true, hasTouch: true } : {}) })
  const page = await context.newPage()
  const seller = await loginNewSeller(page)
  return { page, context, seller }
}

/** 같은 판매자로 다른 기기(폭) */
export async function sameSellerAt(browser: Browser, baseURL: string, seller: Seller, width: Width): Promise<Page> {
  const viewport = width === 'PC' ? PC : PHONE
  const context = await browser.newContext({ baseURL, viewport, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...(width === '375' ? { isMobile: true, hasTouch: true } : {}) })
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('아이디').fill(seller.loginId)
  await page.getByLabel('비밀번호').fill(seller.password)
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page.getByRole('navigation', { name: '메뉴' })).toBeVisible()
  return page
}

// ── 설정 "휴대폰 알림 받기" ──────────────────────────────────────────────

export function inboxSection(page: Page): Locator {
  return page.getByRole('region', { name: '휴대폰 알림 받기' })
}

/** 설정 화면에서 "켜고 받기 열쇠 만들기"를 눌러 한 번 보이는 토큰을 읽는다 */
export async function makeTokenOnScreen(page: Page): Promise<string> {
  await page.goto('/settings/inbox')
  const section = inboxSection(page)
  await section.getByRole('button', { name: '켜고 받기 열쇠 만들기' }).click()
  const box = section.getByRole('textbox', { name: '받기 열쇠' })
  await expect(box).toBeVisible()
  const token = await box.inputValue()
  expect(token.length, '받기 토큰이 비었다').toBeGreaterThan(15)
  return token
}

/** API로 토큰 만들기 (설정 화면 흐름을 따로 보는 시험이 아닐 때) */
export async function makeTokenApi(page: Page): Promise<string> {
  if (!page.url().startsWith('http')) await page.goto('/')
  const res = await postJson(page, '/api/inbox/token', {})
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  const token = res.body['token']
  if (typeof token !== 'string') throw new Error(JSON.stringify(res.body))
  return token
}

// ── 가짜 기기 ────────────────────────────────────────────────────────────

export interface InboxMessage {
  id?: string
  channel: 'SMS' | 'APP'
  from: string | null
  title?: string | null
  text: string
  receivedAt?: string | number | null
}

export interface Device {
  /** 메시지 보내기 → { status, body } */
  send(messages: InboxMessage[], opts?: { token?: string | null; device?: string }): Promise<{ status: number; body: Record<string, unknown> }>
  /** 손님 문자 한 통 — SAVED여야 한다 */
  sms(from: string | null, text: string, expectStatus?: string): Promise<string>
  dispose(): Promise<void>
}

let seq = 0
/** 가짜 기기 (쿠키·Origin 없는 새 요청 맥락 — 화면 주소의 /api) */
export async function fakeDevice(baseURL: string, token: string, name = '김사장 갤럭시'): Promise<Device> {
  const ctx: APIRequestContext = await pwRequest.newContext({ baseURL })
  const device: Device = {
    async send(messages, opts = {}) {
      const tk = opts.token === undefined ? token : opts.token
      const body = {
        device: opts.device ?? name,
        messages: messages.map((m) => {
          seq += 1
          return { id: m.id ?? `e2e-${String(Date.now())}-${String(seq)}`, channel: m.channel, from: m.from, title: m.title ?? null, text: m.text, receivedAt: m.receivedAt === undefined ? new Date().toISOString() : m.receivedAt }
        }),
      }
      const res = await ctx.post('/api/inbox/messages', { data: body, headers: { 'content-type': 'application/json', ...(tk === null ? {} : { authorization: `Bearer ${tk}` }) } })
      let json: Record<string, unknown>
      try {
        json = (await res.json()) as Record<string, unknown>
      } catch {
        json = {}
      }
      return { status: res.status(), body: json }
    },
    async sms(from, text, expectStatus = 'SAVED') {
      seq += 1
      const id = `e2e-sms-${String(Date.now())}-${String(seq)}`
      const res = await device.send([{ id, channel: 'SMS', from, text }])
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect((res.body['results'] as { id: string; status: string }[])[0]?.status, `${text}: ${JSON.stringify(res.body)}`).toBe(expectStatus)
      return id
    },
    dispose: () => ctx.dispose(),
  }
  return device
}

// ── 방송·상품 ────────────────────────────────────────────────────────────

/** 오늘 실제 방송 하나 (API). 화면은 옮기지 않는다 */
export async function realBroadcast(page: Page, title = '1부', date = kstToday()): Promise<string> {
  if (!page.url().startsWith('http')) await page.goto('/')
  const res = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), date, rehearsal: false, title })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  const body = res.body as Record<string, Record<string, unknown> | undefined>
  const b = body['result']?.['b'] ?? body['broadcast']?.['id'] ?? res.body['b'] ?? res.body['id']
  if (typeof b !== 'string') throw new Error(JSON.stringify(res.body))
  return b
}

/** 상품 등록 + 판매 중으로 (공개) */
export async function onSale(page: Page, b: string, no: number, name: string, price: number): Promise<void> {
  const reg = await writeEvent(page, { type: 'product.register', b, no, name, price })
  expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
  const open = await writeEvent(page, { type: 'product.open', b, no })
  expect(open.status, JSON.stringify(open.body)).toBeLessThan(300)
}

/** 콘솔 열기 (보드가 보일 때까지) */
export async function openConsole(page: Page, b: string): Promise<void> {
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByRole('region', { name: '상품 보드' })).toBeVisible()
}

export function boardItem(page: Page, no: number): Locator {
  return page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: new RegExp(`^${String(no)}번 `) })
}

export function inboxPanel(page: Page): Locator {
  return page.getByRole('region', { name: '문자 확인' })
}

/** 문자 확인 칸의 카드 (본문 글로 찾는다) */
export function inboxCard(page: Page, text: string): Locator {
  return inboxPanel(page).getByRole('listitem').filter({ hasText: text })
}

/** 그 범위의 찜 중 그 번호 */
export async function claimsOf(page: Page, date: string, no: number) {
  return (await scopeView(page, date, false)).claims.filter((c) => c.no === no)
}

/** 그 구매자 표시 이름으로 지금의 구매자 */
export async function buyerByDisplay(page: Page, date: string, display: string) {
  const view = await scopeView(page, date, false)
  return view.buyers.find((x) => x.display === display)
}

/** 화면 글에 영어 상태값·개발 용어가 없다 (보이는 글 innerText) — 이번 스프린트가 더한 곳만. 2라운드(D-SMS3-27·29~31): LATE·REJECTED·INBOX_OFF 등 더함 */
export const DEV_WORDS = /\b(REVIEW|CANCEL|UNCLEAR|NO_NUMBER|OPTIONS|NOT_ON_SALE|UNTRUSTED_SOURCE|BALANCE_GAP|ONE_MATCH|SAVED|IGNORED|DUPLICATE|PHONE|TOKEN_INVALID|AUTO_APPLIED|APPLIED|UNREADABLE|DEPOSIT|WITHDRAWAL|SMS|APP|LATE|REJECTED|INBOX_OFF|TOO_MANY|STATE_FORMAT|SEALED|INVALID_INPUT|NOT_SUPPORTED|REQUEST_ERROR|INTERNAL_ERROR|staleBroadcast|StaleNotice|CANCEL_NOTICE|null|undefined|true|false|NaN|ibx_\w*|ic_\w*|inbox|Invalid Date)\b|토큰/

export async function expectNoDevWords(where: Locator, label: string): Promise<void> {
  const text = await where.evaluate((el) => (el as HTMLElement).innerText)
  expect(text.match(DEV_WORDS)?.[0] ?? null, `${label}: 영어 상태값·개발 용어가 보인다 — ${text.slice(0, 400)}`).toBeNull()
}

/** 누르는 것의 높이 (px) */
export async function heightOf(target: Locator): Promise<number> {
  const box = await target.boundingBox()
  if (box === null) throw new Error('보이지 않는다')
  return box.height
}

export function won(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`
}
