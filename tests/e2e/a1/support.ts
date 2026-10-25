// A1 E2E 공용 도우미 (test-e2e) — AI 확인 필요 제안. 기대값은 acceptance.md(AC-A1-20~24·31)·R-20 10·D-A1-01~08에서 정했다.
// 선택자는 역할·이름 기반(A1 dev-notes "dev-web — 화면 동작"). 문장은 acceptance.md의 따옴표 그대로.
// @assist 시험은 한 서버·한 가짜 AI를 함께 쓴다 — 시험마다 새 판매자(하루 상한 3이 섞이지 않게)와 /_fake/reset.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { fakeLlmUrl } from '../../../apps/web/playwright.config.ts'
import { loginNewSeller, type Seller } from '../i3/support.ts'
import { createBroadcast, registerOptions, type OptionItem, type Review } from '../o2/support.ts'

export * from '../o2/support.ts'
export { loginAs, loginNewSeller, apiUrl } from '../i3/support.ts'

export const READING = 'AI가 읽는 중이에요…'
export const FAILED = 'AI 제안을 지금 받지 못했어요. 직접 골라 주세요.'
export const LIMIT = (limit: number): string => `오늘 AI 제안을 다 썼어요(하루 ${String(limit)}번). 비슷한 글자로 찾은 제안만 보여요.`
export const OFFER = '설정에서 AI 제안을 켤 수 있어요.'
export const NOTICE = '확인 필요 댓글의 글이 AI 회사(Anthropic, 미국)로 보내져 읽혀요. 유튜브 채팅은 보내지 않아요. 닉네임·전화번호는 빼고 보내요. 언제든 끌 수 있어요.' // QL2 D-QL2-05
export const CONSENT = '위 내용을 읽었고 동의해요'
export const SWITCH = 'AI 제안 받기'
export const UNAVAILABLE = '지금은 쓸 수 없어요.'
export const ON = (used: number, limit: number): string => `켜져 있어요 · 오늘 ${String(used)}번 썼어요 (하루 ${String(limit)}번까지)`
export const SOURCE_RULE = '비슷한 글자로 찾음'
export const SOURCE_AI = 'AI가 읽음'

/** 21 반바지 S / M(별칭 미디움) / L — AC-A1-02 재료 */
export const SHORTS_SIZES: OptionItem[] = [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['미디움'] }, { label: 'L' }] }]

export interface ReviewWithSuggestion extends Review { suggestion: { no: number; options?: Record<string, string>; qty: number; source: 'RULE' | 'AI' } | null }

export function llmUrl(): string {
  const url = fakeLlmUrl(test.info().project.name)
  if (url === null) throw new Error('AI 제안 묶음이 아니다 (@assist 태그)')
  return url
}

export interface FakeRequest { at: string; headers: Record<string, string>; body: { model?: string; temperature?: number; max_tokens?: number; system?: unknown; messages?: { role: string; content: unknown }[] } & Record<string, unknown> }

export async function fakeLlm(request: APIRequestContext, path: string, data: unknown = {}): Promise<void> {
  const res = await request.post(`${llmUrl()}${path}`, { data })
  expect(res.ok(), `${path} ${await res.text()}`).toBe(true)
}

export async function fakeRequests(request: APIRequestContext): Promise<FakeRequest[]> {
  const res = await request.get(`${llmUrl()}/_fake/requests`)
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json() as { requests: FakeRequest[] }).requests
}

/** 보낸 요청 하나의 항목 글 (body.messages[0].content의 items[].text) */
export function sentTexts(req: FakeRequest): string[] {
  const content = req.body.messages?.[0]?.content
  const raw = typeof content === 'string' ? content : Array.isArray(content) ? (content as { text?: string }[]).map((c) => c.text ?? '').join('') : ''
  const parsed = JSON.parse(raw) as { items: { text: string }[] }
  return parsed.items.map((x) => x.text)
}

export async function assistSettingsApi(page: Page): Promise<{ available: boolean; enabled: boolean; consentedAt: string | null; usedToday: number; dailyLimit: number }> {
  const res = await page.request.get('/api/assist/settings')
  expect(res.ok(), await res.text()).toBe(true)
  return await res.json() as { available: boolean; enabled: boolean; consentedAt: string | null; usedToday: number; dailyLimit: number }
}

/** API로 켜기 (동의 함께) */
export async function enableAssistApi(page: Page): Promise<void> {
  const res = await page.request.put('/api/assist/settings', { data: { enabled: true, consent: true }, headers: { Origin: new URL(page.url()).origin } })
  expect(res.status(), await res.text()).toBe(200)
}

export async function reviewsWithSuggestion(page: Page, b: string, rehearsal = true): Promise<ReviewWithSuggestion[]> {
  const res = await page.request.get(`/api/reviews?broadcast=${encodeURIComponent(b)}${rehearsal ? '&rehearsal=true' : ''}`)
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json() as { reviews: ReviewWithSuggestion[] }).reviews
}

/**
 * 새 판매자 + 판매 방식 옵션 + 옵션 리허설 방송 + 21 반바지(S/M[미디움]/L, 판매 중).
 * 브라우저 쪽에서 api.anthropic.com으로 가는 요청이 있으면 모은다(AC-A1-31).
 */
export async function assistWorld(page: Page, opts: { productName?: string; sizes?: OptionItem[] } = {}): Promise<{ seller: Seller; b: string; date: string; outbound: string[] }> {
  const outbound: string[] = []
  page.on('request', (r) => {
    if (/anthropic\.com/i.test(new URL(r.url()).hostname)) outbound.push(r.url())
  })
  const seller = await loginNewSeller(page)
  const origin = new URL(page.url()).origin
  const res = await page.request.patch('/api/settings', { data: { settings: { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } }, headers: { Origin: origin } })
  expect(res.status(), await res.text()).toBe(200)
  const made = await createBroadcast(page, { rehearsal: true, saleMode: 'OPTIONS' })
  await registerOptions(page, made.b, { no: 21, name: opts.productName ?? '반바지', price: 15000, options: opts.sizes ?? SHORTS_SIZES, stock: 3 })
  return { seller, b: made.b, date: made.date, outbound }
}

/** 화면이 부른 AI 제안 받기 요청 수 */
export function countSuggestCalls(page: Page): { readonly count: () => number } {
  let n = 0
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/assist/suggest') n += 1
  })
  return { count: () => n }
}
