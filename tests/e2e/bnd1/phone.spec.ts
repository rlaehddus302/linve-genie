// BND1 E2E — 휴대폰 우선·이스케이프·보조자·두 기기 (AC-BND1-70·71·74·76·77, AC-BND1-80 ⑩). 여러 플랫폼 묶음(@multi) + 아이폰 크기 WebKit(@webkit).
// 기대값: 375·393(WebKit)·412·430 폭과 글자 150%에서 가로 스크롤 없음·누르는 곳 44px 이상·고르기 창의 "더 보기"·"잇기"는 화면 아래쪽,
// 손님 이름·글·글 첫 줄·알림 글은 글자로만, 보조자에게 설정 칸 없음(콘솔은 열 수 없음), 다른 기기의 변화는 새로 고침 없이.
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  READ_WAIT,
  T,
  alertStrip,
  band,
  bandComment,
  bandPost,
  bandRequests,
  bandSettings,
  bandUser,
  bandWorld,
  boardItem,
  chatPanel,
  cleanupBand,
  consoleBand,
  escapeRe,
  linkBandUi,
  linkedBroadcast,
  loginAs,
  noHorizontalScroll,
  openRealBroadcast,
  registerApi,
  type BandWorld,
} from './support.ts'

/** 보이는 단추·링크가 모두 44px 이상 높이 (AC-BND1-76) */
async function bigTargets(scope: Locator): Promise<void> {
  const boxes = await scope.locator('button:visible, a:visible').evaluateAll((els) => els.map((el) => ({ text: (el.textContent ?? '').trim(), h: el.getBoundingClientRect().height })))
  const small = boxes.filter((b) => b.h < 44)
  expect(small, '44px보다 낮은 누르는 곳').toEqual([])
}

/** 글자가 잘리지 않는다: 안쪽 글이 칸보다 넓지 않다 (넘쳐서 숨은 글자 없음) */
async function noClipped(scope: Locator): Promise<void> {
  const clipped = await scope.locator('p, strong, span, button, a, li').evaluateAll((els) =>
    els
      .filter((el) => {
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        const hides = style.overflow === 'hidden' || style.overflowX === 'hidden' || style.textOverflow === 'ellipsis'
        return hides && el.scrollWidth > el.clientWidth + 1
      })
      .map((el) => (el.textContent ?? '').trim().slice(0, 40)),
  )
  expect(clipped, '잘린 글자').toEqual([])
}

async function rootFont(page: Page, percent: number): Promise<void> {
  await page.addStyleTag({ content: `html { font-size: ${String(percent)}% !important; }` })
}

/** 화면 아래쪽(엄지)에 있는지 — 단추 위끝이 화면 높이의 절반보다 아래 */
async function nearBottom(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThan(page.viewportSize()!.height / 2)
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
}

/** 휴대폰에서 한 흐름: 설정 칸 → 콘솔 밴드 칸 → 고르기(더 보기) → 확인 창 → 잇기 → 댓글·알림 — 단계마다 가로 스크롤·44px·잘림 */
async function phoneFlow(page: Page, w: BandWorld, percent: number): Promise<void> {
  // 내 글 25개 → 첫 쪽(가짜 쪽 크기 20)에 다 들어오지 않아 "더 보기"
  for (let i = 0; i < 24; i += 1) await bandPost(page.request, w.bandA, w.me, `지난 공지 ${String(i)}`, Date.now() - 86_400_000 - i * 1000)
  await page.goto('/settings/band')
  if (percent !== 100) await rootFont(page, percent)
  await expect(bandSettings(page).getByText(`연결됨 — ${w.profileName}`)).toBeVisible()
  await noHorizontalScroll(page)
  await bigTargets(bandSettings(page))
  await noClipped(bandSettings(page))

  const { b } = await openRealBroadcast(page)
  if (percent !== 100) await rootFont(page, percent)
  await registerApi(page, b, 1, '핑크프릴', 12_000)
  const region = consoleBand(page)
  await expect(region.getByRole('button', { name: T.linkStart })).toBeVisible()
  await noHorizontalScroll(page)
  await region.getByRole('button', { name: T.linkStart }).click()
  const pickBand = page.getByRole('dialog', { name: '밴드 고르기' })
  await expect(pickBand.getByRole('list', { name: '가입한 밴드' })).toBeVisible()
  await noHorizontalScroll(page)
  await bigTargets(pickBand)
  await pickBand.getByRole('button', { name: new RegExp(escapeRe(w.bandAName)) }).click()
  const posts = page.getByRole('dialog', { name: '내 글 고르기' })
  const more = posts.getByRole('button', { name: '더 보기' })
  await expect(more).toBeVisible()
  await noHorizontalScroll(page)
  await bigTargets(posts)
  await noClipped(posts)
  // 글이 한 쪽(20개) 가득이면 창이 화면보다 길다 — 끝까지 내려 보면 "더 보기"가 화면 아래쪽(엄지 쪽)에 있다
  await more.scrollIntoViewIfNeeded()
  await nearBottom(page, more)
  await more.click()
  const list = posts.getByRole('list', { name: '내가 쓴 글' })
  await expect(list.getByRole('button', { name: /지난 공지 23/ })).toBeVisible()
  // 창 안에서 끝까지 내려 볼 수 있다 — 마지막 글을 눌러 확인 창으로
  await list.getByRole('button', { name: new RegExp(escapeRe(w.postLine)) }).scrollIntoViewIfNeeded()
  await list.getByRole('button', { name: new RegExp(escapeRe(w.postLine)) }).click()
  const confirm = page.getByRole('dialog', { name: '이 글 잇기' })
  await expect(confirm.getByText(T.confirm)).toBeVisible()
  await noHorizontalScroll(page)
  await bigTargets(confirm)
  await noClipped(confirm)
  await nearBottom(page, confirm.getByRole('button', { name: '잇기', exact: true }))
  await confirm.getByRole('button', { name: '잇기', exact: true }).click()
  await expect(region.getByText(T.reading)).toBeVisible()
  const guest = await bandUser(page.request, '폰손님')
  const key = await bandComment(page.request, w.post, { content: '1번', name: '폰손님', userKey: guest })
  await expect(boardItem(page, 1)).toContainText('폰손님', { timeout: READ_WAIT })
  await band(page.request, 'drop', { postKey: w.post, commentKey: key })
  await expect(region.getByRole('list', { name: '밴드 알림' }).getByText(T.deleted('폰손님', '1번'))).toBeVisible({ timeout: READ_WAIT })
  await noHorizontalScroll(page)
  await bigTargets(region)
  await noClipped(region)
}

test.describe('BND1 휴대폰 @multi', () => {
  test.describe.configure({ timeout: 240_000 })
  test.afterEach(async ({ page }) => {
    await cleanupBand(page)
  })

  for (const [width, height, percent] of [
    [375, 812, 100],
    [412, 915, 100],
    [430, 932, 100],
    [375, 812, 150],
    [412, 915, 150],
  ] as const) {
    test(`AC-BND1-76·80 ⑩: ${String(width)}×${String(height)} 글자 ${String(percent)}% — 설정 칸·밴드 칸·고르기 창·확인 창·알림 목록에 가로 스크롤 없음·44px·안 잘림·"더 보기"·"잇기"는 아래쪽 @multi`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      const w = await bandWorld(page)
      await phoneFlow(page, w, percent)
    })
  }

  test('AC-BND1-76: 1440×900(PC)에서도 같은 흐름이 된다 @multi', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const w = await bandWorld(page)
    await linkedBroadcast(page, w)
    const guest = await bandUser(page.request, 'PC손님')
    await bandComment(page.request, w.post, { content: '1번', name: 'PC손님', userKey: guest })
    await expect(boardItem(page, 1)).toContainText('PC손님', { timeout: READ_WAIT })
    await noHorizontalScroll(page)
  })

  test('AC-BND1-71: 휴대폰(48rem 미만)에서 연결 안 한 판매자의 "설정으로"뿐인 밴드 칸은 그리지 않는다 · PC에서는 그린다 @multi', async ({ page }) => {
    const { loginNewSeller } = await import('./support.ts')
    await loginNewSeller(page)
    await page.setViewportSize({ width: 375, height: 812 })
    await openRealBroadcast(page)
    await expect(page.getByRole('region', { name: '상품 보드' })).toBeVisible()
    await expect(consoleBand(page)).toHaveCount(0)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.reload()
    await expect(consoleBand(page).getByText(T.needConnect, { exact: true })).toBeVisible()
  })

  test('AC-BND1-77·80 ⑩: 손님 이름 <img onerror>·본문 &lt;script&gt;·글 첫 줄·알림 글은 글자 그대로, 대화 상자·스크립트 없음 @multi', async ({ page }) => {
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(d.message())
      void d.dismiss()
    })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.addInitScript(() => {
      ;(window as unknown as { __xss: number }).__xss = 0
    })
    const w = await bandWorld(page, { baseline: 0 })
    const evilLine = '<b>굵게</b> &lt;i&gt;공지'
    const evilPost = await bandPost(page.request, w.bandA, w.me, evilLine)
    const { b } = await openRealBroadcast(page)
    await registerApi(page, b, 1, '핑크프릴', 12_000)
    await consoleBand(page).getByRole('button', { name: T.linkStart }).click()
    await page.getByRole('dialog', { name: '밴드 고르기' }).getByRole('button', { name: new RegExp(escapeRe(w.bandAName)) }).click()
    const posts = page.getByRole('dialog', { name: '내 글 고르기' })
    // 첫 줄은 D-BND1-04로 바꾼 글 — 태그가 되지 않고 글자로
    const evilButton = posts.getByRole('list', { name: '내가 쓴 글' }).getByRole('button').filter({ hasText: '공지' }).filter({ hasNotText: w.postLine })
    await expect(evilButton).toHaveCount(1)
    await expect(posts.locator('b, i')).toHaveCount(0)
    await evilButton.click()
    await page.getByRole('dialog', { name: '이 글 잇기' }).getByRole('button', { name: '잇기', exact: true }).click()
    await expect(consoleBand(page).getByText(T.reading)).toBeVisible()
    expect(evilPost).toBeTruthy()
    const nick = '<img src=x onerror=alert(1)>'
    const guest = await bandUser(page.request, nick)
    const key = await bandComment(page.request, evilPost, { content: '&lt;script&gt;alert(1)&lt;/script&gt; 1번', name: nick, userKey: guest })
    const chat = chatPanel(page)
    await expect(chat.getByText('<script>alert(1)</script> 1번')).toBeVisible({ timeout: READ_WAIT })
    await expect(chat.getByText(nick).first()).toBeVisible()
    await band(page.request, 'edit', { postKey: evilPost, commentKey: key, content: '&lt;img src=y onerror=alert(2)&gt; 고침' })
    await expect(consoleBand(page).getByRole('list', { name: '밴드 알림' }).getByText(T.edited(nick, '<script>alert(1)</script> 1번', '<img src=y onerror=alert(2)> 고침'))).toBeVisible({ timeout: READ_WAIT })
    await expect(page.locator('main img[src="x"], main img[src="y"], main script')).toHaveCount(0)
    expect(dialogs).toEqual([])
    expect(errors).toEqual([])
  })

  test('AC-BND1-70·71·80 ⑩: 보조자 — 설정에 "네이버 밴드" 칸 없음, 콘솔은 열 수 없고 밴드 쓰기 요청 0 @multi', async ({ page, browser }) => {
    const w = await bandWorld(page, { baseline: 0, oneBand: true })
    const { b } = await linkedBroadcast(page, w)
    const origin = new URL(page.url()).origin
    const res = await page.request.post('/api/assistants', { data: { name: '밴드보조' }, headers: { Origin: origin } })
    const { assistant, password } = (await res.json()) as { assistant: { loginId: string }; password: string }
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    const phone = await ctx.newPage()
    const bandCalls: string[] = []
    phone.on('request', (r) => {
      const path = new URL(r.url()).pathname
      if (path.startsWith('/api/band') || /\/band(\/|$)/.test(path)) bandCalls.push(`${r.method()} ${path}`)
    })
    try {
      await loginAs(phone, { loginId: assistant.loginId, password })
      await phone.goto('/settings/band')
      await expect(bandSettings(phone)).toHaveCount(0)
      await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(phone.getByText('문자찜 입력만', { exact: false }).first()).toBeVisible()
      await expect(consoleBand(phone)).toHaveCount(0)
      expect(bandCalls.filter((c) => c.startsWith('POST'))).toEqual([])
      // 보조자의 쓰기 경로는 403 (AC-BND1-15)
      const tryLink = await phone.request.post(`/api/broadcasts/${encodeURIComponent(b)}/band/unlink`, { data: { requestId: crypto.randomUUID() }, headers: { Origin: origin } })
      expect(tryLink.status()).toBe(403)
      const view = await phone.request.get(`/api/broadcasts/${encodeURIComponent(b)}/band`)
      expect(view.status()).toBe(200)
    } finally {
      await ctx.close()
    }
  })

  test('두 기기: PC에서 잇기 → 휴대폰 콘솔 밴드 칸이 새로 고침 없이 "읽고 있어요" · 휴대폰에서 "확인했어요" → PC 알림 띠 줄 사라짐 @multi', async ({ page, browser }) => {
    const w = await bandWorld(page)
    const { b } = await openRealBroadcast(page)
    await registerApi(page, b, 1, '핑크프릴', 12_000)
    const seller = w.seller
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    const phone = await ctx.newPage()
    try {
      await loginAs(phone, seller)
      await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(consoleBand(phone).getByRole('button', { name: T.linkStart })).toBeVisible()
      await linkBandUi(page, w)
      await expect(consoleBand(phone).getByText(T.reading)).toBeVisible({ timeout: 5_000 })
      const guest = await bandUser(page.request, '두기기손님')
      const key = await bandComment(page.request, w.post, { content: '1번', name: '두기기손님', userKey: guest })
      await expect(boardItem(phone, 1)).toContainText('두기기손님', { timeout: READ_WAIT })
      await band(page.request, 'drop', { postKey: w.post, commentKey: key })
      await expect(alertStrip(page).getByText(T.notices(1))).toBeVisible({ timeout: READ_WAIT })
      await expect(alertStrip(phone).getByText(T.notices(1))).toBeVisible({ timeout: READ_WAIT })
      await consoleBand(phone).getByRole('button', { name: T.seen }).click()
      await expect(alertStrip(phone).getByText(T.notices(1))).toHaveCount(0)
      await expect(alertStrip(page).getByText(T.notices(1))).toHaveCount(0, { timeout: 5_000 })
      // 두 기기가 같은 "확인했어요"를 거의 함께 눌러도 오류 없이 같다
      expect((await bandRequests(page.request)).onlyAllowed).toBe(true)
    } finally {
      await ctx.close()
    }
  })
})

test.describe('BND1 아이폰 크기 WebKit @webkit', () => {
  test.describe.configure({ timeout: 240_000 })
  test.afterEach(async ({ page }) => {
    await cleanupBand(page)
  })

  test('AC-BND1-76·80 ⑩: 393×852 WebKit — 연결·고르기(더 보기)·확인 창·잇기·댓글·알림에 가로 스크롤 없음·44px·"더 보기"·"잇기"는 아래쪽 @webkit', async ({ page }) => {
    const w = await bandWorld(page)
    await phoneFlow(page, w, 100)
  })
})
