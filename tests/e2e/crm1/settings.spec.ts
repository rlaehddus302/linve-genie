// CRM1 설정 "손님 관리" (test-e2e) — AC-CRM1-11·12. 문장은 D-CRM1-05 그대로. 저장은 화면 아래 저장 막대 하나(D-FB1-06).
import { test, expect, type Page } from '@playwright/test'
import { buyerRows, eventCount, kstDate, loginNewSeller, youtubeSale } from './support.ts'

const COUNT_BAD = '단골 횟수는 2~99번으로 적어 주세요.'
const AMOUNT_BAD = '단골 금액은 1,000원~100,000,000원으로 적거나 비워 주세요.'
const WAIT_BAD = '입금 기다리는 날은 1~30일로 적어 주세요.'

function region(page: Page) {
  return page.getByRole('region', { name: '손님 관리', exact: true })
}
function saveButton(page: Page) {
  return page.getByRole('region', { name: '저장', exact: true }).getByRole('button', { name: '저장', exact: true })
}

async function serverSettings(page: Page): Promise<{ regularCount: number; regularAmount: number | null; waitDays: number }> {
  const res = await page.request.get('/api/customer-settings')
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as { settings: { regularCount: number; regularAmount: number | null; waitDays: number } }).settings
}

for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 900 }]) {
  test(`AC-CRM1-11 ${String(viewport.width)}px: 기본 3번·100,000원·3일, 틀린 값은 서버가 거절하고 칸 아래 문장, 금액을 비우면 "금액 기준 안 씀"`, async ({ page }) => {
    test.setTimeout(150_000)
    await page.setViewportSize(viewport)
    await loginNewSeller(page)
    await page.goto('/settings')
    const box = region(page)
    await expect(box.getByRole('heading', { name: '손님 관리' })).toBeVisible()
    const count = box.getByLabel('단골 횟수')
    const amount = box.getByLabel('단골 금액')
    const wait = box.getByLabel('입금 기다리는 날')
    await expect(count).toHaveValue('3')
    await expect(amount).toHaveValue(/^100,?000$/)
    await expect(wait).toHaveValue('3')
    // 설명은 규칙 "이상" 그대로 (D-CRM1-05·D-CRM1-16 (4)) — "넘은"을 쓰지 않는다
    await expect(box.getByText('단골 = 이 횟수 이상 샀거나 이 금액 이상 산 손님. 입금 늦음 주의 = 미입금이 한 번이라도 있는 손님.', { exact: true })).toBeVisible()
    await expect(box).not.toContainText('넘은')

    const cases: { field: typeof count; value: string; message: string; back: string }[] = [
      { field: count, value: '1', message: COUNT_BAD, back: '3' },
      { field: count, value: '100', message: COUNT_BAD, back: '3' },
      { field: amount, value: '999', message: AMOUNT_BAD, back: '100000' },
      { field: amount, value: '100000001', message: AMOUNT_BAD, back: '100000' },
      { field: amount, value: '10.5', message: AMOUNT_BAD, back: '100000' },
      { field: wait, value: '0', message: WAIT_BAD, back: '3' },
      { field: wait, value: '31', message: WAIT_BAD, back: '3' },
    ]
    for (const c of cases) {
      await c.field.fill(c.value)
      await saveButton(page).click()
      await expect(box.getByText(c.message), `${c.value} → ${c.message}`).toBeVisible()
      // 칸 아래 문장 = 그 칸의 설명으로 이어진다
      await expect(c.field).toHaveAttribute('aria-invalid', 'true')
      expect(await serverSettings(page)).toEqual({ regularCount: 3, regularAmount: 100_000, waitDays: 3 })
      // 거절된 칸 값을 고치면 그 칸의 문장과 aria-invalid가 바로 사라진다 (D-CRM1-16 (3), TE-CRM1-006) — 새로 열지 않고
      await c.field.fill(c.back)
      await expect(box.getByText(c.message), `${c.value} → 고친 뒤 문장`).toHaveCount(0)
      await expect(c.field).not.toHaveAttribute('aria-invalid', 'true')
      // 다음 경우 전에 화면을 새로 연다 (남은 상태가 다음 경우를 거짓 통과시키지 않게)
      await page.goto('/settings')
      await expect(box.getByText(c.message)).toHaveCount(0)
    }

    await amount.fill('')
    await count.fill('5')
    await saveButton(page).click()
    await expect.poll(() => serverSettings(page)).toEqual({ regularCount: 5, regularAmount: null, waitDays: 3 })
    await page.reload()
    await expect(amount).toHaveValue('')
    await expect(count).toHaveValue('5')
  })
}

test('AC-CRM1-12: 단골 횟수를 2로 저장 → 구매 2번(45,000원) 손님 줄에 "단골", 이벤트 로그는 그대로', async ({ page }) => {
  test.setTimeout(150_000)
  await loginNewSeller(page)
  const [d1, d2] = [kstDate(14), kstDate(7)] as const
  const ch = `UC_A${String(Date.now())}`
  await youtubeSale(page, { date: d1, ch, nick: '두번손님', prices: [20_000], paid: true })
  const s2 = await youtubeSale(page, { date: d2, ch, nick: '두번손님', prices: [25_000], paid: true })
  const scopes = [d1, d2].map((date) => ({ date, rehearsal: false }))
  const before = await eventCount(page, scopes)
  const winnersBefore = JSON.stringify((await (await page.request.get(`/api/days/${d2}`)).json() as { products: unknown }).products)

  await page.goto(`/buyers?date=${d2}`)
  const row = buyerRows(page).filter({ hasText: '두번손님' })
  await expect(row).toHaveCount(1)
  await expect(row).not.toContainText('단골')

  await page.goto('/settings')
  await region(page).getByLabel('단골 횟수').fill('2')
  await saveButton(page).click()
  await expect.poll(async () => (await serverSettings(page)).regularCount).toBe(2)

  await page.goto(`/buyers?date=${d2}`)
  await expect(buyerRows(page).filter({ hasText: '두번손님' })).toContainText('단골')
  await page.goto(`/buyers?date=${d2}&buyer=${encodeURIComponent(s2.buyer)}`)
  await expect(page.getByRole('region', { name: '손님 기록' })).toContainText('누적 구매 45,000원 · 2번')
  expect(await eventCount(page, scopes)).toBe(before)
  expect(JSON.stringify((await (await page.request.get(`/api/days/${d2}`)).json() as { products: unknown }).products)).toBe(winnersBefore)
})
