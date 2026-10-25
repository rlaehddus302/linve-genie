// SMS2 휴대폰·PC 모양 (test-e2e) — AC-SMS2-30. Chromium 375×812·412×915·1280×800, WebKit 393×852(@webkit = webkit-iphone 묶음, iPhone 15), 뿌리 글자 100%·150%.
// 기대값: 가로 스크롤 0, 요약의 "빠진 번호"·"순서"·"다음에 보낼 글" 문장이 잘리지 않음, "처음부터 다시 세기"·확인 화면 두 단추 높이 48px 이상,
// 기본 본문 글자 18px 이상, PC 내용 폭 720px 이하.
// 현실적인 무거운 화면을 만든다: 빠진 번호가 20개 넘는 기기(시험 30 하나), 띄어쓰기 없는 긴 주소가 든 문자, 30자 기기 이름.
import { expect, test, type Page } from '@playwright/test'
import { START, bigRoot, expectNoSideScroll, expectNotCut, holdRefresh, openSmsBox, phoneAtBefore, type SmsBox } from './support.ts'

let sms: SmsBox

test.beforeEach(async () => {
  sms = await openSmsBox()
})

test.afterEach(async () => {
  await sms.close()
})

const LONG_DEVICE = 'GalaxyS24Ultra사장님가게폰두번째기기' // 띄어쓰기 없는 30자 안팎
const LONG_URL = 'https://smartstore.naver.com/dayuk-garden/products/1234567890?NaPm=ct%3Dabcdefghij%7Cci%3Dshoppingwindow%7Ctr%3Dswl%7Chk%3D0123456789abcdef'

async function fill(): Promise<void> {
  const at = (sec: number) => sms.setNow(new Date(START.getTime() + sec * 1000))
  const order = [1, 2, 4, 3, 6, 5, 8, 7, 10, 9]
  for (const [i, n] of order.entries()) {
    at(i * 5)
    await sms.send({ from: '010-1234-5678', body: `시험 ${String(n)}`, device: 'iPhone', receivedAt: phoneAtBefore(sms, 1200 + i * 300) })
  }
  at(60)
  await sms.send({ from: '010-2222-3333', body: '시험 30', device: LONG_DEVICE, receivedAt: phoneAtBefore(sms, 2500) })
  at(61)
  await sms.send({ from: '010-2222-3333', body: `시험 31 주문 링크 ${LONG_URL}`, device: LONG_DEVICE })
  at(62)
  await sms.send({ from: '다육이단골손님', body: '165번주세요\n166번도요\n주소는 서울시 강남구 테헤란로 123 다육빌딩 4층입니다', device: LONG_DEVICE })
}

const SUMMARY_LINES = [/^시험 1~10: 빠진 번호 없어요$/, /^순서: 늦게 온 번호 3, 5, 7, 9$/, /^다음에 보낼 글: 시험 11$/, /^시험 1~31: 빠진 번호 1, 2, 3/, /^다음에 보낼 글: 시험 32$/]

async function minFont(page: Page): Promise<{ size: number; what: string }> {
  return page.evaluate(() => {
    let size = Infinity
    let what = ''
    for (const el of document.querySelectorAll<HTMLElement>('main p, main li, main .b, main a, main button')) {
      if (el.getClientRects().length === 0) continue
      const px = Number.parseFloat(getComputedStyle(el).fontSize)
      if (px < size) {
        size = px
        what = `${el.tagName} ${(el.textContent ?? '').slice(0, 30)}`
      }
    }
    return { size, what }
  })
}

async function heightOf(page: Page, role: 'link' | 'button', name: string): Promise<number> {
  const target = page.getByRole(role, { name, exact: true })
  await expect(target).toBeVisible()
  const box = await target.boundingBox()
  return box?.height ?? 0
}

async function check(page: Page, where: string, opts: { pc: boolean; big: boolean }): Promise<void> {
  await holdRefresh(page)
  if (opts.big) await bigRoot(page)
  await fill()
  await page.goto(sms.viewUrl)
  await expect(page.locator('.card')).toHaveCount(13)
  if (opts.big) expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('24px')

  // 빠진 번호가 20개 넘는 기기 — 앞 20개와 "외 n개" (시험 30·31만 받음 → 1~29 빠짐 29개, 20개 보이고 9개)
  await expect(page.getByText(/^시험 1~31: 빠진 번호 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20 외 9개$/)).toBeVisible()

  await expectNoSideScroll(page, `${where} 보기 화면`)
  await expectNotCut(page, SUMMARY_LINES, `${where} 요약`)
  // 긴 주소가 든 카드 내용도 화면 안
  await expectNotCut(page, [/smartstore\.naver\.com/], `${where} 긴 주소 카드`)
  await expectNotCut(page, [new RegExp(`^${LONG_DEVICE} — 받은 문자 3건$`)], `${where} 긴 기기 이름 제목`)

  const font = await minFont(page)
  expect(font.size, `${where} 가장 작은 본문 글자 (${font.what})`).toBeGreaterThanOrEqual(18)
  expect(await heightOf(page, 'link', '처음부터 다시 세기'), `${where} "처음부터 다시 세기" 높이`).toBeGreaterThanOrEqual(48)

  if (opts.pc) {
    const width = await page.locator('main').evaluate((el) => el.getBoundingClientRect().width)
    expect(width, `${where} 내용 폭`).toBeLessThanOrEqual(720)
  }

  await page.getByRole('link', { name: '처음부터 다시 세기' }).click()
  await expect(page.getByText(/^받은 시험 문자 13건을 지우고 처음부터 셀까요\?/)).toBeVisible()
  await expectNoSideScroll(page, `${where} 확인 화면`)
  expect(await heightOf(page, 'button', '네, 지우고 처음부터 셀게요'), `${where} "네" 단추 높이`).toBeGreaterThanOrEqual(48)
  expect(await heightOf(page, 'link', '아니요, 돌아갈게요'), `${where} "아니요" 높이`).toBeGreaterThanOrEqual(48)
  await expectNotCut(page, [/^받은 시험 문자 13건을/, /^네, 지우고 처음부터 셀게요$/, /^아니요, 돌아갈게요$/], `${where} 확인 화면 글`)
  const askFont = await minFont(page)
  expect(askFont.size, `${where} 확인 화면 가장 작은 글자 (${askFont.what})`).toBeGreaterThanOrEqual(18)
  if (opts.pc) {
    const width = await page.locator('main').evaluate((el) => el.getBoundingClientRect().width)
    expect(width, `${where} 확인 화면 내용 폭`).toBeLessThanOrEqual(720)
  }
}

const CHROMIUM = [
  ['375×812', { width: 375, height: 812 }, false],
  ['412×915', { width: 412, height: 915 }, false],
  ['PC 1280×800', { width: 1280, height: 800 }, true],
] as const

for (const [label, viewport, pc] of CHROMIUM) {
  for (const big of [false, true]) {
    test(`AC-SMS2-30 ${label} 글자 ${big ? '150' : '100'}%: 가로 스크롤 0, 요약 문장 안 잘림, 단추 48px, 글자 18px 이상${pc ? ', 내용 폭 720px 이하' : ''}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...(pc ? {} : { hasTouch: true, isMobile: true }) })
      const page = await ctx.newPage()
      try {
        await check(page, `${label} ${big ? '150' : '100'}%`, { pc, big })
      } finally {
        await ctx.close()
      }
    })
  }
}

for (const big of [false, true]) {
  test(`AC-SMS2-30 @webkit 아이폰 393×852 글자 ${big ? '150' : '100'}%: 가로 스크롤 0, 요약 문장 안 잘림, 단추 48px, 글자 18px 이상`, async ({ page }) => {
    // iPhone 15 묶음: 화면 393×852, 브라우저 보이는 칸 393×659(주소창·아래 막대 뺌)
    expect(page.viewportSize()?.width).toBe(393)
    await check(page, `WebKit 393 ${big ? '150' : '100'}%`, { pc: false, big })
  })
}
