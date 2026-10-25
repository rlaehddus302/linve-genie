// V3 E2E 공용 도우미 (test-e2e): 음성 바로 등록(VOC-04·PRD-06, R-17 8·R-22). I4 가짜 인식 계약 그대로(addInitScript).
// 사례 표(harness/sprints/V3/acceptance.md)의 "중간 결과 꼴": 문장을 공백으로 나눈 토큰 t1 … tn에서 결과 k(< n)는 t1 … tk 중간 결과,
// 결과 n은 전체 최종 결과, 결과 사이 200ms. 시계는 page.clock을 멈춘 뒤 runFor로만 흐른다.
// 설정은 기본값(바로 등록 켬, D-V3-16) — 시험이 따로 넣지 않으면 저장값 없음.
import { expect, type Page, type Request } from '@playwright/test'
import { loginNewSeller } from '../i3/support.ts'
import { cardList, installFakeSpeech, openExtras, openNewBroadcast, speak, turnOnVoice, uniqueDate } from '../i4/support.ts'

export * from '../v2/support.ts'

/** 결과 사이 (사례 표) */
export const GAP_MS = 200
/** 기본 조용한 시간 (D-V2-03) */
export const QUIET_MS = 1800

export interface V3Setup {
  readonly b: string
  readonly date: string
}

/** 새 판매자 → 리허설 방송 콘솔 → (상품 미리 등록) → 음성 켜기 → 이력 2초 기다림 지남 → 시계 멈춤 */
export async function setupV3(
  page: Page,
  opts: { width?: number; settings?: unknown; consent?: boolean; before?: (s: V3Setup) => Promise<void>; sellerSettings?: Record<string, unknown> } = {},
): Promise<V3Setup> {
  await installFakeSpeech(page, { consent: opts.consent ?? true, autoRegister: true, ...(opts.settings === undefined ? {} : { settings: opts.settings }) })
  await page.setViewportSize({ width: opts.width ?? 1440, height: 900 })
  await page.clock.install()
  await loginNewSeller(page)
  if (opts.sellerSettings !== undefined) {
    // 판매 규칙은 다음 방송부터 — 방송을 만들기 전에 바꾼다
    const res = await page.request.patch('/api/settings', { data: { settings: opts.sellerSettings }, headers: { Origin: new URL(page.url()).origin } })
    expect(res.ok(), await res.text()).toBe(true)
  }
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  if (opts.before !== undefined) await opts.before({ b, date })
  await turnOnVoice(page)
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(now + 1000)
  // 판매 이력을 받는 2초(AC-V3-43 b)를 넘겨 둔다 — 그 동안의 문장은 미뤄진다
  await page.clock.runFor(2500)
  return { b, date }
}

export interface Write {
  readonly type: string
  readonly body: Record<string, unknown>
  readonly url: string
}

/** 서버로 간 쓰기(POST /api/events) — 상품 등록·고치기·닫기만이 아니라 모든 종류 */
export function recordWrites(page: Page): Write[] {
  const out: Write[] = []
  page.on('request', (request: Request) => {
    if (request.method() !== 'POST') return
    const url = new URL(request.url())
    if (url.pathname !== '/api/events') return
    let body: Record<string, unknown>
    try {
      body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>
    } catch {
      body = {}
    }
    out.push({ type: String(body['type'] ?? ''), body, url: request.url() })
  })
  return out
}

/** 상품 쓰기(등록·고치기·닫기)만 [type, no, name?, price?] */
export function productWrites(writes: readonly Write[]): unknown[][] {
  return writes
    .filter((w) => w.type.startsWith('product.'))
    .map((w) => {
      const row: unknown[] = [w.type, w.body['no']]
      if ('name' in w.body) row.push(w.body['name'])
      if ('price' in w.body) row.push(w.body['price'])
      return row
    })
}

/**
 * 사례 표 꼴로 한 문장을 말한다: 결과 1…n-1 중간, 결과 n 최종, 사이 200ms. afterEach(k)는 결과 k를 넣은 바로 뒤.
 * final: false면 마지막도 중간 결과로 둔다(사파리처럼).
 */
export async function sayWords(page: Page, sentence: string, opts: { afterEach?: (k: number, n: number) => Promise<void>; final?: boolean } = {}): Promise<void> {
  const tokens = sentence.split(/\s+/).filter((t) => t !== '')
  const n = tokens.length
  for (let k = 1; k <= n; k += 1) {
    if (k > 1) await page.clock.runFor(GAP_MS)
    const last = k === n
    await speak(page, tokens.slice(0, k).join(' '), { final: last ? opts.final ?? true : false })
    if (opts.afterEach !== undefined) await opts.afterEach(k, n)
  }
}

/** 문장 하나를 말하고 조용한 시간까지 흘려 덩어리를 끝낸다 */
export async function sayChunk(page: Page, sentence: string): Promise<void> {
  await sayWords(page, sentence)
  await page.clock.runFor(QUIET_MS + 100)
}

/** 큰 글자 칸의 결과 한 줄 (4초) */
export function readout(page: Page) {
  return page.getByRole('region', { name: '지금 들리는 말', exact: true }).getByRole('status')
}

/** 알림·묻기 카드 목록 */
export function notices(page: Page) {
  return page.getByRole('list', { name: '방금 등록한 상품 고치기' })
}

export function notice(page: Page, message: string) {
  return notices(page).getByRole('listitem', { name: message, exact: true })
}

/** 음성 카드 개수 (카드 목록이 없으면 0) */
export function voiceCards(page: Page) {
  return cardList(page).getByRole('listitem')
}

/** 빠른 입력 아래 "보내기 전 조치" 띠 */
export function undoBar(page: Page) {
  return page.getByRole('region', { name: '보내기 전 조치' })
}

/** 음성 설정의 바로 등록 체크 (D-V3-17) */
export async function instantBox(page: Page) {
  return (await openExtras(page)).getByRole('checkbox', { name: '번호와 가격이 들리면 바로 등록' })
}

/** API로 상품 등록 (음성 켜기 전 준비) */
export async function registerProduct(page: Page, b: string, no: number, name: string, price: number): Promise<void> {
  const res = await page.request.post('/api/events', {
    data: { requestId: crypto.randomUUID(), type: 'product.register', b, no, name, price },
    headers: { Origin: new URL(page.url()).origin },
  })
  expect(res.status(), await res.text()).toBeLessThan(300)
}

/** 리허설 채팅으로 1등 찜 하나 */
export async function claimOne(page: Page, b: string, no: number, nick = '찜손님'): Promise<void> {
  const res = await page.request.post(`/api/broadcasts/${b}/rehearsal/chat`, {
    data: { requestId: crypto.randomUUID(), nick, text: String(no), channel: `sim_v3c${String(no)}${String(Math.floor(Math.random() * 1e8))}` },
    headers: { Origin: new URL(page.url()).origin },
  })
  expect(res.status(), await res.text()).toBeLessThan(300)
}

/** 앞서 보낸 일(마이크로태스크·fetch 시작)이 끝나도록 페이지와 한 번 주고받는다 — 시계는 흐르지 않는다 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => Promise.resolve())
  await page.evaluate(() => Promise.resolve())
}

/** 시험 동안 서버로 간 모든 요청 본문·주소 (받아쓴 글이 가지 않는지, 가격 30000·50000이 없는지) */
export function recordAllBodies(page: Page): string[] {
  const out: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (!url.includes('/api/')) return
    out.push(`${decodeURIComponent(url)} ${request.postData() ?? ''}`)
  })
  return out
}
