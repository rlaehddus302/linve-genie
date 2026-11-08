// BND1 E2E 공용 도우미 (test-e2e). 가짜 밴드가 붙은 묶음(chromium-multi — 제목에 @multi, webkit-iphone — 제목에 @webkit)에서 돈다.
// 가짜 밴드 조작은 그 묶음 서버 주소의 /_e2e/band/*(BND1 dev-notes "E2E 기동"). 문장은 acceptance.md 따옴표 그대로.
// 가짜 밴드는 서버 하나에 하나라 시험마다 새 판매자·새 밴드 사용자·새 밴드를 만든다. 오류 넣기(fail)는 요청 이름 전체에 걸리므로
// 시험이 끝나면 그 판매자의 밴드 글 연결을 끊어(afterEach) 다른 시험의 읽기가 오류를 가져가지 않게 한다.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiUrl, loginNewSeller, openRealBroadcast, postJson, registerApi, type Seller } from '../i3/support.ts'

export * from '../i3/support.ts'

// ── 수용 기준 문장 ───────────────────────────────────────────────────────

export const T = {
  connected: '밴드를 연결했어요.',
  denied: '밴드 연결을 취소했어요.',
  expired: '연결 시간이 지났어요. 다시 해 주세요.',
  notConnected: '연결 안 됨',
  disconnectQuestion: '끊으면 이어 둔 밴드 글의 댓글도 더 받지 않아요.',
  disconnectHint: '밴드 앱의 설정에서도 연결을 끊을 수 있어요.',
  needConnect: '설정에서 밴드를 먼저 연결해 주세요.',
  reconnect: '밴드 연결이 풀렸어요. 설정에서 밴드를 다시 연결해 주세요.',
  reading: '밴드 댓글을 읽고 있어요.',
  noAccess: '이 밴드 글을 읽을 수 없어요. 글이 지워졌거나 밴드 권한이 바뀌었을 수 있어요.',
  youtubeLinkedBlock: '유튜브 라이브를 이은 방송에는 아직 밴드 글을 이을 수 없어요.',
  youtubeLinkedState: '유튜브 라이브를 이은 방송이라 밴드 댓글을 그만 받았어요.',
  unlinked: '끊었어요.',
  ended: '방송을 끝내서 밴드 댓글을 그만 받았어요.',
  rehearsal: '리허설 방송에는 라이브를 이을 수 없어요.',
  linkStart: '밴드 글 잇기',
  inUse: '이미 다른 방송에 밴드 글이 이어져 있어요. 먼저 그 방송의 밴드 연결을 끊어 주세요.',
  linkOther: '다른 글 잇기',
  confirm: '이 글에 지금부터 달리는 댓글을 찜으로 받아요. 이미 달려 있는 댓글은 넣지 않아요. 글을 올린 뒤 바로 이어 주세요.',
  busy: '글을 읽는 중이에요…',
  /** 잇기 중 일시 실패(503 UNAVAILABLE — 5xx·연결 실패·응답 모양·호출 한도, D-BND1-19) */
  linkUnavailable: '밴드 글을 읽지 못해 잇지 못했어요. 잠시 뒤 다시 눌러 주세요.',
  noPosts: '이 밴드에 내가 쓴 글이 없어요. 밴드 앱에서 공지 글을 먼저 올려 주세요.',
  unlinkQuestion: '끊으면 이 방송의 밴드 댓글을 더 받지 않아요. 이미 받은 찜은 그대로예요.',
  notComing: '밴드 댓글이 들어오지 않아요.',
  seen: '확인했어요',
  newNotice: '새 알림',
  notMyPost: '내가 쓴 글만 이을 수 있어요.',
  noAuthor: (n: number) => `작성자를 알 수 없는 밴드 댓글 ${String(n)}개는 넣지 못했어요. 밴드에서 직접 확인해 주세요.`,
  baseline: (n: number) => `이을 때 이미 달려 있던 댓글 ${String(n)}개는 넣지 않았어요.`,
  /** 알림 띠 한 줄 — 확인하지 않은 밴드 알림을 종류와 상관없이 센다 (D-BND1-17, AC-BND1-73) */
  notices: (n: number) => `확인하지 않은 밴드 알림이 ${String(n)}개 있어요.`,
  /** D-BND1-17 앞의 옛 문장 — 더는 보이지 않아야 한다 */
  oldEdits: /밴드에서 지우거나 고친 댓글이 \d+개 있어요\./,
  /** 설정 칸 단추 — 연결됨·다시 연결 필요 (D-BND1-19) */
  reconnectButton: '다시 연결하기',
  connectButton: '밴드 연결하기',
  deleted: (nick: string, text: string) => `밴드에서 지운 댓글이에요 — ${nick}: '${text}'. 찜은 그대로예요. 취소하려면 찜에서 직접 취소해 주세요.`,
  edited: (nick: string, before: string, after: string) => `밴드에서 고친 댓글이에요 — ${nick}: '${before}' → '${after}'. 찜은 처음 글대로예요.`,
  late: /^밴드 댓글을 \d+분 동안 읽지 못했어요\. 그 사이 달린 댓글 (\d+)개를 지금 넣었어요\. 찜 순서는 지금 넣은 차례예요\.$/,
  privacy: '네이버 밴드를 연결하면: 밴드 이름, 내가 쓴 글 목록, 이은 글의 댓글(작성자 이름·작성자 구분 값·글·작성 시각). 밴드에 글이나 댓글을 쓰지 않아요. [검토 필요]',
} as const

/** 밴드 읽기 간격이 1초·3초(E2E 기동)라 댓글이 보드에 오기까지의 넉넉한 한도 */
export const READ_WAIT = 15_000

// ── 가짜 밴드 조작 ───────────────────────────────────────────────────────

export async function band<R = Record<string, unknown>>(request: APIRequestContext, path: string, data: Record<string, unknown> = {}): Promise<R> {
  const res = await request.post(`${apiUrl()}/_e2e/band/${path}`, { data })
  expect(res.ok(), `${path} ${await res.text()}`).toBe(true)
  return (await res.json()) as R
}

let nameCounter = 0
function uniq(prefix: string): string {
  nameCounter += 1
  return `${prefix}${Math.random().toString(36).slice(2, 7)}${String(nameCounter)}`
}

export async function bandUser(request: APIRequestContext, name: string): Promise<string> {
  return (await band<{ userKey: string }>(request, 'user', { name })).userKey
}

export async function bandBand(request: APIRequestContext, name: string, members: string[]): Promise<string> {
  return (await band<{ bandKey: string }>(request, 'band', { name, members })).bandKey
}

export async function bandPost(request: APIRequestContext, bandKey: string, authorUserKey: string | null, content: string, createdAt?: number): Promise<string> {
  return (await band<{ postKey: string }>(request, 'post', { bandKey, authorUserKey, content, ...(createdAt === undefined ? {} : { createdAt }) })).postKey
}

export interface CommentInput { content: string; name?: string; userKey?: string | null; createdAt?: number; commentKey?: string }

export async function bandComment(request: APIRequestContext, postKey: string, input: CommentInput): Promise<string> {
  return (await band<{ commentKey: string }>(request, 'comment', { postKey, ...input })).commentKey
}

export async function bandComments(request: APIRequestContext, postKey: string, items: CommentInput[]): Promise<string[]> {
  return (await band<{ commentKeys: string[] }>(request, 'comments', { postKey, items })).commentKeys
}

export async function bandRequests(request: APIRequestContext): Promise<{ requests: { method: string; path: string }[]; onlyAllowed: boolean }> {
  const res = await request.get(`${apiUrl()}/_e2e/band/requests`)
  expect(res.ok()).toBe(true)
  return (await res.json()) as never
}

/** AC-BND1-60·80: 가짜 밴드가 지금까지 받은 요청이 모두 읽기 일곱 GET 가운데 하나 */
export async function expectOnlyReads(request: APIRequestContext): Promise<void> {
  const { requests, onlyAllowed } = await bandRequests(request)
  const allowed = ['/oauth2/authorize', '/oauth2/token', '/v2/profile', '/v2.1/bands', '/v2/band/posts', '/v2.1/band/post', '/v2/band/post/comments']
  const odd = requests.filter((r) => r.method !== 'GET' || !allowed.includes(r.path))
  expect(odd, '읽기 일곱 GET 밖의 요청').toEqual([])
  expect(onlyAllowed).toBe(true)
}

// ── 화면 ────────────────────────────────────────────────────────────────

export function bandSettings(page: Page) {
  return page.getByRole('region', { name: '네이버 밴드', exact: true })
}

export function consoleBand(page: Page) {
  return page.getByRole('region', { name: '밴드', exact: true })
}

export function chatPanel(page: Page) {
  return page.getByRole('region', { name: '채팅' })
}

export interface BandWorld {
  seller: Seller
  /** 판매자의 밴드 user_key */
  me: string
  profileName: string
  /** 판매자가 가입한 밴드 둘 (A에 내 글·남의 글) */
  bandA: string
  bandAName: string
  bandB: string
  bandBName: string
  /** 밴드 A의 내 글 (댓글 baseline개 달림) */
  post: string
  postLine: string
  /** 남의 글 */
  otherPost: string
  otherLine: string
  other: string
}

/** 설정 화면에서 "밴드 연결하기" → 가짜 밴드 승인 → "밴드를 연결했어요." */
export async function connectBandUi(page: Page, userKey: string, profileName: string): Promise<void> {
  await band(page.request, 'login', { decision: 'approve', userKey })
  await page.goto('/settings/band')
  const region = bandSettings(page)
  await region.getByRole('button', { name: '밴드 연결하기' }).click()
  await expect(page.getByText(T.connected)).toBeVisible()
  await expect(bandSettings(page).getByText(`연결됨 — ${profileName}`)).toBeVisible()
}

/** 새 판매자 + 밴드 사용자·밴드 둘·내 글(이미 달린 댓글 baseline개)·남의 글 + 설정에서 연결 */
export async function bandWorld(page: Page, opts: { baseline?: number; oneBand?: boolean } = {}): Promise<BandWorld> {
  const seller = await loginNewSeller(page)
  const profileName = uniq('판매자')
  const me = await bandUser(page.request, profileName)
  const other = await bandUser(page.request, uniq('다른이'))
  const bandAName = uniq('다육 공구방 ')
  const bandBName = uniq('동네 모임 ')
  const bandA = await bandBand(page.request, bandAName, [me, other])
  const bandB = opts.oneBand === true ? '' : await bandBand(page.request, bandBName, [me])
  const postLine = uniq('오늘 저녁 라방 공지 ')
  const otherLine = uniq('남이 쓴 글 ')
  const otherPost = await bandPost(page.request, bandA, other, otherLine)
  const post = await bandPost(page.request, bandA, me, `${postLine}\n둘째 줄`)
  const baseline = opts.baseline ?? 3
  for (let i = 0; i < baseline; i += 1) await bandComment(page.request, post, { content: `${String(i + 1)}번 미리 단 댓글`, name: `미리손님${String(i)}`, userKey: await bandUser(page.request, `미리손님${String(i)}`) })
  await connectBandUi(page, me, profileName)
  return { seller, me, profileName, bandA, bandAName, bandB, bandBName, post, postLine, otherPost, otherLine, other }
}

/** 지금 콘솔 주소의 회차 */
export function currentBroadcast(page: Page): string {
  const b = /\/broadcasts\/([^/?#]+)/.exec(page.url())?.[1]
  if (b === undefined) throw new Error(`콘솔 주소가 아니다: ${page.url()}`)
  return decodeURIComponent(b)
}

export interface LinkViewLite {
  state: string
  message: string | null
  canLink: boolean
  blockCode: string | null
  received: number
  baseline: number
  skipped: Record<string, number>
  notices: { items: { id: number; kind: string; message: string; seen: boolean }[]; unseen: number }
}

export async function linkView(page: Page, b: string): Promise<LinkViewLite> {
  const res = await page.request.get(`/api/broadcasts/${encodeURIComponent(b)}/band`)
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as { link: LinkViewLite }).link
}

/** 콘솔 밴드 칸에서 "밴드 글 잇기" → (밴드 고르기) → 내 글 → 확인 창 → 잇기 → 칸에 "밴드 댓글을 읽고 있어요." */
export async function linkBandUi(page: Page, w: BandWorld, opts: { bandName?: string } = {}): Promise<void> {
  const region = consoleBand(page)
  await region.getByRole('button', { name: T.linkStart }).click()
  const pickBand = page.getByRole('dialog', { name: '밴드 고르기' })
  const posts = page.getByRole('dialog', { name: '내 글 고르기' })
  const bandList = pickBand.getByRole('list', { name: '가입한 밴드' })
  const postList = posts.getByRole('list', { name: '내가 쓴 글' })
  // 밴드가 하나뿐이면 고르기를 건너뛴다 — 불러오는 중인 "밴드 고르기" 창을 보고 고르지 않게 목록이 뜰 때까지
  await expect(bandList.or(postList)).toBeVisible()
  if (await bandList.isVisible()) await bandList.getByRole('button', { name: new RegExp(escapeRe(opts.bandName ?? w.bandAName)) }).click()
  await posts.getByRole('list', { name: '내가 쓴 글' }).getByRole('button', { name: new RegExp(escapeRe(w.postLine)) }).click()
  const confirm = page.getByRole('dialog', { name: '이 글 잇기' })
  await expect(confirm.getByText(T.confirm)).toBeVisible()
  await confirm.getByRole('button', { name: '잇기', exact: true }).click()
  await expect(confirm).toHaveCount(0, { timeout: 30_000 })
  await expect(region.getByText(T.reading)).toBeVisible()
}

export function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 실제 회차 + 1번 상품(열림) + 밴드 글 잇기 */
export async function linkedBroadcast(page: Page, w: BandWorld, products: { no: number; name: string; price: number }[] = [{ no: 1, name: '핑크프릴', price: 12_000 }]): Promise<{ b: string; date: string }> {
  const opened = await openRealBroadcast(page)
  for (const p of products) await registerApi(page, opened.b, p.no, p.name, p.price)
  await linkBandUi(page, w)
  return opened
}

/** 시험 끝: 열린 밴드 글 연결을 끊고(다른 시험의 오류 넣기를 가져가지 않게) 가짜 밴드가 받은 요청을 확인한다 */
export async function cleanupBand(page: Page): Promise<void> {
  if (!page.url().startsWith('http')) return
  try {
    const res = await page.request.get('/api/live')
    if (res.ok()) {
      const body = (await res.json()) as { links?: { platform: string; broadcast: string; state?: string }[] }
      for (const l of body.links ?? []) {
        if (l.platform === 'BAND') await postJson(page, `/api/broadcasts/${encodeURIComponent(l.broadcast)}/band/unlink`, { requestId: crypto.randomUUID() })
      }
    }
  } catch {
    // 세션이 없는 시험은 넘어간다
  }
  await band(page.request, 'clear')
  await band(page.request, 'delay', { op: 'post', ms: 0 })
  await band(page.request, 'delay', { op: 'comments', ms: 0 })
  await expectOnlyReads(page.request)
}

export function bandProject(): boolean {
  const name = test.info().project.name
  return name === 'chromium-multi' || name === 'webkit-iphone'
}
