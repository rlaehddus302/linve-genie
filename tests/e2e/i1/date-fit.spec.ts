// STB 회귀 — 날짜 칸 (L-5 기본 템플릿 보장값 "어느 날짜든 20점 이상", L-11 13 저장 전 최악 날짜 2004-04-04·저장된 설정 경고, D-STB-01)
// 옛 기본 50×30 상품 템플릿(날짜 칸 x 292·폭 88)은 '04.04.04'·'00.04.04'처럼 넓은 숫자가 많은 날짜를 20점으로도 담지 못해
// 방송 중 1등 라벨이 "라벨을 만들지 못해" 멈췄다. 넓은 날짜(2004-04-04·2000-04-04)는 공용 판매자의 가장 오래된 날짜 가정
// (AC-S05-02의 2004-01-01)을 깨므로, 이 파일의 시험은 모두 자기 전용 새 판매자로 돈다(라벨 설정도 공용 계정을 건드리지 않는다).
import { defaultTemplate, doesNotFitMessage, renderProductLabel } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { expect, test, type Page } from '@playwright/test'
import { loginNewSeller } from '../i3/support.ts'
import { becomeDevice, cleanupPrint, gotoLabels, printed, printOverview, realBroadcast, region, registerApi, scopeLabels, smsApi, waitPrinted } from './support.ts'

test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

interface Stored { template: Record<string, unknown> & { items: Record<string, Record<string, unknown>> }; version: number }
async function productTemplate(page: Page): Promise<Stored> {
  const res = await page.request.get('/api/print/templates')
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json() as { product: Stored }).product
}
async function putProduct(page: Page, template: unknown, version: number): Promise<number> {
  const res = await page.request.put('/api/print/templates/product', { data: { template, version }, headers: { Origin: new URL(page.url()).origin } })
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json() as { version: number }).version
}

const DATE_MESSAGE = doesNotFitMessage('date')
const WARNING = '저장된 라벨 설정 경고'

for (const date of ['2004-04-04', '2000-04-04']) {
  test(`D-STB-01·L-5: 방송 날짜 ${date} — 기본 50×30 상품 템플릿으로 1등 라벨이 멈춤 없이 한 장 나온다`, async ({ page }) => {
    // 이 날짜가 정말 옛 날짜 칸(x 292·폭 88)을 넘는 날인지 먼저 확인 — 시험이 버그를 겨누는지
    const env = createNodeRenderEnv()
    const base = defaultTemplate('product', '50x30')
    const old = { ...base, items: { ...base.items, date: { ...base.items.date, x: 292, width: 88 } } }
    const data = { no: 1, name: '품종1', price: 1000, date, buyer: { kind: 'sms' } }
    const oldResult = renderProductLabel(env, old, data)
    expect(oldResult.ok ? null : oldResult.error.code).toBe('DOES_NOT_FIT')
    expect(oldResult.ok ? null : oldResult.error.item).toBe('date')

    await loginNewSeller(page)
    const before = await productTemplate(page)
    // 기본 50×30(가게 이름만 그대로)으로 — 앞 시험이 바꿔 두었어도
    await putProduct(page, { ...base, shopName: before.template['shopName'] }, before.version)
    try {
      const b = await realBroadcast(page, date)
      await becomeDevice(page, 'PC')
      await registerApi(page, b, 1, '품종1', 1000)
      await smsApi(page, { b, no: 1, phone: '010-5555-1001' })
      await waitPrinted(page, 1)
      const [image] = await printed(page)
      expect(image!.height).toBe(240)
      await expect.poll(async () => (await printOverview(page)).queue.waiting).toBe(0)
      const ov = await printOverview(page)
      expect(ov.queue.pause).toBeNull()
      expect(ov.discard).toHaveLength(0)
      await expect(page.getByText('라벨을 만들지 못해')).toHaveCount(0)
      const labels = await scopeLabels(page, date)
      const one = labels.filter((l) => l.no === 1 && l.winner)
      expect(one).toHaveLength(1)
      expect(one[0]!.printed).toBe(1)
      expect(one[0]!.word).toBe('라벨 출력됨')
      // 그 날짜 그대로 그린 라벨이다 (출력 기기는 가장 작은 글자로 줄여서라도 담는다)
      expect(one[0]!.data?.['date']).toBe(date)
    } finally {
      await putProduct(page, before.template, (await productTemplate(page)).version)
    }
  })
}

test('L-11 13·D-STB-01: 날짜 칸을 폭 86점으로 좁혀 저장된 설정 — 라벨 설정을 열면 같은 문장으로 경고, 그대로 저장은 막히고, 기본으로 되돌려 저장하면 경고가 사라진다', async ({ page }) => {
  await loginNewSeller(page)
  const before = await productTemplate(page)
  const base = defaultTemplate('product', '50x30')
  try {
    // 기본 템플릿에는 경고가 없다(헛경고 없음)
    let version = await putProduct(page, { ...base, shopName: before.template['shopName'] }, before.version)
    await gotoLabels(page)
    const settings = region(page, '라벨 설정')
    await expect(settings.getByRole('button', { name: '라벨 설정 저장' })).toBeVisible()
    await expect(settings.getByRole('note', { name: WARNING })).toHaveCount(0)

    // 다른 기기(옛 화면)가 저장해 둔 좁은 날짜 칸: 오른쪽 끝 380 그대로, 폭 86 — '26.12.28'(79.8점)·'26.10.08'(80.6점)은 들어가지만 '04.04.04'(88.5점)는 안 들어간다
    const narrow = { ...base, shopName: before.template['shopName'], items: { ...base.items, date: { ...base.items.date, x: 294, width: 86 } } }
    version = await putProduct(page, narrow, version)
    await page.reload()
    await expect(page.getByRole('heading', { name: '라벨', level: 1 })).toBeVisible()
    const warning = settings.getByRole('note', { name: WARNING })
    await expect(warning).toHaveText(DATE_MESSAGE)

    // 열기만 해서는 서버의 설정을 고치지 않는다
    let puts = 0
    page.on('request', (r) => { if (r.method() === 'PUT' && new URL(r.url()).pathname === '/api/print/templates/product') puts += 1 })
    const afterOpen = await productTemplate(page)
    expect(afterOpen.version).toBe(version)
    expect(afterOpen.template.items['date']).toMatchObject({ x: 294, width: 86 })

    // 그대로 다시 저장: 같은 문장으로 막히고 보내지 않는다
    await settings.getByRole('button', { name: '라벨 설정 저장' }).click()
    await expect(settings.getByRole('alert').filter({ hasText: DATE_MESSAGE })).toBeVisible()
    await expect(settings.getByText('라벨 설정을 저장했어요.')).toHaveCount(0)
    expect(puts).toBe(0)
    expect((await productTemplate(page)).version).toBe(version)

    // 기본으로 되돌려 저장하면 경고가 사라진다
    await settings.getByRole('button', { name: '기본으로 되돌리기' }).click()
    await settings.getByRole('button', { name: '라벨 설정 저장' }).click()
    await expect(settings.getByText('라벨 설정을 저장했어요.')).toBeVisible()
    await expect(settings.getByRole('note', { name: WARNING })).toHaveCount(0)
    const saved = await productTemplate(page)
    expect(saved.template.items['date']).toMatchObject({ x: 290, width: 90 })
  } finally {
    await putProduct(page, before.template, (await productTemplate(page)).version)
  }
})
