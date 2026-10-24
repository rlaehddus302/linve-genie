// FB1 라벨 가게 이름 재현 (AC-FB1-29·28, AC-FB1-90 라벨 줄) — 시험용 프린터(서버 시험 모드).
// 50×30 상품 템플릿에 가게 이름 "다육상회"를 적어 저장 → 이 기기를 출력 기기로 → 판매 하나 1등 확정 → 시험용 프린터가 받은 그림의 가게 이름 자리.
// 브라우저 캔버스와 Node 캔버스는 글자 가장자리 점이 조금 다르다 — 점 하나까지가 아니라 "이 이름으로 그린 것에 더 가까운지"로 본다(I1 probes와 같은 방식).
import { bitmapsEqual, computeProductText, renderProductLabel, renderTestLabel } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { expect, test, type Page } from '@playwright/test'
import { becomeDevice, cleanupPrint, gotoLabels, printed, realBroadcast, region, scopeLabels, waitPrinted } from '../i1/support.ts'
import { loginNewSeller, registerApi, smsApi, todayKst, uniqueDate } from './support.ts'

const SHOP_HINT = "라벨 맨 위에 찍히는 이름이에요. 비워 두면 설정 '가게'의 가게 이름이 찍혀요. 찍지 않으려면 아래 '가게 이름' 항목을 꺼 주세요."
const SHOP_OFF = '가게 이름 항목이 꺼져 있어 라벨에 찍히지 않아요.'

type Bits = { width: number; height: number; data: Uint8Array }

function diff(a: Bits, b: Bits): number {
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY
  let n = 0
  for (let i = 0; i < a.data.length; i++) for (let x = (a.data[i]! ^ b.data[i]!) & 0xff; x !== 0; x >>= 1) n += x & 1
  return n
}

async function servedProductTemplate(page: Page): Promise<Record<string, unknown>> {
  const res = await page.request.get('/api/print/templates')
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json() as { product: { template: Record<string, unknown> } }).product.template
}

function productBits(template: unknown, data: unknown): Bits {
  const r = renderProductLabel(createNodeRenderEnv(), template, data)
  if (!r.ok) throw new Error(r.error.message)
  return { width: r.image.width, height: r.image.height, data: Uint8Array.from(r.image.data) }
}

async function lastPrinted(page: Page): Promise<Bits> {
  const all = await printed(page)
  const got = all.at(-1)!
  return { width: got.width, height: got.height, data: Uint8Array.from(got.data) }
}

/** 1등 확정 하나 → 출력된 그림·작업 데이터 */
async function sellOne(page: Page, date: string, b: string, no: number, count: number): Promise<{ image: Bits; data: unknown }> {
  await registerApi(page, b, no, `품종${String(no)}`, 10000)
  await smsApi(page, { b, no })
  await waitPrinted(page, count)
  const label = (await scopeLabels(page, date)).find((l) => l.no === no && l.winner && l.data !== null)
  expect(label, '1등 라벨').toBeDefined()
  return { image: await lastPrinted(page), data: label!.data }
}

test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

test('AC-FB1-29: 라벨 설정 가게 이름 "다육상회" 저장 → 1등 라벨·테스트 인쇄에 "다육상회", 비워 저장하면 설정 "가게"의 가게 이름', async ({ page }) => {
  const seller = await loginNewSeller(page)
  const enable = await page.request.put('/api/settings/labels', { data: { enabled: true }, headers: { Origin: new URL(page.url()).origin } })
  expect(enable.ok(), await enable.text()).toBe(true)
  const date = uniqueDate()
  const b = await realBroadcast(page, date)
  await gotoLabels(page)

  const settings = region(page, '라벨 설정')
  await settings.getByRole('radio', { name: '50×30mm' }).check()
  const shop = settings.getByRole('textbox', { name: '가게 이름' })
  await expect(shop).toHaveValue('')
  await expect(settings.getByText(SHOP_HINT)).toBeVisible()
  await expect(settings.getByText(SHOP_OFF)).toHaveCount(0)
  await shop.fill('다육상회')
  await settings.getByRole('button', { name: '라벨 설정 저장' }).click()
  await expect(settings.getByText('라벨 설정을 저장했어요.')).toBeVisible()
  await expect(shop).toHaveValue('다육상회')

  await becomeDevice(page, 'PC')
  const first = await sellOne(page, date, b, 1, 1)
  const template = await servedProductTemplate(page)
  expect(template['shopName']).toBe('다육상회')
  const text = computeProductText(template, first.data)
  expect(text.ok).toBe(true)
  if (text.ok) expect(text.text.items['shop']).toBe('다육상회')
  const want = productBits(template, first.data)
  expect({ w: first.image.width, h: first.image.height }).toEqual({ w: want.width, h: want.height })
  const blank = productBits({ ...template, shopName: '' }, first.data)
  const other = productBits({ ...template, shopName: seller.shopName }, first.data)
  expect(bitmapsEqual(first.image, blank), '가게 이름 자리가 비어 있지 않다').toBe(false)
  expect(diff(first.image, want)).toBeLessThan(diff(first.image, blank))
  expect(diff(first.image, want)).toBeLessThan(diff(first.image, other))

  // 테스트 인쇄 그림에도 "다육상회"
  const printer = region(page, '프린터')
  await printer.getByRole('button', { name: '테스트 인쇄' }).click()
  await waitPrinted(page, 2)
  const test1 = await lastPrinted(page)
  const env = createNodeRenderEnv()
  const testBits = (name: string): Bits => {
    const r = renderTestLabel(env, { shopName: name, date: todayKst(), size: '50x30' })
    if (!r.ok) throw new Error(r.error.message)
    return { width: r.image.width, height: r.image.height, data: Uint8Array.from(r.image.data) }
  }
  expect(diff(test1, testBits('다육상회'))).toBeLessThan(diff(test1, testBits('')))
  expect(diff(test1, testBits('다육상회'))).toBeLessThan(diff(test1, testBits(seller.shopName)))

  // 가게 이름 칸을 비워 저장 → 설정 "가게"의 가게 이름이 찍힌다 (칸은 빈 채로 남는다 — 서버가 채운 이름이 템플릿에 굳지 않는다)
  await shop.fill('')
  await settings.getByRole('button', { name: '라벨 설정 저장' }).click()
  await expect(settings.getByText('라벨 설정을 저장했어요.')).toBeVisible()
  await expect(shop).toHaveValue('')
  const second = await sellOne(page, date, b, 2, 3)
  const filled = await servedProductTemplate(page)
  expect(filled['shopName']).toBe(seller.shopName)
  const text2 = computeProductText(filled, second.data)
  if (text2.ok) expect(text2.text.items['shop']).toBe(seller.shopName)
  const want2 = productBits(filled, second.data)
  expect(diff(second.image, want2)).toBeLessThan(diff(second.image, productBits({ ...filled, shopName: '' }, second.data)))
  expect(diff(second.image, want2)).toBeLessThan(diff(second.image, productBits({ ...filled, shopName: '다육상회' }, second.data)))
  // 다시 열어도 칸은 빈 글 (저장된 본문 그대로)
  await page.reload()
  await expect(region(page, '라벨 설정').getByRole('textbox', { name: '가게 이름' })).toHaveValue('')
})

test('AC-FB1-28: 가게 이름 항목을 끄면 칸 옆 안내, 켜면 사라짐', async ({ page }) => {
  await loginNewSeller(page)
  const enable = await page.request.put('/api/settings/labels', { data: { enabled: true }, headers: { Origin: new URL(page.url()).origin } })
  expect(enable.ok(), await enable.text()).toBe(true)
  await page.goto('/labels')
  const settings = region(page, '라벨 설정')
  await expect(settings.getByText(SHOP_HINT)).toBeVisible()
  const item = settings.getByRole('checkbox', { name: '가게 이름' })
  await expect(item).toBeChecked()
  await item.uncheck()
  await expect(settings.getByText(SHOP_OFF)).toBeVisible()
  await item.check()
  await expect(settings.getByText(SHOP_OFF)).toHaveCount(0)
})
