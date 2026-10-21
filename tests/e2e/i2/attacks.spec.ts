// I2 흐름 깨뜨리기 (AC-I2-31·35·37·82·80) — 끊김 뒤 같은 요청 번호, 보내는 사이 품목 변경, 합쳐진 구매자 주소 — test-e2e.
import { test, expect, type Page } from '@playwright/test'
import { history, login, openNewBroadcast, packingCommand, packingList, pay, phoneLike, realDay, registerApi, scopeView, smsApi, uniq, uniqueDate, viewerClaim, writeEvent } from './support.ts'

const A = '010-6000-0001'
const B = '010-6000-0002'

async function day(page: Page) {
  const date = uniqueDate()
  const { b, buyers } = await realDay(page, {
    date,
    products: [{ no: 15, name: '핑크프릴', price: 10000 }, { no: 31, name: '블루엘프', price: 3000 }, { no: 7, name: '라울', price: 5000 }],
    claims: [{ no: 15, phone: A }, { no: 7, phone: B }],
  })
  return { date, b, a: buyers.get(A)!, bb: buyers.get(B)! }
}

function checklist(page: Page) {
  return page.getByRole('region', { name: '체크리스트' })
}

test.describe('끊김 (AC-I2-82)', () => {
  test('포장 완료를 보내다 끊기면 "인터넷 연결을 확인하고 다시 눌러 주세요.", 다시 누르면 같은 요청 번호로 한 번만 적힌다', async ({ page }) => {
    await login(page)
    const { date, a } = await day(page)
    await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(a)}`)
    const cl = checklist(page)
    await cl.getByRole('checkbox', { name: '15번 핑크프릴' }).click()
    const ids: string[] = []
    let drop = true
    await page.route(`**/api/days/${date}/packing`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      ids.push((route.request().postDataJSON() as { requestId: string }).requestId)
      if (drop) return route.abort('internetdisconnected')
      return route.continue()
    })
    await cl.getByRole('button', { name: '포장 완료', exact: true }).click()
    await expect(cl.getByText('인터넷 연결을 확인하고 다시 눌러 주세요.')).toBeVisible({ timeout: 30_000 })
    expect((await packingList(page, date)).find((e) => e.buyer === a)?.status).toBe('포장 대기')
    drop = false
    await cl.getByRole('button', { name: '포장 완료', exact: true }).click()
    await expect(cl.getByText('포장 완료로 적었어요.')).toBeVisible()
    expect(ids.length).toBeGreaterThanOrEqual(2)
    expect(new Set(ids).size).toBe(1)
    expect((await packingList(page, date)).find((e) => e.buyer === a)?.status).toBe('포장 완료')
  })

  test('상품 목록 등록이 저장된 뒤 응답을 잃어도 다시 누르면 같은 요청 번호 — 상품이 두 번 등록되지 않는다', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const { b } = await realDay(page, { date, products: [], claims: [] })
    await page.getByRole('button', { name: '상품 목록 가져오기' }).click()
    const dlg = page.getByRole('dialog', { name: '상품 목록 가져오기' })
    await dlg.getByRole('textbox', { name: '붙여 넣기' }).fill('1\t핑크프릴\t10000\n2\t라울\t8000')
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await expect(dlg.getByRole('button', { name: '2개 등록하기' })).toBeEnabled()
    const ids: string[] = []
    let drop = true
    await page.route(`**/api/broadcasts/*/import`, async (route) => {
      ids.push((route.request().postDataJSON() as { requestId: string }).requestId)
      if (!drop) return route.continue()
      await route.fetch()
      await route.abort('internetdisconnected')
    })
    await dlg.getByRole('button', { name: '2개 등록하기' }).click()
    await expect(dlg.getByText('인터넷 연결을 확인하고 다시 눌러 주세요.')).toBeVisible({ timeout: 30_000 })
    drop = false
    await dlg.getByRole('button', { name: '2개 등록하기' }).click()
    await expect(dlg.getByText('2개를 공개 전 상품으로 등록했어요.')).toBeVisible()
    expect(new Set(ids).size).toBe(1)
    const regs = (await history(page, date, false)).filter((e) => e.type === 'product.register')
    expect(regs).toHaveLength(2)
    void b
  })
})

test.describe('보내는 사이 품목 변경 (AC-I2-31·37)', () => {
  test('포장 완료를 보내는 사이 새 1등이 생기면 거절 → "구매 내역이 바뀌었어요 — 새로 담을 것: 31번", 기록 없음', async ({ page }) => {
    await login(page)
    const { date, b, a } = await day(page)
    await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(a)}`)
    const cl = checklist(page)
    await cl.getByRole('checkbox', { name: '15번 핑크프릴' }).click()
    // SSE를 끊어 화면이 새 품목을 미리 알지 못하게 하고, 보내는 순간 다른 기기가 31번 문자찜
    await page.route('**/api/stream*', (route) => route.abort())
    let raced = false
    await page.route(`**/api/days/${date}/packing`, async (route) => {
      if (route.request().method() === 'POST' && !raced) {
        raced = true
        await smsApi(page, { b, no: 31, phone: A })
      }
      await route.continue()
    })
    await cl.getByRole('button', { name: '포장 완료', exact: true }).click()
    await expect(cl.getByText('구매 내역이 바뀌었어요 — 새로 담을 것: 31번')).toBeVisible()
    await expect(cl.getByRole('checkbox', { name: '31번 블루엘프' })).not.toBeChecked()
    await expect(cl.getByRole('checkbox', { name: '15번 핑크프릴' })).toBeChecked()
    await expect(cl.getByRole('button', { name: '포장 완료', exact: true })).toBeDisabled()
    expect((await packingList(page, date)).find((e) => e.buyer === a)?.status).toBe('포장 대기')
  })
})

test.describe('합쳐진 구매자 (AC-I2-30·35)', () => {
  test('합쳐진 구매자는 목록에 따로 나오지 않고, 그 ID로 연 주소는 지금의 구매자 체크리스트로 바뀐다', async ({ page }) => {
    await login(page)
    const { date, a, bb } = await day(page)
    expect((await writeEvent(page, { type: 'buyer.merge', from: bb, into: a, reason: '같은 사람' }, { date, rehearsal: false })).status).toBeLessThan(300)
    await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(bb)}`)
    await expect(page).toHaveURL(new RegExp(`buyer=${encodeURIComponent(a)}`))
    const cl = checklist(page)
    await expect(cl.getByRole('checkbox', { name: '15번 핑크프릴' })).toBeVisible()
    await expect(cl.getByRole('checkbox', { name: '7번 라울' })).toBeVisible()
    await page.getByRole('group', { name: '걸러 보기' }).getByRole('button', { name: '전체' }).click()
    await expect(page.getByRole('list', { name: '포장할 구매자' }).getByRole('link')).toHaveCount(1)
  })
})

test.describe('화면 낱말 (AC-I2-80)', () => {
  test('포장·설정·가져오기 화면 글자·aria에 영어 상태값·코드가 없다', async ({ page }) => {
    await login(page)
    const { date, a } = await day(page)
    const CODES = /\b(PACKED|SHIPPED|UNPACKED|UNSHIPPED|READY|NO_ITEMS|CELLS|EXISTS|DUPLICATE|NAME_PHONE|PRICE_[A-Z_]+|NUMBER_INVALID|EMPTY|TOO_MANY|ITEMS_CHANGED|PACKING_STATE|PAID|UNPAID|PARTIAL|OVERPAID|INVALID_INPUT)\b/
    const words = async () => await page.evaluate(() => {
      const aria = [...document.querySelectorAll('[aria-label],[title],[alt]')].map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''} ${el.getAttribute('alt') ?? ''}`)
      return `${document.body.innerText}\n${aria.join('\n')}`
    })
    await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(a)}`)
    await expect(page.getByRole('img', { name: '포장 라벨 1/1쪽' })).toBeVisible()
    expect(await words()).not.toMatch(CODES)
    await page.goto('/settings')
    await expect(page.getByRole('list', { name: '보관 중인 백업' })).toBeVisible()
    expect(await words()).not.toMatch(CODES)
  })
})

test.describe('파일 이름·실시간 정산 표 (AC-I2-13·14·33, D-I2-01)', () => {
  test('리허설 닉네임에 / " 이모지 → 공유 파일 이름 "리허설-확인서-<날짜>-가람.png", 이모지만이면 "구매자"', async ({ page, browser }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true, title: '1부' })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await registerApi(page, b, 16, '라울', 10000)
    const c1 = uniq('sim_n1_')
    const c2 = uniq('sim_n2_')
    await viewerClaim(page, b, '🌵/가람"', '15', c1)
    await viewerClaim(page, b, '🌵🌵', '16', c2)
    await expect.poll(async () => (await scopeView(page, date, true)).settlements.length).toBe(2)
    const phone = await phoneLike(browser, page)
    await phone.addInitScript(() => {
      const w = window as unknown as { __names: string[] }
      w.__names = []
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
      Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: { files: File[] }) => { w.__names.push(...d.files.map((f) => f.name)) } })
    })
    for (const [ch, want] of [[c1, `리허설-확인서-${date}-가람.png`], [c2, `리허설-확인서-${date}-구매자.png`]] as const) {
      await phone.goto(`/settlements?date=${date}&rehearsal=true&buyer=${encodeURIComponent(ch)}`)
      const btn = phone.getByRole('region', { name: '구매 내역 확인서' }).getByRole('button', { name: '이미지 공유' })
      await expect(btn).toBeEnabled()
      await btn.click()
      await expect.poll(async () => await phone.evaluate(() => (window as unknown as { __names: string[] }).__names.at(-1))).toBe(want)
    }
    await phone.context().close()
  })

  test('휴대폰에서 포장 완료 → PC 정산 표의 포장·배송 칸이 1초 안에 "포장 완료"', async ({ page, browser }) => {
    await login(page)
    const { date, a } = await day(page)
    await page.goto(`/settlements?date=${date}`)
    const table = page.locator('table').first()
    await expect(table.locator('thead th').nth(8)).toHaveText('포장·배송')
    const rowA = table.locator('tbody tr').filter({ hasText: '0001' })
    await expect(rowA).toContainText('포장 대기')
    const phone = await phoneLike(browser, page)
    await phone.goto(`/packing?date=${date}&buyer=${encodeURIComponent(a)}`)
    const cl = checklist(phone)
    await cl.getByRole('checkbox', { name: '15번 핑크프릴' }).click()
    await cl.getByRole('button', { name: '포장 완료', exact: true }).click()
    await expect(cl.getByText('포장 완료로 적었어요.')).toBeVisible()
    await expect(rowA).toContainText('포장 완료', { timeout: 1500 })
    await phone.context().close()
  })

  test('품목 있는 묶음이 없으면 "전원 확인서 PDF (0명)"이 잠기고 "구매 내역이 있는 구매자가 없어요."', async ({ page }) => {
    await login(page)
    const { date, b, a, bb } = await day(page)
    await pay(page, date, a, 1000)
    await pay(page, date, bb, 1000)
    for (const [no, buyer] of [[15, a], [7, bb]] as const) {
      const res = await writeEvent(page, { type: 'host.cancel', b, no, buyer, reason: '취소' })
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
    }
    await page.goto(`/settlements?date=${date}`)
    const docs = page.getByRole('group', { name: '정산 문서' })
    await expect(docs.getByRole('button', { name: '전원 확인서 PDF (0명)' })).toBeDisabled()
    await expect(docs.getByText('구매 내역이 있는 구매자가 없어요.')).toBeVisible()
  })
})

test.describe('두 기기 엇갈린 명령 (AC-I2-31)', () => {
  test('알림을 못 받은 기기에서 포장 완료 취소 → 서버 문장 "이미 배송 완료로 적었어요. 먼저 배송 완료를 취소해 주세요."와 지금 상태(배송 완료)', async ({ page, browser }) => {
    await login(page)
    const { date, a } = await day(page)
    const entry = (await packingList(page, date)).find((e) => e.buyer === a)!
    expect((await packingCommand(page, date, { buyer: a, action: 'pack', items: entry.items.map((i) => i.key) })).status).toBe(200)
    const phone = await phoneLike(browser, page)
    await phone.route('**/api/stream*', (route) => route.abort())
    await phone.goto(`/packing?date=${date}&buyer=${encodeURIComponent(a)}`)
    const cl = checklist(phone)
    await expect(cl.getByRole('button', { name: '포장 완료 취소' })).toBeVisible()
    expect((await packingCommand(page, date, { buyer: a, action: 'ship', invoice: '123456789012' })).status).toBe(200)
    await cl.getByRole('button', { name: '포장 완료 취소' }).click()
    await phone.getByRole('dialog', { name: '포장 완료 취소' }).getByRole('button', { name: '포장 완료 취소하기' }).click()
    await expect(cl.getByText('이미 배송 완료로 적었어요. 먼저 배송 완료를 취소해 주세요.')).toBeVisible()
    await expect(cl).toContainText('배송 완료 · 송장 123456789012')
    await expect(cl.getByRole('button', { name: '배송 완료 취소' })).toBeVisible()
    expect((await packingList(page, date)).find((e) => e.buyer === a)?.status).toBe('배송 완료')
    await phone.context().close()
  })
})
