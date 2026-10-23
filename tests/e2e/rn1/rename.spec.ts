// RN1 서비스 이름 라이브지니 (AC-RN1-01·02·03·05·13·14, UX-01, D-RN1-01·04·05·06) — test-e2e.
// 주요 화면을 PC·휴대폰 크기로 차례로 열고 body 글 전체와 document.title에 옛 이름이 0번인지 본다.
import { test, expect, type Browser, type Page } from '@playwright/test'
import { CLIPBOARD_FAKE, allRegion, anonymousPhone, buyerRow, clipboard, endedDay, linkOf, login, receiptsPath, resetShop, setShop } from '../n4b/support.ts'

const NEW_NAME = '라이브지니'
const OLD_NAME = '라이브' + '찜'
const PHONE = { width: 375, height: 812 }
const KST_DATE = /\d{4}-\d{2}-\d{2}/

/** 화면이 다 그려질 때까지 (h1이 보이고 "불러오는 중"이 사라짐) 기다린 뒤 옛 이름·가칭 표시가 없는지 본다 */
async function noOldName(page: Page, where: string, h1?: string | RegExp): Promise<void> {
  const heading = page.getByRole('heading', { level: 1, ...(h1 === undefined ? {} : { name: h1 }) }).first()
  await expect(heading, where).toBeVisible()
  await expect.poll(async () => await page.locator('body').innerText(), { message: where }).not.toContain('불러오는 중')
  const text = await page.locator('body').innerText()
  expect(text.split(OLD_NAME).length - 1, `${where} body`).toBe(0)
  expect(text, `${where} body`).not.toContain('(가칭)')
  expect(text, `${where} body`).not.toContain('LiveGenie')
  expect(await page.title(), `${where} title`).toBe(NEW_NAME)
}

async function loggedOutScreens(page: Page): Promise<void> {
  // 세션 확인 중 화면: /api/me 응답을 붙잡아 둔 동안 h1이 라이브지니
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/me', async (route) => {
    await held
    await route.continue()
  })
  await page.goto('/')
  await expect(page.getByText('불러오는 중…')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NEW_NAME)
  expect(await page.title()).toBe(NEW_NAME)
  expect(await page.locator('body').innerText()).not.toContain(OLD_NAME)
  release()

  // 로그인 화면
  await expect(page.getByLabel('아이디')).toBeVisible()
  await noOldName(page, '로그인', NEW_NAME)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NEW_NAME)

  // 정책 페이지 (로그인 없이) — 위 줄 이름·본문 이름, "(초안)"은 그대로
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { level: 1, name: '개인정보처리방침(초안)' })).toBeVisible()
  await expect(page.locator('.shop-name')).toHaveText(NEW_NAME)
  const privacy = await page.locator('body').innerText()
  expect(privacy).toContain(`${NEW_NAME}(이하 "서비스")는 유튜브 라이브 판매자가 주문(찜)을 받고 정산하도록 돕는 서비스예요.`)
  expect(privacy).toContain(`서비스에 준 권한은 ${NEW_NAME} 설정 → 유튜브 → "연결 끊기"로 언제든 끊을 수 있고,`)
  expect(privacy).not.toContain(OLD_NAME)
  expect(await page.title()).toBe(NEW_NAME)

  await page.goto('/terms')
  await expect(page.getByRole('heading', { level: 1, name: '이용약관(초안)' })).toBeVisible()
  await expect(page.locator('.shop-name')).toHaveText(NEW_NAME)
  const terms = await page.locator('body').innerText()
  expect(terms).toContain(`${NEW_NAME}는 유튜브 라이브 판매의 주문(찜) 받기, 문자찜 입력, 구매자·정산 관리, 라벨 출력, 구매 감사 메시지 게시를 돕는 서비스예요.`)
  expect(terms).not.toContain(OLD_NAME)
  expect(await page.title()).toBe(NEW_NAME)
}

async function sellerScreens(page: Page, browser: Browser): Promise<void> {
  await page.addInitScript(CLIPBOARD_FAKE)
  await login(page)
  await setShop(page)
  try {
    const day = await endedDay(page)
    const screens: { path: string; h1?: string | RegExp }[] = [
      { path: '/', h1: '방송 목록' },
      { path: `/broadcasts/${encodeURIComponent(day.b)}` },
      { path: '/sms', h1: '문자찜 입력' },
      { path: `/buyers?date=${day.date}`, h1: '구매자' },
      { path: `/settlements?date=${day.date}`, h1: '정산' },
      { path: `/packing?date=${day.date}`, h1: '포장' },
      { path: '/labels', h1: '라벨' },
      { path: '/settings', h1: '설정' },
      { path: '/deposits', h1: '입금 확인' },
      { path: receiptsPath(day.b), h1: '영수증 보내기' },
      { path: `/reviews?broadcast=${encodeURIComponent(day.b)}`, h1: '확인 필요' },
    ]
    for (const screen of screens) {
      await page.goto(screen.path)
      await noOldName(page, screen.path, screen.h1)
    }

    // 구매자 공유 링크 화면 (/r/…): 이름이 새로 생기지도 옛 이름이 남지도 않는다 (D-RN1-05)
    await page.goto(receiptsPath(day.b))
    await allRegion(page).getByRole('button', { name: '링크 전부 만들기' }).click()
    await expect(allRegion(page).getByText('링크 2개를 만들었어요.')).toBeVisible()
    await buyerRow(page, '문자찜').getByRole('button', { name: '링크 복사' }).click()
    const clip = await clipboard(page)
    expect(clip).toHaveLength(1)
    expect(clip[0]).not.toContain(OLD_NAME)
    expect(clip[0]).not.toContain(NEW_NAME)
    const buyer = await anonymousPhone(browser, page)
    try {
      const res = await buyer.goto(linkOf(clip[0]!))
      expect(res?.status()).toBe(200)
      await expect(buyer.getByRole('heading', { level: 1, name: '구매 내역 확인서' })).toBeVisible()
      const html = await buyer.content()
      expect(html).not.toContain(OLD_NAME)
      expect(html).not.toContain(NEW_NAME)
    } finally {
      await buyer.context().close()
    }

    // 내려받는 파일 이름 (AC-RN1-05): 한글 이름과 대체 이름
    const origin = { Origin: new URL(page.url()).origin }
    const ledger = await page.request.get('/api/export/ledger.xlsx', { headers: origin })
    expect(ledger.status()).toBe(200)
    const ledgerName = ledger.headers()['content-disposition'] ?? ''
    expect(ledgerName).toMatch(/^attachment; filename="livegenie-ledger-all-\d{4}-\d{2}-\d{2}\.xlsx"; filename\*=UTF-8''.+$/)
    expect(decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(ledgerName)?.[1] ?? '')).toMatch(new RegExp(`^${NEW_NAME}-판매대장-전체-${KST_DATE.source}\\.xlsx$`))
    const records = await page.request.get('/api/export/records.json.gz', { headers: origin })
    expect(records.status()).toBe(200)
    const recordsName = records.headers()['content-disposition'] ?? ''
    expect(recordsName).toMatch(/^attachment; filename="livegenie-records-\d{4}-\d{2}-\d{2}\.json\.gz"; filename\*=UTF-8''.+$/)
    expect(decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(recordsName)?.[1] ?? '')).toMatch(new RegExp(`^${NEW_NAME}-전체기록-${KST_DATE.source}\\.json\\.gz$`))
  } finally {
    await resetShop(page)
  }
}

test.describe('AC-RN1-14 화면에 옛 이름이 없다 — PC', () => {
  test('AC-RN1-01·03: 세션 확인·로그인·정책 페이지의 이름', async ({ page }) => {
    await loggedOutScreens(page)
  })

  test('AC-RN1-13·14·05: 주요 화면·공유 링크·내려받기 이름', async ({ page, browser }) => {
    await sellerScreens(page, browser)
  })

  test('AC-RN1-02: manifest 이름은 라이브지니, 나머지 값은 그대로', async ({ page }) => {
    await page.goto('/')
    const res = await page.request.get('/manifest.webmanifest')
    expect(res.ok()).toBe(true)
    const manifest = await res.json() as Record<string, unknown>
    expect(manifest).toMatchObject({ name: NEW_NAME, short_name: NEW_NAME, lang: 'ko', start_url: '/', scope: '/', display: 'standalone' })
    expect(JSON.stringify(manifest)).not.toContain(OLD_NAME)
  })
})

// 요금 화면은 요금 기능을 켠 묶음(chromium-billing)에만 있다 — 꺼진 서버의 /billing은 없는 화면(AC-N5-50)
test.describe('AC-RN1-14 요금 화면에 옛 이름이 없다', () => {
  test('@billing PC·휴대폰 크기 요금 화면', async ({ page }) => {
    await login(page)
    for (const size of [{ width: 1280, height: 800 }, PHONE]) {
      await page.setViewportSize(size)
      await page.goto('/billing')
      await noOldName(page, `/billing ${String(size.width)}px`, '요금')
    }
  })
})

test.describe('AC-RN1-14 화면에 옛 이름이 없다 — 휴대폰', () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true })

  test('AC-RN1-01·03: 세션 확인·로그인·정책 페이지의 이름', async ({ page }) => {
    await loggedOutScreens(page)
  })

  test('AC-RN1-13·14·05: 주요 화면·공유 링크·내려받기 이름', async ({ page, browser }) => {
    await sellerScreens(page, browser)
  })
})
