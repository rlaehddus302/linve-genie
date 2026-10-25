// BND1 E2E — 유튜브·인스타그램과 한 회차 (AC-BND1-24·71·75, AC-BND1-80 ⑧⑨). 여러 플랫폼 묶음(@multi — 가짜 구글·가짜 메타·가짜 밴드가 같은 서버).
// 기대값: 유튜브를 이은 회차에는 밴드를 잇지 않고(이미 이었으면 멈춤), 인스타그램과는 함께 잇는다(도착순 안내·한 보드·플랫폼 글자·합치기).
import { expect, test, type Page } from '@playwright/test'
import { MULTI_NOTICE, meta } from '../n2b2/support.ts'
import { previewSettled } from '../s06b/support.ts'
import {
  READ_WAIT,
  T,
  alertStrip,
  bandComment,
  bandRequests,
  bandUser,
  bandWorld,
  boardItem,
  chatPanel,
  cleanupBand,
  connectYoutube,
  consoleBand,
  fakeBroadcast,
  linkBandUi,
  linkByAddress,
  linkView,
  openRealBroadcast,
  registerApi,
  scopeView,
  settingsRegion,
} from './support.ts'

async function connectInstagram(page: Page): Promise<{ accountId: string }> {
  const { account } = await meta<{ account: { id: string } }>(page.request, '/_fake/accounts', { username: `shop.${Math.random().toString(36).slice(2, 7)}` })
  await meta(page.request, '/_fake/login', { accounts: [account.id] })
  await page.goto('/settings/instagram')
  await settingsRegion(page, '인스타그램').getByRole('button', { name: '인스타그램 연결하기' }).click()
  await expect(page.getByText('인스타그램 계정을 연결했어요.')).toBeVisible()
  return { accountId: account.id }
}

test.describe('BND1 여러 플랫폼 @multi', () => {
  test.describe.configure({ timeout: 240_000 })
  test.afterEach(async ({ page }) => {
    await cleanupBand(page)
  })

  test('AC-BND1-80 ⑧·24: 유튜브를 이은 회차 → 밴드 칸에 "유튜브 라이브를 이은 방송에는 아직 밴드 글을 이을 수 없어요." · 잇기 없음 @multi', async ({ page }) => {
    const w = await bandWorld(page, { baseline: 0, oneBand: true })
    expect(w.post).toBeTruthy()
    const channel = await connectYoutube(page)
    const yt = await fakeBroadcast(page.request, channel.id)
    const { b } = await openRealBroadcast(page)
    await linkByAddress(page, yt.videoId)
    const region = consoleBand(page)
    await page.reload()
    await expect(region.getByText(T.youtubeLinkedBlock, { exact: true })).toBeVisible()
    await expect(region.getByRole('button', { name: T.linkStart })).toHaveCount(0)
    const view = await linkView(page, b)
    expect(view.canLink).toBe(false)
    expect(view.blockCode).toBe('YOUTUBE_LINKED')
  })

  test('AC-BND1-24·73: 밴드를 이은 뒤 유튜브를 이으면 밴드는 "유튜브 라이브를 이은 방송이라 밴드 댓글을 그만 받았어요."로 멈추고 그 뒤 밴드 댓글은 들어오지 않는다 @multi', async ({ page }) => {
    const w = await bandWorld(page, { baseline: 0, oneBand: true })
    const channel = await connectYoutube(page)
    const yt = await fakeBroadcast(page.request, channel.id)
    const { b, date } = await openRealBroadcast(page)
    await registerApi(page, b, 1, '핑크프릴', 12_000)
    await linkBandUi(page, w)
    await linkByAddress(page, yt.videoId)
    const region = consoleBand(page)
    await expect(region.getByText(T.youtubeLinkedState, { exact: true })).toBeVisible({ timeout: READ_WAIT })
    await expect(alertStrip(page).getByText(T.notComing)).toBeVisible()
    await bandComment(page.request, w.post, { content: '1번', name: '멈춘뒤손님', userKey: await bandUser(page.request, '멈춘뒤손님') })
    expect((await linkView(page, b)).state).toBe('YOUTUBE_LINKED')
    expect((await scopeView(page, date, false)).claims.filter((c) => c.buyer.startsWith('band:'))).toHaveLength(0)
  })

  test('AC-BND1-80 ⑨·75: 인스타그램·밴드를 한 회차에 → 도착순 안내 → 한 보드 → 채팅·구매자 목록 "인스타그램"·"밴드" → 합치기 @multi', async ({ page }) => {
    const w = await bandWorld(page, { baseline: 0, oneBand: true })
    const { accountId } = await connectInstagram(page)
    const { liveId } = await meta<{ liveId: string }>(page.request, '/_fake/live', { accountId })
    const { b, date } = await openRealBroadcast(page)
    for (const no of [1, 2]) await registerApi(page, b, no, `상품${String(no)}`, 10_000)
    await expect(boardItem(page, 2)).toBeVisible()
    await linkBandUi(page, w)
    await expect(page.getByText(MULTI_NOTICE)).toHaveCount(0)
    const ig = page.getByRole('region', { name: '인스타그램', exact: true })
    await ig.getByRole('button', { name: '진행 중인 라이브 고르기' }).click()
    await page.getByRole('list', { name: '진행 중인 인스타그램 라이브' }).getByRole('button', { name: '이 라이브 잇기' }).first().click()
    await expect(page.getByText(MULTI_NOTICE)).toBeVisible()

    // 같은 이름 다른 플랫폼 = 다른 구매자
    const guest = await bandUser(page.request, 'flower_mom')
    await bandComment(page.request, w.post, { content: '1번', name: 'flower_mom', userKey: guest })
    await expect(boardItem(page, 1)).toContainText('flower_mom', { timeout: READ_WAIT })
    await meta(page.request, '/_fake/comments', { accountId, liveId, comments: [{ igsid: '91000077', username: 'flower_mom', text: '2' }] })
    await expect(boardItem(page, 2)).toContainText('flower_mom', { timeout: READ_WAIT })
    const chat = chatPanel(page)
    for (const word of ['밴드', '인스타그램']) await expect(chat.locator('.tag-platform', { hasText: word }).first()).toBeVisible()

    const view = await scopeView(page, date, false)
    const bandBuyer = view.buyers.find((x) => x.id === `band:${guest}`)
    const igBuyer = view.buyers.find((x) => x.id.startsWith('ig:'))
    expect(bandBuyer).toBeDefined()
    expect(igBuyer).toBeDefined()

    await page.goto(`/buyers?date=${date}`)
    const rows = page.getByRole('row').filter({ hasText: 'flower_mom' })
    await expect(rows).toHaveCount(2)
    await expect(rows.filter({ hasText: '밴드' })).toHaveCount(1)
    await expect(rows.filter({ hasText: '인스타그램' })).toHaveCount(1)
    // 이름 구분 표기 끝 4자리 = 키 끝 4자리
    await expect(rows.filter({ hasText: '밴드' })).toContainText(guest.slice(-4))

    await page.goto(`/buyers?date=${date}&buyer=${encodeURIComponent(bandBuyer!.id)}`)
    const detail = page.getByRole('region', { name: '구매자 자세히' })
    await detail.getByRole('button', { name: '다른 구매자와 합치기' }).click()
    const pick = page.getByRole('dialog', { name: '다른 구매자와 합치기' })
    await pick.getByLabel('합칠 구매자 찾기').fill('flower_mom')
    const candidates = pick.getByRole('list', { name: '합칠 구매자' }).getByRole('button')
    await expect(candidates).toHaveCount(1)
    await expect(candidates.first()).toContainText('인스타그램')
    await candidates.first().click()
    const dlg = page.getByRole('dialog', { name: '구매자 합치기' })
    await previewSettled(dlg)
    await expect(dlg.getByText(/밴드/).first()).toBeVisible()
    await dlg.getByRole('button', { name: '1 같은 사람' }).click()
    await dlg.getByRole('button', { name: '합치기', exact: true }).click()
    await expect(dlg).toHaveCount(0)
    const after = await scopeView(page, date, false)
    const settlement = after.settlements.filter((s) => s.buyer === bandBuyer!.id || s.buyer === igBuyer!.id)
    expect(settlement).toHaveLength(1)
    expect(settlement[0]!.subtotal).toBe(20_000)
  })

  // SA-BND1-01·TE-BND1-001 (AC-BND1-71·80 ⑧): 열어 둔 콘솔은 어느 플랫폼의 연결 알림을 받아도 밴드 연결 보기(canLink·blockCode)를 다시 받는다.
  // 고치기 전에는 유튜브를 이어도 밴드 칸이 "밴드 글 잇기"를 그대로 보여 세 단계를 다 고른 뒤에야 거절 문장을 봤다.
  test('SA-BND1-01·TE-BND1-001 AC-BND1-71·80 ⑧: 열어 둔 콘솔에서 유튜브를 이으면 새로 고침 없이 15초 안에 밴드 칸이 "유튜브 라이브를 이은 방송에는 아직 밴드 글을 이을 수 없어요."로 바뀐다 @multi', async ({ page }) => {
    await bandWorld(page, { baseline: 0, oneBand: true })
    const channel = await connectYoutube(page)
    const yt = await fakeBroadcast(page.request, channel.id)
    const { b } = await openRealBroadcast(page)
    const region = consoleBand(page)
    await expect(region.getByRole('button', { name: T.linkStart })).toBeVisible()
    await linkByAddress(page, yt.videoId)
    expect((await linkView(page, b)).blockCode).toBe('YOUTUBE_LINKED')
    await expect(region.getByText(T.youtubeLinkedBlock, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(region.getByRole('button', { name: T.linkStart })).toHaveCount(0)
  })

  test('SA-BND1-01 AC-BND1-71·80 ⑧: 방송 둘의 콘솔을 열어 두고 한쪽에 밴드 글을 이으면 다른 쪽 밴드 칸에 BAND_IN_USE 문장(잇기 없음), 끊으면 15초 안에 사라지고 "밴드 글 잇기"가 돌아온다 — 새로 고침 없이 @multi', async ({ page }) => {
    const w = await bandWorld(page)
    const first = await openRealBroadcast(page, { title: '1부' })
    const second = await page.context().newPage()
    try {
      await second.goto('/')
      const other = await openRealBroadcast(second, { title: '2부' })
      const otherRegion = consoleBand(second)
      await expect(otherRegion.getByRole('button', { name: T.linkStart })).toBeVisible()
      expect((await linkView(second, other.b)).canLink).toBe(true)
      // 1부 콘솔에서 잇기 → 열어 둔 2부 콘솔이 새로 고침 없이 막힌다
      await linkBandUi(page, w)
      const inUse = await linkView(second, other.b)
      expect(inUse.canLink).toBe(false)
      expect(inUse.blockCode).toBe('BAND_IN_USE')
      await expect(otherRegion.getByText(T.inUse, { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(otherRegion.getByRole('button', { name: T.linkStart })).toHaveCount(0)
      // 1부 콘솔에서 끊기 → 2부 콘솔의 막힘이 새로 고침 없이 풀린다
      const region = consoleBand(page)
      await region.getByRole('button', { name: '끊기', exact: true }).click()
      const dlg = page.getByRole('dialog', { name: '밴드 연결 끊기' })
      await dlg.getByRole('button', { name: '끊기', exact: true }).click()
      await expect(region.getByText(T.unlinked, { exact: true })).toBeVisible()
      expect((await linkView(second, other.b)).canLink).toBe(true)
      await expect(otherRegion.getByText(T.inUse, { exact: true })).toHaveCount(0, { timeout: 15_000 })
      await expect(otherRegion.getByRole('button', { name: T.linkStart })).toBeVisible()
      // 1부 콘솔 주소는 그대로 (새로 고침·이동 없음)
      expect(page.url()).toContain(encodeURIComponent(first.b))
    } finally {
      await second.close()
    }
  })

  test('D-BND1-24 AC-BND1-50 RA-BND1-08: 조용한 읽기 차례(새 댓글 없음) 동안 열어 둔 다른 방송 콘솔은 밴드 연결 보기(GET /api/broadcasts/:id/band)를 다시 부르지 않고, 새 댓글이 들어오면 다시 부른다 @multi', async ({ page }) => {
    const w = await bandWorld(page)
    const first = await openRealBroadcast(page, { title: '1부' })
    await registerApi(page, first.b, 1, '핑크프릴', 12_000)
    const second = await page.context().newPage()
    try {
      await second.goto('/')
      const other = await openRealBroadcast(second, { title: '2부' })
      const otherRegion = consoleBand(second)
      await expect(otherRegion.getByRole('button', { name: T.linkStart })).toBeVisible()
      const bandPath = `/api/broadcasts/${encodeURIComponent(other.b)}/band`
      const gets: string[] = []
      second.on('request', (req) => {
        if (req.method() === 'GET' && new URL(req.url()).pathname === bandPath) gets.push(new Date().toISOString())
      })
      const commentReads = async () => (await bandRequests(page.request)).requests.filter((r) => r.path === '/v2/band/post/comments').length
      // 1부에 잇기(판매자 조작 — 알림은 늘 보낸다) → 2부가 다시 받아 BAND_IN_USE
      await linkBandUi(page, w)
      await expect(otherRegion.getByText(T.inUse, { exact: true })).toBeVisible({ timeout: 15_000 })
      // 잇기 알림의 다시 받기가 끝나도록 읽기 차례 하나를 지나 보낸 뒤부터 센다
      const start = await commentReads()
      await expect.poll(commentReads, { timeout: READ_WAIT }).toBeGreaterThanOrEqual(start + 1)
      const before = gets.length
      const from = await commentReads()
      // 조용한 차례 3번(가짜 밴드가 댓글 읽기 요청을 3번 더 받을 때까지)
      await expect.poll(commentReads, { timeout: 30_000 }).toBeGreaterThanOrEqual(from + 3)
      expect(gets.length - before, `조용한 차례 3번 동안 2부 콘솔의 ${bandPath} 다시 부름(시각: ${gets.slice(before).join(', ')})`).toBe(0)
      await expect(otherRegion.getByText(T.inUse, { exact: true })).toBeVisible()
      // 대조: 새 댓글 하나 → 1부 보드에 들어오고, 그 알림으로 2부 콘솔은 다시 부른다(재는 방법이 살아 있다)
      const guest = await bandUser(page.request, '조용손님')
      await bandComment(page.request, w.post, { content: '1번이요', name: '조용손님', userKey: guest })
      await expect(boardItem(page, 1)).toContainText('조용손님', { timeout: READ_WAIT })
      await expect.poll(() => gets.length - before, { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
    } finally {
      await second.close()
    }
  })
})
