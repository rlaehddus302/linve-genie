// TTX E2E 수정 라운드 4 — D-TTX-21 (3)·AC-TTX-32 (10)·AC-TTX-10 (5): 팝업 '놓친 틱톡 댓글' 수도 날아가는 묶음 몫은 답으로 정한다.
// 실제 확장 + 실제 서버. 확장 서비스 워커의 /ext/tiktok/chats 요청(첫 묶음)을 붙잡아 "날아가는 중"을 만들고,
// 그동안 댓글을 더 붙여 대기열을 500 + 3개로 만든다(잘린 3개는 모두 날아가는 묶음 몫).
// 시간 대기 없음 — 세션 대기열 크기·요청 수·서버 보기·화면 문장을 기다린다.
import type { BrowserContext, Page, Route } from '@playwright/test'
import {
  POPUP,
  ROUTE,
  connectPopup,
  consoleTiktok,
  expect,
  issueCode,
  newCommentId,
  newUserId,
  openPopup,
  openRealBroadcast,
  openTiktok,
  registerApi,
  routeLine,
  routeTiktok,
  saveFailedLine,
  test,
  tiktokSeller,
  ttLinkView,
  ttLive,
  unlinkTiktok,
} from './support.ts'

const OVERFLOW_EXTRA = 3

async function extensionReceiving(context: BrowserContext, page: Page, extId: string, title: string): Promise<{ b: string; popup: Page; tab: Page }> {
  const { tiktokId } = await tiktokSeller(page)
  await ttLive(page.request, tiktokId, 'MISSING')
  const { b } = await openRealBroadcast(page, { title })
  await registerApi(page, b, 15, '상품15', 10_000)
  const code = await issueCode(page)
  const popup = await openPopup(context, extId)
  await connectPopup(popup, code)
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  const region = consoleTiktok(page)
  await region.getByRole('button', { name: '틱톡 잇기' }).click()
  await expect(region.getByRole('button', { name: '끊기' })).toBeVisible()
  const tab = await openTiktok(context, `/@${tiktokId}/live`)
  await expect(routeLine(page)).toHaveText(ROUTE.EXTENSION, { timeout: 20_000 })
  return { b, popup, tab }
}

/** 구경 댓글 n개를 한 번에 붙이고 그 댓글 ID들을 돌려준다 (찜 아님 — 본문은 인사) */
async function addMany(tab: Page, n: number, before: (ids: readonly string[]) => void = () => undefined): Promise<string[]> {
  const rows = Array.from({ length: n }, (_, i) => ({ commentId: newCommentId(), userId: newUserId(), text: `예뻐요 ${String(i + 1)}번째` }))
  // 붙이기 전에 부른다 (첫 묶음 붙잡기를 미리 건다 — 붙인 뒤에 걸면 묶음이 먼저 지나간다)
  before(rows.map((r) => r.commentId))
  await tab.evaluate((list) => {
    const box = document.querySelector('.tt-comment-list')
    const frag = document.createDocumentFragment()
    for (const m of list) {
      const el = document.createElement('div')
      el.className = 'tt-comment'
      el.setAttribute('data-comment-id', m.commentId)
      el.setAttribute('data-user-id', m.userId)
      el.setAttribute('data-unique-id', `viewer_${m.userId.slice(-6)}`)
      const nick = document.createElement('span')
      nick.className = 'tt-nickname'
      nick.textContent = '구경손님'
      const text = document.createElement('span')
      text.className = 'tt-text'
      text.textContent = m.text
      el.append(nick, text)
      frag.append(el)
    }
    box?.append(frag)
  }, rows)
  return rows.map((r) => r.commentId)
}

/** 확장 서비스 워커의 세션 틱톡 대기열 (붙든 수·팝업 누적 수) */
async function sessionQueue(context: BrowserContext): Promise<{ size: number; dropped: number }> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  return worker.evaluate(async () => {
    const area = (globalThis as unknown as { chrome: { storage: { session: { get: (key: string) => Promise<Record<string, unknown>> } } } }).chrome.storage.session
    const saved = (await area.get('ttQueue'))['ttQueue'] as { items?: unknown[]; dropped?: number } | undefined
    return { size: Array.isArray(saved?.items) ? saved.items.length : 0, dropped: typeof saved?.dropped === 'number' ? saved.dropped : 0 }
  })
}

interface Watch {
  arm: (commentId: string) => void
  held: () => { route: Route; size: number } | null
  statusDropped: number[]
}

/** arm한 댓글 ID가 처음 실린 묶음만 붙잡고 나머지는 지나가게 둔다 */
async function watchTiktok(context: BrowserContext): Promise<Watch> {
  const statusDropped: number[] = []
  let target: string | null = null
  let held: { route: Route; size: number } | null = null
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
      // 본문을 읽지 못하면 붙잡지 않는다
    }
    if (held === null && target !== null && ids.includes(target)) {
      held = { route, size: ids.length }
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
    statusDropped,
  }
}

/** 첫 묶음을 붙잡아 두고, 대기열이 500 + 3개가 되도록 더 붙여 잘린 3개가 모두 날아가는 묶음 몫이 되게 한다 */
async function overflowWhileFlying(context: BrowserContext, tab: Page, watch: Watch): Promise<{ route: Route; size: number }> {
  // 앞 사례의 대기열이 비어 있어야 셈이 맞는다
  await expect.poll(async () => (await sessionQueue(context)).size, { timeout: 90_000 }).toBe(0)
  await addMany(tab, 50, (ids) => watch.arm(ids[0] ?? ''))
  await expect.poll(() => watch.held() !== null, { timeout: 15_000 }).toBe(true)
  const held = watch.held()
  if (held === null) throw new Error('붙잡은 묶음이 없음')
  // 날아가는 묶음 크기 size(보통 50) — 아직 묶음에 안 실린 첫 댓글이 있으면 그것도 대기열에 있다
  expect(held.size).toBeGreaterThan(OVERFLOW_EXTRA)
  await expect.poll(async () => (await sessionQueue(context)).size, { timeout: 15_000 }).toBe(50)
  await addMany(tab, 500 - 50 + OVERFLOW_EXTRA)
  // 넘침으로 3개가 잘려 500개가 남았다 — 잘린 3개는 가장 오래된 것, 곧 날아가는 묶음 몫
  await expect.poll(async () => (await sessionQueue(context)).size, { timeout: 30_000 }).toBe(500)
  return held
}

async function popupOverflow(popup: Page) {
  await popup.reload()
  await expect(popup.getByRole('region', { name: '틱톡' }).getByRole('status')).toBeVisible()
  return popup.getByText(POPUP.OVERFLOW, { exact: true })
}

test.describe('TTX 수정 라운드 4 — 팝업 놓친 댓글 수 @multi', () => {
  test.describe.configure({ timeout: 300_000 })
  test.afterEach(async ({ ext }) => {
    await ext.context.unrouteAll({ behavior: 'ignoreErrors' })
    await unlinkTiktok(ext.page)
  })

  test('AC-TTX-32(10)(D-TTX-21 (3), SA-TTX-05·RA-TTX-08): 날아가는 50개 묶음 중 3개가 넘침으로 잘림 — 답 전에는 팝업 "놓친 틱톡 댓글이 있어요" 없음, 200이면 끝까지 없음·dropped 0·saveFailed 0, 503이면 그때 팝업 문장·dropped 3·"저장하지 못한 틱톡 댓글이 3개" @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const { b, popup, tab } = await extensionReceiving(context, page, extId, '팝업 놓친 수 1부')
    const watch = await watchTiktok(context)
    const region = consoleTiktok(page)

    // (가) 200 — 서버가 날아가던 묶음을 저장했다. 잘린 3개는 서버에 있으니 붙여 넣으라 하면 이중 찜 길이 열린다
    const heldA = await overflowWhileFlying(context, tab, watch)
    // 답 전: 잘린 몫이 모두 날아가던 것이라 팝업 누적 수 0, 팝업 문장 없음 (옛 코드는 여기서 3·문장 있음)
    expect((await sessionQueue(context)).dropped).toBe(0)
    await expect(await popupOverflow(popup)).toHaveCount(0)
    const res = await heldA.route.fetch()
    expect(res.status()).toBe(200)
    await heldA.route.fulfill({ response: res })
    // 남은 500개가 다 들어가 대기열이 빈다
    await expect.poll(async () => (await sessionQueue(context)).size, { timeout: 90_000 }).toBe(0)
    await expect.poll(async () => (await ttLinkView(page, b)).extension?.recorded ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(500 + OVERFLOW_EXTRA)
    expect((await sessionQueue(context)).dropped).toBe(0)
    await expect(await popupOverflow(popup)).toHaveCount(0)
    const afterA = watch.statusDropped.length
    await expect.poll(() => watch.statusDropped.length, { timeout: 40_000 }).toBeGreaterThan(afterA)
    expect(watch.statusDropped.every((n) => n === 0), `상태 dropped: ${watch.statusDropped.join(',')}`).toBe(true)
    expect((await ttLinkView(page, b)).collection?.saveFailed ?? 0).toBe(0)
    await expect(region.getByText(/저장하지 못한 틱톡 댓글이/)).toHaveCount(0)

    // (나) 503 — 서버가 날아가던 묶음을 받지 못했다. 잘린 3개는 다시 보내지 않으니 그때 팝업 수·서버 알림 수에 든다
    const heldB = await overflowWhileFlying(context, tab, watch)
    expect((await sessionQueue(context)).dropped).toBe(0)
    await expect(await popupOverflow(popup)).toHaveCount(0)
    await heldB.route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '잠시 뒤 다시 시도해 주세요.' } }) })
    await expect.poll(async () => (await sessionQueue(context)).dropped, { timeout: 30_000 }).toBe(OVERFLOW_EXTRA)
    await expect(async () => {
      await expect(await popupOverflow(popup)).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 30_000 })
    await expect(region.getByText(saveFailedLine(OVERFLOW_EXTRA), { exact: true })).toBeVisible({ timeout: 30_000 })
    expect(watch.statusDropped).toContain(OVERFLOW_EXTRA)
    expect((await ttLinkView(page, b)).collection?.saveFailed).toBe(OVERFLOW_EXTRA)
    await expect(routeLine(page)).toHaveText(ROUTE.EXTENSION)
    // 다시 보낸 나머지 497개(날아가던 묶음의 남은 몫 포함)는 들어오고, 팝업 수는 3 그대로 (두 번 세지 않음)
    await expect.poll(async () => (await sessionQueue(context)).size, { timeout: 90_000 }).toBe(0)
    expect((await sessionQueue(context)).dropped).toBe(OVERFLOW_EXTRA)
    expect((await ttLinkView(page, b)).collection?.saveFailed).toBe(OVERFLOW_EXTRA)
  })
})
