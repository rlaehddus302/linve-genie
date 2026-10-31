// D-PRN2-27 테스트 인쇄 크기(저장 크기가 이은 프로필 목록에 있으면 그 크기, 없으면 프로필 기본 크기)·D-PRN2-29 테스트 중 작업 안 받음.
// 근거: docs/DECISIONS.md D-PRN2-27·29, docs/spec/LABEL_RULES.md L-7 테스트 라벨. 화면 밖 증거는 시험용 프린터가 받은 그림 크기(printed)와 서버 요청 주소다.
import { expect, test, type Page } from '@playwright/test'
import { BAUATO, becomeOutputDevice, connectAs, D110, loginNewSeller, openRealBroadcast, printed, queueOf, region, registerApi, smsApi, waitPrinted } from './support.ts'

async function saveSize(page: Page, size: string): Promise<void> {
  const { defaultTemplate } = await import('@livejjim/label')
  const before = await (await page.request.get('/api/print/templates')).json() as { product: { version: number } }
  const put = await page.request.put('/api/print/templates/product', { data: { template: defaultTemplate('product', size as never), version: before.product.version }, headers: { Origin: new URL(page.url()).origin } })
  expect(put.ok(), await put.text()).toBe(true)
}

async function testPrintSize(page: Page): Promise<{ query: string; w: number; h: number }> {
  const count = (await printed(page)).length
  const request = page.waitForRequest((r) => /\/api\/print\/test-(bitmap|png)/.test(r.url()))
  await region(page, '프린터').getByRole('button', { name: '테스트 인쇄' }).click()
  const url = new URL((await request).url())
  await waitPrinted(page, count + 1)
  const last = (await printed(page)).at(-1)!
  return { query: url.search, w: last.width, h: last.height }
}

test('D-PRN2-27: B1에 50×20 저장 → 테스트 인쇄는 ?size=50x20, 그림 높이도 20mm(160점)', async ({ page }) => {
  await loginNewSeller(page)
  await saveSize(page, '50x20')
  await connectAs(page, null)
  const r = await testPrintSize(page)
  expect(r.query).toBe('?size=50x20')
  expect({ w: r.w, h: r.h }).toEqual({ w: 384, h: 160 })
})

test('D-PRN2-27: B1에 50×30(기본) 저장 → ?size=50x30', async ({ page }) => {
  await loginNewSeller(page)
  await connectAs(page, null)
  expect((await testPrintSize(page)).query).toBe('?size=50x30')
})

test('D-PRN2-27: D110(테이프)에 50×30 저장 → 목록 밖이라 프로필 기본 ?size=tape12x40', async ({ page }) => {
  await loginNewSeller(page)
  await connectAs(page, D110.id)
  const r = await testPrintSize(page)
  expect(r.query).toBe('?size=tape12x40')
})

test('D-PRN2-27: 바우아토에 50×15 저장 → 목록 안이라 ?size=50x15', async ({ page }) => {
  await loginNewSeller(page)
  await saveSize(page, '50x15')
  await connectAs(page, BAUATO.id)
  expect((await testPrintSize(page)).query).toBe('?size=50x15')
})

test('D-PRN2-29: 테스트 인쇄 직전·직후에 들어온 접수도 멈춤 없이 모두 찍힌다 (테스트 중에는 받지 않고, 끝나면 받는다)', async ({ page }) => {
  await loginNewSeller(page)
  const { b } = await openRealBroadcast(page)
  await connectAs(page, null)
  await becomeOutputDevice(page, 'PC', false)
  const before = (await printed(page)).length
  await registerApi(page, b, 1, '품종1', 1000)
  await region(page, '프린터').getByRole('button', { name: '테스트 인쇄' }).click()
  await smsApi(page, { b, no: 1 })
  await waitPrinted(page, before + 2) // 테스트 1장 + 접수 라벨 1장
  expect((await queueOf(page)).pause).toBeNull()
  await expect(region(page, '출력 멈춤')).toHaveCount(0)
})
