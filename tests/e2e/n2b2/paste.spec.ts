// N2b-2 E2E — 막힘 → 알림 줄 → 붙여넣기 창 (AC-N2b-2-62·64·80 ④⑥⑦⑧). 여러 플랫폼 묶음(@multi).
import { expect, test } from '@playwright/test'
import {
  PASTE_ALERT,
  boardItem,
  consoleTiktok,
  history,
  linkTiktokUi,
  loginAs,
  noHorizontalScroll,
  openRealBroadcast,
  pasteDialog,
  registerApi,
  scopeView,
  tiktokSeller,
  tt,
  ttComment,
  CONNECT_WAIT,
  unlinkTiktok,
} from './support.ts'

test.describe('N2b-2 붙여넣기 @multi', () => {
  // 서버 전체 연결 시도 한도(60초에 30번) 때문에 잇기·다시 붙기가 최대 60초 미뤄질 수 있다 (support.ts CONNECT_WAIT)
  test.describe.configure({ timeout: 300_000 })
  test.afterEach(async ({ page }) => {
    await unlinkTiktok(page)
  })
  test('AC-N2b-2-80 ④ 막힘 → 틱톡 칸 문장·알림 줄 → 붙여넣기 미리 보기(줄 결과·같은 닉네임 묶음) → 넣기 → 보드에 찜 @multi', async ({ page }) => {
    const { tiktokId } = await tiktokSeller(page)
    const { b, date } = await openRealBroadcast(page)
    for (const no of [15, 16, 28]) await registerApi(page, b, no, `상품${String(no)}`, 10_000)
    await expect(boardItem(page, 28)).toBeVisible()
    await linkTiktokUi(page)
    // 막힘 두 번(가짜 웹캐스트의 실패 대기열은 서버 전체 하나 — 이 판매자의 다시 시도가 다 써서 다음 시험에 남지 않게 끝에서 다시 붙기를 기다린다)
    await tt(page.request, 'block', { uniqueId: tiktokId, times: 2 })
    const region = consoleTiktok(page)
    await expect(region.getByText('틱톡이 연결을 막아 다시 시도하는 중이에요. 그동안 댓글을 직접 넣어 주세요.')).toBeVisible({ timeout: CONNECT_WAIT })
    // 알림 줄(고정 영역) — 누르면 붙여넣기 창
    const alertLine = page.getByRole('button', { name: PASTE_ALERT })
    await expect(alertLine).toBeVisible()
    // 칸의 주 단추는 "댓글 붙여넣기" — 화면마다 주 단추 하나
    await expect(region.locator('.button-primary')).toHaveText('댓글 붙여넣기')
    await alertLine.click()
    const dlg = pasteDialog(page)
    await expect(dlg.getByText("틱톡 화면의 댓글을 '닉네임: 댓글' 한 줄씩 붙여 넣어 주세요.")).toBeVisible()
    await dlg.getByLabel('붙여 넣을 댓글').fill(['꽃집손님: 15', '구경꾼: 예뻐요', '꽃집손님: 16 28', '이름없는줄', '취소손님: 15 취소'].join('\n'))
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    const rows = dlg.getByRole('list', { name: '줄마다 결과' })
    await expect(rows.getByRole('listitem')).toHaveCount(5)
    await expect(rows.getByRole('listitem').nth(0)).toContainText('15번 찜')
    await expect(rows.getByRole('listitem').nth(1)).toContainText('주문이 아니라 넣지 않아요.')
    await expect(rows.getByRole('listitem').nth(2)).toContainText('16번·28번 찜')
    await expect(rows.getByRole('listitem').nth(3)).toContainText('닉네임: 댓글 모양이 아니에요.')
    await expect(rows.getByRole('listitem').nth(4)).toContainText('취소는 붙여넣기로 넣지 않아요. 찜 목록에서 취소해 주세요.')
    await expect(dlg.getByRole('list', { name: '같은 닉네임' })).toContainText('같은 닉네임 2줄은 한 구매자로 넣어요')
    await dlg.getByRole('button', { name: '찜 3개 넣기' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(page.getByText('찜 3개를 넣었어요.')).toBeVisible()
    await expect(boardItem(page, 15)).toContainText('꽃집손님')
    const view = await scopeView(page, date, false)
    const pasted = view.claims.filter((c) => [15, 16, 28].includes(c.no))
    expect(pasted).toHaveLength(3)
    // 같은 닉네임은 한 구매자
    expect(new Set(pasted.map((c) => c.currentBuyer)).size).toBe(1)
    await expect(region.getByText('틱톡 댓글을 받고 있어요.')).toBeVisible({ timeout: CONNECT_WAIT })
  })

  test('AC-N2b-2-64 넣기 응답을 잃어 다시 보내도 찜은 한 번 (같은 요청 번호) @multi', async ({ page }) => {
    await tiktokSeller(page)
    const { b, date } = await openRealBroadcast(page)
    await registerApi(page, b, 15, '라울', 10_000)
    await expect(boardItem(page, 15)).toBeVisible()
    await linkTiktokUi(page)
    const sent: string[] = []
    let first = true
    await page.route('**/paste', async (route) => {
      sent.push((route.request().postDataJSON() as { requestId: string }).requestId)
      if (first) {
        first = false
        // 서버는 처리하지만 응답은 화면에 닿지 않는다
        await route.fetch()
        await route.abort('connectionreset')
        return
      }
      await route.continue()
    })
    await page.getByRole('region', { name: '틱톡', exact: true }).getByRole('button', { name: '댓글 붙여넣기' }).click()
    const dlg = pasteDialog(page)
    await dlg.getByLabel('붙여 넣을 댓글').fill('한번손님: 15')
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    const go = dlg.getByRole('button', { name: '찜 1개 넣기' })
    await go.dblclick()
    // 자동 다시 보내기 또는 "다시 시도"로 끝까지
    const retry = dlg.getByRole('button', { name: '다시 시도' })
    await expect(dlg.or(page.getByText('찜 1개를 넣었어요.')).first()).toBeVisible()
    if (await retry.isVisible().catch(() => false)) await retry.click()
    await expect(page.getByText('찜 1개를 넣었어요.')).toBeVisible()
    expect(new Set(sent).size).toBe(1)
    const view = await scopeView(page, date, false)
    expect(view.claims.filter((c) => c.no === 15)).toHaveLength(1)
    const events = await history(page, date, false)
    expect(events.filter((e) => e.type === 'sms')).toHaveLength(1)
  })

  test('AC-N2b-2-80 ⑥ 틱톡 닉네임·붙여넣기 닉네임의 <img onerror>는 글자로만 @multi', async ({ page }) => {
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(d.message())
      void d.dismiss()
    })
    await page.addInitScript(() => {
      ;(window as unknown as { __xss: number }).__xss = 0
    })
    const { tiktokId } = await tiktokSeller(page)
    const { b } = await openRealBroadcast(page)
    await registerApi(page, b, 15, '라울', 10_000)
    await registerApi(page, b, 16, '홍옥', 10_000)
    await linkTiktokUi(page)
    const evil = '<img src=x onerror="window.__xss=1;alert(1)">'
    await ttComment(page.request, tiktokId, evil, '15')
    const chat = page.getByRole('region', { name: '채팅' })
    // 닉네임은 이름 정리(길이 줄임)를 거쳐도 글자로 보인다
    await expect(chat.getByText(/<img src=x onerror=/)).toBeVisible()
    await consoleTiktok(page).getByRole('button', { name: '댓글 붙여넣기' }).click()
    const dlg = pasteDialog(page)
    const evilPaste = '<img src=x onerror=window.__xss=2>'
    await dlg.getByLabel('붙여 넣을 댓글').fill(`${evilPaste}: 16`)
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await expect(dlg.getByRole('list', { name: '줄마다 결과' })).toContainText(/<img src=x onerror=/)
    await dlg.getByRole('button', { name: '찜 1개 넣기' }).click()
    await expect(page.getByText('찜 1개를 넣었어요.')).toBeVisible()
    await expect(boardItem(page, 16)).toContainText('<img')
    expect(await page.evaluate(() => (window as unknown as { __xss: number }).__xss)).toBe(0)
    expect(await page.locator('img[src="x"]').count()).toBe(0)
    expect(dialogs).toEqual([])
  })

  test('AC-N2b-2-80 ⑦ 보조자: 문자찜 화면에서 붙여넣기(실제 방송), 틱톡·인스타 설정 칸은 없음 @multi', async ({ page, browser }) => {
    await tiktokSeller(page)
    const title = `보조자 붙여넣기 ${String(Date.now())}`
    const { b, date } = await openRealBroadcast(page, { title })
    await registerApi(page, b, 15, '라울', 10_000)
    const created = await page.request.post('/api/assistants', { data: { name: '도우미' }, headers: { Origin: new URL(page.url()).origin } })
    expect(created.ok(), await created.text()).toBe(true)
    const { assistant, password } = (await created.json()) as { assistant: { loginId: string }; password: string }
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
    const p = await ctx.newPage()
    await loginAs(p, { loginId: assistant.loginId, password })
    await p.goto('/sms')
    const region = p.getByRole('region', { name: '고른 방송' })
    await expect(region).toContainText(title)
    await region.getByRole('button', { name: '댓글 붙여넣기' }).click()
    const dlg = pasteDialog(p)
    await dlg.getByLabel('붙여 넣을 댓글').fill('보조손님: 15')
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await dlg.getByRole('button', { name: '찜 1개 넣기' }).click()
    await expect(p.getByText('찜 1개를 넣었어요.')).toBeVisible()
    const view = await scopeView(page, date, false)
    expect(view.claims.filter((c) => c.no === 15)).toHaveLength(1)
    await p.goto('/settings/tiktok')
    await expect(p.getByRole('region', { name: '틱톡 라이브(베타)', exact: true })).toHaveCount(0)
    await expect(p.getByRole('region', { name: '인스타그램', exact: true })).toHaveCount(0)
    await ctx.close()
  })

  test('AC-N2b-2-80 ⑧ 375×812: 붙여넣기 창 가로 스크롤 없음·누르는 곳 44px @multi', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await tiktokSeller(page)
    const { b } = await openRealBroadcast(page)
    await registerApi(page, b, 15, '라울', 10_000)
    await linkTiktokUi(page)
    await consoleTiktok(page).getByRole('button', { name: '댓글 붙여넣기' }).click()
    const dlg = pasteDialog(page)
    const long = `${'아주긴닉네임'.repeat(8)}: ${'15 '.repeat(3)}${'꽃'.repeat(200)}`
    await dlg.getByLabel('붙여 넣을 댓글').fill([long, 'averyveryveryveryveryveryveryverylongasciinicknamewithoutspaces: 15', '짧은: 15'].join('\n'))
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await expect(dlg.getByRole('list', { name: '줄마다 결과' }).getByRole('listitem')).toHaveCount(3)
    await noHorizontalScroll(page)
    const dialogBox = await dlg.boundingBox()
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(375)
    for (const name of ['미리 보기', /^찜 \d+개 넣기$/]) {
      const box = await dlg.getByRole('button', { name }).boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  })
})
