// FB1 B1 연결 실패·다시 잇기 (AC-FB1-40·38, AC-FB1-90 프린터 줄) @printer — 시험 모드의 가짜 B1 블루투스(window.livejjimTestPrinter.useFakeB1).
// 해볼 일 문장은 docs/spec/LABEL_RULES.md L-7 "해볼 일" 따옴표 그대로(v0.2.6 — 회차 2 D-FB1-17: 옛 ⑥ 없음, ⑤는 안드로이드가 아닐 때만).
// 회차 2 D-FB1-18 (b): 차례는 문장 → 해볼 일 → "다시 연결"(하나, 주 버튼) → 자세히. 상자에 "다시 연결"이 보이면 연결 방법 버튼은 보통 버튼.
import { expect, test, type Page } from '@playwright/test'
import { loginNewSeller } from './support.ts'

const CONNECT_FAILED = '프린터에 연결하지 못했어요. 아래를 차례로 해 본 뒤 다시 연결해 주세요.'
const RETRIED = '프린터가 답하지 않아 기다리는 시간이 지났어요. 한 번 더 해 봤지만 안 됐어요.'
const TIP1 = "프린터 전원을 껐다 켠 뒤 '다시 연결'을 눌러 주세요."
const TIP2 = '휴대폰의 NIIMBOT 앱이 프린터에 이어져 있으면 앱을 닫아 주세요. 프린터는 한 기기에만 이어져요.'
const TIP3 = "윈도우 설정 → 블루투스 및 장치에서 B1을 '장치 제거'한 뒤 여기서 '다시 연결'을 눌러 목록에서 B1을 골라 주세요. 윈도우에서 미리 연결(페어링)하지 않아도 돼요."
const TIP4 = 'USB 선이 있으면 USB 연결로 해 보세요.'
const TIP5 = "그래도 안 되면 안드로이드 폰의 크롬에서 라이브지니에 로그인해 프린터를 연결하고 '이 기기에서 출력'을 눌러 주세요. 컴퓨터에서 만든 라벨도 그 폰이 찍어요."
/** 옛 ⑥ — 어디에도 없어야 한다 (회차 2 D-FB1-17) */
const OLD_TIP6 = '아이폰·아이패드는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 NIIMBOT 앱에서 인쇄해 주세요.'
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
/** 오류 상자에 허용되는 라틴 낱말 (AC-FB1-38) */
const ALLOWED_LATIN = new Set(['B1', 'NIIMBOT', 'Marklife', 'USB', 'PNG', 'PDF'])

type Handle = {
  useFakeB1(): void
  setUnansweredNegotiations(n: number): void
  fakeB1(): { requests: number; connectAttempts: number; connected: boolean } | null
}

const printer = (page: Page) => page.getByRole('region', { name: '프린터', exact: true })

async function openLabelsWithFakeB1(page: Page, unanswered: number): Promise<void> {
  await loginNewSeller(page)
  await page.goto('/labels')
  await expect(page.getByRole('heading', { name: '라벨', level: 1 })).toBeVisible()
  await expect.poll(() => page.evaluate(() => 'livejjimTestPrinter' in window)).toBe(true)
  await page.evaluate((n) => {
    const h = (window as unknown as { livejjimTestPrinter: Handle }).livejjimTestPrinter
    h.useFakeB1()
    h.setUnansweredNegotiations(n)
  }, unanswered)
}

async function fakeState(page: Page) {
  return await page.evaluate(() => (window as unknown as { livejjimTestPrinter: Handle }).livejjimTestPrinter.fakeB1())
}

/** 상자 안 차례·주 버튼 (회차 2 D-FB1-18 (b)) */
async function checkBoxOrder(page: Page, box: ReturnType<Page['getByRole']>): Promise<void> {
  const retry = box.getByRole('button', { name: '다시 연결' })
  await expect(retry).toHaveCount(1)
  await expect(printer(page).getByRole('button', { name: '다시 연결' })).toHaveCount(1)
  await expect(retry).toHaveClass(/button-primary/)
  const y = async (l: ReturnType<Page['getByRole']>) => (await l.boundingBox())!.y
  const msg = box.getByText(CONNECT_FAILED, { exact: true })
  const tips = box.getByRole('list', { name: '해볼 일' })
  const more = box.getByText('자세히', { exact: true })
  const tipsBox = (await tips.boundingBox())!
  expect(await y(msg)).toBeLessThan(tipsBox.y)
  expect(await y(retry)).toBeGreaterThanOrEqual(tipsBox.y + tipsBox.height - 1)
  expect(await y(more)).toBeGreaterThan(await y(retry))
  // 연결 방법 버튼은 모두 보통 버튼, 라벨 화면의 주 버튼은 많아야 하나
  for (const name of ['블루투스로 연결', 'USB로 연결']) {
    const b = printer(page).getByRole('button', { name, exact: true })
    if ((await b.count()) > 0) await expect(b).not.toHaveClass(/button-primary/)
  }
  await expect(page.locator('main .button-primary:visible')).toHaveCount(1)
}

function latinWords(text: string): string[] {
  return (text.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []).filter((w) => !ALLOWED_LATIN.has(w))
}

test.describe('AC-FB1-40 가짜 B1 연결 실패·다시 잇기 @printer', () => {
  test('두 번 답하지 않음 → 문장·해볼 일(차례)·자세히 "한 번 더 해 봤지만…", 영어 낱말 없음 → "다시 연결"은 고르기부터', async ({ page }) => {
    await openLabelsWithFakeB1(page, 2)
    // Playwright "Desktop Chrome"의 사용자 에이전트는 윈도우다 — ③은 그때만
    const { serial, windows } = await page.evaluate(() => ({ serial: 'serial' in navigator, windows: navigator.userAgent.includes('Windows') }))
    await printer(page).getByRole('button', { name: '블루투스로 연결' }).click()
    const box = printer(page).getByRole('alert').filter({ hasText: CONNECT_FAILED })
    await expect(box).toBeVisible({ timeout: 20_000 })
    const tips = box.getByRole('list', { name: '해볼 일' })
    await expect(tips.getByRole('listitem')).toHaveText([TIP1, TIP2, ...(windows ? [TIP3] : []), ...(serial ? [TIP4] : []), TIP5])
    await expect(page.getByText(OLD_TIP6)).toHaveCount(0)
    await checkBoxOrder(page, box)
    await box.getByText('자세히', { exact: true }).click()
    await expect(box.getByText(RETRIED, { exact: true })).toBeVisible()
    const all = await page.locator('main').innerText()
    for (const word of ['Error', 'negotiate', 'Timeout', 'waited', 'CONNECT_FAILED', 'DISCONNECTED']) expect(all).not.toContain(word)
    expect(latinWords(await box.innerText())).toEqual([])
    const before = await fakeState(page)
    expect(before).toMatchObject({ requests: 1, connectAttempts: 2, connected: false })

    // "다시 연결" → 다시 고르기부터 (이번엔 답함)
    await page.evaluate(() => (window as unknown as { livejjimTestPrinter: Handle }).livejjimTestPrinter.setUnansweredNegotiations(0))
    await box.getByRole('button', { name: '다시 연결' }).click()
    await expect(printer(page).getByText(/이 기기의 프린터: 연결됨/)).toBeVisible({ timeout: 20_000 })
    await expect(printer(page).getByText(CONNECT_FAILED)).toHaveCount(0)
    const after = await fakeState(page)
    expect(after!.requests).toBe(2)
    expect(after!.connected).toBe(true)
  })

  test('처음 한 번만 답하지 않음 → 저절로 다시 이어져 "연결됨"이고 오류 없음, 고르기 창은 한 번', async ({ page }) => {
    await openLabelsWithFakeB1(page, 1)
    await printer(page).getByRole('button', { name: '블루투스로 연결' }).click()
    await expect(printer(page).getByText(/이 기기의 프린터: 연결됨/)).toBeVisible({ timeout: 20_000 })
    await expect(printer(page).getByRole('alert')).toHaveCount(0)
    await expect(page.getByText(CONNECT_FAILED)).toHaveCount(0)
    expect(await fakeState(page)).toMatchObject({ requests: 1, connectAttempts: 2, connected: true })
  })

  test('맥 사용자 에이전트면 해볼 일에 윈도우 줄(③)·옛 ⑥이 없고 ⑤는 있다, 차례·주 버튼', async ({ browser }) => {
    const context = await browser.newContext({ userAgent: MAC_UA })
    const page = await context.newPage()
    try {
      await openLabelsWithFakeB1(page, 2)
      const serial = await page.evaluate(() => 'serial' in navigator)
      await printer(page).getByRole('button', { name: '블루투스로 연결' }).click()
      const box = printer(page).getByRole('alert').filter({ hasText: CONNECT_FAILED })
      await expect(box).toBeVisible({ timeout: 20_000 })
      await expect(box.getByRole('list', { name: '해볼 일' }).getByRole('listitem')).toHaveText([TIP1, TIP2, ...(serial ? [TIP4] : []), TIP5])
      await expect(box.getByText(TIP3)).toHaveCount(0)
      await expect(box.getByText(TIP5, { exact: true })).toBeVisible()
      await expect(page.getByText(OLD_TIP6)).toHaveCount(0)
      await checkBoxOrder(page, box)
      expect(latinWords(await box.innerText())).toEqual([])
    } finally {
      await context.close()
    }
  })

  test('안드로이드 사용자 에이전트면 ⑤(안드로이드 폰으로 출력)가 없다', async ({ browser }) => {
    const context = await browser.newContext({ userAgent: ANDROID_UA, viewport: { width: 375, height: 812 } })
    const page = await context.newPage()
    try {
      await openLabelsWithFakeB1(page, 2)
      const serial = await page.evaluate(() => 'serial' in navigator)
      await printer(page).getByRole('button', { name: '블루투스로 연결' }).click()
      const box = printer(page).getByRole('alert').filter({ hasText: CONNECT_FAILED })
      await expect(box).toBeVisible({ timeout: 20_000 })
      await expect(box.getByRole('list', { name: '해볼 일' }).getByRole('listitem')).toHaveText([TIP1, TIP2, ...(serial ? [TIP4] : [])])
      await expect(page.getByText(TIP5)).toHaveCount(0)
      await expect(page.getByText(OLD_TIP6)).toHaveCount(0)
      await checkBoxOrder(page, box)
    } finally {
      await context.close()
    }
  })

  test('375px에서도 문장·해볼 일·다시 연결이 보인다', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 })
    await openLabelsWithFakeB1(page, 2)
    await printer(page).getByRole('button', { name: '블루투스로 연결' }).click()
    const box = printer(page).getByRole('alert').filter({ hasText: CONNECT_FAILED })
    await expect(box).toBeVisible({ timeout: 20_000 })
    await expect(box.getByRole('button', { name: '다시 연결' })).toBeVisible()
    await expect(box.getByRole('list', { name: '해볼 일' })).toBeVisible()
    await checkBoxOrder(page, box)
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(width).toBeLessThanOrEqual(375)
  })
})
