// TTX E2E 수정 라운드 2 — D-TTX-15(AC-TTX-21a)·D-TTX-16(AC-TTX-32)·D-TTX-17(AC-TTX-33). 여러 플랫폼 묶음(@multi).
// 기대 문장은 acceptance.md "화면 문구" 표 그대로. 30초 "조용함"은 서버 시계가 정한다 — E2E 서버에는 서버 시계를 넘기는 조작이 없어
// 실제로 기다린다(상태를 기다림, 시간 대기 없음). 가짜 웹캐스트 실패 대기열을 쓴 시험은 직접 연결이 다시 붙을 때까지 기다려 비운다.
import type { BrowserContext, Page } from '@playwright/test'
import {
  EXT_HINT,
  PASTE_ALERT,
  POPUP,
  ROUTE,
  SETTINGS_TIKTOK_LINE,
  WARN,
  addTtComment,
  boardItem,
  connectPopup,
  consoleTiktok,
  expect,
  issueCode,
  linkTiktokUi,
  loginNewSeller,
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
  tt,
  ttLinkView,
  ttLive,
  unlinkTiktok,
} from './support.ts'

const BLOCKED_MESSAGE = '틱톡이 연결을 막아 다시 시도하는 중이에요. 그동안 댓글을 직접 넣어 주세요.'
const CONNECTED_MESSAGE = '틱톡 댓글을 받고 있어요.'
const EXT_REGION = '크롬 확장으로 채팅 받기'

async function connectExtension(context: BrowserContext, page: Page, extId: string, b: string): Promise<Page> {
  const code = await issueCode(page)
  const popup = await openPopup(context, extId)
  await connectPopup(popup, code)
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  return popup
}

async function linkTiktokNoWait(page: Page): Promise<void> {
  const region = consoleTiktok(page)
  await region.getByRole('button', { name: '틱톡 잇기' }).click()
  await expect(region.getByRole('button', { name: '끊기' })).toBeVisible()
}

/** 가짜 틱톡 화면에 일반 댓글 n개를 한 번에 붙인다 (찜이 아닌 글) */
async function addManyTtComments(tab: Page, n: number): Promise<void> {
  const rows = Array.from({ length: n }, (_, i) => ({ commentId: newCommentId(), userId: newUserId(), text: `예뻐요 ${String(i + 1)}번째` }))
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
}

test.describe('TTX 수정 라운드 2 @multi', () => {
  test.describe.configure({ timeout: 300_000 })
  test.afterEach(async ({ ext }) => {
    await ext.context.unrouteAll({ behavior: 'ignoreErrors' })
    await unlinkTiktok(ext.page)
  })

  test('AC-TTX-21a(D-TTX-15, SA-TTX-02): 막힘 + "확장으로 받는 중"이면 칸 어디에도 "직접 넣어 주세요"가 없다 → 틱톡 탭을 닫아 30초 조용해지면 막힘 문장이 다시 굵게, 알림 띠도 다시 @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const { tiktokId } = await tiktokSeller(page)
    const { b } = await openRealBroadcast(page, { title: '조용해짐 1부' })
    await registerApi(page, b, 15, '라울', 10_000)
    await connectExtension(context, page, extId, b)
    await linkTiktokUi(page)
    const tab = await openTiktok(context, `/@${tiktokId}/live`)
    await expect(routeLine(page)).toHaveText(ROUTE.DIRECT_STANDBY, { timeout: 20_000 })

    // 막힘: 다음 네 번(5·10·20·40초 뒤)이 막힌다 → 약 135초 동안 다시 시도하는 중 (조용함 30초를 넉넉히 넘김)
    await tt(page.request, 'block', { uniqueId: tiktokId, times: 4 })
    await expect
      .poll(async () => {
        const c = (await ttLinkView(page, b)).collection
        return c === null ? null : `${c.state}:${c.reason ?? ''}`
      }, { timeout: 20_000 })
      .toBe('RETRYING:BLOCKED')
    const region = consoleTiktok(page)
    await expect(routeLine(page)).toHaveText(ROUTE.EXTENSION, { timeout: 15_000 })
    await expect(region.getByText(BLOCKED_MESSAGE)).toHaveCount(0)
    await expect(region).not.toContainText('직접 넣어 주세요')
    // 보조 단추 "댓글 붙여넣기"는 그대로, 알림 띠·주 단추는 없음 (AC-TTX-21)
    await expect(region.getByRole('button', { name: '댓글 붙여넣기' })).toBeVisible()
    await expect(region.getByRole('button', { name: '댓글 붙여넣기' })).not.toHaveClass(/button-primary/)
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toHaveCount(0)
    await addTtComment(tab, { nickname: '막힘중손님', text: '15' })
    await expect(boardItem(page, 15)).toContainText('막힘중손님', { timeout: 15_000 })

    // 확장이 조용해짐 → 서버가 스스로 알린다(새로고침 없음): 경고 + 막힘 문장이 굵게 다시 + 알림 띠
    await tab.close()
    await expect(region.getByText(WARN.STALE, { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(region.locator('strong').filter({ hasText: BLOCKED_MESSAGE })).toBeVisible()
    await expect(routeLine(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toBeVisible()
    await expect(region.getByRole('button', { name: '댓글 붙여넣기' })).toBeVisible()
    // 이미 확장 상태가 있던 회차라 안내 한 줄(D-TTX-17)은 보이지 않는다
    await expect(region.getByText(EXT_HINT, { exact: true })).toHaveCount(0)

    // 실패 대기열을 비운다 (다음 시험에 막힘을 남기지 않음)
    await expect(region.getByText(CONNECTED_MESSAGE)).toBeVisible({ timeout: 180_000 })
  })

  test('AC-TTX-32(D-TTX-16, RA-TTX-01): 서버가 틱톡 묶음을 받지 못하는 동안 503개가 쌓여 3개를 버림 → "저장하지 못한 틱톡 댓글이 3개" 알림, 받는 길은 "확장으로 받는 중" 그대로, 다시 받으면 나머지는 들어오고 수는 늘지 않음 @multi', async ({ ext }) => {
    test.setTimeout(300_000)
    const { context, page, extId } = ext
    await routeTiktok(context)
    const { tiktokId } = await tiktokSeller(page)
    await ttLive(page.request, tiktokId, 'MISSING')
    const { b } = await openRealBroadcast(page, { title: '넘침 1부' })
    await connectExtension(context, page, extId, b)
    await linkTiktokNoWait(page)
    const tab = await openTiktok(context, `/@${tiktokId}/live`)
    await expect(routeLine(page)).toHaveText(ROUTE.EXTENSION, { timeout: 20_000 })
    const region = consoleTiktok(page)
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toHaveCount(0)

    // 서버 저장 실패(500)인 동안은 다시 보내는 중 — 세지 않는다 (AC-TTX-32(5))
    let failing = true
    let failed = 0
    const statusDropped: number[] = []
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
      if (failing) {
        failed += 1
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SAVE_FAILED', message: '잠시 뒤 다시 시도해 주세요.' } }) })
      } else await route.continue()
    })
    await addManyTtComments(tab, 503)
    await expect.poll(() => failed, { timeout: 15_000 }).toBeGreaterThanOrEqual(1)

    // 대기열 500개 상한 → 3개를 버림 → 다음 상태 dropped: 3 → 그 연결 saveFailed +3
    await expect(region.getByText(saveFailedLine(3), { exact: true })).toBeVisible({ timeout: 30_000 })
    expect(statusDropped).toContain(3)
    expect((await ttLinkView(page, b)).collection?.saveFailed).toBe(3)
    await expect(routeLine(page)).toHaveText(ROUTE.EXTENSION)
    // 직접 연결의 저장 실패와 같게: 알림 띠 + "확인했어요"
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toBeVisible()
    await expect(region.getByRole('button', { name: '확인했어요' })).toBeVisible()

    // 서버가 다시 받으면 남은 500개는 들어온다 — 그 뒤 상태는 dropped: 0, 수는 3 그대로
    failing = false
    await expect.poll(async () => (await ttLinkView(page, b)).extension?.recorded ?? 0, { timeout: 90_000 }).toBeGreaterThanOrEqual(500)
    const after = statusDropped.length
    await expect.poll(() => statusDropped.length, { timeout: 30_000 }).toBeGreaterThan(after)
    expect(statusDropped.slice(after).every((n) => n === 0)).toBe(true)
    expect((await ttLinkView(page, b)).collection?.saveFailed).toBe(3)

    // 확인하면 알림 띠가 걷힌다 (확장으로 받는 중이라 멈춤 때문의 띠도 없다)
    await region.getByRole('button', { name: '확인했어요' }).click()
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toHaveCount(0)
    await expect(region.getByText(saveFailedLine(3), { exact: true })).toHaveCount(0)
    await expect(routeLine(page)).toHaveText(ROUTE.EXTENSION)
  })

  test('AC-TTX-33(1)(3)(D-TTX-17, U-TTX-02): 확장 연결이 없으면 안내 줄 없음 → 확장을 이으면 멈춤 칸에 안내 한 줄(경고 모양 아님) → 확장을 끊으면 다시 없음. 설정 설명에 틱톡 문장 @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const { tiktokId } = await tiktokSeller(page)
    await ttLive(page.request, tiktokId, 'MISSING')
    const { b } = await openRealBroadcast(page, { title: '안내줄 1부' })
    const consoleUrl = page.url()

    // 확장 연결 없음 + 멈춤 → 안내 줄 없음, 알림 띠는 지금 조건 그대로
    await linkTiktokNoWait(page)
    const region = consoleTiktok(page)
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toBeVisible({ timeout: 20_000 })
    await expect.poll(async () => (await ttLinkView(page, b)).collection?.state, { timeout: 20_000 }).toBe('STOPPED')
    await expect(region.getByText(EXT_HINT, { exact: true })).toHaveCount(0)

    // 설정 확장 칸: 틱톡 문장 그대로, 그 설명에 "서버" 낱말 없음 (AC-TTX-33(3))
    await page.goto('/settings/extension')
    const settings = page.getByRole('region', { name: EXT_REGION, exact: true })
    const intro = settings.locator('p').filter({ hasText: SETTINGS_TIKTOK_LINE })
    await expect(intro).toHaveCount(1)
    await expect(intro).not.toContainText('서버')

    // 확장을 이으면 (새로고침 없이 콘솔에 알림이 오지만, 연결 코드는 설정에서 받으므로 콘솔로 돌아와 본다)
    const popup = await connectExtension(context, page, extId, b)
    const hint = region.getByText(EXT_HINT, { exact: true })
    await expect(hint).toBeVisible({ timeout: 15_000 })
    await expect(hint).not.toHaveClass(/warning/)
    expect((await ttLinkView(page, b)).extension?.hint).toBe(EXT_HINT)
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toBeVisible()
    await expect(routeLine(page)).toHaveCount(0)

    await popup.close()

    // 틱톡 화면을 열기 전에 확장을 끊으면 → 안내 줄 없음 (확장 상태가 생겨 없어지는 경우는 extension.spec AC-TTX-24 흐름이 본다)
    await page.goto('/settings/extension')
    await settings.getByRole('button', { name: '끊기' }).click()
    await page.getByRole('dialog', { name: '확장 연결을 끊을까요?' }).getByRole('button', { name: '끊기' }).click()
    await expect(settings.getByText('연결된 확장이 없어요.')).toBeVisible()
    await page.goto(consoleUrl)
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toBeVisible({ timeout: 15_000 })
    await expect(region.getByText(EXT_HINT, { exact: true })).toHaveCount(0)
    expect((await ttLinkView(page, b)).extension?.hint ?? null).toBeNull()
  })

  test('AC-TTX-33(2)(D-TTX-17): 연결 코드로 이은 직후 판매자 틱톡 아이디가 없으면 팝업에 틱톡 줄이 없다 @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const asked = await countExtTiktokGets(context)
    await loginNewSeller(page)
    const code = await issueCode(page)
    const popup = await openPopup(context, extId)
    await connectPopup(popup, code)
    // 확장이 틱톡 정보를 물어 답을 받은 뒤에 본다 (묻기 전에 보면 줄이 없는 것이 당연하다)
    await expect.poll(() => asked.done(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
    await expect(popup.getByRole('region', { name: '틱톡' }).getByRole('status')).toHaveCount(0)
    await expect(popup.locator('body')).not.toContainText('틱톡 방송 화면')
  })

  test('AC-TTX-33(2)(D-TTX-17): 연결 코드로 이은 직후 판매자 틱톡 아이디가 있으면 틱톡 화면을 본 적 없어도 팝업 틱톡 줄 "내 틱톡 방송 화면을 열면 댓글을 보내요."(틱톡만 쓰면 맨 위) @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    await tiktokSeller(page)
    const code = await issueCode(page)
    const popup = await openPopup(context, extId)
    await connectPopup(popup, code)
    // 팝업을 다시 열지 않고 연결 직후 그대로 본다
    const line = popup.getByRole('region', { name: '틱톡' }).getByRole('status')
    await expect(line).toHaveText(POPUP.ELSEWHERE_PAGE, { timeout: 15_000 })
    // 유튜브 채팅 창 없이 틱톡만 → 틱톡 줄이 팝업 맨 위 (U-TTX-05)
    await expect(popup.getByRole('status').first()).toHaveText(POPUP.ELSEWHERE_PAGE)
    const text = await popup.locator('body').innerText()
    expect(text).not.toMatch(/\b(NO_TIKTOK_ID|NOT_LINKED|standby|recording|API)\b|토큰/)
  })
})

/** 확장이 판매자 틱톡 정보(GET /ext/tiktok)를 물어 답을 받은 수 */
async function countExtTiktokGets(context: BrowserContext): Promise<{ done: () => number }> {
  let done = 0
  await context.route(/\/ext\/tiktok(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const res = await route.fetch()
    await route.fulfill({ response: res })
    done += 1
  })
  return { done: () => done }
}
