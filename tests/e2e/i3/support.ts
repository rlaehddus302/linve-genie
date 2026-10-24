// I3 E2E 공용 도우미 (test-e2e). S05·S06 도우미 위에 새 판매자 계정·가짜 유튜브 조작·설정 화면 선택자를 더한다.
// 선택자는 역할·이름 기반(I3 dev-notes "테스트(test-e2e)에게"), 문장은 acceptance.md 그대로.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { STACKS, fakeYoutubeUrl } from '../../../apps/web/playwright.config.ts'
import { postJson } from '../s05/support.ts'

export * from '../s06/support.ts'

/** 이 프로젝트 묶음의 서버 주소 (시험용 조작 /_e2e/*) */
export function apiUrl(): string {
  const stack = STACKS.find((s) => s.name === test.info().project.name)
  if (stack === undefined) throw new Error('묶음 없음')
  return `http://127.0.0.1:${String(stack.api)}`
}

/** 화면 프록시를 거치지 않는 서버 주소 (세션 쿠키는 localhost에 걸려 있어 포트가 달라도 실린다 — 많이 부르는 조회용) */
export function directApi(): string {
  const stack = STACKS.find((s) => s.name === test.info().project.name)
  if (stack === undefined) throw new Error('묶음 없음')
  return `http://localhost:${String(stack.api)}`
}

/** 이 프로젝트 묶음의 가짜 유튜브 주소 */
export function fakeUrl(): string {
  const url = fakeYoutubeUrl(test.info().project.name)
  if (url === null) throw new Error('가짜 유튜브 묶음이 아니다')
  return url
}

export interface Seller { loginId: string; password: string; shopName: string }

/** 방송이 하나도 없는 새 판매자 (마법사 "처음") */
export async function newSeller(request: APIRequestContext): Promise<Seller> {
  const res = await request.post(`${apiUrl()}/_e2e/sellers`, { data: {} })
  expect(res.ok(), await res.text()).toBe(true)
  return await res.json() as Seller
}

export async function e2eDate(request: APIRequestContext, loginId: string, kind: 'sealed' | 'sealSoon' | 'youtube', date?: string): Promise<{ date: string; broadcast: string; sealed: boolean }> {
  const res = await request.post(`${apiUrl()}/_e2e/dates`, { data: { loginId, kind, ...(date === undefined ? {} : { date }) } })
  expect(res.ok(), await res.text()).toBe(true)
  const body = await res.json() as { date: string; broadcast: unknown; sealed: boolean }
  const b = typeof body.broadcast === 'string' ? body.broadcast : (body.broadcast as { id: string }).id
  return { date: body.date, broadcast: b, sealed: body.sealed }
}

export async function sealNow(request: APIRequestContext, loginId: string, date: string): Promise<void> {
  const res = await request.post(`${apiUrl()}/_e2e/seal`, { data: { loginId, date } })
  expect(res.ok(), await res.text()).toBe(true)
}

/** 로그인 화면에서 그 계정으로 로그인 (마법사가 열리든 아니든 로그아웃 버튼까지) */
export async function loginAs(page: Page, account: { loginId: string; password: string }, path = '/'): Promise<void> {
  await page.goto(path)
  await page.getByLabel('아이디').fill(account.loginId)
  await page.getByLabel('비밀번호').fill(account.password)
  await page.getByRole('button', { name: '로그인' }).click()
  // MOB1 D-MOB1-05: 휴대폰 판매자는 위 줄에 "로그아웃"이 없다 — 로그인 확인은 메뉴로
  await expect(page.getByRole('navigation', { name: '메뉴' })).toBeVisible()
}

/** 새 판매자로 로그인하고 마법사를 닫아 둔다 (마법사가 아닌 시험용) */
export async function loginNewSeller(page: Page): Promise<Seller> {
  const seller = await newSeller(page.request)
  await loginAs(page, seller, '/settings')
  const res = await page.request.put('/api/wizard', { data: { status: 'DONE' }, headers: { Origin: new URL(page.url()).origin } })
  expect(res.ok(), await res.text()).toBe(true)
  return seller
}

// ── 가짜 유튜브 ─────────────────────────────────────────────────────────

export async function fake<T = Record<string, unknown>>(request: APIRequestContext, path: string, data: unknown = {}): Promise<T> {
  const res = await request.post(`${fakeUrl()}${path}`, { data })
  expect(res.ok(), `${path} ${await res.text()}`).toBe(true)
  return await res.json() as T
}

export interface FakeState { posted: { liveChatId: string; id: string; text: string; authorChannelId: string }[]; comments: { text: string }[]; calls: Record<string, number>; messages?: unknown[] }

export async function fakeState(request: APIRequestContext, liveChatId?: string): Promise<FakeState> {
  const res = await request.get(`${fakeUrl()}/_fake/state${liveChatId === undefined ? '' : `?liveChatId=${encodeURIComponent(liveChatId)}`}`)
  expect(res.ok()).toBe(true)
  return await res.json() as FakeState
}

/** 가짜 채널을 만들고 다음 승인을 그 채널로 */
export async function fakeChannel(request: APIRequestContext, title = '테스트 채널'): Promise<{ id: string; title: string; account: string }> {
  const channel = await fake<{ id: string; title: string; account: string }>(request, '/_fake/channels', { title })
  await fake(request, '/_fake/approval', { account: channel.account, channel: channel.id })
  return channel
}

export async function fakeBroadcast(request: APIRequestContext, channelId: string, opts: { title?: string; status?: 'live' | 'upcoming' | 'complete'; chat?: boolean } = {}): Promise<{ videoId: string; liveChatId: string }> {
  return await fake(request, '/_fake/broadcasts', { channelId, status: opts.status ?? 'live', ...(opts.title === undefined ? {} : { title: opts.title }), ...(opts.chat === false ? { chat: false } : {}) })
}

export async function fakeChat(request: APIRequestContext, liveChatId: string, author: string, name: string, text: string): Promise<string> {
  const { id } = await fake<{ id: string }>(request, '/_fake/messages', { liveChatId, author, name, text })
  return id
}

export function settingsRegion(page: Page, title: string) {
  return page.getByRole('region', { name: title, exact: true })
}

/** 설정 → 유튜브 칸에서 가짜 승인으로 연결 (돌아와 "유튜브 채널을 연결했어요."까지) */
export async function connectYoutube(page: Page, title = '테스트 채널'): Promise<{ id: string; title: string; account: string }> {
  const channel = await fakeChannel(page.request, title)
  await page.goto('/settings/youtube')
  const yt = settingsRegion(page, '유튜브')
  await yt.getByRole('button', { name: '구글로 유튜브 연결하기' }).click()
  await expect(page.getByText('유튜브 채널을 연결했어요.')).toBeVisible()
  await expect(yt.getByText('읽기 권한 있음')).toBeVisible()
  return channel
}

/** 실시간 채팅 자동 게시 동의 (설명 창 → 동의해요 → (글쓰기 권한 승인) → 켜짐) */
export async function consentLiveChat(page: Page, channel: { id: string; account: string }): Promise<void> {
  await fake(page.request, '/_fake/approval', { account: channel.account, channel: channel.id })
  await page.goto('/settings')
  const thanks = settingsRegion(page, '구매 감사 메시지')
  await thanks.getByRole('button', { name: '실시간 채팅 자동 게시 켜기' }).click()
  await page.getByRole('dialog', { name: '실시간 채팅 자동 게시' }).getByRole('button', { name: '동의해요' }).click()
  await expect(settingsRegion(page, '구매 감사 메시지').getByRole('button', { name: '실시간 채팅 자동 게시 끄기' })).toBeVisible()
}

/** API로 실제 방송을 만들고 콘솔을 연다 */
export async function openRealBroadcast(page: Page, opts: { date?: string; title?: string } = {}): Promise<{ b: string; date: string }> {
  const date = opts.date ?? todayKstLocal()
  const res = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), date, rehearsal: false, ...(opts.title === undefined ? {} : { title: opts.title }) })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  const b = (res.body['broadcast'] as { id: string } | undefined)?.id ?? (res.body['result'] as { b?: string } | undefined)?.b
  if (typeof b !== 'string') throw new Error(JSON.stringify(res.body))
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  return { b, date }
}

function todayKstLocal(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function consoleYoutube(page: Page) {
  return page.getByRole('region', { name: '유튜브', exact: true })
}

/** 콘솔에서 주소 붙여넣기로 잇기 */
export async function linkByAddress(page: Page, videoId: string): Promise<void> {
  const yt = consoleYoutube(page)
  const field = yt.getByLabel('주소 붙여넣기')
  await field.fill(`https://www.youtube.com/watch?v=${videoId}`)
  await field.press('Enter')
  await expect(yt.getByText(`읽은 영상: ${videoId}`)).toBeVisible()
  await yt.getByRole('button', { name: '이 방송에 잇기' }).last().click()
  await expect(yt.getByRole('group', { name: '채팅 수집' })).toBeVisible()
}

export interface OutboxRowLite { id: number; target: string; state: string; reason: string | null; text: string; dismissed?: boolean; confirmedBySeller?: boolean; groupWith: number[] }

export async function outboxRows(page: Page, date: string): Promise<OutboxRowLite[]> {
  const res = await page.request.get(`/api/days/${date}/outbox`)
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json() as { rows: OutboxRowLite[] }).rows
}

export function alertStrip(page: Page) {
  return page.getByRole('region', { name: '알림' })
}
