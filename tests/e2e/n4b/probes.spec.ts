// N4b 흐름 깨뜨리기 — 응답 유실 뒤 다시 보내기(같은 요청 번호)·받는 중 잠금·링크 끝 시각(KST) (AC-N4b-10·11·31·33) — test-e2e.
import { test, expect } from '@playwright/test'
import { allRegion, buyerRow, endedDay, login, receiptsPath } from './support.ts'

/** ISO → KST "M월 D일 (요일) HH:MM" (스펙 문장으로 손 계산) */
function kstWords(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 3600_000)
  const dow = '일월화수목금토'[d.getUTCDay()]!
  return `${String(d.getUTCMonth() + 1)}월 ${String(d.getUTCDate())}일 (${dow}) ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

test.describe('응답을 잃어도 한 번만 만든다', () => {
  test('"링크 전부 만들기" 첫 응답이 끊기면 같은 요청 번호로 다시 보내 "링크 2개를 만들었어요."', async ({ page }) => {
    await login(page)
    const day = await endedDay(page)
    await page.goto(receiptsPath(day.b))
    const ids: string[] = []
    let first = true
    await page.route('**/receipt-links/all', async (route) => {
      ids.push((route.request().postDataJSON() as { requestId: string }).requestId)
      if (first) {
        first = false
        await route.fetch() // 서버에는 닿는다
        await route.abort('connectionreset')
        return
      }
      await route.continue()
    })
    await allRegion(page).getByRole('button', { name: '링크 전부 만들기' }).click()
    await expect(allRegion(page).getByText('링크 2개를 만들었어요.')).toBeVisible({ timeout: 20_000 })
    expect(ids.length).toBeGreaterThanOrEqual(2)
    expect(new Set(ids).size).toBe(1)
    const list = await (await page.request.get(`/api/days/${day.date}/receipt-links`)).json() as { links: { status: string }[] }
    expect(list.links.map((l) => l.status)).toEqual(['ACTIVE', 'ACTIVE'])
  })

  test('"링크 만들기" 첫 응답이 끊겨도 줄은 "링크를 만들었어요."와 링크 있음', async ({ page }) => {
    await login(page)
    const day = await endedDay(page)
    await page.goto(receiptsPath(day.b))
    const ids: string[] = []
    let first = true
    await page.route(`**/api/days/${day.date}/receipt-links`, async (route) => {
      if (route.request().method() !== 'POST') return await route.continue()
      ids.push((route.request().postDataJSON() as { requestId: string }).requestId)
      if (first) {
        first = false
        await route.fetch()
        await route.abort('connectionreset')
        return
      }
      await route.continue()
    })
    const row = buyerRow(page, '문자찜')
    await row.getByRole('button', { name: '링크 만들기' }).click()
    await expect(row.getByRole('status')).toHaveText('링크를 만들었어요.', { timeout: 20_000 })
    expect(new Set(ids).size).toBe(1)
  })
})

test.describe('AC-N4b-31 받는 동안 잠금', () => {
  test('전원 이미지 묶음을 받는 동안 그 버튼은 눌리지 않고 "만드는 중…"', async ({ page }) => {
    await login(page)
    const day = await endedDay(page)
    await page.goto(receiptsPath(day.b))
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    await page.route('**/receipts.zip*', async (route) => {
      await gate
      await route.continue()
    })
    const btn = allRegion(page).getByRole('button', { name: '전원 이미지(JPG) 묶음' })
    const dl = page.waitForEvent('download')
    await btn.click()
    await expect(btn).toBeDisabled()
    await expect(allRegion(page).getByText('만드는 중…')).toBeVisible()
    release()
    await dl
    await expect(btn).toBeEnabled()
  })
})

test.describe('AC-N4b-33 링크 끝 시각', () => {
  test('줄의 "링크 있음 · M월 D일 (요일) HH:MM까지"는 서버 끝 시각의 KST, 끝 시각 = 만든 때 + 14일', async ({ page }) => {
    await login(page)
    const day = await endedDay(page)
    await page.goto(receiptsPath(day.b))
    const before = Date.now()
    const row = buyerRow(page, '문자찜')
    await row.getByRole('button', { name: '링크 만들기' }).click()
    await expect(row.getByRole('status')).toHaveText('링크를 만들었어요.')
    const after = Date.now()
    const list = await (await page.request.get(`/api/days/${day.date}/receipt-links`)).json() as { links: { buyer: string; expiresAt: string }[] }
    const mine = list.links.find((l) => l.buyer === day.phoneBuyer)!
    const exp = Date.parse(mine.expiresAt)
    expect(exp).toBeGreaterThanOrEqual(before + 14 * 86_400_000 - 2000)
    expect(exp).toBeLessThanOrEqual(after + 14 * 86_400_000 + 2000)
    await expect(row).toContainText(`링크 있음 · ${kstWords(mine.expiresAt)}까지`)
  })
})
