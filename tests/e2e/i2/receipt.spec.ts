// 정산 화면의 확인서·전원 확인서·포장 상태 (AC-I2-13·14·15·33) — test-e2e.
// AC-I2-15: 미리 보기 PNG 응답의 X-Receipt-Created-At → E2E 서버의 ?at= 로 같은 확인서 데이터 → Node renderReceiptPng 바이트 = 공유된 File 바이트.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test, expect, type Page, type Response } from '@playwright/test'
import { loadDocumentFont, renderReceiptPng } from '@livejjim/documents'
import { downloadBytes, login, noHorizontalScroll, openNewBroadcast, packingCommand, packingList, pay, pdfPages, phoneLike, realDay, registerApi, resetShop, scopeView, uniq, uniqueDate, viewerClaim } from './support.ts'

const require = createRequire(import.meta.url)
const FONT = loadDocumentFont(new Uint8Array(readFileSync(require.resolve('@livejjim/documents/fonts/Pretendard-Regular.ttf'))))

const SHARE_FAKE = () => {
  const w = window as unknown as { __shared: { name: string; type: string; bytes: number[] }[] }
  w.__shared = []
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data: { files?: File[] }) => Array.isArray(data?.files) })
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: async (data: { files: File[] }) => {
      for (const f of data.files) w.__shared.push({ name: f.name, type: f.type, bytes: [...new Uint8Array(await f.arrayBuffer())] })
    },
  })
}

async function shared(page: Page): Promise<{ name: string; type: string; bytes: Buffer }[]> {
  const list = await page.evaluate(() => (window as unknown as { __shared: { name: string; type: string; bytes: number[] }[] }).__shared)
  return list.map((x) => ({ ...x, bytes: Buffer.from(x.bytes) }))
}

function isReceiptPng(r: Response, date: string): boolean {
  const url = new URL(r.url())
  return url.pathname === `/api/days/${date}/receipt.png` && r.ok()
}

async function nodePng(page: Page, date: string, buyer: string, createdAt: string): Promise<Buffer> {
  const res = await page.request.get(`/api/days/${date}/receipt?buyer=${encodeURIComponent(buyer)}&at=${createdAt}`)
  expect(res.ok(), await res.text()).toBe(true)
  return Buffer.from(renderReceiptPng(await res.json() as never, FONT))
}

const PHONE = '010-4000-0001'

async function oneBuyer(page: Page) {
  const date = uniqueDate()
  const { b, buyers } = await realDay(page, { date, products: [{ no: 15, name: '핑크프릴', price: 10000 }, { no: 28, name: '라울', price: 8000 }], claims: [{ no: 15, phone: PHONE }, { no: 28, phone: PHONE }] })
  return { date, b, a: buyers.get(PHONE)! }
}

test.describe('확인서 공유 = 문서 그림 (AC-I2-13·15)', () => {
  test('휴대폰: 이미지 공유 파일 바이트 = 미리 보기 바이트 = Node renderReceiptPng(같은 만든 시각), 이름·형식 D-I2-01', async ({ page, browser }) => {
    await login(page)
    const { date, a } = await oneBuyer(page)
    const phone = await phoneLike(browser, page)
    await phone.addInitScript(SHARE_FAKE)
    const previewRes = phone.waitForResponse((r) => isReceiptPng(r, date))
    await phone.goto(`/settlements?date=${date}&buyer=${encodeURIComponent(a)}`)
    const res = await previewRes
    const region = phone.getByRole('region', { name: '구매 내역 확인서' })
    await expect(region.getByRole('img', { name: '구매 내역 확인서 미리 보기' })).toBeVisible()
    await expect(region.getByRole('button', { name: 'PDF 내려받기' })).toBeEnabled()
    await expect(region.getByRole('button', { name: '이미지 저장' })).toHaveCount(0)
    const shareBtn = region.getByRole('button', { name: '이미지 공유' })
    await expect(shareBtn).toBeEnabled()
    const box = await shareBtn.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    await noHorizontalScroll(phone)
    const previewBytes = await res.body()
    const createdAt = res.headers()['x-receipt-created-at']!
    expect(createdAt).toMatch(/^\d+$/)
    await shareBtn.click()
    await expect.poll(async () => (await shared(phone)).length).toBe(1)
    const [file] = await shared(phone)
    expect(file!.type).toBe('image/png')
    expect(file!.name).toMatch(new RegExp(`^확인서-${date}-.+\\.png$`))
    expect(file!.bytes.equals(previewBytes)).toBe(true)
    expect(file!.bytes.equals(await nodePng(phone, date, a, createdAt))).toBe(true)
    // 미리 보기 그림의 바이트도 같은 파일
    const imgBytes = await region.getByRole('img', { name: '구매 내역 확인서 미리 보기' }).evaluate(async (img: HTMLImageElement) => [...new Uint8Array(await (await fetch(img.src)).arrayBuffer())])
    expect(Buffer.from(imgBytes).equals(previewBytes)).toBe(true)
    await phone.context().close()
  })

  test('입금으로 묶음이 바뀌면 새 그림을 받고, 받는 동안 공유·PDF가 잠기며, 공유 파일은 새 그림이다', async ({ page, browser }) => {
    await login(page)
    const { date, a } = await oneBuyer(page)
    const phone = await phoneLike(browser, page)
    await phone.addInitScript(SHARE_FAKE)
    const first = phone.waitForResponse((r) => isReceiptPng(r, date))
    await phone.goto(`/settlements?date=${date}&buyer=${encodeURIComponent(a)}`)
    const firstBytes = await (await first).body()
    const region = phone.getByRole('region', { name: '구매 내역 확인서' })
    const shareBtn = region.getByRole('button', { name: '이미지 공유' })
    await expect(shareBtn).toBeEnabled()
    // 두 번째 그림 응답을 붙잡아 두고 잠금을 본다
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    await phone.route(`**/api/days/${date}/receipt.png*`, async (route) => {
      await gate
      await route.continue()
    })
    await pay(page, date, a, 18000)
    await expect(region.getByText('확인서를 만드는 중이에요…')).toBeVisible()
    await expect(shareBtn).toBeDisabled()
    await expect(region.getByRole('button', { name: 'PDF 내려받기' })).toBeDisabled()
    const second = phone.waitForResponse((r) => isReceiptPng(r, date))
    release()
    const res = await second
    const secondBytes = await res.body()
    expect(secondBytes.equals(firstBytes)).toBe(false)
    await expect(shareBtn).toBeEnabled()
    await shareBtn.click()
    await expect.poll(async () => (await shared(phone)).length).toBe(1)
    const [file] = await shared(phone)
    expect(file!.bytes.equals(secondBytes)).toBe(true)
    expect(file!.bytes.equals(await nodePng(phone, date, a, res.headers()['x-receipt-created-at']!))).toBe(true)
    await phone.context().close()
  })

  test('가게 설정을 바꾸면(다른 기기) 미리 보기를 새로 받는다', async ({ page, browser }) => {
    await login(page)
    const { date, a } = await oneBuyer(page)
    const phone = await phoneLike(browser, page)
    try {
      const first = phone.waitForResponse((r) => isReceiptPng(r, date))
      await phone.goto(`/settlements?date=${date}&buyer=${encodeURIComponent(a)}`)
      await first
      const again = phone.waitForResponse((r) => isReceiptPng(r, date))
      const put = await page.request.put('/api/shop', { data: { name: '초록다육', bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매', accountNote: '입금자명은 닉네임으로 적어 주세요' }, headers: { Origin: new URL(page.url()).origin } })
      expect(put.ok(), await put.text()).toBe(true)
      await again
    } finally {
      await resetShop(page)
      await phone.context().close()
    }
  })

  test('데스크톱(공유 없음): 이미지 저장이 같은 바이트의 파일을 내려받는다', async ({ page }) => {
    await login(page)
    const { date, a } = await oneBuyer(page)
    const first = page.waitForResponse((r) => isReceiptPng(r, date))
    await page.goto(`/settlements?date=${date}&buyer=${encodeURIComponent(a)}`)
    const res = await first
    const region = page.getByRole('region', { name: '구매 내역 확인서' })
    await expect(region.getByRole('button', { name: '이미지 공유' })).toHaveCount(0)
    const [dl] = await Promise.all([page.waitForEvent('download'), region.getByRole('button', { name: '이미지 저장' }).click()])
    expect(dl.suggestedFilename()).toMatch(new RegExp(`^확인서-${date}-.+\\.png$`))
    expect((await downloadBytes(dl)).equals(await res.body())).toBe(true)
    const [pdf] = await Promise.all([page.waitForEvent('download'), region.getByRole('button', { name: 'PDF 내려받기' }).click()])
    expect(pdf.suggestedFilename()).toMatch(new RegExp(`^확인서-${date}-.+\\.pdf$`))
    expect(await pdfPages(await downloadBytes(pdf))).toBeGreaterThanOrEqual(1)
  })

  test('공유 실패(AbortError 밖)면 안내와 이미지 저장, AbortError면 아무 오류 없음', async ({ page, browser }) => {
    await login(page)
    const { date, a } = await oneBuyer(page)
    const phone = await phoneLike(browser, page)
    await phone.addInitScript(() => {
      const w = window as unknown as { __mode: string }
      w.__mode = 'abort'
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
      Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(w.__mode === 'abort' ? new DOMException('x', 'AbortError') : new DOMException('x', 'NotAllowedError')) })
    })
    await phone.goto(`/settlements?date=${date}&buyer=${encodeURIComponent(a)}`)
    const region = phone.getByRole('region', { name: '구매 내역 확인서' })
    await region.getByRole('button', { name: '이미지 공유' }).click()
    await expect(region.getByRole('alert')).toHaveCount(0)
    await phone.evaluate(() => ((window as unknown as { __mode: string }).__mode = 'fail'))
    await region.getByRole('button', { name: '이미지 공유' }).click()
    const alert = region.getByRole('alert')
    await expect(alert).toContainText("공유하지 못했어요. '이미지 저장'으로 저장해 주세요.")
    await expect(alert.getByRole('button', { name: '이미지 저장' })).toBeVisible()
    await phone.context().close()
  })
})

test.describe('정산 문서·포장 상태 (AC-I2-14·22·33)', () => {
  test('실제 범위: 전원 확인서 PDF (2명) → 파일 이름·쪽 수, PC 표 9번째 열 "포장·배송", 배송 완료 송장', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const { buyers } = await realDay(page, { date, products: [{ no: 1, name: '가', price: 1000 }, { no: 2, name: '나', price: 2000 }], claims: [{ no: 1, phone: '010-5000-0001' }, { no: 2, phone: '010-5000-0002' }] })
    const a = buyers.get('010-5000-0001')!
    await pay(page, date, a, 1000)
    const entry = (await packingList(page, date)).find((e) => e.buyer === a)!
    expect((await packingCommand(page, date, { buyer: a, action: 'pack', items: entry.items.map((i) => i.key) })).status).toBe(200)
    expect((await packingCommand(page, date, { buyer: a, action: 'ship', invoice: '123456789012' })).status).toBe(200)
    await page.goto(`/settlements?date=${date}`)
    const docs = page.getByRole('group', { name: '정산 문서' })
    const all = docs.getByRole('button', { name: '전원 확인서 PDF (2명)' })
    await expect(all).toBeEnabled()
    await expect(docs.getByRole('button', { name: '판매대장 엑셀' })).toBeVisible()
    const table = page.locator('table').first()
    await expect(table.locator('thead th')).toHaveCount(9)
    await expect(table.locator('thead th').nth(8)).toHaveText('포장·배송')
    await expect(table).toContainText('배송 완료 · 송장 123456789012')
    await expect(table).toContainText('포장 대기')
    const [dl] = await Promise.all([page.waitForEvent('download'), all.click()])
    expect(dl.suggestedFilename()).toBe(`확인서-${date}-전원.pdf`)
    expect(await pdfPages(await downloadBytes(dl))).toBe(2)
  })

  test('리허설 범위: 판매대장 대신 안내, 표는 8열, 확인서 옆 "리허설 기록이에요.", 품목 없는 묶음은 한 문장', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true, title: '1부' })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    const ch = uniq('sim_r_')
    await viewerClaim(page, b, '홍길동', '15', ch)
    await expect.poll(async () => (await scopeView(page, date, true)).settlements.length).toBe(1)
    await page.goto(`/settlements?date=${date}&rehearsal=true`)
    const docs = page.getByRole('group', { name: '정산 문서' })
    await expect(docs.getByRole('button', { name: '전원 확인서 PDF (1명)' })).toBeEnabled()
    await expect(docs.getByText('리허설 기록은 판매대장에 넣지 않아요.')).toBeVisible()
    await expect(docs.getByRole('button', { name: '판매대장 엑셀' })).toHaveCount(0)
    await expect(page.locator('table').first().locator('thead th')).toHaveCount(8)
    await page.goto(`/settlements?date=${date}&rehearsal=true&buyer=${encodeURIComponent(ch)}`)
    const region = page.getByRole('region', { name: '구매 내역 확인서' })
    await expect(region.getByText('리허설 기록이에요.')).toBeVisible()
    await expect(region.getByRole('img', { name: '구매 내역 확인서 미리 보기' })).toBeVisible()
    // 과입금으로 품목이 0개가 된 묶음 → 확인서 대신 한 문장
    await page.request.post(`/api/events?date=${date}&rehearsal=true`, { data: { requestId: crypto.randomUUID(), type: 'settlement.payment', buyer: ch, date, amount: 14000 }, headers: { Origin: new URL(page.url()).origin } })
    await page.request.post(`/api/events`, { data: { requestId: crypto.randomUUID(), type: 'host.cancel', b, no: 15, buyer: ch, reason: '취소' }, headers: { Origin: new URL(page.url()).origin } })
    await expect(region.getByText('구매 내역이 없어 확인서를 만들 수 없어요.')).toBeVisible()
    await expect(region.getByRole('button')).toHaveCount(0)
  })
})
