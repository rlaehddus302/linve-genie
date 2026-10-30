// AC-PRN2-11 E2E — 가짜 프린터로 출력 한 장 끝까지(B1·바우아토), 휴대폰 폭 390에서 실험 표시와 글자·누르는 칸 크기.
import { expect, test } from '@playwright/test'
import { BAUATO, becomeOutputDevice, connectAs, loginNewSeller, openRealBroadcast, printed, queueOf, region, registerApi, scopeLabels, smsApi, waitPrinted } from './support.ts'

test('AC-PRN2-11: B1 — 접수 → 라벨 한 장이 시험용 프린터에 384×240으로 찍히고 "라벨 출력됨"', async ({ page }) => {
  await loginNewSeller(page)
  const { b, date } = await openRealBroadcast(page)
  await connectAs(page, null)
  await becomeOutputDevice(page, 'PC', false)
  await registerApi(page, b, 1, '품종1', 1000)
  await smsApi(page, { b, no: 1 })
  await waitPrinted(page, 1)
  const [one] = await printed(page)
  expect({ w: one!.width, h: one!.height }).toEqual({ w: 384, h: 240 })
  const labels = (await scopeLabels(page, date)).filter((l) => l.winner)
  expect(labels.map((l) => l.printed)).toEqual([1])
})

test('AC-PRN2-11: 바우아토(실험) — 테스트 인쇄 "예" 뒤 출력 기기가 되어 접수 한 장이 끝까지 찍히고 멈춤이 없다', async ({ page }) => {
  await loginNewSeller(page)
  const { b, date } = await openRealBroadcast(page)
  await connectAs(page, BAUATO.id)
  await becomeOutputDevice(page, 'PC', true)
  const testPrints = (await printed(page)).length
  await registerApi(page, b, 1, '품종1', 1000)
  await smsApi(page, { b, no: 1 })
  await waitPrinted(page, testPrints + 1)
  const all = await printed(page)
  expect({ w: all.at(-1)!.width, h: all.at(-1)!.height }).toEqual({ w: 384, h: 240 })
  await expect.poll(async () => (await scopeLabels(page, date)).filter((l) => l.winner).map((l) => l.printed)).toEqual([1])
  expect((await queueOf(page)).pause).toBeNull()
  await expect(region(page, '프린터').getByText(`${BAUATO.name} (실험)`, { exact: true })).toBeVisible()
})

test.describe('휴대폰 폭 390', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('AC-PRN2-06: 실험 표시·안내·"테스트 인쇄"·"예"가 가로 스크롤 없이 보이고, 안내 글자 18px 이상·버튼 글자 16px 이상·누르는 칸 44px 이상(MOB1 기준)', async ({ page }) => {
    await loginNewSeller(page)
    await connectAs(page, BAUATO.id)
    const printer = region(page, '프린터')
    const note = printer.getByRole('note', { name: '실험 중인 프린터 안내' })
    await expect(note).toBeVisible()
    await printer.getByRole('button', { name: '테스트 인쇄' }).click()
    const yes = printer.getByRole('group', { name: '테스트 인쇄 결과' }).getByRole('button', { name: '예' })
    await expect(yes).toBeVisible()
    const noteSize = await note.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(noteSize).toBeGreaterThanOrEqual(18)
    for (const button of [printer.getByRole('button', { name: '테스트 인쇄' }), yes]) {
      const box = (await button.boundingBox())!
      expect(box.height, '누르는 칸 높이').toBeGreaterThanOrEqual(44)
      const font = await button.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      expect(font).toBeGreaterThanOrEqual(16)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await yes.click()
    const output = printer.getByRole('button', { name: '이 기기에서 출력' })
    await expect(output).toBeVisible()
    expect((await output.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  })
})
