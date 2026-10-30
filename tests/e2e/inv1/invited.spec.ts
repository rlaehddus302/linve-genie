// INV1 — 초대받은 유튜버 방송 (가짜 유튜브 묶음 @youtube). AC-INV1-05·10(3)·12 + 흐름 깨뜨리기 (test-e2e)
// 사장님 채널 A = 콘솔에서 연결한 채널. 유튜버 채널 B = 가짜 구글에 따로 만든 채널(승인 없음).
// 문장은 acceptance.md 그대로. 셀렉터는 역할·이름.
import { expect, test, type Page } from '@playwright/test'
import {
  boardItem,
  connectYoutube,
  consentLiveChat,
  consoleYoutube,
  fake,
  fakeBroadcast,
  fakeChat,
  fakeState,
  linkByAddress,
  loginNewSeller,
  openRealBroadcast,
  register,
} from '../i3/support.ts'

const B_NAME = '다육이유튜버'
const QUESTION = (name: string) => `내 채널 방송이 아니에요 (채널: ${name}). 초대받은 방송이 맞나요?`
const LINE = (name: string) => `초대받은 방송 · ${name}`
const OLD_ERROR = '내 채널의 방송만 연결할 수 있어요.'
const EXT_LOGIN = '방송 채널 계정으로 로그인해야 감사 글을 올릴 수 있어요'

test.beforeEach(async ({ request }) => {
  await fake(request, '/_fake/clear-faults')
})
test.afterEach(async ({ request }) => {
  await fake(request, '/_fake/clear-faults')
})

/** 승인 없이 유튜버 채널 B를 만들고 그 채널의 진행 중 방송 */
async function youtuberLive(page: Page, title = B_NAME): Promise<{ channel: { id: string; title: string; account: string }; live: { videoId: string; liveChatId: string } }> {
  const channel = await fake<{ id: string; title: string; account: string }>(page.request, '/_fake/channels', { title })
  const live = await fakeBroadcast(page.request, channel.id, { title: '유튜버 라이브' })
  return { channel, live }
}

/** 주소 칸에 붙여넣고 Enter → 읽은 영상 → 마지막 "이 방송에 잇기" */
async function pasteAndLink(page: Page, videoId: string): Promise<void> {
  const yt = consoleYoutube(page)
  const field = yt.getByLabel('주소 붙여넣기')
  await field.fill(`https://www.youtube.com/watch?v=${videoId}`)
  await field.press('Enter')
  await expect(yt.getByText(`읽은 영상: ${videoId}`)).toBeVisible()
  await yt.getByRole('button', { name: '이 방송에 잇기' }).last().click()
}

function confirmGroup(page: Page) {
  return consoleYoutube(page).getByRole('group', { name: '초대받은 방송 확인' })
}

/** 잇기 요청(POST /api/broadcasts/:id/youtube)만 센다 */
function countLinkPosts(page: Page): { bodies: unknown[] } {
  const seen = { bodies: [] as unknown[] }
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/broadcasts\/[^/]+\/youtube$/.test(new URL(r.url()).pathname)) seen.bodies.push(r.postDataJSON())
  })
  return seen
}

test.describe('@youtube INV1 초대받은 방송', () => {
  test('AC-INV1-12: B 주소 → 확인 줄 → [맞아요, 잇기] → "초대받은 방송 · 다육이유튜버" → 시청자 "15" 찜·A 이름 감사 1건, B의 "16"은 찜 0', async ({ page }) => {
    test.setTimeout(120_000)
    await loginNewSeller(page)
    const a = await connectYoutube(page, '사장님채널')
    await consentLiveChat(page, a)
    const { channel: b, live } = await youtuberLive(page)
    await openRealBroadcast(page, { title: '초대 1부' })
    await register(page, '15 핑크프릴 10', 15)
    await register(page, '16 라울 5', 16)
    await page.getByLabel('빠른 입력').focus()

    const posts = countLinkPosts(page)
    await pasteAndLink(page, live.videoId)
    const group = confirmGroup(page)
    await expect(group.getByRole('alert')).toHaveText(QUESTION(B_NAME))
    await expect(page.getByText(OLD_ERROR)).toHaveCount(0)
    await group.getByRole('button', { name: '맞아요, 잇기' }).click()
    const yt = consoleYoutube(page)
    await expect(yt.getByRole('group', { name: '채팅 수집' })).toBeVisible()
    await expect(yt.getByText(LINE(B_NAME), { exact: true })).toBeVisible()
    await expect(confirmGroup(page)).toHaveCount(0)
    expect(posts.bodies).toHaveLength(2)
    expect((posts.bodies[1] as Record<string, unknown>)['confirmInvited']).toBe(true)
    // 확장 감사 올리기 안내(방송 채널 계정 로그인)는 초대 방송 콘솔에 없다 (AC-INV1-10 (3))
    await expect(page.getByText(EXT_LOGIN)).toHaveCount(0)

    // B(유튜버, isChatOwner)의 "16" → 찜 0 / 시청자 "15" → 찜 1
    await fakeChat(page.request, live.liveChatId, b.id, B_NAME, '16')
    await fakeChat(page.request, live.liveChatId, 'UCinvViewer1', '홍길동', '15')
    await expect(boardItem(page, 15)).toContainText('홍길동', { timeout: 20_000 })
    const ownerRow = page.getByRole('list', { name: '채팅 메시지' }).getByRole('listitem').filter({ hasText: B_NAME }).filter({ hasText: '16' })
    await expect(ownerRow.getByText('방송자', { exact: true })).toBeVisible()
    await expect(boardItem(page, 16)).not.toContainText(B_NAME)

    // 감사 한 건이 A의 이름으로 그 방송 채팅에
    await expect.poll(async () => (await fakeState(page.request)).posted.filter((p) => p.liveChatId === live.liveChatId && p.text === '15번 핑크프릴 10,000원 홍길동님 구매 감사합니다').map((p) => p.authorChannelId), { timeout: 30_000 }).toEqual([a.id])
    const state = await fakeState(page.request)
    expect(state.posted.filter((p) => p.liveChatId === live.liveChatId && p.text.includes('16번'))).toHaveLength(0)
    expect(state.posted.filter((p) => p.authorChannelId === b.id)).toHaveLength(0)
  })

  test('AC-INV1-05: [취소] → 잇기 요청 0번 더, 이어지지 않음 · 새로고침해도 이어지지 않음', async ({ page }) => {
    await loginNewSeller(page)
    await connectYoutube(page, '사장님채널')
    const { live } = await youtuberLive(page)
    await openRealBroadcast(page, { title: '취소 1부' })
    const posts = countLinkPosts(page)
    await pasteAndLink(page, live.videoId)
    const group = confirmGroup(page)
    await expect(group.getByRole('alert')).toHaveText(QUESTION(B_NAME))
    await expect(group.getByRole('button', { name: '취소' })).toBeVisible()
    await group.getByRole('button', { name: '취소' }).click()
    await expect(confirmGroup(page)).toHaveCount(0)
    expect(posts.bodies).toHaveLength(1)
    const yt = consoleYoutube(page)
    await expect(yt.getByRole('group', { name: '채팅 수집' })).toHaveCount(0)
    await expect(yt.getByText(/초대받은 방송 ·/)).toHaveCount(0)
    await page.reload()
    await expect(consoleYoutube(page).getByLabel('주소 붙여넣기')).toBeVisible()
    await expect(consoleYoutube(page).getByRole('group', { name: '채팅 수집' })).toHaveCount(0)
    expect(posts.bodies).toHaveLength(1)
  })

  test('AC-INV1-05: 내 방송을 이으면 확인 줄도 "초대받은 방송" 줄도 없다', async ({ page }) => {
    await loginNewSeller(page)
    const a = await connectYoutube(page, '사장님채널')
    const live = await fakeBroadcast(page.request, a.id, { title: '내 라이브' })
    await openRealBroadcast(page, { title: '내 1부' })
    const posts = countLinkPosts(page)
    await linkByAddress(page, live.videoId)
    const yt = consoleYoutube(page)
    await expect(confirmGroup(page)).toHaveCount(0)
    await expect(yt.getByText(/초대받은 방송/)).toHaveCount(0)
    expect(posts.bodies).toHaveLength(1)
    await page.reload()
    await expect(consoleYoutube(page).getByRole('group', { name: '채팅 수집' })).toBeVisible()
    await expect(consoleYoutube(page).getByText(/초대받은 방송/)).toHaveCount(0)
  })

  test('AC-INV1-05: 채널 이름 <img src=x onerror=alert(1)>은 확인 줄·이은 줄에 글자로만 보인다(요소 없음)', async ({ page }) => {
    const evil = '<img src=x onerror=alert(1)>'
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(d.message())
      void d.dismiss()
    })
    await loginNewSeller(page)
    await connectYoutube(page, '사장님채널')
    const { live } = await youtuberLive(page, evil)
    await openRealBroadcast(page, { title: '이름 1부' })
    await pasteAndLink(page, live.videoId)
    const group = confirmGroup(page)
    await expect(group.getByRole('alert')).toHaveText(QUESTION(evil))
    await group.getByRole('button', { name: '맞아요, 잇기' }).click()
    const yt = consoleYoutube(page)
    await expect(yt.getByText(LINE(evil), { exact: true })).toBeVisible()
    expect(await yt.locator('img').count()).toBe(0)
    expect(dialogs).toEqual([])
  })

  test('D-INV1-03: 이름이 빈 채널 → 확인 줄·이은 줄 모두 "(이름 없음)"', async ({ page }) => {
    await loginNewSeller(page)
    await connectYoutube(page, '사장님채널')
    const { live } = await youtuberLive(page, '')
    await openRealBroadcast(page, { title: '빈이름 1부' })
    await pasteAndLink(page, live.videoId)
    const group = confirmGroup(page)
    await expect(group.getByRole('alert')).toHaveText(QUESTION('(이름 없음)'))
    await group.getByRole('button', { name: '맞아요, 잇기' }).click()
    await expect(consoleYoutube(page).getByText(LINE('(이름 없음)'), { exact: true })).toBeVisible()
  })

  test('깨뜨리기: 이은 뒤 새로고침·두 번째 기기(375px)에서도 "초대받은 방송 · 다육이유튜버", 감사 확장 안내 없음', async ({ page, browser }) => {
    await loginNewSeller(page)
    await connectYoutube(page, '사장님채널')
    const { live } = await youtuberLive(page)
    const { b } = await openRealBroadcast(page, { title: '두기기 1부' })
    const cookies = await page.context().cookies()
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
    await ctx.addCookies(cookies)
    const phone = await ctx.newPage()
    await phone.goto(`${new URL(page.url()).origin}/broadcasts/${encodeURIComponent(b)}`)
    await expect(consoleYoutube(phone).getByLabel('주소 붙여넣기')).toBeVisible()

    await pasteAndLink(page, live.videoId)
    await confirmGroup(page).getByRole('button', { name: '맞아요, 잇기' }).click()
    await expect(consoleYoutube(page).getByText(LINE(B_NAME), { exact: true })).toBeVisible()
    // 다른 기기는 새로고침 없이 따라온다
    await expect(consoleYoutube(phone).getByText(LINE(B_NAME), { exact: true })).toBeVisible({ timeout: 5_000 })
    await expect(phone.getByText(EXT_LOGIN)).toHaveCount(0)
    const width = await phone.evaluate(() => document.documentElement.scrollWidth)
    expect(width).toBeLessThanOrEqual(375)
    await page.reload()
    await expect(consoleYoutube(page).getByText(LINE(B_NAME), { exact: true })).toBeVisible()
    await ctx.close()
  })

  test('깨뜨리기: 확인 줄이 뜬 뒤 주소를 내 방송으로 바꾸면 확인 줄이 사라지고 내 방송이 확인 없이 이어진다 (초대 줄 없음)', async ({ page }) => {
    await loginNewSeller(page)
    const a = await connectYoutube(page, '사장님채널')
    const mine = await fakeBroadcast(page.request, a.id, { title: '내 라이브' })
    const { live } = await youtuberLive(page)
    await openRealBroadcast(page, { title: '바꾸기 1부' })
    await pasteAndLink(page, live.videoId)
    await expect(confirmGroup(page)).toBeVisible()
    const posts = countLinkPosts(page)
    await pasteAndLink(page, mine.videoId)
    const yt = consoleYoutube(page)
    await expect(yt.getByRole('group', { name: '채팅 수집' })).toBeVisible()
    await expect(confirmGroup(page)).toHaveCount(0)
    await expect(yt.getByText(/초대받은 방송/)).toHaveCount(0)
    expect(posts.bodies).toHaveLength(1)
    expect((posts.bodies[0] as Record<string, unknown>)['video']).toBe(mine.videoId)
    expect((posts.bodies[0] as Record<string, unknown>)['confirmInvited']).toBeUndefined()
  })

  test('깨뜨리기: [맞아요, 잇기] 연타 → 잇기 기록·수집 한 번, 오류 문장 없음', async ({ page }) => {
    await loginNewSeller(page)
    await connectYoutube(page, '사장님채널')
    const { live } = await youtuberLive(page)
    const { b } = await openRealBroadcast(page, { title: '연타 1부' })
    await pasteAndLink(page, live.videoId)
    const btn = confirmGroup(page).getByRole('button', { name: '맞아요, 잇기' })
    await expect(btn).toBeVisible()
    await btn.dblclick()
    const yt = consoleYoutube(page)
    await expect(yt.getByText(LINE(B_NAME), { exact: true })).toBeVisible()
    await expect(yt.getByRole('alert')).toHaveCount(0)
    const res = await page.request.get(`/api/broadcasts/${encodeURIComponent(b)}/youtube`)
    expect(res.ok(), await res.text()).toBe(true)
    const body = await res.json() as { link: { link: { invited?: boolean; broadcastChannelTitle?: string | null } | null } | null }
    const link = body.link?.link ?? (body.link as unknown as { invited?: boolean; broadcastChannelTitle?: string | null } | null)
    expect(link?.invited).toBe(true)
    expect(link?.broadcastChannelTitle).toBe(B_NAME)
  })

  test('깨뜨리기(AC-INV1-04): 끝난 남의 방송 → 확인해도 잇지 않고 "채팅을 받을 수 없는 방송이에요. 끝났거나 채팅이 꺼져 있어요."', async ({ page }) => {
    await loginNewSeller(page)
    await connectYoutube(page, '사장님채널')
    const channel = await fake<{ id: string }>(page.request, '/_fake/channels', { title: B_NAME })
    const ended = await fakeBroadcast(page.request, channel.id, { status: 'complete' })
    await openRealBroadcast(page, { title: '끝남 1부' })
    await pasteAndLink(page, ended.videoId)
    const yt = consoleYoutube(page)
    const cannot = yt.getByText('채팅을 받을 수 없는 방송이에요. 끝났거나 채팅이 꺼져 있어요.')
    // 확인 줄을 먼저 보여 주는지는 정하지 않았다 — 보여 줬다면 확인해도 잇지 않아야 한다
    await expect(cannot.or(confirmGroup(page))).toBeVisible()
    if (await confirmGroup(page).isVisible()) await confirmGroup(page).getByRole('button', { name: '맞아요, 잇기' }).click()
    await expect(cannot).toBeVisible()
    await expect(yt.getByRole('group', { name: '채팅 수집' })).toHaveCount(0)
    await expect(page.getByText(OLD_ERROR)).toHaveCount(0)
  })

  test('AC-INV1-03: "내 라이브 목록에서 고르기"에는 내 채널 방송만 나오고(유튜버 B 방송 없음) 고르면 확인 없이 이어진다', async ({ page }) => {
    await loginNewSeller(page)
    const a = await connectYoutube(page, '사장님채널')
    await fakeBroadcast(page.request, a.id, { title: '내목록라이브' })
    const channel = await fake<{ id: string }>(page.request, '/_fake/channels', { title: B_NAME })
    await fakeBroadcast(page.request, channel.id, { title: '남의목록라이브' })
    await openRealBroadcast(page, { title: '목록 1부' })
    const yt = consoleYoutube(page)
    await yt.getByRole('button', { name: '내 라이브 목록에서 고르기' }).click()
    const mine = yt.getByRole('group', { name: '내 라이브' })
    await expect(mine.getByText('내목록라이브')).toBeVisible()
    await expect(yt.getByText('남의목록라이브')).toHaveCount(0)
    await mine.getByRole('radio').first().check()
    await mine.getByRole('button', { name: '이 방송에 잇기' }).click()
    await expect(yt.getByRole('group', { name: '채팅 수집' })).toBeVisible()
    await expect(confirmGroup(page)).toHaveCount(0)
    await expect(yt.getByText(/초대받은 방송/)).toHaveCount(0)
  })
})
