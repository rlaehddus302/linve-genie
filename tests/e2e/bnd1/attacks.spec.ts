// BND1 E2E — 흐름 깨뜨리기: 잇는 중 새로 고침·네트워크 끊김·확인 경쟁·호출 한도·다시 시도·키보드만 (AC-BND1-41·50·52·53·72·73·74·77). 여러 플랫폼 묶음(@multi).
import { expect, test, type Route } from '@playwright/test'
import {
  READ_WAIT,
  T,
  alertStrip,
  band,
  bandSettings,
  bandComment,
  bandUser,
  bandWorld,
  boardItem,
  chatPanel,
  cleanupBand,
  consoleBand,
  escapeRe,
  linkView,
  linkedBroadcast,
  loginAs,
  openRealBroadcast,
  registerApi,
  scopeView,
} from './support.ts'

test.describe('BND1 흐름 깨뜨리기 @multi', () => {
  test.describe.configure({ timeout: 300_000 })
  test.afterEach(async ({ page }) => {
    await cleanupBand(page)
  })

  test('잇는 중(기준선 읽기가 늦음) 새로 고침 → 연결은 하나, 다시 열면 읽는 중·기준선 문장 · 다시 잇기 단추 없음 @multi', async ({ page }) => {
    const w = await bandWorld(page)
    const { b, date } = await openRealBroadcast(page)
    await registerApi(page, b, 1, '핑크프릴', 12_000)
    await band(page.request, 'delay', { op: 'comments', ms: 3000 })
    const region = consoleBand(page)
    await region.getByRole('button', { name: T.linkStart }).click()
    await page.getByRole('dialog', { name: '밴드 고르기' }).getByRole('button', { name: new RegExp(escapeRe(w.bandAName)) }).click()
    await page.getByRole('dialog', { name: '내 글 고르기' }).getByRole('button', { name: new RegExp(escapeRe(w.postLine)) }).click()
    const sent = page.waitForRequest((r) => r.url().endsWith(`/api/broadcasts/${b}/band/link`) && r.method() === 'POST')
    await page.getByRole('dialog', { name: '이 글 잇기' }).getByRole('button', { name: '잇기', exact: true }).click()
    await sent
    await page.reload()
    await band(page.request, 'delay', { op: 'comments', ms: 0 })
    await expect(consoleBand(page).getByText(T.reading)).toBeVisible({ timeout: READ_WAIT })
    await expect(consoleBand(page).getByText(T.baseline(3))).toBeVisible()
    await expect(consoleBand(page).getByRole('button', { name: T.linkStart })).toHaveCount(0)
    const live = (await (await page.request.get(`/api/broadcasts/${b}/live`)).json()) as { links: { platform: string }[] }
    expect(live.links.filter((l) => l.platform === 'BAND')).toHaveLength(1)
    // 이은 뒤 댓글은 그대로 들어온다
    await bandComment(page.request, w.post, { content: '1번', name: '새로고침손님', userKey: await bandUser(page.request, '새로고침손님') })
    await expect(boardItem(page, 1)).toContainText('새로고침손님', { timeout: READ_WAIT })
    expect((await scopeView(page, date, false)).claims).toHaveLength(1)
  })

  test('네트워크가 끊긴 동안 달린 댓글 → 다시 붙으면 새로 고침 없이 보드·밴드 칸 수가 맞고 두 번 들어오지 않는다 @multi', async ({ page, context }) => {
    const w = await bandWorld(page)
    const { b, date } = await linkedBroadcast(page, w)
    await context.setOffline(true)
    const guests = await Promise.all(['끊김손님1', '끊김손님2'].map((n) => bandUser(page.request, n)))
    for (const [i, g] of guests.entries()) await bandComment(page.request, w.post, { content: '1번', name: `끊김손님${String(i + 1)}`, userKey: g })
    // 서버는 그 동안에도 기록한다
    await expect.poll(async () => (await linkView(page, b)).received, { timeout: READ_WAIT }).toBe(2)
    await context.setOffline(false)
    await expect(boardItem(page, 1)).toContainText('끊김손님1', { timeout: 30_000 })
    await expect(consoleBand(page).getByText('받은 댓글 2개')).toBeVisible({ timeout: 30_000 })
    await expect(chatPanel(page).getByText('끊김손님2')).toHaveCount(1)
    expect((await scopeView(page, date, false)).claims).toHaveLength(2)
  })

  test('AC-BND1-41·74: 휴대폰의 "확인했어요"가 오가는 사이 새 지운 댓글 → 확인은 본 번호까지만 — 두 기기 모두 알림 띠 "…1개 있어요."가 남는다 @multi', async ({ page, browser }) => {
    const w = await bandWorld(page)
    const { b } = await linkedBroadcast(page, w)
    const g = await Promise.all(['확인손님1', '확인손님2'].map((n) => bandUser(page.request, n)))
    const k1 = await bandComment(page.request, w.post, { content: '1번', name: '확인손님1', userKey: g[0]! })
    const k2 = await bandComment(page.request, w.post, { content: '1번 저도요', name: '확인손님2', userKey: g[1]! })
    await expect(chatPanel(page).getByText('1번 저도요')).toBeVisible({ timeout: READ_WAIT })
    await band(page.request, 'drop', { postKey: w.post, commentKey: k1 })
    await expect(alertStrip(page).getByText(T.edits(1))).toBeVisible({ timeout: READ_WAIT })
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    const phone = await ctx.newPage()
    try {
      await loginAs(phone, w.seller)
      await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(alertStrip(phone).getByText(T.edits(1))).toBeVisible()
      // 휴대폰의 확인 요청을 붙잡아 둔다
      let held: Route | null = null
      await phone.route(`**/api/broadcasts/${b}/band/notices-seen`, (route) => {
        held = route
      })
      await consoleBand(phone).getByRole('button', { name: T.seen }).click()
      await expect.poll(() => held !== null).toBe(true)
      // 그 사이 새 지운 댓글
      await band(page.request, 'drop', { postKey: w.post, commentKey: k2 })
      await expect(alertStrip(page).getByText(T.edits(2))).toBeVisible({ timeout: READ_WAIT })
      await (held as unknown as Route).continue()
      await expect(alertStrip(page).getByText(T.edits(1))).toBeVisible({ timeout: READ_WAIT })
      await expect(alertStrip(phone).getByText(T.edits(1))).toBeVisible({ timeout: READ_WAIT })
      const view = await linkView(page, b)
      expect(view.notices.unseenEdits).toBe(1)
      expect(view.notices.items.filter((n) => !n.seen)).toHaveLength(1)
    } finally {
      await ctx.close()
    }
  })

  test('AC-BND1-77: 키보드만으로 밴드 글 잇기(고르기·확인)·확인했어요·끊기 @multi', async ({ page }) => {
    const w = await bandWorld(page)
    const { b } = await openRealBroadcast(page)
    await registerApi(page, b, 1, '핑크프릴', 12_000)
    const region = consoleBand(page)
    await region.getByRole('button', { name: T.linkStart }).focus()
    await page.keyboard.press('Enter')
    const bandBtn = page.getByRole('dialog', { name: '밴드 고르기' }).getByRole('button', { name: new RegExp(escapeRe(w.bandAName)) })
    await expect(bandBtn).toBeVisible()
    await bandBtn.focus()
    await page.keyboard.press('Enter')
    const postBtn = page.getByRole('dialog', { name: '내 글 고르기' }).getByRole('button', { name: new RegExp(escapeRe(w.postLine)) })
    await expect(postBtn).toBeVisible()
    await postBtn.focus()
    await page.keyboard.press('Space')
    const go = page.getByRole('dialog', { name: '이 글 잇기' }).getByRole('button', { name: '잇기', exact: true })
    await expect(go).toBeVisible()
    // 창 안에서 Tab으로 "잇기"까지
    for (let i = 0; i < 6 && !(await go.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press('Tab')
    await expect(go).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(region.getByText(T.reading)).toBeVisible()
    const key = await bandComment(page.request, w.post, { content: '1번', name: '키보드손님', userKey: await bandUser(page.request, '키보드손님') })
    await expect(boardItem(page, 1)).toContainText('키보드손님', { timeout: READ_WAIT })
    await band(page.request, 'drop', { postKey: w.post, commentKey: key })
    const seen = region.getByRole('button', { name: T.seen })
    await expect(seen).toBeVisible({ timeout: READ_WAIT })
    await seen.focus()
    await page.keyboard.press('Enter')
    await expect(alertStrip(page).getByText(T.edits(1))).toHaveCount(0)
    await region.getByRole('button', { name: '끊기', exact: true }).focus()
    await page.keyboard.press('Enter')
    const dlg = page.getByRole('dialog', { name: '밴드 연결 끊기' })
    const off = dlg.getByRole('button', { name: '끊기', exact: true })
    for (let i = 0; i < 4 && !(await off.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press('Tab')
    await expect(off).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(region.getByText(T.unlinked, { exact: true })).toBeVisible()
  })

  test('AC-BND1-53·50: 호출 한도(1003) → 밴드 칸 "밴드가 잠시 쉬어 달라고 해서 {N}초 뒤에 다시 읽어요." @multi', async ({ page }) => {
    const w = await bandWorld(page)
    const { b } = await linkedBroadcast(page, w)
    await band(page.request, 'fail', { op: 'comments', resultCode: 1003, times: 1 })
    await expect(consoleBand(page).getByText(/^밴드가 잠시 쉬어 달라고 해서 \d+초 뒤에 다시 읽어요\.$/)).toBeVisible({ timeout: READ_WAIT })
    const view = await linkView(page, b)
    expect(view.state).toBe('RETRYING')
    const n = Number(/(\d+)초/.exec(view.message ?? '')?.[1])
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(30)
    await band(page.request, 'clear')
    await expect(consoleBand(page).getByText(T.reading)).toBeVisible({ timeout: 60_000 })
  })

  test('AC-BND1-52·73: 계속 읽지 못하면 "밴드 댓글을 읽지 못해 다시 시도하고 있어요." → 60초 넘게 이어지면 알림 띠 "밴드 댓글이 들어오지 않아요." → 나으면 띠 사라짐·그 사이 댓글 들어옴 @multi', async ({ page }) => {
    const w = await bandWorld(page)
    const { b } = await linkedBroadcast(page, w)
    await band(page.request, 'fail', { op: 'comments', http: 500, times: 1000 })
    await expect(consoleBand(page).getByText('밴드 댓글을 읽지 못해 다시 시도하고 있어요.', { exact: true })).toBeVisible({ timeout: READ_WAIT })
    await expect(alertStrip(page).getByText(T.notComing)).toHaveCount(0)
    // 띠는 마지막으로 읽은 때부터 60초가 넘어야 — 화면이 그때 맞춰 다시 그린다
    await expect(alertStrip(page).getByText(T.notComing)).toBeVisible({ timeout: 90_000 })
    await bandComment(page.request, w.post, { content: '1번', name: '다시시도손님', userKey: await bandUser(page.request, '다시시도손님') })
    await band(page.request, 'clear')
    // 다시 시도 시간표 10·20·40·80초 — 다음 차례가 오면 읽는다
    await expect(consoleBand(page).getByText(T.reading)).toBeVisible({ timeout: 120_000 })
    await expect(boardItem(page, 1)).toContainText('다시시도손님', { timeout: READ_WAIT })
    await expect(alertStrip(page).getByText(T.notComing)).toHaveCount(0)
    expect((await linkView(page, b)).state).toBe('READING')
  })

  test('두 기기가 같은 방송에 동시에 잇기 → 연결은 하나, 늦은 쪽은 서버 문장 그대로 · 두 화면 모두 같은 글로 읽는 중 @multi', async ({ page, browser }) => {
    const w = await bandWorld(page)
    const { b } = await openRealBroadcast(page)
    await registerApi(page, b, 1, '핑크프릴', 12_000)
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    const phone = await ctx.newPage()
    try {
      await loginAs(phone, w.seller)
      await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
      // 두 화면 모두 확인 창까지
      for (const p of [page, phone]) {
        await consoleBand(p).getByRole('button', { name: T.linkStart }).click()
        await p.getByRole('dialog', { name: '밴드 고르기' }).getByRole('button', { name: new RegExp(escapeRe(w.bandAName)) }).click()
        await p.getByRole('dialog', { name: '내 글 고르기' }).getByRole('button', { name: new RegExp(escapeRe(w.postLine)) }).click()
        await expect(p.getByRole('dialog', { name: '이 글 잇기' }).getByText(T.confirm)).toBeVisible()
      }
      await band(page.request, 'delay', { op: 'comments', ms: 1500 })
      await Promise.all([page, phone].map((p) => p.getByRole('dialog', { name: '이 글 잇기' }).getByRole('button', { name: '잇기', exact: true }).click()))
      await band(page.request, 'delay', { op: 'comments', ms: 0 })
      const already = '이 방송에는 이미 밴드 글이 이어져 있어요. 먼저 연결을 끊어 주세요.'
      // 한쪽은 창이 닫히고 다른 쪽은 서버 문장 (또는 같은 결과로 닫힘)
      for (const p of [page, phone]) {
        const dlg = p.getByRole('dialog', { name: '이 글 잇기' })
        await expect(dlg.getByText(already).or(consoleBand(p).getByText(T.reading)).first()).toBeVisible({ timeout: 30_000 })
        if (await dlg.isVisible()) await dlg.getByRole('button', { name: '닫기' }).click()
        await expect(consoleBand(p).getByText(T.reading)).toBeVisible({ timeout: READ_WAIT })
      }
      const live = (await (await page.request.get(`/api/broadcasts/${b}/live`)).json()) as { links: { platform: string }[] }
      expect(live.links.filter((l) => l.platform === 'BAND')).toHaveLength(1)
      expect((await linkView(page, b)).baseline).toBe(3)
    } finally {
      await ctx.close()
    }
  })

  test('AC-BND1-70: 다른 기기에서 밴드 연결을 끊으면 열어 둔 설정 칸이 새로 고침 없이 "연결 안 됨" · 콘솔 밴드 칸은 끊긴 사유 @multi', async ({ page, browser }) => {
    const w = await bandWorld(page)
    const { b } = await linkedBroadcast(page, w)
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    const phone = await ctx.newPage()
    try {
      await loginAs(phone, w.seller)
      await phone.goto('/settings/band')
      await expect(bandSettings(phone).getByText(`연결됨 — ${w.profileName}`)).toBeVisible()
      await page.goto('/settings/band')
      await bandSettings(page).getByRole('button', { name: '연결 끊기' }).click()
      await page.getByRole('dialog', { name: '밴드 연결 끊기' }).getByRole('button', { name: '끊기', exact: true }).click()
      await expect(bandSettings(page).getByText(T.notConnected, { exact: true })).toBeVisible()
      await expect(bandSettings(phone).getByText(T.notConnected, { exact: true })).toBeVisible({ timeout: 5_000 })
      await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await phone.setViewportSize({ width: 1280, height: 800 })
      await expect(consoleBand(phone).getByText('밴드 연결을 끊어서 밴드 글 연결을 끝냈어요.', { exact: true })).toBeVisible()
      expect((await linkView(page, b)).state).toBe('FINISHED')
    } finally {
      await ctx.close()
    }
  })

  test('AC-BND1-77: 프로필 이름·밴드 이름·글 첫 줄에 넣은 태그 모양도 글자로만 @multi', async ({ page }) => {
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(d.message())
      void d.dismiss()
    })
    const { loginNewSeller } = await import('./support.ts')
    await loginNewSeller(page)
    const profile = '<img src=p onerror=alert(3)>사장'
    const me = await bandUser(page.request, profile)
    const evilBand = '<svg onload=alert(4)>밴드'
    const bk = await (await import('./support.ts')).bandBand(page.request, evilBand, [me])
    await (await import('./support.ts')).bandPost(page.request, bk, me, '공지 &lt;img src=q onerror=alert(5)&gt;')
    await (await import('./support.ts')).connectBandUi(page, me, profile)
    const { b } = await openRealBroadcast(page)
    expect(b).toBeTruthy()
    await consoleBand(page).getByRole('button', { name: T.linkStart }).click()
    const posts = page.getByRole('dialog', { name: '내 글 고르기' })
    await expect(posts.getByText(evilBand, { exact: true })).toBeVisible()
    await expect(posts.getByText('공지 <img src=q onerror=alert(5)>', { exact: true })).toBeVisible()
    await expect(page.locator('img[src="p"], img[src="q"], svg[onload]')).toHaveCount(0)
    expect(dialogs).toEqual([])
  })
})
