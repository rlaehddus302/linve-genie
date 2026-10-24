// MOB1 아래 막대 "문자찜"(AC-MOB1-04, D-MOB1-04·D-NAV-01) · 휴대폰 로그아웃 자리(AC-MOB1-05) · 위험할 때만 확인 창(AC-MOB1-06, D-MOB1-05) — test-e2e.
// 기대 문장은 acceptance.md 따옴표 그대로.
import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import { becomeDevice, cleanupPrint, gotoLabels } from '../i1/support.ts'
import { loginAs } from '../i3/support.ts'
import { BAR_CELLS, barCells, expectPhoneBar, expectTarget, menu, menuLink, moreButton, moreList, openMore } from '../menu.ts'
import { uniqueDate } from '../s05/support.ts'
import { ANDROID, IPHONE_UA, PC, PHONE, baseUrlOf, bigText, broadcastApi, endBroadcastApi, expectBig, freshSeller, newDevice, setLabelsApi } from './support.ts'

const TITLE = '로그아웃할까요?'
const LIVE = '아직 끝내지 않은 방송이 있어요. 로그아웃하면 이 기기에서는 다시 로그인해야 찜·채팅을 볼 수 있어요. 방송과 찜은 그대로예요.'
const STATION = '이 기기가 라벨을 출력하는 기기예요. 로그아웃하면 라벨 출력이 멈춰요.'
const UNKNOWN = '방송 중인지 확인하지 못했어요.'
const NONE = '끝내지 않은 방송이 없어요.' // D-MOB1-15
const IPHONE = { width: 393, height: 852 } as const

function banner(page: Page): Locator {
  return page.getByRole('banner')
}

/** 칸 이름 글이 한 줄인가 — 글 상자 높이 < 글자 줄 높이 × 1.5 (AC-MOB1-04) */
async function oneLine(cell: Locator): Promise<{ height: number; line: number }> {
  return await cell.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const height = range.getBoundingClientRect().height
    const s = getComputedStyle(el)
    const line = s.lineHeight === 'normal' ? parseFloat(s.fontSize) * 1.2 : parseFloat(s.lineHeight)
    return { height, line }
  })
}

/** 로그아웃 버튼 (휴대폰 판매자 — "더보기" 목록 맨 끝) */
async function phoneLogout(page: Page): Promise<Locator> {
  await openMore(page)
  return moreList(page).getByRole('button', { name: '로그아웃', exact: true })
}

function dialogOf(page: Page): Locator {
  return page.getByRole('dialog', { name: TITLE })
}

async function expectLoggedIn(page: Page): Promise<void> {
  await expect(menu(page)).toBeVisible()
  const me = await page.request.get('/api/me')
  expect(me.status(), '로그인 그대로').toBe(200)
}

async function expectLoginScreen(page: Page): Promise<void> {
  await expect(page.getByLabel('아이디')).toBeVisible()
  await expect(dialogOf(page)).toHaveCount(0)
  expect((await page.request.get('/api/me')).status(), '로그아웃됨').toBe(401)
}

test.describe('AC-MOB1-04 아래 막대 "문자찜"', () => {
  for (const [label, viewport, big] of [['375 · 100%', PHONE, false], ['412 · 100%', ANDROID, false], ['375 · 150%', PHONE, true], ['412 · 150%', ANDROID, true]] as const) {
    test(`${label}: 막대 링크는 "방송"·"문자찜"·"구매자"·"정산" + "더보기", 칸마다 이름이 한 줄, 다섯 칸이 한 줄·화면 안`, async ({ browser, page }) => {
      await page.goto('/')
      const { page: phone, context } = await newDevice(browser, baseUrlOf(page), { viewport, touch: true, big })
      try {
        const { login } = await import('../s05/support.ts')
        await login(phone)
        if (big) await expectBig(phone)
        await phone.goto('/sms')
        await expect(phone.getByRole('heading', { level: 1, name: '문자찜 입력' })).toBeVisible()
        // 보이는 글 = 접근성 이름 (정확히)
        await expect(menu(phone).getByRole('link')).toHaveText(['방송', '문자찜', '구매자', '정산'])
        await expect(menuLink(phone, '문자찜')).toHaveAccessibleName('문자찜')
        await expect(menuLink(phone, '문자찜 입력')).toHaveCount(0)
        await expect(moreButton(phone)).toHaveAccessibleName('더보기')
        if (!big) await expectPhoneBar(phone) // AC-NAV-01 그대로 (한 줄·44px·화면 안)
        const tops: number[] = []
        for (const [i, cell] of barCells(phone).entries()) {
          const box = await expectTarget(phone, cell)
          tops.push(box.y)
          const { height, line } = await oneLine(cell)
          expect(height, `${BAR_CELLS[i]!} 이름 한 줄 (글 상자 ${String(height)} < 줄 ${String(line)} × 1.5)`).toBeLessThan(line * 1.5)
        }
        for (const top of tops) expect(Math.abs(top - tops[0]!), '다섯 칸이 한 줄').toBeLessThanOrEqual(1)
        // 막대 높이 64px 이하·글자 16px 이상 (AC-NAV-01 — 100%에서)
        if (!big) {
          const nav = (await menu(phone).boundingBox())!
          expect(nav.height).toBeLessThanOrEqual(64)
          for (const cell of barCells(phone)) expect(await cell.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
        }
        // "문자찜"을 누르면 "문자찜 입력" 화면
        await phone.goto('/')
        await menuLink(phone, '문자찜').click()
        await expect(phone).toHaveURL(/\/sms$/)
        await expect(phone.getByRole('heading', { level: 1, name: '문자찜 입력' })).toBeVisible()
        await expect(menuLink(phone, '문자찜')).toHaveAttribute('aria-current', 'page')
      } finally {
        await context.close()
      }
    })
  }

  test('1440×900: 위 줄 메뉴의 링크는 "문자찜 입력" 그대로, 제목도 "문자찜 입력" — 보조자 375는 막대 한 칸 "문자찜"', async ({ page, browser }) => {
    await page.goto('/')
    const { page: pc, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PC })
    try {
      await pc.goto('/sms')
      await expect(menuLink(pc, '문자찜 입력')).toBeVisible()
      await expect(menuLink(pc, '문자찜')).toHaveCount(0)
      await expect(pc.getByRole('heading', { level: 1, name: '문자찜 입력' })).toBeVisible()
      // 보조자
      const created = await pc.request.post('/api/assistants', { data: { name: '막대보조' }, headers: { Origin: baseUrlOf(pc) } })
      expect(created.ok(), await created.text()).toBe(true)
      const { assistant, password } = (await created.json()) as { assistant: { loginId: string }; password: string }
      const helper = await newDevice(browser, baseUrlOf(pc), { viewport: PHONE, touch: true })
      try {
        await loginAs(helper.page, { loginId: assistant.loginId, password }, '/sms')
        await expect(menu(helper.page).getByRole('link')).toHaveText(['문자찜'])
        await expectTarget(helper.page, menuLink(helper.page, '문자찜'))
        await expect(helper.page.getByRole('heading', { level: 1, name: '문자찜 입력' })).toBeVisible()
      } finally {
        await helper.context.close()
      }
    } finally {
      await context.close()
    }
  })
})

test.describe('AC-MOB1-05 휴대폰 로그아웃 자리', () => {
  test('375 판매자: 위 줄에 "로그아웃" 없음, "더보기" 목록 맨 끝("설정" 다음) 버튼 — 44px·16px·화면 안·키보드로 목록 순서대로 닿는다', async ({ page, browser }) => {
    await page.goto('/')
    const { page: phone, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PHONE, touch: true })
    try {
      await phone.goto('/sms')
      await expect(menu(phone)).toBeVisible()
      await expect(banner(phone).getByRole('button', { name: '로그아웃' })).toHaveCount(0)
      await expect(phone.getByRole('button', { name: '로그아웃' })).toHaveCount(0)
      await openMore(phone)
      const list = moreList(phone)
      const items = list.getByRole('listitem')
      const count = await items.count()
      // 맨 끝 항목은 버튼 "로그아웃"(링크가 아님), 그 앞은 "설정"
      await expect(items.nth(count - 1).getByRole('button', { name: '로그아웃', exact: true })).toBeVisible()
      await expect(items.nth(count - 1).getByRole('link')).toHaveCount(0)
      await expect(items.nth(count - 2).getByRole('link', { name: '설정', exact: true })).toBeVisible()
      await expect(list.getByRole('link', { name: '로그아웃' })).toHaveCount(0)
      const logout = list.getByRole('button', { name: '로그아웃', exact: true })
      await expectTarget(phone, logout)
      expect(await logout.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
      const box = (await logout.boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height + 0.5)
      // 키보드: "설정" 다음 Tab은 "로그아웃"
      await menuLink(phone, '설정').focus()
      await phone.keyboard.press('Tab')
      await expect(logout).toBeFocused()
    } finally {
      await context.close()
    }
  })

  test('1440 판매자·보조자(375·1440): 위 줄의 "로그아웃" 그대로', async ({ page, browser }) => {
    await page.goto('/')
    const { page: pc, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PC })
    try {
      await expect(banner(pc).getByRole('button', { name: '로그아웃', exact: true })).toBeVisible()
      const created = await pc.request.post('/api/assistants', { data: { name: '자리보조' }, headers: { Origin: baseUrlOf(pc) } })
      expect(created.ok(), await created.text()).toBe(true)
      const { assistant, password } = (await created.json()) as { assistant: { loginId: string }; password: string }
      for (const viewport of [PHONE, PC]) {
        const helper = await newDevice(browser, baseUrlOf(pc), { viewport, touch: viewport === PHONE })
        try {
          await loginAs(helper.page, { loginId: assistant.loginId, password }, '/sms')
          await expect(banner(helper.page).getByRole('button', { name: '로그아웃', exact: true }), `보조자 ${String(viewport.width)}`).toBeVisible()
          // 보조자는 묻지 않는다 (방송이 있어도 — 지금 그대로)
        } finally {
          await helper.context.close()
        }
      }
    } finally {
      await context.close()
    }
  })
})

test.describe('AC-MOB1-06 위험할 때만 확인 창', () => {
  for (const [label, viewport] of [['휴대폰 375', PHONE], ['PC 1440', PC]] as const) {
    test(`${label}: 끝내지 않은 방송이 없고 출력 기기가 아니면 창 없이 로그인 화면`, async ({ page, browser }) => {
      await page.goto('/')
      const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport, touch: viewport === PHONE })
      try {
        // 끝낸 방송 하나는 있어도 된다 (끝내지 않은 방송만 묻는다)
        const b = await broadcastApi(dev, uniqueDate())
        await endBroadcastApi(dev, b)
        await dev.goto('/')
        const button = viewport === PHONE ? await phoneLogout(dev) : banner(dev).getByRole('button', { name: '로그아웃', exact: true })
        await button.click()
        await expectLoginScreen(dev)
      } finally {
        await context.close()
      }
    })

    test(`${label}: 끝내지 않은 방송 → 창 "로그아웃할까요?"·본문·처음 포커스 "로그인 유지", 누르거나 Esc면 그대로, 위험 버튼 "로그아웃"이면 로그인 화면`, async ({ page, browser }) => {
      await page.goto('/')
      const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport, touch: viewport === PHONE })
      try {
        await setLabelsApi(dev, false)
        await broadcastApi(dev, uniqueDate(), true) // 리허설도 끝내지 않은 방송이다
        await dev.goto('/buyers')
        const press = async () => {
          const button = viewport === PHONE ? await phoneLogout(dev) : banner(dev).getByRole('button', { name: '로그아웃', exact: true })
          await button.click()
          const dlg = dialogOf(dev)
          await expect(dlg).toBeVisible()
          return dlg
        }
        let dlg = await press()
        await expect(dlg.getByRole('heading', { name: TITLE })).toBeVisible()
        await expect(dlg.getByText(LIVE, { exact: true })).toBeVisible()
        await expect(dlg.getByText(STATION)).toHaveCount(0)
        await expect(dlg.getByText(UNKNOWN)).toHaveCount(0)
        const keep = dlg.getByRole('button', { name: '로그인 유지', exact: true })
        await expect(keep).toBeFocused()
        await keep.click()
        await expect(dlg).toHaveCount(0)
        await expectLoggedIn(dev)
        await expect(dev).toHaveURL(/\/buyers/)
        // Esc
        dlg = await press()
        await expect(keep).toBeFocused()
        await dev.keyboard.press('Escape')
        await expect(dlg).toHaveCount(0)
        await expectLoggedIn(dev)
        // 위험 버튼
        dlg = await press()
        const out = dlg.getByRole('button', { name: '로그아웃', exact: true })
        await expect(out).toHaveClass(/button-danger/)
        await out.click()
        await expectLoginScreen(dev)
      } finally {
        await context.close()
      }
    })
  }

  test('휴대폰 375: 이 기기가 출력 기기(라벨 켜짐) — 끝낸 방송뿐이면 출력 기기 문장 하나, 끝내지 않은 방송도 있으면 두 문장(방송 문장이 먼저)', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PHONE, touch: true })
    try {
      await setLabelsApi(dev, true)
      await dev.goto('/')
      await becomeDevice(dev, '포장 폰')
      await gotoLabels(dev)
      let dlg: Locator
      // 출력 기기만
      await (await phoneLogout(dev)).click()
      dlg = dialogOf(dev)
      await expect(dlg).toBeVisible()
      await expect(dlg.locator('p')).toHaveText([STATION])
      await dlg.getByRole('button', { name: '로그인 유지', exact: true }).click()
      await expect(dlg).toHaveCount(0)
      await expectLoggedIn(dev)
      // 끝내지 않은 방송 + 출력 기기
      await broadcastApi(dev, uniqueDate())
      await (await phoneLogout(dev)).click()
      dlg = dialogOf(dev)
      await expect(dlg).toBeVisible()
      await expect(dlg.locator('p')).toHaveText([LIVE, STATION])
      await dlg.getByRole('button', { name: '로그인 유지', exact: true }).click()
      await expectLoggedIn(dev)
      await cleanupPrint(dev)
    } finally {
      await context.close()
    }
  })

  test('PC 1440: 방송 목록 요청이 실패하면 "방송 중인지 확인하지 못했어요." — 묻지 않고 로그아웃하지 않는다', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PC })
    try {
      await setLabelsApi(dev, false)
      await dev.goto('/settings')
      await expect(menu(dev)).toBeVisible()
      await dev.route((url) => url.pathname === '/api/broadcasts', (route) => (route.request().method() === 'GET' ? route.abort('failed') : route.fallback()))
      await banner(dev).getByRole('button', { name: '로그아웃', exact: true }).click()
      const dlg = dialogOf(dev)
      await expect(dlg).toBeVisible()
      await expect(dlg.locator('p')).toHaveText([UNKNOWN])
      await expect(dlg.getByRole('button', { name: '로그인 유지', exact: true })).toBeFocused()
      await dlg.getByRole('button', { name: '로그인 유지', exact: true }).click()
      await expectLoggedIn(dev)
    } finally {
      await context.close()
    }
  })

  test('TE-MOB1-001 휴대폰 375: 방송 목록 응답이 오지 않는 동안(응답 전) 누르면 같은 창에 "방송 중인지 확인하지 못했어요." — 버튼이 말없이 잠긴 채 멈추지 않는다', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PHONE, touch: true })
    try {
      await setLabelsApi(dev, false)
      await dev.goto('/settings')
      await expect(menu(dev)).toBeVisible()
      // 누를 때 받는 목록이 오지 않는다 (느린 망 — 답하지 않는다)
      await dev.route((url) => url.pathname === '/api/broadcasts', (route) => (route.request().method() === 'GET' ? undefined : route.fallback()))
      await (await phoneLogout(dev)).click()
      const dlg = dialogOf(dev)
      await expect(dlg, '응답 전에도 창으로 묻는다 (AC-MOB1-06 "목록 요청 실패·응답 전")').toBeVisible()
      await expect(dlg.getByText(UNKNOWN)).toBeVisible()
      await expectLoggedIn(dev)
    } finally {
      await context.close()
    }
  })

  test('글자 150% 375: 확인 창이 화면 안, 버튼 44px', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PHONE, touch: true })
    try {
      await bigText(dev)
      await setLabelsApi(dev, false)
      await broadcastApi(dev, uniqueDate())
      await dev.goto('/')
      await expectBig(dev)
      await (await phoneLogout(dev)).click()
      const dlg = dialogOf(dev)
      await expect(dlg).toBeVisible()
      for (const name of ['로그인 유지', '로그아웃']) {
        const box = await expectTarget(dev, dlg.getByRole('button', { name, exact: true }))
        expect(box.y + box.height, name).toBeLessThanOrEqual(PHONE.height + 0.5)
      }
      await dlg.getByRole('button', { name: '로그인 유지', exact: true }).click()
      await expectLoggedIn(dev)
    } finally {
      await context.close()
    }
  })
})

/**
 * 방송 목록(GET /api/broadcasts) 답을 붙잡아 둔다 (D-MOB1-15 — 느린 망). release()는 붙잡은 요청을 서버로 보내고(진짜 답) 그 뒤 요청은 그대로 지나가게 한다.
 * 붙잡은 요청이 하나라도 생길 때까지 기다리려면 heldCount()를 본다.
 */
async function holdBroadcasts(page: Page): Promise<{ heldCount: () => number; release: () => Promise<void> }> {
  const held: Route[] = []
  let released = false
  await page.route(
    (url) => url.pathname === '/api/broadcasts',
    async (route) => {
      if (route.request().method() !== 'GET' || released) return route.fallback()
      held.push(route)
    },
  )
  return {
    heldCount: () => held.length,
    release: async () => {
      released = true
      for (const route of held.splice(0)) await route.continue()
    },
  }
}

test.describe('AC-MOB1-06 답을 기다리는 동안 (D-MOB1-15)', () => {
  test('휴대폰 375: 답이 오지 않으면 창 "방송 중인지 확인하지 못했어요."(처음 포커스 "로그인 유지") → 늦은 답(끝난 방송만)에 창은 그대로·본문만 "끝내지 않은 방송이 없어요."·로그인 그대로 → "로그아웃"을 눌러야 로그인 화면', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PHONE, touch: true })
    try {
      await setLabelsApi(dev, false)
      const b = await broadcastApi(dev, uniqueDate())
      await endBroadcastApi(dev, b) // 끝낸 방송만 — 위험 없음
      await dev.goto('/settings')
      await expect(menu(dev)).toBeVisible()
      const hold = await holdBroadcasts(dev)
      await (await phoneLogout(dev)).click()
      const dlg = dialogOf(dev)
      await expect(dlg, '답이 오지 않아도 창').toBeVisible()
      await expect(dlg.locator('p')).toHaveText([UNKNOWN])
      const keep = dlg.getByRole('button', { name: '로그인 유지', exact: true })
      const out = dlg.getByRole('button', { name: '로그아웃', exact: true })
      await expect(keep).toBeFocused()
      await expectLoggedIn(dev)
      // 늦은 답 (위험 없음)
      await expect.poll(hold.heldCount, '목록을 한 번 받는다').toBeGreaterThan(0)
      const answered = dev.waitForResponse((r) => new URL(r.url()).pathname === '/api/broadcasts' && r.request().method() === 'GET')
      await hold.release()
      await answered
      await expect(dlg.locator('p')).toHaveText([NONE])
      // 창 그대로 — 제목·두 버튼·포커스 자리, 저절로 로그아웃하지 않음
      await expect(dlg).toBeVisible()
      await expect(dlg.getByRole('heading', { name: TITLE })).toBeVisible()
      await expect(keep).toBeVisible()
      await expect(out).toBeVisible()
      await expect(keep).toBeFocused()
      await expectLoggedIn(dev)
      await expect(dev).toHaveURL(/\/settings/)
      // 판매자가 눌러야 로그아웃
      await out.click()
      await expectLoginScreen(dev)
    } finally {
      await context.close()
    }
  })

  test('PC 1440: 답이 오지 않아 뜬 창에 늦은 답(끝내지 않은 방송 있음)이 오면 본문만 방송 문장으로 — "로그인 유지"면 닫기만, 로그인 그대로', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PC })
    try {
      await setLabelsApi(dev, false)
      await broadcastApi(dev, uniqueDate())
      await dev.goto('/settings')
      await expect(menu(dev)).toBeVisible()
      const hold = await holdBroadcasts(dev)
      await banner(dev).getByRole('button', { name: '로그아웃', exact: true }).click()
      const dlg = dialogOf(dev)
      await expect(dlg).toBeVisible()
      await expect(dlg.locator('p')).toHaveText([UNKNOWN])
      const keep = dlg.getByRole('button', { name: '로그인 유지', exact: true })
      await expect(keep).toBeFocused()
      await expect.poll(hold.heldCount).toBeGreaterThan(0)
      await hold.release()
      await expect(dlg.locator('p')).toHaveText([LIVE])
      await expect(dlg.getByRole('heading', { name: TITLE })).toBeVisible()
      await expect(dlg.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible()
      await expect(keep).toBeFocused()
      await expectLoggedIn(dev)
      await keep.click()
      await expect(dlg).toHaveCount(0)
      await expectLoggedIn(dev)
    } finally {
      await context.close()
    }
  })

  test('휴대폰 375: 답이 오기 전에 창을 닫으면 늦은 답은 아무것도 바꾸지 않는다(창이 다시 뜨지 않음·로그인 그대로) — "로그아웃" 버튼은 다시 눌린다', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PHONE, touch: true })
    try {
      await setLabelsApi(dev, false)
      await dev.goto('/settings')
      await expect(menu(dev)).toBeVisible()
      const hold = await holdBroadcasts(dev)
      await (await phoneLogout(dev)).click()
      const dlg = dialogOf(dev)
      await expect(dlg).toBeVisible()
      await expect(dlg.locator('p')).toHaveText([UNKNOWN])
      await expect.poll(hold.heldCount).toBeGreaterThan(0)
      await dlg.getByRole('button', { name: '로그인 유지', exact: true }).click()
      await expect(dlg).toHaveCount(0)
      // 닫은 뒤 답 (위험 없음)
      const answered = dev.waitForResponse((r) => new URL(r.url()).pathname === '/api/broadcasts' && r.request().method() === 'GET')
      await hold.release()
      await answered
      // 화면이 답을 처리할 다음 그리기까지 (시간이 아니라 그리기 두 번)
      await dev.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      await expect(dlg).toHaveCount(0)
      await expectLoggedIn(dev)
      await expect(dev).toHaveURL(/\/settings/)
      // 버튼이 다시 눌린다 — 이번엔 답이 바로 와서(위험 없음) 창 없이 로그인 화면
      const again = await phoneLogout(dev)
      await expect(again).toBeEnabled()
      await again.click()
      await expectLoginScreen(dev)
    } finally {
      await context.close()
    }
  })
})

/** 로그아웃 확인 창을 연다 (끝내지 않은 방송이 있어 창이 뜬다) */
async function openLogoutDialog(dev: Page, phone: boolean): Promise<Locator> {
  await broadcastApi(dev, uniqueDate())
  await dev.goto('/')
  await expect(menu(dev)).toBeVisible()
  const button = phone ? await phoneLogout(dev) : banner(dev).getByRole('button', { name: '로그아웃', exact: true })
  await button.click()
  const dlg = dialogOf(dev)
  await expect(dlg).toBeVisible()
  await expect(dlg.locator('p')).toHaveText([LIVE])
  return dlg
}

test.describe('AC-MOB1-06 창 자리 (D-MOB1-16, U-MOB1-04)', () => {
  for (const [label, viewport, webkit] of [
    ['375×812 WebKit @webkit', PHONE, true],
    ['393×852 WebKit 아이폰 @webkit', IPHONE, true],
    ['375×812 크로미움', PHONE, false],
  ] as const) {
    test(`${label} 글자 100%: 로그아웃 확인 창은 화면 아래쪽 — 아래 끝 차이 ≤ 16px, 두 버튼 위 끝 ≥ 화면 높이 50%, 화면 폭 안`, async ({ page, browser }) => {
      await page.goto('/')
      const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport, touch: true, ...(webkit ? { userAgent: IPHONE_UA } : {}) })
      try {
        await setLabelsApi(dev, false)
        const dlg = await openLogoutDialog(dev, true)
        const { width, height } = dev.viewportSize()!
        expect(width).toBe(viewport.width)
        const box = (await dlg.boundingBox())!
        expect(height - (box.y + box.height), `창 아래 끝 ${String(Math.round(box.y + box.height))} · 화면 ${String(height)}`).toBeLessThanOrEqual(16)
        expect(box.y + box.height, '창이 화면 아래로 넘치지 않음').toBeLessThanOrEqual(height + 0.5)
        expect(box.x, '창 왼쪽 화면 안').toBeGreaterThanOrEqual(-0.5)
        expect(box.x + box.width, '창 오른쪽 화면 안').toBeLessThanOrEqual(width + 0.5)
        for (const name of ['로그인 유지', '로그아웃']) {
          const b = (await dlg.getByRole('button', { name, exact: true }).boundingBox())!
          expect(b.y, `"${name}" 위 끝 ${String(Math.round(b.y))} ≥ 화면 높이 50%`).toBeGreaterThanOrEqual(height * 0.5)
          expect(b.y + b.height, `"${name}" 화면 안`).toBeLessThanOrEqual(height + 0.5)
        }
        // 처음 포커스·Esc는 그대로
        await expect(dlg.getByRole('button', { name: '로그인 유지', exact: true })).toBeFocused()
        await dev.keyboard.press('Escape')
        await expect(dlg).toHaveCount(0)
        await expectLoggedIn(dev)
      } finally {
        await context.close()
      }
    })
  }

  test('글자 150% 375: 창이 화면보다 길면 스크롤로 제목부터 끝까지 볼 수 있다 (위가 잘리지 않음)', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PHONE, touch: true, big: true })
    try {
      await setLabelsApi(dev, false)
      const dlg = await openLogoutDialog(dev, true)
      await expectBig(dev)
      const title = dlg.getByRole('heading', { name: TITLE })
      for (const [name, target] of [
        ['제목', title],
        ['본문', dlg.getByText(LIVE, { exact: true })],
        ['"로그인 유지"', dlg.getByRole('button', { name: '로그인 유지', exact: true })],
        ['"로그아웃"', dlg.getByRole('button', { name: '로그아웃', exact: true })],
        ['제목', title],
      ] as const) {
        await target.scrollIntoViewIfNeeded()
        const b = (await target.boundingBox())!
        expect(b.y, `${name} 위 끝 화면 안`).toBeGreaterThanOrEqual(-0.5)
        expect(b.y + b.height, `${name} 아래 끝 화면 안`).toBeLessThanOrEqual(PHONE.height + 0.5)
        expect(b.x, `${name} 왼쪽`).toBeGreaterThanOrEqual(-0.5)
        expect(b.x + b.width, `${name} 오른쪽`).toBeLessThanOrEqual(PHONE.width + 0.5)
      }
      await dlg.getByRole('button', { name: '로그인 유지', exact: true }).click()
      await expectLoggedIn(dev)
    } finally {
      await context.close()
    }
  })

  test('1440×900: 로그아웃 확인 창은 지금처럼 위쪽 (창 위 끝 < 화면 높이 50%)', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PC })
    try {
      await setLabelsApi(dev, false)
      const dlg = await openLogoutDialog(dev, false)
      const box = (await dlg.boundingBox())!
      expect(box.y, `창 위 끝 ${String(Math.round(box.y))}`).toBeLessThan(PC.height * 0.5)
      expect(PC.height - (box.y + box.height), '아래에 붙지 않음').toBeGreaterThan(16)
      await dlg.getByRole('button', { name: '로그인 유지', exact: true }).click()
      await expectLoggedIn(dev)
    } finally {
      await context.close()
    }
  })
})
