// TTX E2E — 크롬 확장으로 틱톡 라이브 댓글 읽기 (서버 직접 연결의 대비책). 여러 플랫폼 묶음(@multi — 가짜 웹캐스트·가짜 유튜브).
// AC-TTX-20·21·22·23·24·25·26·27·28·31. 압축 해제 확장(X1 도우미) + 가짜 틱톡 화면(Playwright가 돌려줌) + 콘솔.
// 가짜 웹캐스트의 실패 대기열(/_e2e/tiktok/fail·block)은 서버 하나에 하나라, 그것을 쓴 시험은 다시 붙을 때까지 기다려 대기열을 비우고 끝낸다.
import {
  CONNECT_WAIT,
  PASTE_ALERT,
  POPUP,
  ROUTE,
  WARN,
  addTtComment,
  boardItem,
  claimsOf,
  connectPopup,
  consoleTiktok,
  countTiktokChats,
  expect,
  expectPopupTiktok,
  issueCode,
  linkTiktokUi,
  openPopup,
  openRealBroadcast,
  openTiktok,
  pasteDialog,
  registerApi,
  routeLine,
  routeTiktok,
  scopeView,
  test,
  tiktokSeller,
  tt,
  ttComment,
  ttLinkView,
  ttLive,
  unlinkTiktok,
} from './support.ts'
import type { BrowserContext, Page } from '@playwright/test'

const SIGN_FAILED_MESSAGE = '틱톡 연결 준비에 실패해 다시 시도하는 중이에요. 그동안 댓글을 직접 넣어 주세요.'
const BLOCKED_MESSAGE = '틱톡이 연결을 막아 다시 시도하는 중이에요. 그동안 댓글을 직접 넣어 주세요.'
const CONNECTED_MESSAGE = '틱톡 댓글을 받고 있어요.'
/** 영어 상태값·개발 낱말이 화면에 보이지 않는다 (AC-TTX-20·31) */
const DEV_WORDS = /\b(CONNECTED|RETRYING|STOPPED|SIGN_FAILED|BLOCKED|NOT_LIVE|RECEIVING|STANDBY|STALE|HIDDEN|UNREADABLE|ELSEWHERE|NOT_LINKED|NO_CONSENT|PLATFORM_NOT_READY|NOT_OWN_LIVE|standby|recording|DOM|API)\b|토큰/

/** 콘솔·팝업에서 확장을 잇는다 (연결 코드 → 팝업). 콘솔은 그 회차 화면으로 돌아온다 */
async function connectExtension(context: BrowserContext, page: Page, extId: string, b: string): Promise<Page> {
  const code = await issueCode(page)
  const popup = await openPopup(context, extId)
  await connectPopup(popup, code)
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  return popup
}

/** 콘솔 틱톡 칸에서 "틱톡 잇기"만 누른다 (받는 중이 되기를 기다리지 않는다 — 막힌 직접 연결) */
async function linkTiktokNoWait(page: Page): Promise<void> {
  const region = consoleTiktok(page)
  await region.getByRole('button', { name: '틱톡 잇기' }).click()
  await expect(region.getByRole('button', { name: '끊기' })).toBeVisible()
}

async function noDevWords(page: Page): Promise<void> {
  const text = await page.locator('body').innerText()
  expect(text).not.toMatch(DEV_WORDS)
}

test.describe('TTX 확장 틱톡 @multi', () => {
  test.describe.configure({ timeout: 300_000 })
  test.afterEach(async ({ ext }) => {
    await unlinkTiktok(ext.page)
  })

  test('AC-TTX-24·23·17: 직접 연결이 SIGN_FAILED로 막힘 → 가짜 틱톡 화면 "15" → 찜 1건(틱톡), 칸 "확장으로 받는 중", 알림 띠 없음 → 다시 붙으면 "확장은 대기 중" @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const chats = await countTiktokChats(context)
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(d.message())
      void d.dismiss()
    })
    const { tiktokId } = await tiktokSeller(page)
    const { b, date } = await openRealBroadcast(page, { title: '틱톡 확장 1부' })
    await registerApi(page, b, 15, '라울', 10_000)
    await registerApi(page, b, 16, '홍옥', 8_000)
    await registerApi(page, b, 17, '청옥', 7_000)
    const popup = await connectExtension(context, page, extId, b)

    // 직접 연결은 서명 실패 세 번(0·5·15초) → 35초쯤 다시 받는 중
    await tt(page.request, 'fail', { kind: 'SIGN_FAILED', times: 3 })
    await linkTiktokNoWait(page)
    await expect(consoleTiktok(page).getByText(SIGN_FAILED_MESSAGE)).toBeVisible({ timeout: 15_000 })

    const tab = await openTiktok(context, `/@${tiktokId}/live`)
    await expect(routeLine(page)).toHaveText(ROUTE.EXTENSION, { timeout: 20_000 })
    await expectPopupTiktok(popup, POPUP.RECORDING)

    await addTtComment(tab, { nickname: '확장손님', text: '15' })
    await expect(boardItem(page, 15)).toContainText('확장손님', { timeout: 15_000 })
    const chat = page.getByRole('region', { name: '채팅', exact: true })
    await expect(chat.getByRole('listitem').filter({ hasText: '확장손님' })).toContainText('틱톡')
    // 확장으로 받는 중이면 붙여넣기 알림 띠와 칸의 주 단추가 없다 (AC-TTX-21) — "댓글 붙여넣기"는 보조 단추로 남는다
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toHaveCount(0)
    await expect(consoleTiktok(page).getByRole('button', { name: '댓글 붙여넣기' })).toBeVisible()
    expect(chats.count()).toBeGreaterThan(0)

    // 닉네임 태그 글자는 글자로 (AC-TTX-23)
    await addTtComment(tab, { nickname: '<img src=x onerror=alert(1)>', text: '16' })
    await addTtComment(tab, { nickname: '<script>alert(1)</script>', text: '16' })
    await expect(chat.getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(chat.getByText('<script>alert(1)</script>', { exact: true })).toBeVisible()
    await expect(boardItem(page, 16)).toContainText('<img src=x onerror=alert(1)>')
    expect(await page.locator('img[src="x"]').count()).toBe(0)
    expect(await page.getByRole('region', { name: '채팅', exact: true }).locator('script').count()).toBe(0)
    expect(dialogs).toEqual([])
    await noDevWords(page)

    let view = await scopeView(page, date, false)
    expect(claimsOf(view, b, 15)).toBe(1)
    expect(claimsOf(view, b, 16)).toBe(2)

    // 직접 연결이 다시 받는 중이 되면 확장은 대기 (실패 대기열을 다 쓴다)
    await expect(consoleTiktok(page).getByText(CONNECTED_MESSAGE)).toBeVisible({ timeout: CONNECT_WAIT })
    await expect(routeLine(page)).toHaveText(ROUTE.DIRECT_STANDBY)
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toHaveCount(0)
    // 그 뒤 확장에만 뜬 "17"은 기록되지 않는다(대기) — 같은 댓글이 직접 연결로 오면 1건
    const before = chats.count()
    const { commentId, userId } = await addTtComment(tab, { nickname: '대기손님', text: '17' })
    await expect.poll(() => chats.count(), { timeout: 15_000 }).toBeGreaterThan(before)
    await expect.poll(async () => (await ttLinkView(page, b)).extension?.standby ?? 0, { timeout: 10_000 }).toBeGreaterThan(0)
    expect(claimsOf(await scopeView(page, date, false), b, 17)).toBe(0)
    await expectPopupTiktok(popup, POPUP.STANDBY)
    expect(await ttComment(page.request, tiktokId, '대기손님', '17', { msgId: commentId, userId })).toBe(1)
    await expect(boardItem(page, 17)).toContainText('대기손님')
    view = await scopeView(page, date, false)
    expect(claimsOf(view, b, 17)).toBe(1)
    await noDevWords(popup)
  })

  test('AC-TTX-25: 직접 연결 받는 중 + 같은 댓글 ID를 화면에도 → 찜 1건·"확장은 대기 중" → 막힘 → "16"은 확장으로 1건 → 이중 찜 0 @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const { tiktokId } = await tiktokSeller(page)
    const { b, date } = await openRealBroadcast(page, { title: '틱톡 확장 2부' })
    await registerApi(page, b, 15, '라울', 10_000)
    await registerApi(page, b, 16, '홍옥', 8_000)
    await connectExtension(context, page, extId, b)
    await linkTiktokUi(page)
    // 대문자·물음표가 붙은 주소도 내 방송 (D-TTX-03)
    const tab = await openTiktok(context, `/@${tiktokId.toUpperCase()}/live?lang=ko`)
    await expect(routeLine(page)).toHaveText(ROUTE.DIRECT_STANDBY, { timeout: 20_000 })

    const first = await addTtComment(tab, { nickname: '같은손님', text: '15' })
    expect(await ttComment(page.request, tiktokId, '같은손님', '15', { msgId: first.commentId, userId: first.userId })).toBe(1)
    await expect(boardItem(page, 15)).toContainText('같은손님')

    // 막힘: 열린 연결이 끊기고 다음 세 번(5·10·20초 뒤)이 막힌다 → 75초쯤 다시 받는 중
    await tt(page.request, 'block', { uniqueId: tiktokId, times: 3 })
    await expect(consoleTiktok(page).getByText(BLOCKED_MESSAGE)).toBeVisible({ timeout: 20_000 })
    await expect(routeLine(page)).toHaveText(ROUTE.EXTENSION, { timeout: 15_000 })
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toHaveCount(0)
    await addTtComment(tab, { nickname: '넘어온손님', text: '16' })
    await expect(boardItem(page, 16)).toContainText('넘어온손님', { timeout: 15_000 })

    // 다시 받는 중이 되기를 기다려 실패 대기열을 비운다
    await expect(consoleTiktok(page).getByText(CONNECTED_MESSAGE)).toBeVisible({ timeout: CONNECT_WAIT })
    await expect(routeLine(page)).toHaveText(ROUTE.DIRECT_STANDBY)
    const view = await scopeView(page, date, false)
    expect(claimsOf(view, b, 15)).toBe(1)
    expect(claimsOf(view, b, 16)).toBe(1)
    expect(view.claims.filter((c) => c.broadcast === b)).toHaveLength(2)
  })

  test('AC-TTX-20: 직접 연결 받는 중 — 확장 상태가 없던 회차는 받는 길 줄 없음 → 틱톡 화면 열면 "확장은 대기 중" → 탭을 닫고 30초 넘으면 "서버 연결로 받는 중"(경고·알림 띠 없음) @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const { tiktokId } = await tiktokSeller(page)
    const { b } = await openRealBroadcast(page, { title: '틱톡 확장 5부' })
    await connectExtension(context, page, extId, b)
    await linkTiktokUi(page)
    await expect(consoleTiktok(page).getByText(CONNECTED_MESSAGE)).toBeVisible()
    await expect(routeLine(page)).toHaveCount(0)
    const tab = await openTiktok(context, `/@${tiktokId}/live`)
    await expect(routeLine(page)).toHaveText(ROUTE.DIRECT_STANDBY, { timeout: 20_000 })
    await tab.close()
    await expect(routeLine(page)).toHaveText(ROUTE.DIRECT, { timeout: 60_000 })
    await expect(consoleTiktok(page).getByText(WARN.STALE)).toHaveCount(0)
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toHaveCount(0)
    await noDevWords(page)
  })

  test('AC-TTX-26·22: 남의 방송 화면의 "15"는 서버로 0번·찜 0·팝업 "내 틱톡 방송이 아니에요" → 한 화면 앱 이동으로 내 방송이 되면 그 뒤 댓글만 @multi', async ({ ext }) => {
    const { context, page, extId } = ext
    await routeTiktok(context)
    const chats = await countTiktokChats(context)
    const { tiktokId } = await tiktokSeller(page)
    // 직접 연결은 그런 아이디를 찾지 못해 멈춤 (실패 대기열을 쓰지 않는다)
    await ttLive(page.request, tiktokId, 'MISSING')
    const { b, date } = await openRealBroadcast(page, { title: '틱톡 확장 3부' })
    await registerApi(page, b, 15, '라울', 10_000)
    await registerApi(page, b, 16, '홍옥', 8_000)
    const popup = await connectExtension(context, page, extId, b)
    await linkTiktokNoWait(page)

    const tab = await openTiktok(context, '/@other_seller/live')
    await expectPopupTiktok(popup, POPUP.NOT_OWN_LIVE)
    await expect(popup.getByRole('region', { name: '틱톡' })).not.toContainText('other_seller')
    await addTtComment(tab, { nickname: '남의손님', text: '15' })
    // 콘솔 틱톡 칸 경고 (직접 연결이 받는 중이 아니다)
    await expect(consoleTiktok(page).getByText(WARN.ELSEWHERE)).toBeVisible({ timeout: 20_000 })
    expect(chats.count()).toBe(0)
    expect(claimsOf(await scopeView(page, date, false), b, 15)).toBe(0)

    // 같은 탭에서 주소만 바꿔 내 방송으로 (한 화면 앱 이동) → 바뀐 뒤 붙은 댓글만 보낸다
    await tab.evaluate((path) => history.pushState({}, '', path), `/@${tiktokId}/live`)
    await expect(routeLine(page)).toHaveText(ROUTE.EXTENSION, { timeout: 20_000 })
    await addTtComment(tab, { nickname: '내손님', text: '16' })
    await expect(boardItem(page, 16)).toContainText('내손님', { timeout: 15_000 })
    expect(claimsOf(await scopeView(page, date, false), b, 15)).toBe(0)
    expect(chats.items()).toBe(1)

    // 다시 남의 방송으로 → 그 뒤 댓글은 보내지 않는다 (AC-TTX-07)
    await tab.evaluate(() => history.pushState({}, '', '/@other_seller/live'))
    await expectPopupTiktok(popup, POPUP.NOT_OWN_LIVE)
    const sent = chats.count()
    await addTtComment(tab, { nickname: '또남의손님', text: '15' })
    // 프로필·추천 화면 → "내 틱톡 방송 화면을 열면 댓글을 보내요."
    await tab.evaluate((path) => history.pushState({}, '', path), `/@${tiktokId}`)
    await expectPopupTiktok(popup, POPUP.ELSEWHERE_PAGE)
    expect(chats.count()).toBe(sent)
    expect(claimsOf(await scopeView(page, date, false), b, 15)).toBe(0)
    await noDevWords(popup)
  })

  test('AC-TTX-21·27: 확장으로 받는 중이면 직접 연결이 멈춰도 알림 띠 없음 → 틱톡 탭을 닫으면 30초 뒤 "확장에서 틱톡 댓글이 오지 않아요"와 알림 띠 → 붙여넣기 그대로 @multi', async ({ ext }) => {
    test.setTimeout(300_000)
    const { context, page, extId } = ext
    await routeTiktok(context)
    const { tiktokId } = await tiktokSeller(page)
    await ttLive(page.request, tiktokId, 'MISSING')
    const { b, date } = await openRealBroadcast(page, { title: '틱톡 확장 4부' })
    await registerApi(page, b, 15, '라울', 10_000)
    await registerApi(page, b, 16, '홍옥', 8_000)
    await connectExtension(context, page, extId, b)
    await linkTiktokNoWait(page)
    // 멈춤(그런 아이디 없음)이면 지금 조건대로 알림 띠
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toBeVisible({ timeout: 20_000 })

    const tab = await openTiktok(context, `/@${tiktokId}/live`)
    await expect(routeLine(page)).toHaveText(ROUTE.EXTENSION, { timeout: 20_000 })
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toHaveCount(0)
    const region = consoleTiktok(page)
    await expect(region.getByRole('button', { name: '댓글 붙여넣기' })).toBeVisible()
    await expect(region.getByRole('button', { name: '댓글 붙여넣기' })).not.toHaveClass(/button-primary/)
    await addTtComment(tab, { nickname: '닫기전손님', text: '15' })
    await expect(boardItem(page, 15)).toContainText('닫기전손님', { timeout: 15_000 })

    await tab.close()
    // 30초 넘게 상태가 없으면 서버가 스스로 알린다 (새로고침 없이)
    await expect(region.getByText(WARN.STALE, { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(routeLine(page)).toHaveCount(0)
    const strip = page.getByRole('button', { name: PASTE_ALERT })
    await expect(strip).toBeVisible()
    await noDevWords(page)

    // 붙여넣기로 넣는 흐름은 그대로
    await region.getByRole('button', { name: '댓글 붙여넣기' }).click()
    const dlg = pasteDialog(page)
    await dlg.getByLabel('붙여 넣을 댓글').fill('붙임손님: 16')
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await dlg.getByRole('button', { name: '찜 1개 넣기' }).click()
    await expect(page.getByText('찜 1개를 넣었어요.')).toBeVisible()
    await expect(boardItem(page, 16)).toContainText('붙임손님')
    expect(claimsOf(await scopeView(page, date, false), b, 16)).toBe(1)
  })
})
