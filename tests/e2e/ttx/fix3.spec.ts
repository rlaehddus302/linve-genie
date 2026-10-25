// TTX E2E 수정 라운드 3 — D-TTX-21 (1)·AC-TTX-32 (8): 날아가는 묶음은 화면을 떠날 때 세지 않고, 그 묶음의 답으로 정한다.
// 실제 확장 + 실제 서버. 확장 서비스 워커의 /ext/tiktok/chats 요청을 붙잡아 "날아가는 중"을 만들고,
// 그동안 내 방송 화면을 떠난 뒤 답을 풀어 준다. 시간 대기 없음 — 상태(요청 수·서버 보기·화면 문장)를 기다린다.
import type { BrowserContext, Page, Route } from '@playwright/test'
import {
  PASTE_ALERT,
  POPUP,
  ROUTE,
  addTtComment,
  claimsOf,
  connectPopup,
  consoleTiktok,
  expect,
  expectPopupTiktok,
  issueCode,
  newCommentId,
  openPopup,
  openRealBroadcast,
  openTiktok,
  registerApi,
  routeLine,
  routeTiktok,
  saveFailedLine,
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

interface Watch {
  /** 이 댓글 ID가 처음 실린 묶음을 붙잡게 한다 (붙잡은 것은 지운다) */
  arm: (commentId: string) => void
  /** 붙잡힌 묶음 (arm한 댓글 ID가 처음 실린 요청) */
  held: () => Route | null
  /** 그 댓글 ID가 실린 /ext/tiktok/chats 요청 수 */
  sendsOf: (commentId: string) => number
  /** /ext/tiktok/status 요청에 실린 dropped 값들 (보낸 순서) */
  statusDropped: number[]
}

/** arm한 댓글 ID가 처음 실린 묶음만 붙잡고(답을 미룸 — 확장은 이 묶음이 날아가는 중), 나머지는 지나가게 둔다 */
async function watchTiktok(context: BrowserContext): Promise<Watch> {
  const sends = new Map<string, number>()
  const statusDropped: number[] = []
  let target: string | null = null
  let held: Route | null = null
  await context.route('**/ext/tiktok/status', async (route) => {
    try {
      const body = route.request().postDataJSON() as { dropped?: unknown } | null
      if (typeof body?.dropped === 'number') statusDropped.push(body.dropped)
    } catch {
      // 본문을 읽지 못해도 지나가게 둔다
    }
    await route.continue()
  })
  await context.route('**/ext/tiktok/chats', async (route) => {
    let ids: string[] = []
    try {
      const body = route.request().postDataJSON() as { items?: { commentId?: unknown }[] } | null
      ids = (body?.items ?? []).map((it) => (typeof it.commentId === 'string' ? it.commentId : ''))
    } catch {
      // 본문을 읽지 못하면 세지 않는다
    }
    for (const id of ids) sends.set(id, (sends.get(id) ?? 0) + 1)
    if (held === null && target !== null && ids.includes(target)) {
      held = route
      target = null
      return
    }
    await route.continue()
  })
  return {
    arm: (id) => {
      target = id
      held = null
    },
    held: () => held,
    sendsOf: (id) => sends.get(id) ?? 0,
    statusDropped,
  }
}

/** 남의 방송으로 (한 화면 앱 이동) — 확장이 떠남(ttLeave)을 처리해 팝업이 "내 방송 아님"이 될 때까지 */
async function leaveOwnLive(tab: Page, popup: Page): Promise<void> {
  await tab.evaluate(() => history.pushState({}, '', '/@other_seller/live'))
  await expectPopupTiktok(popup, POPUP.NOT_OWN_LIVE)
}

async function backToOwnLive(tab: Page, page: Page, tiktokId: string): Promise<void> {
  await tab.evaluate((path) => history.pushState({}, '', path), `/@${tiktokId}/live`)
  await expect(routeLine(page)).toHaveText(ROUTE.EXTENSION, { timeout: 20_000 })
}

/** 내 방송 화면에 댓글을 붙이고, 그 댓글이 실린 묶음이 날아가는 중(붙잡힘)이 될 때까지 */
async function addFlying(tab: Page, watch: Watch, nickname: string, text: string): Promise<string> {
  // 붙이기 전에 arm하려면 ID를 먼저 정한다
  const commentId = newCommentId()
  watch.arm(commentId)
  await addTtComment(tab, { commentId, nickname, text })
  await expect.poll(() => watch.held() !== null, { timeout: 15_000 }).toBe(true)
  return commentId
}

function heldRoute(watch: Watch): Route {
  const held = watch.held()
  if (held === null) throw new Error('붙잡은 묶음이 없음')
  return held
}

const anySaveFailed = /저장하지 못한 틱톡 댓글이/

test.describe('TTX 수정 라운드 3 — 날아가는 묶음 @multi', () => {
  test.describe.configure({ timeout: 300_000 })
  test.afterEach(async ({ ext }) => {
    await ext.context.unrouteAll({ behavior: 'ignoreErrors' })
    await unlinkTiktok(ext.page)
  })

  // 두 사례를 확장 연결 한 번으로 본다 (TE-TTX-004 이후 E2E 서버는 코드 넣기 주소 한도를 넓혔지만, 사례 사이 상태 이어짐도 함께 본다)
  test('AC-TTX-32(8)(D-TTX-21 (1), TD-TTX-003·RA-TTX-07): 묶음이 날아가는 동안 내 방송을 떠나면 그때 세지 않고 답으로 정한다 — 200이면 찜 1건·저장 실패 알림 없음, 503이면 그때 세어 "저장하지 못한 틱톡 댓글이 1개"·찜 0건, 어느 쪽도 다시 보내지 않음 @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const { b, date, tiktokId, tab, popup } = await extensionReceiving(context, page, extId, '날아가는 묶음 1부', [15, 16, 17])
    const watch = await watchTiktok(context)
    const region = consoleTiktok(page)

    // (가) 200 — 날아가는 중에 떠나도, 서버가 저장했으면 세지 않는다
    const a = await addFlying(tab, watch, '날아가는손님', '15')
    await leaveOwnLive(tab, popup)
    const heldA = heldRoute(watch)
    const res = await heldA.fetch()
    expect(res.status()).toBe(200)
    await heldA.fulfill({ response: res })
    await expect.poll(async () => claimsOf(await scopeView(page, date, false), b, 15), { timeout: 30_000 }).toBe(1)
    // 떠남 이후 상태 두 번 — 어느 것도 버린 수를 싣지 않는다
    const afterA = watch.statusDropped.length
    await expect.poll(() => watch.statusDropped.length, { timeout: 40_000 }).toBeGreaterThanOrEqual(afterA + 2)
    expect(watch.statusDropped.every((n) => n === 0), `상태 dropped: ${watch.statusDropped.join(',')}`).toBe(true)
    expect((await ttLinkView(page, b)).collection?.saveFailed ?? 0).toBe(0)
    await expect(region.getByText(anySaveFailed)).toHaveCount(0)
    // (남의 방송에 있는 동안은 직접 연결 멈춤 때문에 붙여넣기 띠가 뜬다 — 저장 실패 때문이 아님은 위 두 줄이 본다)
    expect(watch.sendsOf(a)).toBe(1)

    // (나) 503 — 날아가는 중에 떠났고 서버가 받지 못했으면 그때 센다
    await backToOwnLive(tab, page, tiktokId)
    const bId = await addFlying(tab, watch, '못간손님', '16')
    await leaveOwnLive(tab, popup)
    // 떠날 때 보낸 상태는 버린 수를 싣지 않았다 (아직 답을 모른다)
    expect(watch.statusDropped.every((n) => n === 0), `상태 dropped: ${watch.statusDropped.join(',')}`).toBe(true)
    await heldRoute(watch).fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '잠시 뒤 다시 시도해 주세요.' } }) })
    await expect(region.getByText(saveFailedLine(1), { exact: true })).toBeVisible({ timeout: 30_000 })
    expect(watch.statusDropped).toContain(1)
    expect((await ttLinkView(page, b)).collection?.saveFailed).toBe(1)
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toBeVisible()
    // 떠난 화면의 댓글은 다시 보내지 않는다 (D-TTX-02) — 찜 0건
    expect(watch.sendsOf(bId)).toBe(1)
    expect(claimsOf(await scopeView(page, date, false), b, 16)).toBe(0)

    // 돌아와 붙은 댓글은 들어오고(대기열이 멈추지 않음, 받는 길 그대로), 버린 수는 1 그대로 (두 번 세지 않음)
    await backToOwnLive(tab, page, tiktokId)
    await addTtComment(tab, { nickname: '돌아온손님', text: '17' })
    await expect.poll(async () => claimsOf(await scopeView(page, date, false), b, 17), { timeout: 30_000 }).toBe(1)
    const afterB = watch.statusDropped.length
    await expect.poll(() => watch.statusDropped.length, { timeout: 30_000 }).toBeGreaterThan(afterB)
    expect(watch.statusDropped.slice(afterB).every((n) => n === 0)).toBe(true)
    expect((await ttLinkView(page, b)).collection?.saveFailed).toBe(1)
    expect(watch.sendsOf(bId)).toBe(1)
    expect(claimsOf(await scopeView(page, date, false), b, 15)).toBe(1)
    expect(claimsOf(await scopeView(page, date, false), b, 16)).toBe(0)
  })
})
