// L1 E2E 공용 도우미 (test-e2e). 간편 로그인(구글·카카오·네이버) — 가짜 OAuth 서버 조작과 화면 선택자.
// 선택자는 역할·이름 기반(L1 dev-notes "시험(test-e2e)에게"), 문장은 acceptance.md "결과 문장" 표 그대로.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { fakeOAuthUrl } from '../../../apps/web/playwright.config.ts'

export { apiUrl, loginAs, loginNewSeller, newSeller, settingsRegion, type Seller } from '../i3/support.ts'

export type Provider = 'kakao' | 'naver' | 'google'
export const PROVIDERS: readonly Provider[] = ['kakao', 'naver', 'google']
export const NAME: Readonly<Record<Provider, string>> = { kakao: '카카오', naver: '네이버', google: '구글' }

/** acceptance "결과 문장" 표 */
export const MSG = {
  CANCELLED: (p: Provider) => `${NAME[p]} 로그인을 취소했어요. 다시 하려면 버튼을 눌러 주세요.`,
  EXPIRED: '로그인 요청이 오래됐거나 다른 창에서 시작한 요청이에요. 처음부터 다시 해 주세요.',
  NOT_LINKED: (p: Provider) => `이 ${NAME[p]} 계정에 연결된 라이브찜 계정이 없어요. 아이디로 로그인한 뒤 설정 → 로그인 방법에서 ${NAME[p]} 계정을 연결해 주세요.`,
  PROVIDER_ERROR: (p: Provider) => `${NAME[p]}에서 로그인을 마치지 못했어요. 잠시 뒤에 다시 해 주세요.`,
  RATE_LIMITED: '로그인 시도가 너무 많아요. 10분 뒤에 다시 해 주세요.',
  LINKED: (p: Provider) => `${NAME[p]} 계정을 연결했어요. 다음부터 "${NAME[p]}로 계속하기"로 로그인할 수 있어요.`,
  LINKED_ELSEWHERE: (p: Provider) => `이 ${NAME[p]} 계정은 이미 다른 라이브찜 계정에 연결돼 있어요. 다른 ${NAME[p]} 계정으로 해 주세요.`,
  ALREADY_LINKED: (p: Provider) => `이미 연결한 ${NAME[p]} 계정이 있어요. 바꾸려면 먼저 연결을 끊어 주세요.`,
  SESSION_GONE: '로그인이 풀려 연결하지 못했어요. 다시 로그인한 뒤 연결해 주세요.',
  UNLINKED: (p: Provider) => `${NAME[p]} 연결을 끊었어요.`,
  START_FAILED: '지금 연결하지 못했어요. 잠시 뒤에 다시 해 주세요.',
  SESSION_EXPIRED: '로그인이 풀렸어요. 다시 로그인해 주세요.',
} as const

/** 이 프로젝트 묶음의 가짜 OAuth 주소 */
export function fakeOAuth(): string {
  const url = fakeOAuthUrl(test.info().project.name)
  if (url === null) throw new Error('간편 로그인 묶음이 아니다')
  return url
}

export interface FakeUser { provider: Provider; id: string; email: string | null; nickname: string | null }

/** 가짜 공급자 사용자 만들기 (이메일·닉네임은 null이면 없음) */
export async function fakeUser(request: APIRequestContext, provider: Provider, opts: { email?: string | null; nickname?: string | null; id?: string } = {}): Promise<FakeUser> {
  const tag = Math.random().toString(36).slice(2, 8)
  const body: Record<string, unknown> = { provider }
  if (opts.id !== undefined) body['id'] = opts.id
  const email = opts.email === undefined ? `seller.${tag}@example.com` : opts.email
  const nickname = opts.nickname === undefined ? `다육이${tag}` : opts.nickname
  if (email !== null) body['email'] = email
  if (nickname !== null) body['nickname'] = nickname
  const res = await request.post(`${fakeOAuth()}/_fake/users`, { data: body })
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json() as { user: FakeUser }).user
}

export interface FakeRequest { provider: Provider; kind: 'authorize' | 'token' | 'userinfo'; at: number; params: Record<string, string | boolean> }

export async function fakeRequests(request: APIRequestContext, provider: Provider): Promise<{ requests: FakeRequest[]; exchanges: Record<Provider, number> }> {
  const res = await request.get(`${fakeOAuth()}/_fake/requests?provider=${provider}`)
  expect(res.ok()).toBe(true)
  return await res.json() as { requests: FakeRequest[]; exchanges: Record<Provider, number> }
}

export async function fakeControl(request: APIRequestContext, path: string, data: unknown): Promise<void> {
  const res = await request.post(`${fakeOAuth()}${path}`, { data })
  expect(res.ok(), `${path} ${await res.text()}`).toBe(true)
}

/** 브라우저가 가짜 승인 화면에 와 있을 때: 사용자를 골라 동의 또는 취소 */
export async function decideOnFakePage(page: Page, provider: Provider, user: FakeUser, action: 'approve' | 'cancel' = 'approve'): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`^${escapeRe(fakeOAuth())}/${provider}/authorize\\?`))
  await page.locator(`input[data-user="${user.id}"]`).check()
  await page.getByRole('button', { name: action === 'approve' ? '동의하고 계속하기' : '취소' }).click()
}

/** 로그인 화면에서 "<공>로 계속하기"를 눌러 가짜 승인 화면까지 */
export async function pressContinue(page: Page, provider: Provider): Promise<void> {
  await page.getByRole('button', { name: `${NAME[provider]}로 계속하기` }).click()
  await expect(page).toHaveURL(new RegExp(`^${escapeRe(fakeOAuth())}/${provider}/authorize\\?`))
}

export function methodsRegion(page: Page) {
  return page.getByRole('region', { name: '로그인 방법', exact: true })
}

export function methodsList(page: Page) {
  return methodsRegion(page).getByRole('list', { name: '로그인 방법 목록' })
}

/** 설정 → 로그인 방법 → [연결하기] → 가짜 승인 → 돌아와 LINKED 문장 */
export async function linkFromSettings(page: Page, provider: Provider, user: FakeUser): Promise<void> {
  await page.goto('/settings')
  await methodsRegion(page).getByRole('button', { name: `${NAME[provider]} 연결하기` }).click()
  await decideOnFakePage(page, provider, user)
  await expect(page).toHaveURL(/\/settings$/)
  await expect(methodsRegion(page).getByRole('status').filter({ hasText: MSG.LINKED(provider) })).toBeVisible()
}

/** 로그인되지 않은 채 로그인 화면 (아이디 칸이 보임) */
export async function expectLoggedOut(page: Page): Promise<void> {
  await expect(page.getByLabel('아이디')).toBeVisible()
  await expect(page.getByRole('button', { name: '로그아웃' })).toHaveCount(0)
}

/** 판매자 계정의 세션 수를 서버에 묻는 길은 없다 — 대신 /api/me로 지금 쿠키가 누구인지 */
export async function whoAmI(request: APIRequestContext): Promise<{ status: number; shop: string | null; loginId: string | null }> {
  const res = await request.get('/api/me')
  if (!res.ok()) return { status: res.status(), shop: null, loginId: null }
  const body = await res.json() as { seller?: { name?: string }; account?: { loginId?: string }; loginId?: string }
  return { status: res.status(), shop: body.seller?.name ?? null, loginId: body.account?.loginId ?? body.loginId ?? null }
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page.getByLabel('아이디')).toBeVisible()
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
export { escapeRe }
