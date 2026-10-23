// N2b-2 E2E 공용 도우미 (test-e2e). 여러 플랫폼 묶음(chromium-multi — 제목에 @multi)에서 돈다.
// 가짜 웹캐스트(틱톡) 조작은 서버 주소의 /_e2e/tiktok/*, 가짜 메타(인스타그램)는 /_fake/*. 문장은 acceptance.md 그대로.
// 틱톡 연결은 판매자마다 하나라 시험마다 새 판매자·새 틱톡 아이디를 쓴다.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { fakeMetaUrl } from '../../../apps/web/playwright.config.ts'
import { apiUrl, loginNewSeller, postJson, type Seller } from '../i3/support.ts'

export * from '../i3/support.ts'

/** 고지 문장 (AC-N2b-2-20 — 판 TT-BETA-1) */
export const NOTICE_TITLE = '틱톡 라이브 연결(베타) 안내'
export const NOTICE_LINES = [
  '틱톡은 라이브 댓글을 읽는 공식 방법을 주지 않아요. 라이브지니는 누구나 볼 수 있는 내 라이브의 댓글을 비공식 방법으로 읽어요.',
  '틱톡이 이 방법을 막거나 바꾸면 언제든 댓글이 들어오지 않을 수 있어요. 그때는 댓글을 직접 붙여 넣어 주세요.',
  '틱톡 이용약관은 자동으로 정보를 모으는 것을 막고 있을 수 있어요. 시험 중인 기능이라 문제가 생기면 운영자가 언제든 끌 수 있어요.',
  '라이브지니는 틱톡에 글을 올리지 않아요. 감사 메시지도 틱톡에는 보내지 않아요.',
  '틱톡 비밀번호나 로그인 정보는 묻지도 받지도 않아요.',
  '내 틱톡 계정의 아이디만 넣어 주세요. 다른 사람의 방송 댓글을 모으는 데 쓰면 안 돼요.',
  '연결을 돕는 다른 회사의 서비스를 거치기 때문에, 넣은 틱톡 아이디가 그 회사로 전달돼요.',
  '언제든 설정에서 끌 수 있어요. 끄면 틱톡 댓글을 바로 그만 받아요.',
] as const
export const CONSENT_CHECKBOX = '안내를 읽었고, 위 내용에 동의해요'
export const PASTE_ALERT = '틱톡 댓글이 들어오지 않아요. 댓글을 직접 붙여 넣어 주세요.'
export const MULTI_NOTICE = '여러 플랫폼을 함께 이으면 서버에 먼저 도착한 댓글이 먼저예요. 플랫폼마다 댓글이 도착하는 속도가 조금씩 달라요.'
export const OFF_MESSAGE = '틱톡 연결이 꺼져 있어요. 안내를 읽고 동의하면 켤 수 있어요.'
/**
 * 연결될 때까지 기다리는 한도. 서버 하나의 틱톡 연결 시도는 60초에 30번까지(AC-N2b-2-42) — 이 묶음의 시험이 줄지어 잇다 보면
 * 31번째 시도는 가장 오래된 시도가 60초를 넘길 때까지 미뤄진다(제품 규칙). 그래서 "받고 있어요"는 최대 60초 + 여유로 기다린다.
 */
export const CONNECT_WAIT = 90_000
export const FINISHED_MESSAGE = '방송을 끝내 댓글 기록을 마쳤어요.'

let idCounter = 0
/** 시험마다 다른 틱톡 아이디 (소문자 — 가짜 웹캐스트는 저장한 소문자 아이디로 찾는다) */
export function newTiktokId(): string {
  idCounter += 1
  return `n2b2_${Math.random().toString(36).slice(2, 8)}_${String(idCounter)}`
}

// ── 가짜 웹캐스트 ───────────────────────────────────────────────────

export async function tt(request: APIRequestContext, path: string, data: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await request.post(`${apiUrl()}/_e2e/tiktok/${path}`, { data })
  expect(res.ok(), `${path} ${await res.text()}`).toBe(true)
  return (await res.json()) as Record<string, unknown>
}

export async function ttLive(request: APIRequestContext, uniqueId: string, state: 'LIVE' | 'OFFLINE' | 'MISSING' = 'LIVE'): Promise<void> {
  await tt(request, 'account', { uniqueId, state })
}

let userCounter = 7_100_000_000
/** 시청자 댓글 (열린 연결 수를 돌려준다) */
export async function ttComment(request: APIRequestContext, uniqueId: string, nickname: string, comment: string, opts: { userId?: string; viewer?: string; msgId?: string } = {}): Promise<number> {
  userCounter += 1
  const body = await tt(request, 'comment', { uniqueId, userId: opts.userId ?? String(userCounter), nickname, comment, ...(opts.viewer === undefined ? {} : { viewer: opts.viewer }), ...(opts.msgId === undefined ? {} : { msgId: opts.msgId }) })
  return body['delivered'] as number
}

export async function ttState(request: APIRequestContext): Promise<{ attempts: number; open: number; maxOpen: number }> {
  const res = await request.get(`${apiUrl()}/_e2e/tiktok/state`)
  expect(res.ok()).toBe(true)
  return (await res.json()) as never
}

// ── 가짜 메타 ───────────────────────────────────────────────────────

export function metaUrl(): string {
  const url = fakeMetaUrl(test.info().project.name)
  if (url === null) throw new Error('여러 플랫폼 묶음이 아니다')
  return url
}

export async function meta<T = Record<string, unknown>>(request: APIRequestContext, path: string, data: unknown = {}): Promise<T> {
  const res = await request.post(`${metaUrl()}${path}`, { data })
  expect(res.ok(), `${path} ${await res.text()}`).toBe(true)
  return (await res.json()) as T
}

// ── 화면 ────────────────────────────────────────────────────────────

export function ttSettings(page: Page) {
  return page.getByRole('region', { name: '틱톡 라이브(베타)', exact: true })
}

export function consoleTiktok(page: Page) {
  return page.getByRole('region', { name: '틱톡', exact: true })
}

export function consoleInstagram(page: Page) {
  return page.getByRole('region', { name: '인스타그램', exact: true })
}

/** 설정에서 고지에 동의해 켜고 아이디를 저장한다 (화면으로) */
export async function enableTiktokUi(page: Page, tiktokId: string): Promise<void> {
  await page.goto('/settings/tiktok')
  const region = ttSettings(page)
  await region.getByRole('checkbox', { name: CONSENT_CHECKBOX }).check()
  await region.getByRole('button', { name: '켜기', exact: true }).click()
  await expect(region.getByLabel('내 틱톡 아이디')).toBeVisible()
  await region.getByLabel('내 틱톡 아이디').fill(`@${tiktokId}`)
  await region.getByRole('button', { name: '저장', exact: true }).click()
  await expect(region.getByLabel('내 틱톡 아이디')).toHaveValue(new RegExp(tiktokId))
}

/** API로 동의·아이디 (화면을 거치지 않는 준비) */
export async function enableTiktokApi(page: Page, tiktokId: string): Promise<void> {
  if (!page.url().startsWith('http')) await page.goto('/')
  const got = await page.request.get('/api/tiktok')
  expect(got.ok(), await got.text()).toBe(true)
  const version = ((await got.json()) as { tiktok: { notice: { version: string } } }).tiktok.notice.version
  const on = await postJson(page, '/api/tiktok/consent', { requestId: crypto.randomUUID(), on: true, version })
  expect(on.status, JSON.stringify(on.body)).toBe(200)
  const put = await page.request.put('/api/tiktok/account', { data: { tiktokId }, headers: { Origin: new URL(page.url()).origin } })
  expect(put.ok(), await put.text()).toBe(true)
}

/** 새 판매자 + 틱톡 준비(동의·아이디·가짜 방송 LIVE) */
export async function tiktokSeller(page: Page): Promise<{ seller: Seller; tiktokId: string }> {
  const seller = await loginNewSeller(page)
  const tiktokId = newTiktokId()
  await enableTiktokApi(page, tiktokId)
  await ttLive(page.request, tiktokId)
  return { seller, tiktokId }
}

/** 콘솔 틱톡 칸에서 "틱톡 잇기" → 댓글을 받는 중 */
export async function linkTiktokUi(page: Page): Promise<void> {
  const region = consoleTiktok(page)
  await region.getByRole('button', { name: '틱톡 잇기' }).click()
  await expect(region.getByRole('button', { name: '끊기' })).toBeVisible()
  // 연결됐는지는 서버 조회로 본다 — 화면 칸은 늦게 온 잇기 응답이 실시간 알림을 덮는 문제(TE-N2b-2-003)가 있어 그 시험이 따로 본다
  const b = /\/broadcasts\/([^/?#]+)/.exec(page.url())?.[1]
  if (b === undefined) throw new Error(`콘솔 주소가 아니다: ${page.url()}`)
  await expect
    .poll(async () => ((await (await page.request.get(`/api/broadcasts/${b}/tiktok`)).json()) as { link: { collection: { state: string } | null } }).link.collection?.state, { timeout: CONNECT_WAIT })
    .toBe('CONNECTED')
}

/** 붙여넣기 창 */
export function pasteDialog(page: Page) {
  return page.getByRole('dialog', { name: '댓글 붙여넣기' })
}

/**
 * 시험이 끝나면 그 판매자의 틱톡 연결을 끊는다. 이어 둔 채 두면 가짜 웹캐스트가 자료를 보내지 않아 120초마다 멈춘 연결로 보고
 * 다시 붙으면서(AC-N2b-2-40) 서버 전체 연결 시도 한도(60초에 30번, AC-N2b-2-42)를 나눠 쓰게 되어 — 뒤 시험의 잇기가 밀린다.
 */
export async function unlinkTiktok(page: Page): Promise<void> {
  if (!page.url().startsWith('http')) return
  const res = await page.request.get('/api/live').catch(() => null)
  if (res === null || !res.ok()) return
  const { links } = (await res.json()) as { links: { broadcast: string; platform: string }[] }
  for (const link of links.filter((item) => item.platform === 'TIKTOK')) {
    await page.request
      .post(`/api/broadcasts/${encodeURIComponent(link.broadcast)}/live/unlink`, { data: { requestId: crypto.randomUUID(), platform: 'TIKTOK' }, headers: { Origin: new URL(page.url()).origin } })
      .catch(() => null)
  }
}
