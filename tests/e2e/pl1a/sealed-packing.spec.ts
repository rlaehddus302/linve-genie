// PL1A — 30일 봉인 날짜의 포장 화면 (AC-PL1A-90·18·19·16·20, D-PL1-04) — test-e2e.
// 기대 문장은 acceptance.md 따옴표 그대로. 선택자는 역할·이름 기반(dev-notes "test-e2e (AC-PL1A-90)").
// 판매자는 시험마다 새로 만든다(봉인은 그 판매자의 날짜에만 걸린다 — 기본 시험 계정의 다른 시험과 섞이지 않게).
import { expect, test, type Browser, type Page } from '@playwright/test'
import { downloadBytes, packingCommand, packingList, pdfPages, pngSize, registerApi, smsApi, xlsxRows } from '../i2/support.ts'
import { e2eDate, loginAs, newSeller, sealNow, type Seller } from '../i3/support.ts'
import { noHorizontalScroll } from '../s06/support.ts'

const SEALED_VIEW_ONLY = '30일이 지나 봉인한 날짜예요. 볼 수만 있어요.'
const SEALED_MESSAGE = '30일이 지난 방송 기록은 봉인되어 고칠 수 없어요.'
const X_PHONE = '010-4100-0001'
const Y_PHONE = '010-4100-0002'

function todayKst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function daysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)
}

async function sellerIn(page: Page): Promise<Seller> {
  const seller = await newSeller(page.request)
  await loginAs(page, seller, '/settings')
  const res = await page.request.put('/api/wizard', { data: { status: 'DONE' }, headers: { Origin: new URL(page.url()).origin } })
  expect(res.ok(), await res.text()).toBe(true)
  return seller
}

async function buyerOf(page: Page, date: string, no: number): Promise<string> {
  const view = await (await page.request.get(`/api/days/${date}`)).json() as { claims: { no: number; currentBuyer: string; seq: number }[] }
  const mine = view.claims.filter((c) => c.no === no).sort((a, b) => b.seq - a.seq)[0]
  if (mine === undefined) throw new Error(`찜 ${String(no)} 없음`)
  return mine.currentBuyer
}

interface SealedDay { seller: Seller; a: string; b: string; x: string; y: string; xb: string }

/**
 * 날짜 A(오늘 − 31일, 유튜브 날짜): 1번(X 문자찜 → 포장 완료), 2번(Y 문자찜 → 포장 대기) → 봉인.
 * 날짜 B(오늘 − 3일, 봉인 안 함): 1번 X 문자찜 (대조군).
 * seal=false면 A를 봉인하지 않고 돌려준다(연 채 봉인되는 시험).
 */
async function sealedDay(page: Page, seal = true): Promise<SealedDay> {
  const seller = await sellerIn(page)
  const a = daysBefore(todayKst(), 31)
  const dayA = await e2eDate(page.request, seller.loginId, 'youtube', a)
  expect(dayA.date).toBe(a)
  await registerApi(page, dayA.broadcast, 2, '라울', 8000)
  await smsApi(page, { b: dayA.broadcast, no: 1, phone: X_PHONE })
  await smsApi(page, { b: dayA.broadcast, no: 2, phone: Y_PHONE })
  const x = await buyerOf(page, a, 1)
  const y = await buyerOf(page, a, 2)
  const xEntry = (await packingList(page, a)).find((e) => e.buyer === x)!
  const packed = await packingCommand(page, a, { buyer: x, action: 'pack', items: xEntry.items.map((i) => i.key) })
  expect(packed.status, JSON.stringify(packed.body)).toBe(200)
  const dayB = await e2eDate(page.request, seller.loginId, 'youtube')
  await smsApi(page, { b: dayB.broadcast, no: 1, phone: X_PHONE })
  const xb = await buyerOf(page, dayB.date, 1)
  if (seal) {
    await sealNow(page.request, seller.loginId, a)
    const res = await page.request.get(`/api/days/${a}/packing`)
    expect(res.ok(), await res.text()).toBe(true)
    expect(((await res.json()) as { sealed?: unknown }).sealed).toBe(true)
  }
  return { seller, a, b: dayB.date, x, y, xb }
}

function checklist(page: Page) {
  return page.getByRole('region', { name: '체크리스트' })
}

/** 포장 모드에서 날짜를 고르고 걸러 보기 "전체"에서 그 구매자를 연다 */
async function openFromList(page: Page, date: string, buyerHint: RegExp): Promise<void> {
  await page.goto('/packing')
  await page.getByLabel('날짜').selectOption(date)
  await expect(page).toHaveURL(new RegExp(`/packing\\?date=${date}`))
  const list = page.getByRole('region', { name: '포장 목록' })
  await list.getByRole('group', { name: '걸러 보기' }).getByRole('button', { name: '전체' }).click()
  await list.getByRole('list', { name: '포장할 구매자' }).getByRole('link').filter({ hasText: buyerHint }).click()
  await expect(checklist(page)).toBeVisible()
}

/** 봉인 날짜 체크리스트는 볼 수만 (AC-PL1A-18) */
async function expectViewOnly(page: Page, itemLine: string): Promise<void> {
  const cl = checklist(page)
  await expect(cl.getByText(SEALED_VIEW_ONLY)).toBeVisible()
  // 늘 보이는 글 — role=status가 아니다
  await expect(page.getByRole('status').filter({ hasText: SEALED_VIEW_ONLY })).toHaveCount(0)
  await expect(cl).toContainText(itemLine)
  await expect(cl.getByRole('checkbox')).toHaveCount(0)
  for (const name of ['포장 완료', '배송 완료', '배송 완료로 적기', '포장 완료 취소', '배송 완료 취소', '송장번호 고치기']) {
    await expect(cl.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  await expect(page.getByLabel('송장번호')).toHaveCount(0)
  // AC-PL1A-19: 포장 라벨 출력 버튼은 봉인 날짜에 없다 (PL1B를 합친 뒤에도)
  await expect(page.getByRole('button', { name: '포장 라벨 출력' })).toHaveCount(0)
}

/** 같은 화면에서 브라우저 요청으로 포장 명령 → 409 SEALED와 봉인 문장 */
async function browserPacking(page: Page, date: string, body: Record<string, unknown>): Promise<{ status: number; text: string }> {
  return await page.evaluate(async ({ date, body }) => {
    const res = await fetch(`/api/days/${date}/packing`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID(), ...body }),
    })
    return { status: res.status, text: await res.text() }
  }, { date, body })
}

async function phone(browser: Browser, like: Page, seller: Seller): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(like.url()).origin })
  const p = await context.newPage()
  await loginAs(p, seller, '/settings')
  return p
}

test.describe('AC-PL1A-90: 봉인 날짜 포장 화면 한 흐름', () => {
  test('PC 1440 — 날짜 고르고 X 열기: 볼 수만 안내, 상태 "포장 완료", 라벨 그림·PDF는 됨, 쓰기 버튼 0개, 브라우저 요청은 409', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const d = await sealedDay(page)
    await openFromList(page, d.a, /4자리 0001/)
    await expect(page).toHaveURL(new RegExp(`buyer=${encodeURIComponent(d.x)}`))
    const cl = checklist(page)
    await expectViewOnly(page, '1번')
    await expect(cl).toContainText('지난 상품')
    // 포장 목록의 상태 말은 봉인 전과 같다
    const rows = page.getByRole('region', { name: '포장 목록' }).getByRole('list', { name: '포장할 구매자' }).getByRole('link')
    await expect(rows.filter({ hasText: '4자리 0001' })).toContainText('포장 완료')
    await expect(rows.filter({ hasText: '4자리 0002' })).toContainText('포장 대기')
    await expect(cl.locator('header')).toContainText('포장 완료')
    // 포장 라벨 칸: 그림 저장·라벨 PDF는 된다
    const label = page.getByRole('region', { name: '포장 라벨' })
    await expect(label.getByRole('img', { name: '포장 라벨 1/1쪽' })).toBeVisible()
    const [png] = await Promise.all([page.waitForEvent('download'), label.getByRole('button', { name: '그림 저장' }).click()])
    expect(pngSize(await downloadBytes(png))).toEqual({ width: 384, height: 240 })
    const [pdf] = await Promise.all([page.waitForEvent('download'), label.getByRole('button', { name: '라벨 PDF' }).click()])
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/)
    expect(await pdfPages(await downloadBytes(pdf))).toBeGreaterThan(0)
    // 같은 화면에서 브라우저 요청 — 포장 취소(X)·포장 완료(Y)·배송 완료(X) 모두 409 봉인 문장
    const yEntry = (await packingList(page, d.a)).find((e) => e.buyer === d.y)!
    const xEntry = (await packingList(page, d.a)).find((e) => e.buyer === d.x)!
    for (const body of [
      { buyer: d.x, action: 'unpack' },
      { buyer: d.y, action: 'pack', items: yEntry.items.map((i) => i.key) },
      { buyer: d.x, action: 'ship', invoice: '123456789012' },
    ]) {
      const res = await browserPacking(page, d.a, body)
      expect(res.status, `${String(body.action)} ${res.text}`).toBe(409)
      expect(res.text).toContain('SEALED')
      expect(res.text).toContain(SEALED_MESSAGE)
    }
    // 아무것도 바뀌지 않았다
    const after = await packingList(page, d.a)
    expect(after.find((e) => e.buyer === d.x)?.status).toBe('포장 완료')
    expect(after.find((e) => e.buyer === d.y)?.status).toBe('포장 대기')
    expect(after.find((e) => e.buyer === d.x)?.items.map((i) => i.key)).toEqual(xEntry.items.map((i) => i.key))
    // 봉인 날짜의 포장 라벨 B1 출력도 409 (라벨 켬/끔보다 봉인이 먼저 — AC-PL1A-16)
    const print = await page.evaluate(async ({ date, buyer }) => {
      const res = await fetch('/api/print/packing', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), date, buyer }) })
      return { status: res.status, text: await res.text() }
    }, { date: d.a, buyer: d.x })
    expect(print.status, print.text).toBe(409)
    expect(print.text).toContain(SEALED_MESSAGE)
  })

  test('휴대폰 375 — X를 열면 체크리스트만, 볼 수만 안내·버튼 0개·가로 스크롤 없음, 포장 대기 Y도 체크 칸·"포장 완료" 없음', async ({ page, browser }) => {
    const d = await sealedDay(page)
    const p = await phone(browser, page, d.seller)
    await p.goto(`/packing?date=${d.a}`)
    const list = p.getByRole('region', { name: '포장 목록' })
    // 기본 걸러 보기 "포장할 것"에는 Y만
    await expect(list.getByRole('list', { name: '포장할 구매자' }).getByRole('link')).toHaveCount(1)
    await list.getByRole('group', { name: '걸러 보기' }).getByRole('button', { name: '포장 완료' }).click()
    const xRow = list.getByRole('list', { name: '포장할 구매자' }).getByRole('link').filter({ hasText: '4자리 0001' })
    await expect(xRow).toContainText('포장 완료')
    await xRow.click()
    await expect(p).toHaveURL(new RegExp(`buyer=${encodeURIComponent(d.x)}`))
    await expectViewOnly(p, '1번')
    await expect(p.getByRole('button', { name: '포장 완료', exact: true })).toHaveCount(0)
    await expect(p.getByRole('button', { name: '배송 완료', exact: true })).toHaveCount(0)
    await noHorizontalScroll(p)
    // 포장 대기인 Y — 봉인이라 담을 수 없다
    await p.goto(`/packing?date=${d.a}&buyer=${encodeURIComponent(d.y)}`)
    await expectViewOnly(p, '2번')
    await expect(checklist(p)).toContainText('라울')
    await expect(checklist(p)).not.toContainText(/\d+\/\d+ 담음/)
    await expect(p.getByRole('button', { name: '포장 완료', exact: true })).toHaveCount(0)
    await noHorizontalScroll(p)
    const res = await browserPacking(p, d.a, { buyer: d.y, action: 'pack', items: (await packingList(p, d.a)).find((e) => e.buyer === d.y)!.items.map((i) => i.key) })
    expect(res.status, res.text).toBe(409)
    expect(res.text).toContain(SEALED_MESSAGE)
    await p.context().close()
  })
})

test.describe('AC-PL1A-20·18: 봉인 안 한 날짜는 그대로', () => {
  test('같은 판매자의 B(봉인 안 함) — 안내 없음, 체크 칸·담음 수·"포장 완료"가 있고 실제로 적힌다', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const d = await sealedDay(page)
    const listB = await (await page.request.get(`/api/days/${d.b}/packing`)).json() as Record<string, unknown>
    expect('sealed' in listB).toBe(false)
    await page.goto(`/packing?date=${d.b}&buyer=${encodeURIComponent(d.xb)}`)
    const cl = checklist(page)
    const box = cl.getByRole('checkbox', { name: '1번 지난 상품' })
    await expect(box).toBeVisible()
    await expect(page.getByText(SEALED_VIEW_ONLY)).toHaveCount(0)
    await expect(cl.getByText('0/1 담음')).toBeVisible()
    await box.click()
    await cl.getByRole('button', { name: '포장 완료', exact: true }).click()
    await expect(cl.getByText('포장 완료로 적었어요.')).toBeVisible()
    expect((await packingList(page, d.b)).find((e) => e.buyer === d.xb)?.status).toBe('포장 완료')
    // 날짜를 봉인 날짜 A로 바꾸면 볼 수만
    await page.getByLabel('날짜').selectOption(d.a)
    await page.getByRole('region', { name: '포장 목록' }).getByRole('group', { name: '걸러 보기' }).getByRole('button', { name: '전체' }).click()
    await page.getByRole('region', { name: '포장 목록' }).getByRole('list', { name: '포장할 구매자' }).getByRole('link').filter({ hasText: '4자리 0002' }).click()
    await expectViewOnly(page, '2번')
  })
})

test.describe('흐름 깨뜨리기: 포장 화면을 연 채 봉인된다', () => {
  test('Y를 다 담아 둔 채 봉인 → "포장 완료"를 눌러도 적히지 않고 봉인 문장(또는 볼 수만 화면)이 보인다', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const d = await sealedDay(page, false)
    await page.goto(`/packing?date=${d.a}&buyer=${encodeURIComponent(d.y)}`)
    const cl = checklist(page)
    await cl.getByRole('checkbox', { name: '2번 라울' }).click()
    const pack = cl.getByRole('button', { name: '포장 완료', exact: true })
    await expect(pack).toBeEnabled()
    await sealNow(page.request, d.seller.loginId, d.a)
    // 화면이 아직 바뀌지 않았으면 눌러 본다 — 어느 쪽이든 봉인 문장이 보여야 하고 적히면 안 된다
    if (await pack.isVisible() && await pack.isEnabled()) await pack.click().catch(() => undefined)
    await expect(cl.getByText(SEALED_VIEW_ONLY).or(page.getByText(SEALED_MESSAGE))).toBeVisible()
    await expect(cl.getByText('포장 완료로 적었어요.')).toHaveCount(0)
    expect((await packingList(page, d.a)).find((e) => e.buyer === d.y)?.status).toBe('포장 대기')
    // 새로고침하면 볼 수만 화면
    await page.reload()
    await expectViewOnly(page, '2번')
  })
})

test.describe('AC-PL1A-10·11·14: 봉인 날짜의 문서를 화면에서 받는다', () => {
  test('정산 화면 — 전원 확인서 PDF(2명 2쪽), 판매대장 엑셀 A~B: A의 "찜 시각"만 빈칸·행은 그대로, B의 지난 구매에 A 항목', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const d = await sealedDay(page)
    await page.goto(`/settlements?date=${d.a}`)
    const docs = page.getByRole('group', { name: '정산 문서' })
    const [pdf] = await Promise.all([page.waitForEvent('download'), docs.getByRole('button', { name: '전원 확인서 PDF (2명)' }).click()])
    expect(await pdfPages(await downloadBytes(pdf))).toBe(2)
    await docs.getByRole('button', { name: '판매대장 엑셀' }).click()
    const dlg = page.getByRole('dialog', { name: '판매대장 엑셀' })
    await expect(dlg.getByLabel('시작 날짜')).toHaveValue(d.a)
    await dlg.getByLabel('끝 날짜').selectOption(d.b)
    const [xlsx] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: '엑셀 내려받기' }).click()])
    const rows = await xlsxRows(await downloadBytes(xlsx))
    const head = rows[0]!
    const dateCol = head.indexOf('방송 날짜')
    const timeCol = head.indexOf('찜 시각')
    expect(dateCol).toBeGreaterThanOrEqual(0)
    expect(timeCol).toBeGreaterThanOrEqual(0)
    const rowsA = rows.slice(1).filter((r) => r[dateCol]?.includes(d.a) || r[dateCol]?.includes(`${String(Number(d.a.slice(5, 7)))}월 ${String(Number(d.a.slice(8, 10)))}일`))
    const rowsB = rows.slice(1).filter((r) => !rowsA.includes(r))
    expect(rowsA).toHaveLength(2)
    expect(rowsB).toHaveLength(1)
    for (const r of rowsA) expect(r[timeCol] ?? '').toBe('')
    expect(rowsB[0]![timeCol]).not.toBe('')
    // 지난 구매 (B에서 X) — A의 항목이 그대로
    const past = await page.request.get(`/api/days/${d.b}/past?buyer=${encodeURIComponent(d.xb)}`)
    expect(past.status(), await past.text()).toBe(200)
    expect(await past.text()).toContain(d.a)
  })
})
