// AC-I1-25·31·40·41·42 — 미리 보기 = 출력 그림 = PNG, 파일 이름, PDF 문서 정보, A4 모아찍기
import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { becomeDevice, boardItem, cleanupPrint, login, printed, realBroadcast, region, registerApi, smsApi, uniqueDate, waitPrinted } from './support.ts'

test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

type Bits = { width: number; height: number; data: number[] }

/** 캔버스(정수 배)를 1비트 바이트로 */
async function canvasBits(canvas: Locator): Promise<Bits> {
  return await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement
    const scale = Number(c.dataset['scale'])
    const width = Number(c.dataset['width'])
    const height = Number(c.dataset['height'])
    const ctx = c.getContext('2d')!
    const img = ctx.getImageData(0, 0, c.width, c.height).data
    const row = Math.ceil(width / 8)
    const data = new Array<number>(row * height).fill(0)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = ((y * scale) * c.width + x * scale) * 4
      const lum = ((img[i] ?? 255) + (img[i + 1] ?? 255) + (img[i + 2] ?? 255)) / 3
      if (lum < 128) data[y * row + (x >> 3)]! |= 0x80 >> (x & 7)
    }
    return { width, height, data }
  })
}

/** PNG 바이트를 브라우저에서 읽어 1비트 바이트로 */
async function pngBits(page: Page, bytes: Buffer): Promise<Bits> {
  return await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }))
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0)
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    const row = Math.ceil(bmp.width / 8)
    const data = new Array<number>(row * bmp.height).fill(0)
    for (let y = 0; y < bmp.height; y++) for (let x = 0; x < bmp.width; x++) {
      const i = (y * bmp.width + x) * 4
      if (((img[i] ?? 255) + (img[i + 1] ?? 255) + (img[i + 2] ?? 255)) / 3 < 128) data[y * row + (x >> 3)]! |= 0x80 >> (x & 7)
    }
    return { width: bmp.width, height: bmp.height, data }
  }, bytes.toString('base64'))
}

test('AC-I1-31·40·42: 상품 자세히 미리 보기 = 시험용 프린터가 받은 그림 = 내려받은 PNG, 파일 이름·PDF 정보에 구매자·시각 없음', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  await page.goBack()
  await registerApi(page, b, 15, '핑크프릴', 14000)
  await smsApi(page, { b, no: 15 })
  await waitPrinted(page, 1)
  const [image] = await printed(page)

  await boardItem(page, 15).click()
  const detail = page.getByRole('dialog', { name: '15번 자세히' })
  const labels = detail.getByRole('region', { name: '라벨' })
  const group = labels.getByRole('group', { name: /^1등 .+ 라벨$/ })
  await expect(group).toContainText('라벨 출력됨')
  const canvas = group.getByRole('img', { name: '15번 라벨 미리 보기' })
  await expect(canvas).toBeVisible()
  const preview = await canvasBits(canvas)
  expect(preview.width).toBe(image!.width)
  expect(preview.height).toBe(image!.height)
  expect(preview.data).toEqual(image!.data)
  expect(Number(await canvas.getAttribute('data-scale'))).toBeGreaterThanOrEqual(1)

  const dl = page.waitForEvent('download')
  await group.getByRole('button', { name: '그림 파일로 저장' }).click()
  const png = await dl
  expect(png.suggestedFilename()).toBe(`라벨-${date}-15번.png`)
  const pngData = await pngBits(page, readFileSync((await png.path())!))
  expect(pngData).toEqual(image)

  const dl2 = page.waitForEvent('download')
  await group.getByRole('button', { name: 'PDF로 저장' }).click()
  const pdf = await dl2
  expect(pdf.suggestedFilename()).toBe(`라벨-${date}-15번.pdf`)
  const text = readFileSync((await pdf.path())!).toString('latin1')
  expect(text.startsWith('%PDF')).toBe(true)
  expect(text).not.toMatch(/\/CreationDate|\/ModDate|\/Author/)
  // 출력 이력·엔진을 바꾸지 않는다 (AC-I1-40)
  await expect(group).toContainText('1번 출력')
})

test('AC-I1-41: 라벨 화면 내보내기 — 1등 라벨 25장 → A4 PDF 2쪽(50×30 한 장 24개), 파일 이름 라벨-<날짜>-<순번>-A4.pdf', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date, '첫 방송 제목')
  for (let no = 1; no <= 25; no += 1) await registerApi(page, b, no, `품종${String(no)}`, 1000)
  for (let no = 1; no <= 25; no += 1) await smsApi(page, { b, no })
  await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '라벨' }).click()
  const exp = region(page, '내보내기')
  const select = exp.getByLabel('방송')
  // AC-N4a-40: 방송 목록을 받은 뒤에 읽는다 (라벨 화면은 켬/끔을 안 뒤에 그려져 목록 조회와 경쟁한다 — 검사는 그대로)
  await expect(select.locator('option', { hasText: '첫 방송 제목' })).toHaveCount(1)
  const options = await select.locator('option').allTextContents()
  const target = options.find((o) => o.includes('첫 방송 제목'))
  expect(target).toBeDefined()
  await select.selectOption({ label: target! })
  await expect(exp).toContainText('지금 1등 라벨 25장')
  const dl = page.waitForEvent('download')
  await exp.getByRole('button', { name: '1등 라벨 모두 A4 PDF로 저장' }).click()
  const pdf = await dl
  expect(pdf.suggestedFilename()).toBe(`라벨-${date}-1-A4.pdf`)
  const text = readFileSync((await pdf.path())!).toString('latin1')
  expect((text.match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length).toBe(2)
  expect(text).not.toMatch(/\/CreationDate|\/ModDate/)
})
