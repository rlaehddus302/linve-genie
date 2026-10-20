// N2b-2 E2E — 한 회차에 유튜브·인스타그램·틱톡 (AC-N2b-2-60·61·65·66·80 ③). 여러 플랫폼 묶음(@multi).
// 기대값: G-ENG-N2b-2-01과 같은 모양 — 접수순이라 먼저 도착한 쪽이 1등, 같은 닉네임 다른 플랫폼 = 다른 구매자, 틱톡·인스타 합치기.
import { expect, test, type Page } from '@playwright/test'
import {
  MULTI_NOTICE,
  boardItem,
  connectYoutube,
  consoleInstagram,
  consoleTiktok,
  enableTiktokApi,
  fakeBroadcast,
  fakeChat,
  linkByAddress,
  linkTiktokUi,
  loginNewSeller,
  meta,
  newTiktokId,
  openRealBroadcast,
  registerApi,
  scopeView,
  settingsRegion,
  ttComment,
  ttLive,
  unlinkTiktok,
} from './support.ts'
import { previewSettled } from '../s06b/support.ts'

/** 설정 → 인스타그램 칸에서 가짜 메타 승인으로 연결 */
async function connectInstagram(page: Page): Promise<{ accountId: string }> {
  const { account } = await meta<{ account: { id: string } }>(page.request, '/_fake/accounts', { username: `shop.${Math.random().toString(36).slice(2, 7)}` })
  await meta(page.request, '/_fake/login', { accounts: [account.id] })
  await page.goto('/settings/instagram')
  const ig = settingsRegion(page, '인스타그램')
  await ig.getByRole('button', { name: '인스타그램 연결하기' }).click()
  await expect(page.getByText('인스타그램 계정을 연결했어요.')).toBeVisible()
  return { accountId: account.id }
}

test.describe('N2b-2 여러 플랫폼 @multi', () => {
  // 서버 전체 연결 시도 한도(60초에 30번) 때문에 잇기·다시 붙기가 최대 60초 미뤄질 수 있다 (support.ts CONNECT_WAIT)
  test.describe.configure({ timeout: 300_000 })
  test.afterEach(async ({ page }) => {
    await unlinkTiktok(page)
  })
  test('AC-N2b-2-80 ③ 유튜브·인스타·틱톡을 한 회차에 → 도착순 안내 → 한 보드(먼저 도착이 1등) → 구매자 플랫폼 글자 → 틱톡·인스타 합치기 @multi', async ({ page }) => {
    await loginNewSeller(page)
    const tiktokId = newTiktokId()
    await enableTiktokApi(page, tiktokId)
    await ttLive(page.request, tiktokId)
    const channel = await connectYoutube(page)
    const { accountId } = await connectInstagram(page)
    const { liveId } = await meta<{ liveId: string }>(page.request, '/_fake/live', { accountId })
    const yt = await fakeBroadcast(page.request, channel.id)
    const { b, date } = await openRealBroadcast(page)
    for (const no of [15, 16]) await registerApi(page, b, no, `상품${String(no)}`, 10_000)
    await expect(boardItem(page, 16)).toBeVisible()

    // 하나만 이으면 안내 없음
    await linkByAddress(page, yt.videoId)
    await expect(page.getByText(MULTI_NOTICE)).toHaveCount(0)
    const ig = consoleInstagram(page)
    await ig.getByRole('button', { name: '진행 중인 라이브 고르기' }).click()
    await page.getByRole('list', { name: '진행 중인 인스타그램 라이브' }).getByRole('button', { name: '이 라이브 잇기' }).first().click()
    await expect(page.getByText(MULTI_NOTICE)).toBeVisible()
    await linkTiktokUi(page)
    const links = (await (await page.request.get(`/api/broadcasts/${b}/live`)).json()) as { links: { platform: string }[] }
    expect(links.links.map((l) => l.platform).sort()).toEqual(['INSTAGRAM', 'TIKTOK', 'YOUTUBE'])

    // 틱톡 "15" 먼저 도착 → 유튜브 "15번" → 인스타 "16"
    await ttComment(page.request, tiktokId, 'flower_mom', '15')
    await expect(boardItem(page, 15)).toContainText('flower_mom')
    await fakeChat(page.request, yt.liveChatId, 'UCyoutubeviewer000000001', '유튜브손님', '15번')
    const chat = page.getByRole('region', { name: '채팅' })
    await expect(chat.getByText('유튜브손님')).toBeVisible({ timeout: 30_000 })
    await meta(page.request, '/_fake/comments', { accountId, liveId, comments: [{ igsid: '91000001', username: 'flower_mom', text: '16' }] })
    await expect(boardItem(page, 16)).toContainText('flower_mom')

    const view = await scopeView(page, date, false)
    const p15 = view.products.find((p) => p.no === 15)!
    const p16 = view.products.find((p) => p.no === 16)!
    expect(p15.winners).toHaveLength(1)
    const buyerOf = (id: string) => view.claims.find((c) => c.id === id)?.buyer ?? id
    expect(buyerOf(p15.winners[0]!)).toMatch(/^tt:/)
    expect(buyerOf(p15.waitlist[0]!)).not.toMatch(/^(tt|ig|sms):/)
    expect(p15.waitlist).toHaveLength(1)
    const ttBuyer = view.buyers.find((x) => x.id.startsWith('tt:'))!
    const igBuyer = view.buyers.find((x) => x.id.startsWith('ig:'))!
    expect(ttBuyer.id).not.toBe(igBuyer.id)
    expect(p16.winners).toHaveLength(1)

    // 채팅 줄마다 플랫폼 글자
    for (const word of ['틱톡', '유튜브', '인스타그램']) await expect(chat.locator('.tag-platform', { hasText: word }).first()).toBeVisible()

    // 구매자 목록 종류 칸
    await page.goto(`/buyers?date=${date}`)
    const rows = page.getByRole('row')
    await expect(rows.filter({ hasText: 'flower_mom' })).toHaveCount(2)
    // 대기만 있는 유튜브 구매자는 "찜 없는 구매자도 보기"로
    await page.getByRole('checkbox', { name: '찜 없는 구매자도 보기' }).check()
    await expect(rows.filter({ hasText: '유튜브손님' })).toContainText('유튜브')
    await expect(rows.filter({ hasText: 'flower_mom' })).toHaveCount(2)
    await expect(rows.filter({ hasText: 'flower_mom' }).filter({ hasText: '틱톡' })).toHaveCount(1)
    await expect(rows.filter({ hasText: 'flower_mom' }).filter({ hasText: '인스타그램' })).toHaveCount(1)

    // 틱톡 구매자를 열어 인스타 구매자와 합친다
    await page.goto(`/buyers?date=${date}&buyer=${encodeURIComponent(ttBuyer.id)}`)
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
    await expect(dlg.getByText('남는 이름: flower_mom · 끝 0001(틱톡)')).toBeVisible()
    await dlg.getByRole('button', { name: '1 같은 사람' }).click()
    await dlg.getByRole('button', { name: '합치기', exact: true }).click()
    await expect(dlg).toHaveCount(0)
    const after = await scopeView(page, date, false)
    const merged = after.buyers.filter((x) => x.id === ttBuyer.id || x.id === igBuyer.id)
    expect(merged.filter((x) => x.mergedInto !== null)).toHaveLength(1)
    const settlement = after.settlements.filter((s) => s.buyer === ttBuyer.id || s.buyer === igBuyer.id)
    expect(settlement).toHaveLength(1)
    expect(settlement[0]!.subtotal).toBe(20_000)
    // 콘솔 칸 이름
    await page.goto(`/broadcasts/${b}`)
    await expect(consoleTiktok(page)).toBeVisible()
  })
})
