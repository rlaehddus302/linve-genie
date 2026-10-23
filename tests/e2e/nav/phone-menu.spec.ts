// 휴대폰 메뉴 — 아래 막대 다섯 칸 + "더보기" 목록 (UX-04, D-NAV-01, AC-NAV-01~08) — test-e2e.
// 기대값은 SPEC UX-04 "휴대폰 메뉴"의 AC-NAV 표에서 정한다. 막대 밖 메뉴는 "더보기"를 연 뒤에 찾는다(AC-NAV-10).
import { expect, test, type Browser, type Page } from '@playwright/test'
import { loginAs, loginNewSeller, login, noHorizontalScroll, openNewBroadcast, registerApi, sendViewerChat, settingsRegion, smsApi, uniqueDate, viewerClaim } from '../i3/support.ts'
import { deposit, fakeSource, kstIso, postJson, uniq } from '../n3/support.ts'
import { BAR_CELLS, BAR_LINKS, barCells, closeMore, expectPhoneBar, expectTarget, fakeReviewCount, menu, menuLink, moreButton, moreLinks, moreList, openMore } from '../menu.ts'

const PHONE = { width: 375, height: 812 }
// T1(AC-T1-60, AC-NAV-09): "택배"는 판매자 목록의 "설정" 바로 앞
const LIST_ON = ['입금 확인', '포장', '라벨', '택배', '설정']
const LIST_OFF = ['입금 확인', '포장', '택배', '설정']

async function phoneOf(browser: Browser, like: Page, account?: { loginId: string; password: string }, viewport = PHONE): Promise<Page> {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(like.url()).origin })
  const page = await ctx.newPage()
  if (account === undefined) await login(page)
  else await loginAs(page, account)
  return page
}

async function setLabelsApi(page: Page, enabled: boolean): Promise<void> {
  const res = await page.request.put('/api/settings/labels', { data: { enabled }, headers: { Origin: new URL(page.url()).origin } })
  expect(res.status(), await res.text()).toBe(200)
}

const fontSize = async (page: Page, name: string) => await menu(page).getByRole('link', { name, exact: true }).or(menu(page).getByRole('button', { name, exact: true }))
  .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

/** 막대 모양 전체 (AC-NAV-01): 다섯 칸 한 줄·44px·화면 안·막대 64px 이하·가로 스크롤 없음·글자 16px 이상 */
async function expectBarShape(page: Page, where: string): Promise<void> {
  await expectPhoneBar(page)
  const nav = await menu(page).boundingBox()
  expect(nav!.height, `${where} 막대 높이`).toBeLessThanOrEqual(64)
  expect(nav!.y + nav!.height, `${where} 막대는 화면 아래`).toBeLessThanOrEqual(page.viewportSize()!.height + 0.5)
  await noHorizontalScroll(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth), where).toBeLessThanOrEqual(page.viewportSize()!.width)
  for (const name of BAR_CELLS) expect(await fontSize(page, name), `${where} ${name} 글자`).toBeGreaterThanOrEqual(16)
}

/** 목록 모양 (AC-NAV-02): 한 줄에 하나·44px·16px·화면 안·가로 스크롤 없음·목록 높이 ≤ 화면 60% */
async function expectListShape(page: Page, names: readonly (string | RegExp)[], where: string): Promise<void> {
  await expect(moreButton(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(moreLinks(page), where).toHaveText([...names])
  let prevBottom = -Infinity
  for (const link of await moreLinks(page).all()) {
    const box = await expectTarget(page, link)
    expect(box.y, `${where} 한 줄에 하나`).toBeGreaterThanOrEqual(prevBottom - 0.5)
    prevBottom = box.y + box.height
    expect(await link.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), where).toBeGreaterThanOrEqual(16)
  }
  const list = await moreList(page).boundingBox()
  expect(list!.height, `${where} 목록 높이`).toBeLessThanOrEqual(page.viewportSize()!.height * 0.6 + 0.5)
  expect(list!.y, where).toBeGreaterThanOrEqual(0)
  await noHorizontalScroll(page)
  // D-N4a-07: 이름이 "설정"인 링크는 화면 전체에 하나
  await expect(page.getByRole('link', { name: '설정', exact: true })).toHaveCount(1)
}

test.describe('AC-NAV-01·02: 막대 다섯 칸·목록 내용', () => {
  test('라벨 켜짐·꺼짐 × 확인 필요 0건·1234건 — 막대는 늘 다섯 칸 한 줄, 목록은 "입금 확인(수)"·"포장"·"라벨"·"설정"(켜짐 = 꺼짐 + 1)', async ({ page, browser }) => {
    test.setTimeout(180_000)
    const seller = await loginNewSeller(page)
    const phone = await phoneOf(browser, page, seller)
    try {
      for (const labels of [true, false]) {
        await setLabelsApi(page, labels)
        for (const review of [0, 1234]) {
          await fakeReviewCount(phone, review > 0 ? review : null)
          for (const path of ['/', '/sms', '/buyers', '/settlements', '/deposits', '/packing', '/settings']) {
            const where = `라벨 ${labels ? '켜짐' : '꺼짐'} · 확인 ${String(review)} · ${path}`
            await phone.goto(path)
            await expect(phone.getByRole('button', { name: '로그아웃' })).toBeVisible()
            await expectBarShape(phone, where)
            await expect(menu(phone).getByRole('link'), `${where} 닫힌 메뉴 링크 넷`).toHaveCount(4)
            await openMore(phone)
            const names = (labels ? LIST_ON : LIST_OFF).map((n) => (n === '입금 확인' && review > 0 ? `입금 확인 ${String(review)}` : n))
            await expectListShape(phone, names, where)
            // "더보기"에는 수를 붙이지 않는다 (AC-NAV-05)
            await expect(moreButton(phone)).toHaveText('더보기')
            await closeMore(phone)
          }
        }
      }
    } finally {
      await setLabelsApi(page, true)
      await phone.context().close()
    }
  })

  test('라벨 켬/끔을 모르는 동안에도 막대는 다섯 칸, 목록에 "라벨"을 만들지 않는다 (L-13 9)', async ({ page, browser }) => {
    const seller = await loginNewSeller(page)
    const phone = await phoneOf(browser, page, seller)
    try {
      // 켬/끔 조회를 붙잡아 둔다 (모름)
      await phone.route(/\/api\/(print|settings\/labels)(\?.*)?$/, async (route) => {
        if (route.request().method() === 'GET') return // 답하지 않는다
        await route.continue()
      })
      await phone.goto('/sms')
      await expect(phone.getByRole('button', { name: '로그아웃' })).toBeVisible()
      await expectBarShape(phone, '모름')
      await openMore(phone)
      await expectListShape(phone, LIST_OFF, '모름')
    } finally {
      await phone.context().close()
    }
  })

  test('목록이 화면 높이의 60%를 넘으면 목록 안에서 스크롤된다 — 마지막 "설정"까지 닿는다 (375×300)', async ({ page, browser }) => {
    // 혼자 쓰는 판매자 + 라벨 켬 — 화면이 켬/끔을 늦게 알면 "라벨"이 늦게 끼므로(L-13 9) 항목 넷이 다 나온 뒤에 잰다
    const seller = await loginNewSeller(page)
    await setLabelsApi(page, true)
    const phone = await phoneOf(browser, page, seller, { width: 375, height: 300 })
    try {
      await phone.goto('/sms')
      await expect(moreButton(phone)).toBeVisible()
      await openMore(phone)
      await expect(moreLinks(phone)).toHaveText(LIST_ON)
      const list = moreList(phone)
      const box = await list.boundingBox()
      expect(box!.height).toBeLessThanOrEqual(300 * 0.6 + 0.5)
      expect(box!.y).toBeGreaterThanOrEqual(0)
      const scroll = await list.evaluate((el) => ({ over: el.scrollHeight > el.clientHeight + 1, y: getComputedStyle(el).overflowY }))
      expect(scroll.over, '항목이 목록 높이보다 많다').toBe(true)
      expect(['auto', 'scroll']).toContain(scroll.y)
      await noHorizontalScroll(phone)
      const settings = menuLink(phone, '설정')
      await settings.scrollIntoViewIfNeeded()
      await expect(settings).toBeInViewport()
      await settings.click()
      await expect(phone).toHaveURL(/\/settings$/)
      await expect(moreList(phone)).toHaveCount(0)
    } finally {
      await phone.context().close()
    }
  })
})

test.describe('AC-NAV-03: 열고 닫기·키보드·화면 읽기', () => {
  test('키보드만으로: Tab으로 "더보기" → Enter 열기·Enter 닫기·Space 열기·Space 닫기, 열린 뒤 Tab은 목록 순서, Esc는 닫고 포커스를 "더보기"로', async ({ page }) => {
    await page.setViewportSize(PHONE)
    // 새 판매자: 방송이 없어 문자찜 입력 화면이 자료를 다 받은 뒤 "번호" 칸으로 포커스를 옮기지 않는다 (시험이 그 늦은 포커스와 겨루지 않게)
    await loginNewSeller(page)
    // 라벨 켬/끔을 정해 둔다 — 화면이 그 값을 늦게 알면 목록에 "라벨"이 늦게 끼어든다(L-13 9). 목록 순서는 그 값을 안 뒤의 목록으로 잰다
    await setLabelsApi(page, true)
    await page.goto('/sms')
    await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
    const more = moreButton(page)
    await menuLink(page, '정산').focus()
    await page.keyboard.press('Tab')
    await expect(more).toBeFocused()
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Enter')
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await expect(moreList(page)).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await expect(moreList(page)).toHaveCount(0)
    await page.keyboard.press('Space')
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Space')
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    // 열린 뒤 Tab은 목록 항목을 목록 순서대로
    await page.keyboard.press('Enter')
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await expect(moreLinks(page)).toHaveText(LIST_ON)
    for (const name of LIST_ON) {
      await page.keyboard.press('Tab')
      await expect(menuLink(page, name)).toBeFocused()
    }
    // Esc: 닫고 포커스는 "더보기"
    await page.keyboard.press('Escape')
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await expect(moreList(page)).toHaveCount(0)
    await expect(more).toBeFocused()
    await expect(page).toHaveURL(/\/sms$/)
  })

  test('목록 밖 누르기는 아무 데도 가지 않고 닫힌다, 항목 고르기는 그 화면으로 가고 닫힌다, 뒤로 가기도 닫는다, 닫힌 목록은 접근성 트리에 없다', async ({ page, browser }) => {
    await login(page)
    const phone = await phoneOf(browser, page)
    try {
      await phone.goto('/buyers')
      await expect(menuLink(phone, '구매자')).toHaveAttribute('aria-current', 'page')
      // 닫힌 목록: 숨김이 아니라 없음 (화면 읽기에도 없다)
      for (const name of ['입금 확인', '포장', '택배', '설정']) {
        await expect(phone.getByRole('link', { name, exact: true, includeHidden: true })).toHaveCount(0)
      }
      await expect(phone.getByRole('list', { includeHidden: true }).filter({ has: phone.getByRole('link', { name: '설정', exact: true, includeHidden: true }) })).toHaveCount(0)
      expect(await menu(phone).ariaSnapshot()).not.toMatch(/설정|포장|입금 확인|택배/)
      await expect(moreButton(phone)).not.toHaveAttribute('aria-controls')

      // 목록 밖 누르기 — 화면 가운데 위쪽 (목록은 막대 바로 위)
      await openMore(phone)
      const before = phone.url()
      const list = await moreList(phone).boundingBox()
      expect(list!.y).toBeGreaterThan(120)
      await phone.mouse.click(187, 100)
      await expect(moreButton(phone)).toHaveAttribute('aria-expanded', 'false')
      await expect(moreList(phone)).toHaveCount(0)
      expect(phone.url()).toBe(before)
      await expect(menuLink(phone, '구매자')).toHaveAttribute('aria-current', 'page')
      await expect(phone.getByRole('dialog')).toHaveCount(0)

      // 열려 있으면 aria-controls가 목록을 가리킨다
      await openMore(phone)
      const id = await moreButton(phone).getAttribute('aria-controls')
      expect(id).not.toBeNull()
      expect(await moreList(phone).getAttribute('id')).toBe(id)

      // 항목 고르기 → 그 화면, 닫힘
      await menuLink(phone, '포장').click()
      await expect(phone).toHaveURL(/\/packing(\?|$)/)
      await expect(moreButton(phone)).toHaveAttribute('aria-expanded', 'false')
      await expect(moreList(phone)).toHaveCount(0)

      // 열어 둔 채 뒤로 가기 → 닫힘
      await openMore(phone)
      await phone.goBack()
      await expect(phone).toHaveURL(/\/buyers/)
      await expect(moreButton(phone)).toHaveAttribute('aria-expanded', 'false')
      await expect(moreList(phone)).toHaveCount(0)
      // 막대 칸으로 옮겨도 닫힘
      await openMore(phone)
      await menuLink(phone, '정산').click()
      await expect(phone).toHaveURL(/\/settlements/)
      await expect(moreList(phone)).toHaveCount(0)
    } finally {
      await phone.context().close()
    }
  })
})

test.describe('AC-NAV-04: 지금 위치', () => {
  test('목록 안 화면이면 "더보기"와 그 항목이 aria-current(파란 바탕·흰 글자), 앞 네 칸 화면이면 그 칸만 — 막대 다섯 칸 중 늘 하나', async ({ page, browser }) => {
    test.setTimeout(180_000)
    await login(page)
    const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    const phone = await phoneOf(browser, page)
    try {
      const currentOnBar = async () => {
        const out: string[] = []
        for (const [i, cell] of barCells(phone).entries()) if ((await cell.getAttribute('aria-current')) === 'page') out.push(BAR_CELLS[i]!)
        return out
      }
      const look = (name: string) => (name === '더보기' ? moreButton(phone) : menuLink(phone, name)).evaluate((el) => {
        const s = getComputedStyle(el)
        return { bg: s.backgroundColor, color: s.color }
      })
      // 앞 네 칸의 화면
      let barLook: { bg: string; color: string } | null = null
      for (const [path, cell] of [['/', '방송'], [`/broadcasts/${encodeURIComponent(b)}`, '방송'], ['/sms', '문자찜 입력'], ['/buyers', '구매자'], ['/settlements', '정산']] as const) {
        await phone.goto(path)
        await expect(menuLink(phone, cell), path).toHaveAttribute('aria-current', 'page')
        await expect(moreButton(phone), path).not.toHaveAttribute('aria-current')
        expect(await currentOnBar(), path).toEqual([cell])
        barLook ??= await look(cell)
      }
      expect(barLook!.color).toBe('rgb(255, 255, 255)')
      // 목록 안 화면
      for (const [path, item] of [['/deposits', '입금 확인'], ['/packing', '포장'], ['/labels', '라벨'], ['/settings', '설정'], ['/settings/youtube', '설정']] as const) {
        await phone.goto(path)
        await expect(moreButton(phone), path).toHaveAttribute('aria-current', 'page')
        expect(await currentOnBar(), path).toEqual(['더보기'])
        // 지금 화면 모양 = 앞 네 칸의 지금 화면 모양 (파란 바탕·흰 글자)
        expect(await look('더보기'), path).toEqual(barLook)
        await openMore(phone)
        const link = moreList(phone).getByRole('link', { name: new RegExp(`^${item}( \\d+)?$`) })
        await expect(link, path).toHaveAttribute('aria-current', 'page')
        await expect(moreList(phone).locator('[aria-current="page"]'), path).toHaveCount(1)
        await closeMore(phone)
      }
    } finally {
      await phone.context().close()
    }
  })
})

test.describe('AC-NAV-05: 확인 필요 수', () => {
  test('목록을 열어 둔 동안 다른 기기에서 새 입금이 들어오거나 처리하면 1초 안에 "입금 확인 N"이 바뀐다 — "더보기"는 늘 "더보기"', async ({ page, browser }) => {
    test.setTimeout(120_000)
    const seller = await loginNewSeller(page)
    const phone = await phoneOf(browser, page, seller)
    try {
      await phone.goto('/sms')
      await openMore(phone)
      await expect(menuLink(phone, '입금 확인')).toBeVisible()
      const src = await fakeSource(page)
      const [d1] = await deposit(page, src, [{ key: uniq('nav'), at: kstIso(5_000), amount: 777, name: uniq('모름') }])
      await expect(menuLink(phone, '입금 확인 1')).toBeVisible({ timeout: 1_000 })
      await expect(moreButton(phone)).toHaveText('더보기')
      await expect(moreButton(phone)).toHaveAccessibleName('더보기')
      const [d2] = await deposit(page, src, [{ key: uniq('nav'), at: kstIso(6_000), amount: 888, name: uniq('모름') }])
      await expect(menuLink(phone, '입금 확인 2')).toBeVisible({ timeout: 1_000 })
      await expect(moreButton(phone)).toHaveAttribute('aria-expanded', 'true')
      // 다른 기기(PC)에서 무시 → 1초 안에 줄어든다
      for (const [d, left] of [[d1!, '입금 확인 1'], [d2!, '입금 확인']] as const) {
        const res = await postJson(page, `/api/deposits/${String(d.no)}/ignore`, { requestId: crypto.randomUUID() })
        expect(res.status, JSON.stringify(res.body)).toBe(200)
        await expect(menuLink(phone, left)).toBeVisible({ timeout: 1_000 })
      }
      await expect(moreButton(phone)).toHaveAttribute('aria-expanded', 'true')
      await expect(moreButton(phone)).toHaveText('더보기')
    } finally {
      await phone.context().close()
    }
  })
})

test.describe('AC-NAV-06: 목록 항목도 같은 메뉴 링크', () => {
  test('목록 항목은 a[href](/deposits·/packing·/labels·/settings)이고 앱 안에서 이동한다 — 전체 새로고침 없음', async ({ page, browser }) => {
    await login(page)
    const phone = await phoneOf(browser, page)
    try {
      await phone.goto('/sms')
      await openMore(phone)
      const hrefs = await moreLinks(phone).evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''))
      expect(hrefs.length).toBeGreaterThanOrEqual(3)
      expect(hrefs[0]).toMatch(/^\/deposits(\?|$)/)
      expect(hrefs[1]).toMatch(/^\/packing(\?|$)/)
      expect(hrefs.at(-1)).toBe('/settings')
      if (hrefs.length === 4) expect(hrefs[2]).toBe('/labels')
      await closeMore(phone)
      await phone.evaluate(() => { (window as unknown as { __sameDocument: string }).__sameDocument = 'yes' })
      for (const [name, heading, url] of [['입금 확인', '입금 확인', /\/deposits/], ['포장', '포장', /\/packing/], ['라벨', '라벨', /\/labels$/], ['설정', '설정', /\/settings$/]] as const) {
        await openMore(phone)
        const link = moreList(phone).getByRole('link', { name: new RegExp(`^${name}( \\d+)?$`) })
        if (name === '라벨' && (await link.count()) === 0) { await closeMore(phone); continue }
        await link.click()
        await expect(phone).toHaveURL(url)
        await expect(phone.getByRole('heading', { level: 1, name: heading })).toBeVisible()
        expect(await phone.evaluate(() => (window as unknown as { __sameDocument?: string }).__sameDocument), `${name}: 전체 새로고침 없음`).toBe('yes')
      }
    } finally {
      await phone.context().close()
    }
  })

  test('설정에 저장하지 않은 값 → 목록 항목으로 떠날 때도 같은 떠나기 창, "닫기"면 남고 "저장하지 않고 떠나기"면 간다 (AC-I3-46)', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await loginNewSeller(page)
    await page.goto('/settings')
    await settingsRegion(page, '판매 규칙').getByLabel('대기 인원 (0이면 대기 없음)').fill('3')
    await openMore(page)
    await menuLink(page, '포장').click()
    const ask = page.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
    await expect(ask).toContainText('저장하지 않은 값이 있어요. 떠나면 저장하지 않아요.')
    await ask.getByRole('button', { name: '닫기' }).click()
    await expect(ask).toHaveCount(0)
    await expect(page).toHaveURL(/\/settings$/)
    await expect(settingsRegion(page, '판매 규칙').getByLabel('대기 인원 (0이면 대기 없음)')).toHaveValue('3')
    await openMore(page)
    await menuLink(page, '입금 확인').click()
    await page.getByRole('dialog', { name: '다른 화면으로 갈까요?' }).getByRole('button', { name: '저장하지 않고 떠나기' }).click()
    await expect(page).toHaveURL(/\/deposits/)
  })

  test('콘솔에 보내기 전 조치가 있으면 목록 항목으로 떠날 때도 묻는다 — "닫기"면 콘솔에 남는다 (AC-S06-01, D-083)', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await viewerClaim(page, b, '홍길동', '15', 'sim_hong_5152')
    const item = page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^15번 / })
    await expect(item).toContainText('홍길동')
    await item.click()
    const detail = page.getByRole('dialog', { name: '15번 자세히' })
    await detail.getByRole('button', { name: '찜 취소하기' }).first().click()
    await page.keyboard.press('1')
    await page.keyboard.press('Enter')
    await expect(detail).toHaveCount(0)
    await openMore(page)
    await menuLink(page, /^입금 확인( \d+)?$/).click()
    const ask = page.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
    await expect(ask).toContainText('보내기 전인 조치가 있어요. 떠나면 보내지 않아요.')
    await expect(ask.getByRole('button', { name: '닫기' })).toBeFocused()
    await ask.getByRole('button', { name: '닫기' }).click()
    await expect(ask).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/broadcasts/${encodeURIComponent(b)}`))
    await expect(page.getByLabel('빠른 입력')).toBeVisible()
  })
})

/** 화면 위·아래에 고정된 영역(position fixed·sticky, 가장 바깥 것)의 보이는 높이 합 (AC-S06-61과 같은 셈) */
async function fixedHeight(page: Page): Promise<{ total: number; parts: string[] }> {
  return await page.evaluate(() => {
    const vh = window.innerHeight
    const parts: string[] = []
    let total = 0
    const pinned = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      const p = getComputedStyle(el).position
      return p === 'fixed' || p === 'sticky'
    })
    for (const el of pinned) {
      if (pinned.some((other) => other !== el && other.contains(el))) continue
      const r = el.getBoundingClientRect()
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
      if (h === 0) continue
      total += h
      parts.push(`${el.tagName}.${el.className} ${String(Math.round(h))}`)
    }
    return { total, parts }
  })
}

test.describe('AC-NAV-07: 콘솔 고정 영역', () => {
  test('AC-S06-61 상태(375×812 콘솔, 알림 여러 종류, 되돌리기 대기), 목록 닫힘 — 고정 영역 합 ≤ 284px, 메뉴 몫 ≤ 64px', async ({ browser, page }) => {
    await login(page)
    const phone = await phoneOf(browser, page)
    try {
      const date = uniqueDate()
      const b = await openNewBroadcast(phone, { date, rehearsal: true })
      for (let no = 1; no <= 12; no++) await registerApi(phone, b, no, `상품${String(no)}`, 10000)
      await smsApi(phone, { b, no: 16, memo: '갑', received: '00:01' })
      await registerApi(phone, b, 16, '충돌상품', 10000)
      await smsApi(phone, { b, no: 16, memo: '을', received: '00:01' })
      await viewerClaim(phone, b, '셋째', '7', 'sim_third_0004')
      await sendViewerChat(phone, b, '셋째', '7 취소', 'sim_third_0004')
      await smsApi(phone, { b, no: 40, memo: '병' })
      const strip = phone.getByRole('region', { name: '알림' })
      await expect(strip.getByRole('button', { name: /^보류 찜 \d+$/ })).toBeVisible()
      await expect(strip.getByRole('button', { name: /^취소 요청 \d+$/ })).toBeVisible()
      const input = phone.getByLabel('빠른 입력')
      await input.fill('20 새상품 10000')
      await input.press('Enter')
      await expect(phone.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^20번 / })).toBeVisible()
      await expect(moreButton(phone)).toHaveAttribute('aria-expanded', 'false')
      await expectPhoneBar(phone)
      const nav = await menu(phone).boundingBox()
      expect(nav!.height).toBeLessThanOrEqual(64)
      const { total, parts } = await fixedHeight(phone)
      expect(total, parts.join(' / ')).toBeLessThanOrEqual(284)
    } finally {
      await phone.context().close()
    }
  })
})

test.describe('AC-NAV-08: PC·경계·보조자', () => {
  test('1440·768은 PC 모양(모든 메뉴가 위 줄 링크, "더보기" 없음), 767은 휴대폰 모양', async ({ page }) => {
    await login(page)
    for (const width of [1440, 768]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/sms')
      await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
      await expect(moreButton(page), `${String(width)}`).toHaveCount(0)
      await expect(menu(page).getByRole('button')).toHaveCount(0)
      const names = (await menu(page).getByRole('link').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().replace(/^입금 확인 \d+$/, '입금 확인'))
      expect([[...BAR_LINKS, ...LIST_ON], [...BAR_LINKS, ...LIST_OFF]], `${String(width)}`).toContainEqual(names)
    }
    await page.setViewportSize({ width: 767, height: 900 })
    await expect(moreButton(page)).toBeVisible()
    await expectPhoneBar(page)
    await page.setViewportSize({ width: 768, height: 900 })
    await expect(moreButton(page)).toHaveCount(0)
  })

  test('보조자 계정 375×812 — 메뉴는 "문자찜 입력" 한 칸, "더보기" 없음', async ({ page, browser }) => {
    await loginNewSeller(page)
    const res = await page.request.post('/api/assistants', { data: { name: '메뉴보조' }, headers: { Origin: new URL(page.url()).origin } })
    expect(res.ok(), await res.text()).toBe(true)
    const { assistant, password } = await res.json() as { assistant: { loginId: string }; password: string }
    const phone = await phoneOf(browser, page, { loginId: assistant.loginId, password })
    try {
      await expect(menu(phone).getByRole('link')).toHaveText(['문자찜 입력'])
      await expect(menu(phone).getByRole('button')).toHaveCount(0)
      await expect(phone.getByRole('button', { name: '더보기' })).toHaveCount(0)
      await expectTarget(phone, menuLink(phone, '문자찜 입력'))
    } finally {
      await phone.context().close()
    }
  })
})
