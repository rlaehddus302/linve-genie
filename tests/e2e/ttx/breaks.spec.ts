// TTX E2E — 확장 틱톡 흐름 깨뜨리기 (여러 플랫폼 묶음 @multi). AC-TTX-10·16·19·21·22·28·31 + 화면 쪽 공격.
// 직접 연결은 실패 대기열을 쓰지 않게 "그런 아이디 없음"(멈춤)으로 막는다 — 가짜 웹캐스트 실패 대기열은 서버 하나에 하나라 다음 시험에 남는다.
import type { BrowserContext, Page } from '@playwright/test'
import {
  PASTE_ALERT,
  POPUP,
  ROUTE,
  addChat,
  addTtComment,
  boardItem,
  claimsOf,
  connectPopup,
  consoleTiktok,
  consoleYoutube,
  countTiktokChats,
  enableTiktokApi,
  expect,
  expectPopupTiktok,
  issueCode,
  loginNewSeller,
  newTtxId,
  newUserId,
  noHorizontalScroll,
  openLiveChat,
  openPopup,
  openRealBroadcast,
  openTiktok,
  pickBroadcast,
  postJson,
  registerApi,
  routeLine,
  routeTiktok,
  scopeView,
  test,
  tiktokSeller,
  ttLinkView,
  ttLive,
  unlinkTiktok,
} from './support.ts'

async function connectExtension(context: BrowserContext, page: Page, extId: string, b: string): Promise<Page> {
  const code = await issueCode(page)
  const popup = await openPopup(context, extId)
  await connectPopup(popup, code)
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  return popup
}

/** 직접 연결이 멈춘(그런 아이디 없음) 회차에 틱톡을 잇고, 확장 탭을 열어 "확장으로 받는 중"까지 */
async function extensionReceiving(context: BrowserContext, page: Page, extId: string, title: string, products: readonly number[]): Promise<{ b: string; date: string; tiktokId: string; popup: Page; tab: Page }> {
  const { tiktokId } = await tiktokSeller(page)
  await ttLive(page.request, tiktokId, 'MISSING')
  const { b, date } = await openRealBroadcast(page, { title })
  for (const no of products) await registerApi(page, b, no, `상품${String(no)}`, 10_000)
  const popup = await connectExtension(context, page, extId, b)
  const region = consoleTiktok(page)
  await region.getByRole('button', { name: '틱톡 잇기' }).click()
  await expect(region.getByRole('button', { name: '끊기' })).toBeVisible()
  const tab = await openTiktok(context, `/@${tiktokId}/live`)
  await expect(routeLine(page)).toHaveText(ROUTE.EXTENSION, { timeout: 20_000 })
  return { b, date, tiktokId, popup, tab }
}

test.describe('TTX 확장 틱톡 깨뜨리기 @multi', () => {
  test.describe.configure({ timeout: 240_000 })
  test.afterEach(async ({ ext }) => {
    await ext.context.unrouteAll({ behavior: 'ignoreErrors' })
    await unlinkTiktok(ext.page)
  })

  test('AC-TTX-28: 같은 브라우저에 유튜브 채팅 창과 틱톡 화면 → "15"(유튜브)·"16"(틱톡) 찜 2건, 두 칸 모두 확장으로 받는 중 @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const { tiktokId } = await tiktokSeller(page)
    await ttLive(page.request, tiktokId, 'MISSING')
    const { b, date } = await openRealBroadcast(page, { title: '두 확장 1부' })
    await registerApi(page, b, 15, '라울', 10_000)
    await registerApi(page, b, 16, '홍옥', 8_000)
    const code = await issueCode(page)
    const chat = await openLiveChat(context, 'ttxBothVid1')
    const popup = await openPopup(context, extId)
    await connectPopup(popup, code)
    await pickBroadcast(popup, page, `두 확장 1부 (${date})`, b)
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    const region = consoleTiktok(page)
    await region.getByRole('button', { name: '틱톡 잇기' }).click()
    await expect(region.getByRole('button', { name: '끊기' })).toBeVisible()
    const tab = await openTiktok(context, `/@${tiktokId}/live`)
    await expect(routeLine(page)).toHaveText(ROUTE.EXTENSION, { timeout: 20_000 })

    await addChat(chat, { id: 'ChwKGkNPdHR4X2JvdGhfeXRfMDAwMDAwMDAwMDAw', ch: 'UCttxbothviewer000000001', nick: '유튜브손님', text: '15' })
    const tt = await addTtComment(tab, { nickname: '틱톡손님', text: '16' })
    await expect(boardItem(page, 15)).toContainText('유튜브손님', { timeout: 15_000 })
    await expect(boardItem(page, 16)).toContainText('틱톡손님', { timeout: 15_000 })
    await expect(consoleYoutube(page).getByRole('group', { name: '채팅 받는 길' })).toContainText('확장으로 받는 중')
    await expect(routeLine(page)).toHaveText(ROUTE.EXTENSION)
    const view = await scopeView(page, date, false)
    expect(claimsOf(view, b, 15)).toBe(1)
    expect(claimsOf(view, b, 16)).toBe(1)
    const buyers = view.claims.filter((c) => c.broadcast === b).map((c) => c.buyer)
    expect(new Set(buyers).size).toBe(2)
    expect(view.products.find((p) => p.no === 16)?.winners[0]).toContain(tt.userId)
    // 팝업: 유튜브 줄과 틱톡 줄이 따로
    await expectPopupTiktok(popup, POPUP.RECORDING)
    await expect(popup.locator('#state')).toHaveText('확장으로 받는 중')
  })

  test('AC-TTX-10(3)·15: 서버에 닿지 못하는 동안 붙은 "15" 두 개는 다시 이어지면 한 번씩, 붙은 순서대로 (먼저 쓴 사람이 1등) @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const { b, date, tab } = await extensionReceiving(context, page, extId, '끊김 1부', [15])
    let failing = true
    let failed = 0
    await context.route('**/ext/tiktok/chats', async (route) => {
      if (failing) {
        failed += 1
        await route.abort('connectionrefused')
      } else await route.continue()
    })
    const a = await addTtComment(tab, { nickname: '먼저손님', text: '15' })
    await addTtComment(tab, { nickname: '나중손님', text: '15' })
    await expect.poll(() => failed, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    expect(claimsOf(await scopeView(page, date, false), b, 15)).toBe(0)
    failing = false
    await expect.poll(async () => claimsOf(await scopeView(page, date, false), b, 15), { timeout: 30_000 }).toBe(2)
    const view = await scopeView(page, date, false)
    expect(view.products.find((p) => p.no === 15)?.winners).toHaveLength(1)
    expect(view.products.find((p) => p.no === 15)?.winners[0]).toContain(a.userId)
    await expect(boardItem(page, 15)).toContainText('먼저손님')
  })

  test('AC-TTX-10(1)(2): 댓글 60개를 빠르게 붙이면 모두 한 번씩, 붙은 순서 = 기록 순서 @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const chats = await countTiktokChats(context)
    const { b, date, tab } = await extensionReceiving(context, page, extId, '연타 1부', [15])
    const users: string[] = []
    for (let i = 0; i < 60; i++) users.push(newUserId())
    await tab.evaluate((ids) => {
      const list = document.querySelector('.tt-comment-list')
      ids.forEach((userId, i) => {
        const el = document.createElement('div')
        el.className = 'tt-comment'
        el.setAttribute('data-comment-id', String(7_500_000_000_000_000_000n + BigInt(i) + BigInt(Date.now() % 100_000) * 1000n))
        el.setAttribute('data-user-id', userId)
        el.setAttribute('data-unique-id', `rapid_${String(i)}`)
        const n = document.createElement('span')
        n.className = 'tt-nickname'
        n.textContent = `연타${String(i)}`
        const t = document.createElement('span')
        t.className = 'tt-text'
        t.textContent = '15'
        el.append(n, t)
        list?.append(el)
      })
    }, users)
    await expect.poll(async () => claimsOf(await scopeView(page, date, false), b, 15), { timeout: 30_000 }).toBe(60)
    const view = await scopeView(page, date, false)
    const ordered = view.claims.filter((c) => c.broadcast === b && c.no === 15).sort((x, y) => x.seq - y.seq).map((c) => c.buyer)
    expect(ordered.map((buyer) => users.findIndex((u) => buyer.includes(u)))).toEqual(users.map((_, i) => i))
    expect(chats.items()).toBe(60)
    expect(chats.count()).toBeGreaterThanOrEqual(2)
  })

  test('AC-TTX-16: 내 방송 화면을 탭 두 개로 열어 같은 댓글이 양쪽에 보여도 찜 1건 @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const { b, date, tiktokId, tab } = await extensionReceiving(context, page, extId, '두 탭 1부', [15, 16])
    const second = await openTiktok(context, `/@${tiktokId}/live`)
    // 두 번째 탭의 관찰이 켜질 때까지 (자기 댓글로 확인)
    await addTtComment(second, { nickname: '둘째탭확인', text: '16' })
    await expect(boardItem(page, 16)).toContainText('둘째탭확인', { timeout: 15_000 })
    const same = { commentId: '7500000000000123456', userId: newUserId(), uniqueId: 'twotab_viewer', nickname: '두탭손님', text: '15' }
    await addTtComment(tab, same)
    await addTtComment(second, same)
    await expect(boardItem(page, 15)).toContainText('두탭손님', { timeout: 15_000 })
    await expect.poll(async () => (await ttLinkView(page, b)).extension?.recorded ?? 0, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    expect(claimsOf(await scopeView(page, date, false), b, 15)).toBe(1)
    await expect(page.getByRole('region', { name: '채팅', exact: true }).getByRole('listitem').filter({ hasText: '두탭손님' })).toHaveCount(1)
  })

  test('AC-TTX-19·21: 설정에서 확장 "끊기" → 받는 길 줄이 사라지고 알림 띠가 다시 뜬다, 그 뒤 틱톡 화면 댓글은 기록되지 않는다 @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const { b, date, tab, popup } = await extensionReceiving(context, page, extId, '확장끊기 1부', [15])
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toHaveCount(0)
    const consoleUrl = page.url()
    await page.goto('/settings/extension')
    const region = page.getByRole('region', { name: '크롬 확장으로 채팅 받기', exact: true })
    await region.getByRole('button', { name: '끊기' }).click()
    await page.getByRole('dialog', { name: '확장 연결을 끊을까요?' }).getByRole('button', { name: '끊기' }).click()
    await expect(region.getByText('연결된 확장이 없어요.')).toBeVisible()
    await page.goto(consoleUrl)
    await expect(routeLine(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toBeVisible({ timeout: 15_000 })
    await addTtComment(tab, { nickname: '끊은뒤손님', text: '15' })
    // 확장은 다음 요청에서 끊김을 알고 연결을 지운다
    await expect(async () => {
      await popup.reload()
      await expect(popup.getByRole('status').first()).toHaveText('연결이 끊겼어요. 라이브지니 설정에서 새 코드를 받아 다시 연결해 주세요.', { timeout: 1000 })
    }).toPass({ timeout: 30_000 })
    expect(claimsOf(await scopeView(page, date, false), b, 15)).toBe(0)
  })

  test('AC-TTX-22·14: 동의를 끄면 팝업 "틱톡 연결이 꺼져 있어요…", 콘솔은 "확장으로 받는 중"이 아니고 그 뒤 댓글은 기록 0 @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const { b, date, tab, popup } = await extensionReceiving(context, page, extId, '동의끄기 1부', [15])
    await expectPopupTiktok(popup, POPUP.RECORDING)
    const off = await postJson(page, '/api/tiktok/consent', { requestId: crypto.randomUUID(), on: false })
    expect(off.status, JSON.stringify(off.body)).toBe(200)
    await expect(consoleTiktok(page)).not.toContainText(ROUTE.EXTENSION, { timeout: 20_000 })
    await addTtComment(tab, { nickname: '끈뒤손님', text: '15' })
    await expectPopupTiktok(popup, POPUP.NO_CONSENT)
    expect(claimsOf(await scopeView(page, date, false), b, 15)).toBe(0)
  })

  test('AC-TTX-22: 아이디 없음 → "내 틱톡 아이디를 먼저 넣어 주세요", 아이디만 있고 잇지 않음 → "콘솔에서 방송을 틱톡에 먼저 이어 주세요" @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const chats = await countTiktokChats(context)
    await loginNewSeller(page)
    const { b } = await openRealBroadcast(page, { title: '팝업문구 1부' })
    const popup = await connectExtension(context, page, extId, b)
    const id = newTtxId()
    const tab = await openTiktok(context, `/@${id}/live`)
    await expectPopupTiktok(popup, POPUP.NO_TIKTOK_ID)
    await addTtComment(tab, { nickname: '아이디없음손님', text: '15' })

    await enableTiktokApi(page, id)
    await expectPopupTiktok(popup, POPUP.NOT_LINKED, 40_000)
    expect(chats.count()).toBe(0)
    // 콘솔 틱톡 칸: 이어진 연결이 없으면 받는 길 줄 없음
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(consoleTiktok(page).getByRole('button', { name: '틱톡 잇기' })).toBeVisible()
    await expect(routeLine(page)).toHaveCount(0)
  })

  test('폰 우선: 375px 콘솔 틱톡 칸 "확장으로 받는 중" 줄이 가로로 넘치지 않는다 @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    await extensionReceiving(context, page, extId, '좁은화면 1부', [15])
    await page.setViewportSize({ width: 375, height: 800 })
    await routeLine(page).scrollIntoViewIfNeeded()
    await expect(routeLine(page)).toBeVisible()
    await noHorizontalScroll(page)
  })

  test('TE-TTX-001(TD-TTX-001 실제 브라우저 재현): 다시 보내기를 기다리는 동안 내 방송 화면을 잠깐 떠났다 돌아오면, 돌아온 뒤 붙은 댓글도 들어와야 한다 @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const { b, date, tiktokId, tab, popup } = await extensionReceiving(context, page, extId, '재시도 1부', [15, 16])
    let failing = true
    let failed = 0
    await context.route('**/ext/tiktok/chats', async (route) => {
      if (failing) {
        failed += 1
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SAVE_FAILED', message: '잠시 뒤 다시 시도해 주세요.' } }) })
      } else await route.continue()
    })
    await addTtComment(tab, { nickname: '실패손님', text: '15' })
    await expect.poll(() => failed, { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
    // 남의 방송으로 잠깐 (한 화면 앱 이동) → 그 화면의 못 보낸 댓글은 버린다 (AC-TTX-07)
    await tab.evaluate(() => history.pushState({}, '', '/@other_seller/live'))
    await expectPopupTiktok(popup, POPUP.NOT_OWN_LIVE)
    failing = false
    await tab.evaluate((path) => history.pushState({}, '', path), `/@${tiktokId}/live`)
    await expect(routeLine(page)).toHaveText(ROUTE.EXTENSION, { timeout: 20_000 })
    await addTtComment(tab, { nickname: '돌아온손님', text: '16' })
    // 콘솔은 "확장으로 받는 중"인데 댓글이 영영 들어오지 않으면 방송 사고다
    await expect.poll(async () => claimsOf(await scopeView(page, date, false), b, 16), { timeout: 30_000 }).toBe(1)
    expect(claimsOf(await scopeView(page, date, false), b, 15)).toBe(0)
    await expectPopupTiktok(popup, POPUP.RECORDING)
  })
})
