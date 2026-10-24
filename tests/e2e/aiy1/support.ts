// AIY1 E2E 공용 도우미 (test-e2e) — 유튜브 채팅은 AI로 보내지 않음 (CMT-06, R-20 10, D-AIY1-01~07).
// 기대값은 harness/sprints/AIY1/acceptance.md에서 정했다(구현을 보고 정하지 않음).
// AI 제안 묶음(chromium-assist, @assist)엔 가짜 유튜브가 없다 — 유튜브 줄은 크롬 확장 경로(/ext/**, 출처 extension)로 넣는다.
// 확장 경로는 화면 프록시가 넘기지 않아 이 묶음의 서버 주소로 바로 부른다(X1 support.ts와 같은 이유, TE-X1-001).
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { SHORTS_SIZES, apiUrl, createBroadcast, loginNewSeller, postJson, registerOptions, type ReviewWithSuggestion } from '../a1/support.ts'
import type { Seller } from '../i3/support.ts'

export * from '../a1/support.ts'

export interface ReviewWithExcluded extends ReviewWithSuggestion { excluded: 'YOUTUBE_POLICY' | null }

export function todayKst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/** 유튜브 영상 번호 모양(11자) — 시험마다 다르게 */
export function videoId(): string {
  return `ai${crypto.randomUUID().replace(/-/g, '').slice(0, 9)}`
}

/** 닉네임마다 같은 유튜브 채널 ID 모양 (UC + 22자) */
export function ytChannel(nick: string): string {
  const hex = [...new TextEncoder().encode(nick)].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `UC${hex.padEnd(22, '0').slice(0, 22)}`
}

export interface ExtLink { token: string; v: string; b: string }

/** 판매자 화면에서 연결 코드 → 확장 토큰 → 그 회차에 영상 잇기 (YT-10, X1 계약) */
export async function bindExtension(page: Page, request: APIRequestContext, b: string): Promise<ExtLink> {
  const issued = await postJson(page, '/api/extension/code', {})
  expect(issued.status, JSON.stringify(issued.body)).toBe(200)
  const code = issued.body['code']
  expect(typeof code).toBe('string')
  const connected = await request.post(`${apiUrl()}/ext/connect`, { data: { code } })
  expect(connected.status(), await connected.text()).toBe(200)
  const token = (await connected.json() as { token: string }).token
  const v = videoId()
  const bound = await request.post(`${apiUrl()}/ext/bind`, { data: { v, broadcast: b }, headers: { Authorization: `Bearer ${token}` } })
  expect(bound.status(), await bound.text()).toBe(200)
  return { token, v, b }
}

let msgCounter = 0
/** 확장이 읽은 유튜브 채팅 한 줄 (출처 extension) */
export async function ytChat(request: APIRequestContext, link: ExtLink, nick: string, text: string): Promise<void> {
  msgCounter += 1
  const id = `ChwKGkNPYWl5MV8${crypto.randomUUID().replace(/-/g, '')}${String(msgCounter)}`
  const res = await request.post(`${apiUrl()}/ext/chats`, {
    data: { v: link.v, messages: [{ id, ch: ytChannel(nick), nick, text, at: Date.now() }] },
    headers: { Authorization: `Bearer ${link.token}` },
  })
  expect(res.status(), await res.text()).toBe(200)
  const body = await res.json() as { recorded: number }
  expect(body.recorded, JSON.stringify(body)).toBe(1)
}

export async function reviewsExcluded(page: Page, b: string, rehearsal: boolean): Promise<ReviewWithExcluded[]> {
  const res = await page.request.get(`/api/reviews?broadcast=${encodeURIComponent(b)}${rehearsal ? '&rehearsal=true' : ''}`)
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json() as { reviews: ReviewWithExcluded[] }).reviews
}

/**
 * 새 판매자 + 판매 방식 옵션 + **오늘 실제** 옵션 방송 + 21 반바지(S/M[미디움]/L) + 확장 잇기.
 * 브라우저 쪽에서 anthropic.com으로 가는 요청을 모은다.
 */
export async function youtubeWorld(page: Page, request: APIRequestContext): Promise<{ seller: Seller; b: string; date: string; link: ExtLink; outbound: string[] }> {
  const outbound: string[] = []
  page.on('request', (r) => {
    if (/anthropic\.com/i.test(new URL(r.url()).hostname)) outbound.push(r.url())
  })
  const seller = await loginNewSeller(page)
  const res = await page.request.patch('/api/settings', { data: { settings: { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } }, headers: { Origin: new URL(page.url()).origin } })
  expect(res.status(), await res.text()).toBe(200)
  const made = await createBroadcast(page, { date: todayKst(), rehearsal: false, saleMode: 'OPTIONS', title: 'AI 제외 1부' })
  await registerOptions(page, made.b, { no: 21, name: '반바지', price: 15000, options: SHORTS_SIZES, stock: 3 })
  const link = await bindExtension(page, request, made.b)
  return { seller, b: made.b, date: made.date, link, outbound }
}
