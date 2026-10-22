// O4 흐름 깨뜨리기 (라운드 0) — test-e2e.
// 열어 둔 포장 화면의 수량만 바뀐 품목, 판매자 글(옵션 이름)의 이스케이프, 라벨 설정 안내(옵션 판매자만), 출력 대기 작업 줄의 옵션 글.
import { expect, test, type Page } from '@playwright/test'
import { loginNewSeller } from '../i3/support.ts'
import {
  SHORTS,
  createBroadcast,
  hostAction,
  login,
  oscope,
  packingList,
  phoneLike,
  registerOptions,
  setLabels,
  smsApi,
  uniqueDate,
  writeEvent,
} from './support.ts'

function phoneNo(): string {
  return `010-${String(Math.floor(Math.random() * 9000) + 1000)}-${String(Math.floor(Math.random() * 9000) + 1000)}`
}

async function smsBuyer(page: Page, date: string, b: string, no: number, phone: string, memo: string, extra: Record<string, unknown> = {}): Promise<string> {
  const body = await smsApi(page, { b, no, phone, memo, ...extra } as never) as { seq?: number }
  const s = await oscope(page, date, false)
  const c = s.claims.find((x) => x.broadcast === b && x.seq === body.seq) ?? s.claims.filter((x) => x.broadcast === b && x.no === no).sort((x, y) => y.seq - x.seq)[0]
  if (c === undefined) throw new Error(`찜 없음 ${JSON.stringify(body)}`)
  return c.currentBuyer
}

test('TE-O4-ATK-1: 열어 둔 포장 화면 — 체크한 뒤 21 L 수량만 2 → 1로 바뀌고 포장 완료를 누르면 409, 수량이 바뀐 L만 체크가 지워지고 7번은 그대로', async ({ page, browser }) => {
  await login(page)
  const date = uniqueDate()
  const P = phoneNo()
  const { b: d } = await createBroadcast(page, { date, rehearsal: false, saleMode: 'NUMBERS', title: '다육 1부' })
  expect((await writeEvent(page, { type: 'product.register', b: d, no: 7, name: '핑크프릴', price: 8000 })).status).toBeLessThan(300)
  const { b } = await createBroadcast(page, { date, rehearsal: false, saleMode: 'OPTIONS', title: '의류 1부' })
  await registerOptions(page, b, { ...SHORTS })
  const buyer = await smsBuyer(page, date, d, 7, P, '홍길동')
  await smsBuyer(page, date, b, 21, P, '홍길동', { options: { 사이즈: 'L' }, qty: 2 })
  const phone = await phoneLike(browser, page)
  try {
    // 이 화면은 그 사이 소식을 받지 못한다 (실시간 연결이 끊긴 휴대폰)
    await phone.route('**/api/stream**', (route) => route.abort())
    await phone.goto(`/packing?date=${date}&buyer=${encodeURIComponent(buyer)}`)
    const cl = phone.getByRole('region', { name: '체크리스트' })
    const seven = cl.getByRole('checkbox', { name: '7번 핑크프릴' })
    const l2 = cl.getByRole('checkbox', { name: '21번 반바지 L 2개' })
    await seven.click()
    await l2.click()
    await expect(cl.getByText('2/2 담음')).toBeVisible()
    await hostAction(page, { type: 'host.cancel', b, no: 21, buyer, options: { 사이즈: 'L' }, reason: '구매자 요청' })
    await hostAction(page, { type: 'host.assign', b, no: 21, buyer, options: { 사이즈: 'L' }, qty: 1, reason: '전화 주문' })
    await expect.poll(async () => (await packingList(page, date)).find((e) => e.buyer === buyer)?.items.map((i) => (i as unknown as { qty: number }).qty), { timeout: 15_000 }).toEqual([1, 1])
    const reply = phone.waitForResponse((r) => new URL(r.url()).pathname === `/api/days/${date}/packing` && r.request().method() === 'POST')
    await cl.getByRole('button', { name: '포장 완료', exact: true }).click()
    expect((await reply).status()).toBe(409)
    await expect(cl.getByText('그 사이 구매 내역이 바뀌어 포장 완료로 적지 않았어요. 바뀐 품목을 담고 다시 눌러 주세요.')).toBeVisible()
    await expect(cl.getByRole('status').filter({ hasText: '구매 내역이 바뀌었어요' })).toHaveText('구매 내역이 바뀌었어요 — 새로 담을 것: 의류 1부 21번 반바지 L · 뺄 것: 의류 1부 21번 반바지 L 2개')
    const l1 = cl.getByRole('checkbox', { name: '21번 반바지 L', exact: true })
    await expect(l1).toBeVisible()
    await expect(l1).not.toBeChecked()
    await expect(seven).toBeChecked()
    await expect(cl.getByText('1/2 담음')).toBeVisible()
    expect((await packingList(page, date)).find((e) => e.buyer === buyer)?.status).toBe('포장 대기')
    // 고쳐 담으면 포장 완료
    await l1.click()
    await cl.getByRole('button', { name: '포장 완료', exact: true }).click()
    await expect(cl.locator('header')).toContainText('포장 완료')
  } finally {
    await phone.context().close()
  }
})

test('TE-O4-ATK-2: 옵션 이름·구매자 메모에 꺾쇠 글 — 포장 줄·지난 구매·확인서 데이터에 글로만 보이고 요소가 생기지 않는다', async ({ page }) => {
  await login(page)
  const d1 = uniqueDate()
  const d2 = uniqueDate()
  const P = phoneNo()
  const evil = '<img src=x>'
  const { b } = await createBroadcast(page, { date: d1, rehearsal: false, saleMode: 'OPTIONS', title: '꺾쇠 1부' })
  await registerOptions(page, b, { no: 31, name: '<b>티</b>', price: 5000, options: [{ name: '색', choices: [{ label: evil }, { label: '검정' }] }], stocks: { [evil]: 3 } })
  const old = await smsBuyer(page, d1, b, 31, P, '<i>홍</i>', { options: { 색: evil }, qty: 2 })
  const { b: t } = await createBroadcast(page, { date: d2, rehearsal: false, saleMode: 'NUMBERS', title: '오늘' })
  expect((await writeEvent(page, { type: 'product.register', b: t, no: 9, name: '블루', price: 3000 })).status).toBeLessThan(300)
  const now = await smsBuyer(page, d2, t, 9, P, '<i>홍</i>')
  // 포장 줄
  await page.goto(`/packing?date=${d1}&buyer=${encodeURIComponent(old)}`)
  const cl = page.getByRole('region', { name: '체크리스트' })
  await expect(cl.getByRole('checkbox', { name: `31번 <b>티</b> ${evil} 2개` })).toBeVisible()
  await expect(cl.locator('.pack-variant')).toHaveText(evil)
  await expect(page.locator('main img[src="x"], main b, main i')).toHaveCount(0)
  // 지난 구매
  await page.goto(`/buyers?date=${d2}&buyer=${encodeURIComponent(now)}`)
  const link = page.getByRole('region', { name: '지난 구매' }).getByRole('link')
  await expect(link).toContainText(`31번 <b>티</b> ${evil} 2개 10,000원`)
  await expect(page.locator('main img[src="x"], main b, main i')).toHaveCount(0)
})

test('TE-O4-ATK-3: 라벨 설정 — 옵션 방송이 있는 판매자가 품종 칸을 끄면 안내 한 줄·저장됨, 옵션 방송이 없는 판매자는 안내 없음 (AC-O4-26)', async ({ page }) => {
  // 옵션 방송이 없는 새 판매자
  await loginNewSeller(page)
  await setLabels(page, true)
  await page.goto('/labels')
  const settings = page.getByRole('region', { name: '라벨 설정', exact: true })
  const nameBox = settings.getByRole('checkbox', { name: '품종 켜기' })
  await nameBox.uncheck()
  await expect(settings.getByRole('note').filter({ hasText: '품종 칸을 끄면' })).toHaveCount(0)
  await settings.getByRole('button', { name: '라벨 설정 저장' }).click()
  await expect(settings.getByText('라벨 설정을 저장했어요.')).toBeVisible()
  await expect(settings.getByRole('note').filter({ hasText: '품종 칸을 끄면' })).toHaveCount(0)

  // 옵션 방송(리허설)이 하나 있는 새 판매자
  await page.context().clearCookies()
  await loginNewSeller(page)
  await setLabels(page, true)
  await createBroadcast(page, { rehearsal: true, saleMode: 'OPTIONS', title: '옵션 연습' })
  await page.goto('/labels')
  const s2 = page.getByRole('region', { name: '라벨 설정', exact: true })
  await expect(s2.getByRole('note').filter({ hasText: '품종 칸을 끄면' })).toHaveCount(0)
  await s2.getByRole('checkbox', { name: '품종 켜기' }).uncheck()
  await expect(s2.getByRole('note')).toHaveText('품종 칸을 끄면 사이즈·색상 같은 옵션이 라벨에 찍히지 않아요.')
  await s2.getByRole('button', { name: '라벨 설정 저장' }).click()
  await expect(s2.getByText('라벨 설정을 저장했어요.')).toBeVisible()
  // 새로 열어도(저장된 템플릿이 꺼져 있음) 안내가 보인다
  await page.reload()
  await expect(page.getByRole('region', { name: '라벨 설정', exact: true }).getByRole('note')).toHaveText('품종 칸을 끄면 사이즈·색상 같은 옵션이 라벨에 찍히지 않아요.')
  await page.getByRole('region', { name: '라벨 설정', exact: true }).getByRole('checkbox', { name: '품종 켜기' }).check()
  await expect(page.getByRole('region', { name: '라벨 설정', exact: true }).getByRole('note').filter({ hasText: '품종 칸을 끄면' })).toHaveCount(0)
})

test('TE-O4-ATK-4: 출력 대기 작업 줄에 옵션 글·수량, 취소한 변형 찜의 작업은 대기에서 빠진다 (AC-O4-25)', async ({ page }) => {
  await loginNewSeller(page)
  await setLabels(page, true)
  const date = uniqueDate()
  const { b } = await createBroadcast(page, { date, rehearsal: false, saleMode: 'OPTIONS', title: '의류 1부' })
  await registerOptions(page, b, { ...SHORTS })
  const A = phoneNo()
  const buyer = await smsBuyer(page, date, b, 21, A, '홍길동', { options: { 사이즈: 'L' }, qty: 2 })
  await smsBuyer(page, date, b, 21, A, '홍길동', { options: { 사이즈: 'M' } })
  await page.goto('/labels')
  const waiting = page.getByRole('region', { name: '출력 대기열', exact: true }).getByRole('list', { name: '대기 작업' })
  await expect(waiting.getByRole('listitem')).toHaveCount(2)
  await expect(waiting.getByRole('listitem').filter({ hasText: '21번 반바지 L · 2개 · ' })).toHaveCount(1)
  await expect(waiting.getByRole('listitem').filter({ hasText: /21번 반바지 M · (?!\d+개)/ })).toHaveCount(1)
  await hostAction(page, { type: 'host.cancel', b, no: 21, buyer, options: { 사이즈: 'M' }, reason: '구매자 요청' })
  await expect(waiting.getByRole('listitem')).toHaveCount(1)
  await expect(waiting.getByRole('listitem')).toContainText('21번 반바지 L · 2개 · ')
})
