// MOB1 아이폰(393×852 WebKit — @webkit 묶음)과 고르기 칸 (AC-MOB1-02 아이폰 부분·10 아이폰·19·20, D-MOB1-03·07·10·11) — test-e2e.
// 제목에 @webkit이 붙은 시험은 webkit-iphone 묶음(devices['iPhone 15'])에서만, 그 밖은 크로미움(375·1440)에서 돈다. @no-test-printer는 시험용 프린터가 없는 서버.
import { expect, test, type Page } from '@playwright/test'
import { installFakeSpeech, turnOnVoice } from '../i4/support.ts'
import { loginAs } from '../i3/support.ts'
import { uniqueDate } from '../s05/support.ts'
import { registerApi, smsApi } from '../s06/support.ts'
import { ANDROID, ANDROID_UA, IPHONE_UA, PC, PHONE, baseUrlOf, broadcastApi, expectBig, expectNoOverflow, freshSeller, installFakeWake, newDevice, setLabelsApi, wakeCounts } from './support.ts'

const TEST_PRINTER = '시험용 프린터 — 실제로 출력되지 않아요'
const IPHONE_LINE = '실제 아이폰에선 프린터에 바로 연결할 수 없어요. 라벨 그림을 저장해 출력해 주세요.'
const IPHONE = { width: 393, height: 852 } as const

/** 날짜·문자찜이 있는 판매 하루 (출력 이력 날짜·내보내기 방송·포장·정산·구매자 날짜 고르기가 생긴다) */
async function saleDays(page: Page): Promise<{ date: string; buyer: string }> {
  let last = { date: '', buyer: '' }
  for (let i = 0; i < 2; i += 1) {
    const date = uniqueDate()
    const b = await broadcastApi(page, date, false, `고르기 방송 ${String(i + 1)}`)
    await registerApi(page, b, 1, '품종1', 1000)
    await smsApi(page, { b, no: 1, phone: `010-8100-000${String(i)}` })
    const view = (await (await page.request.get(`/api/days/${date}`)).json()) as { claims: { no: number; currentBuyer: string }[] }
    last = { date, buyer: view.claims.find((c) => c.no === 1)!.currentBuyer }
  }
  return last
}

/** 보이는 모든 select: 높이 ≥ 44px, 글자 ≥ 16px, appearance none, 배경 그림(화살표) 있음, 오른쪽 여백 ≥ 2rem */
async function expectSelects(page: Page, where: string): Promise<number> {
  const found = await page.evaluate(() => {
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize)
    return [...document.querySelectorAll('select')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
      })
      .map((el) => {
        const s = getComputedStyle(el)
        const label = el.labels?.[0]?.textContent?.trim() ?? el.getAttribute('aria-label') ?? el.id
        return {
          label,
          height: el.getBoundingClientRect().height,
          font: parseFloat(s.fontSize),
          appearance: s.appearance || (s as unknown as { webkitAppearance?: string }).webkitAppearance || '',
          webkitAppearance: s.getPropertyValue('-webkit-appearance'),
          bg: s.backgroundImage,
          padRight: parseFloat(s.paddingRight),
          root,
        }
      })
  })
  for (const sel of found) {
    const name = `${where} "${sel.label}"`
    expect(sel.height, `${name} 높이`).toBeGreaterThanOrEqual(44)
    expect(sel.font, `${name} 글자`).toBeGreaterThanOrEqual(16)
    expect([sel.appearance, sel.webkitAppearance], `${name} appearance`).toContain('none')
    expect(sel.bg, `${name} 화살표 그림`).not.toBe('none')
    expect(sel.padRight, `${name} 오른쪽 여백 ≥ 2rem`).toBeGreaterThanOrEqual(sel.root * 2 - 0.5)
  }
  return found.length
}

/** 설정·라벨·포장·정산·구매자 화면의 고르기 칸 */
async function selectScreens(page: Page, day: { date: string; buyer: string }): Promise<void> {
  const counts: Record<string, number> = {}
  for (const [where, path, ready] of [
    ['설정', '/settings', () => page.getByRole('region', { name: '전체 기록 내려받기', exact: true })],
    ['라벨', '/labels', () => page.getByRole('heading', { level: 1, name: '라벨' })],
    ['포장', `/packing?date=${day.date}`, () => page.getByRole('heading', { level: 1 })],
    ['정산', `/settlements?date=${day.date}`, () => page.getByRole('region', { name: '정산 요약' })],
    ['구매자', `/buyers?date=${day.date}`, () => page.getByRole('heading', { level: 1, name: '구매자' })],
  ] as const) {
    await page.goto(path)
    await expect(ready(), where).toBeVisible()
    await expect.poll(() => page.locator('select:visible').count(), `${where} 고르기 칸이 보인다`).toBeGreaterThan(0)
    counts[where] = await expectSelects(page, where)
  }
  expect(counts['설정'], '설정의 고르기 칸(가격 단위·같은 분·택배사 등)').toBeGreaterThanOrEqual(2)
  expect(counts['라벨'], '라벨 화면(출력 이력 날짜·내보내기 방송)').toBeGreaterThanOrEqual(2)
}

test.describe('AC-MOB1-19 고르기 칸 44px', () => {
  test('393×852 WebKit 아이폰: 설정·라벨·포장·정산·구매자의 보이는 모든 select — 44px·16px·appearance none·화살표·오른쪽 여백 2rem @webkit', async ({ page, browser }) => {
    test.setTimeout(180_000)
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: IPHONE, touch: true, userAgent: IPHONE_UA })
    try {
      await setLabelsApi(dev, true)
      const day = await saleDays(dev)
      await selectScreens(dev, day)
    } finally {
      await context.close()
    }
  })

  for (const [label, viewport] of [['375 크로미움', PHONE], ['1440', PC]] as const) {
    test(`${label}: 같은 기준`, async ({ page, browser }) => {
      test.setTimeout(180_000)
      await page.goto('/')
      const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport, touch: viewport === PHONE })
      try {
        await setLabelsApi(dev, true)
        const day = await saleDays(dev)
        await selectScreens(dev, day)
      } finally {
        await context.close()
      }
    })
  }
})

test.describe('AC-MOB1-20 아이폰에 보이는 시험용 프린터', () => {
  test('아이폰 WebKit 393: 라벨 화면과 마법사 4/5에서 "시험용 프린터 — 실제로 출력되지 않아요" 바로 아래 아이폰 한 줄 @webkit', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: IPHONE, touch: true, userAgent: IPHONE_UA })
    try {
      await setLabelsApi(dev, true)
      await dev.goto('/labels')
      await expectIphoneLine(dev)
      // 마법사 4/5 (같은 프린터 칸)
      const wiz = await dev.request.put('/api/wizard', { data: { status: 'IN_PROGRESS', step: 4 }, headers: { Origin: baseUrlOf(dev) } })
      expect(wiz.ok(), await wiz.text()).toBe(true)
      await dev.goto('/start')
      await expect(dev.getByRole('heading', { level: 2, name: '4/5 프린터 연결' })).toBeVisible()
      await expectIphoneLine(dev)
    } finally {
      await context.close()
    }
  })

  test('크로미움 + 아이폰 사용자 에이전트: 라벨 화면에 같은 줄 — 안드로이드·PC 사용자 에이전트에는 없다', async ({ page, browser }) => {
    await page.goto('/')
    const { page: owner, context, seller } = await freshSeller(browser, baseUrlOf(page), { viewport: PC })
    try {
      await setLabelsApi(owner, true)
      for (const [label, options, shown] of [
        ['아이폰', { viewport: IPHONE, touch: true, userAgent: IPHONE_UA }, true],
        ['안드로이드', { viewport: ANDROID, touch: true, userAgent: ANDROID_UA }, false],
        ['PC', { viewport: PC }, false],
      ] as const) {
        const dev = await newDevice(browser, baseUrlOf(owner), options)
        try {
          await loginAs(dev.page, seller, '/labels')
          const printer = dev.page.getByRole('region', { name: '프린터', exact: true })
          await expect(printer.getByRole('button', { name: TEST_PRINTER }), label).toBeVisible()
          if (shown) await expectIphoneLine(dev.page)
          else await expect(dev.page.getByText(IPHONE_LINE), label).toHaveCount(0)
        } finally {
          await dev.context.close()
        }
      }
    } finally {
      await context.close()
    }
  })

  test('시험용 프린터가 없는 서버: 아이폰 사용자 에이전트여도 줄이 없다 @no-test-printer', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: IPHONE, touch: true, userAgent: IPHONE_UA })
    try {
      await setLabelsApi(dev, true)
      await dev.goto('/labels')
      await expect(dev.getByRole('heading', { level: 1, name: '라벨' })).toBeVisible()
      await expect(dev.getByRole('region', { name: '프린터', exact: true })).toBeVisible()
      await expect(dev.getByRole('button', { name: TEST_PRINTER })).toHaveCount(0)
      await expect(dev.getByText(IPHONE_LINE)).toHaveCount(0)
    } finally {
      await context.close()
    }
  })
})

async function expectIphoneLine(page: Page): Promise<void> {
  const printer = page.getByRole('region', { name: '프린터', exact: true })
  const button = printer.getByRole('button', { name: TEST_PRINTER })
  await expect(button).toBeVisible()
  const line = printer.getByText(IPHONE_LINE, { exact: true })
  await expect(line).toBeVisible()
  // 바로 아래: 시험용 프린터 버튼이 든 줄의 다음 요소
  const next = await button.evaluate((el, target) => {
    let row: Element | null = el
    while (row !== null && row.parentElement !== null && !row.parentElement.contains(target)) row = row.parentElement
    return row?.nextElementSibling === target
  }, await line.elementHandle())
  expect(next, '시험용 프린터 줄 바로 다음').toBe(true)
  const bb = (await button.boundingBox())!
  const lb = (await line.boundingBox())!
  expect(lb.y).toBeGreaterThanOrEqual(bb.y + bb.height - 0.5)
}

test.describe('아이폰 WebKit 393: 글자 150% 넘침 0 (AC-MOB1-02) · 화면 꺼짐 막기 (AC-MOB1-10)', () => {
  test('글자 150%: 콘솔·문자찜 입력·라벨 화면 가로 넘침 0 @webkit', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: IPHONE, touch: true, userAgent: IPHONE_UA, big: true })
    try {
      await setLabelsApi(dev, true)
      const date = uniqueDate()
      const b = await broadcastApi(dev, date, false, '아이폰 큰 글씨 방송')
      for (const no of [1, 2, 3]) await registerApi(dev, b, no, `핑크프릴${String(no)}`, 10000)
      await smsApi(dev, { b, no: 40, memo: '보류' })
      await dev.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expectBig(dev)
      await expect(dev.getByLabel('빠른 입력')).toBeVisible()
      await expectNoOverflow(dev, '아이폰 콘솔')
      const toggle = dev.getByRole('button', { name: /^알림 \d+ 펼치기$/ })
      if ((await toggle.count()) > 0) {
        await toggle.click()
        await expectNoOverflow(dev, '아이폰 콘솔(띠 펼침)')
      }
      await dev.goto('/sms')
      await expect(dev.getByRole('heading', { level: 1, name: '문자찜 입력' })).toBeVisible()
      await expect(dev.getByRole('region', { name: '고른 방송' })).toContainText('아이폰 큰 글씨 방송')
      await expectNoOverflow(dev, '아이폰 문자찜 입력')
      await dev.goto('/labels')
      await expect(dev.getByRole('heading', { level: 1, name: '라벨' })).toBeVisible()
      await expectNoOverflow(dev, '아이폰 라벨')
    } finally {
      await context.close()
    }
  })

  test('가짜 Wake Lock: 음성을 켜면 request("screen") 1번, 끄면 놓는다 @webkit', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: IPHONE, touch: true, userAgent: IPHONE_UA })
    try {
      await installFakeWake(context)
      await installFakeSpeech(context, { consent: true })
      await setLabelsApi(dev, false)
      const b = await broadcastApi(dev, uniqueDate(), true)
      await dev.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(dev.getByLabel('빠른 입력')).toBeVisible()
      await turnOnVoice(dev)
      await expect.poll(async () => (await wakeCounts(dev)).requests).toEqual(['screen'])
      await expect.poll(async () => (await wakeCounts(dev)).held).toBe(1)
      await dev.getByRole('button', { name: '음성 끄기', exact: true }).click()
      await expect.poll(async () => (await wakeCounts(dev)).held).toBe(0)
    } finally {
      await context.close()
    }
  })
})

