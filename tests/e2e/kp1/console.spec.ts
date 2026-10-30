// KP1 방송 콘솔 손님 표시 (test-e2e) — AC-KP1-14(꼬리표)·15(끄는 설정)·16(받기 간격 — 요청 수 셈).
// 기대 글은 CUSTOMER_RULES CR-7 그대로: "입금 늦음 주의"·"단골 · 누적 125,000원"·"처음"·없음, 화면 읽기 "손님: 단골, 누적 125,000원".
// 단골 기본 = 3번 이상 또는 100,000원 이상(D-CRM1-05), 입금 늦음 주의 = 기다리는 날(기본 3일)이 지난 미입금 한 번 이상.
import { test, expect, type Page, type Request } from '@playwright/test'
import {
  BADGES_HELP,
  BADGES_LABEL,
  BADGES_PATH,
  PC,
  PHONE,
  VIEWPORTS,
  broadcast,
  buyersOf,
  chat,
  chatRow,
  customerSection,
  kstDate,
  loginNewSeller,
  openConsole,
  registerStock,
  sameSellerOn,
  saveButton,
  scopeView,
  youtubeSale,
} from './support.ts'

interface World { b: string; date: string; t: string; a: string; bb: string; c: string; d: string }

/** 앞선 실제 날짜: A 미입금(10일 전 — 기다리는 날 지남), B 입금 125,000원(단골), D 입금 5,000원(단골 아님). C는 처음. 어제 날짜에 실제 방송 */
async function badgeWorld(page: Page): Promise<World> {
  await loginNewSeller(page)
  const t = String(Date.now())
  const a = `UC_A${t}`
  const bb = `UC_B${t}`
  const c = `UC_C${t}`
  const d = `UC_D${t}`
  const old = kstDate(10)
  const s = await youtubeSale(page, { date: old, ch: a, nick: '에이손님', prices: [9_000], paid: false, firstNo: 10 })
  await youtubeSale(page, { date: old, b: s.b, ch: bb, nick: '비손님', prices: [125_000], paid: true, firstNo: 20 })
  await youtubeSale(page, { date: old, b: s.b, ch: d, nick: '디손님', prices: [5_000], paid: true, firstNo: 30 })
  const date = kstDate(1)
  const b = await broadcast(page, date)
  await registerStock(page, b, 16, '라울', 8_000, 2)
  await registerStock(page, b, 15, '핑크프릴', 10_000, 2)
  return { b, date, t, a, bb, c, d }
}

async function chatAll(page: Page, w: World): Promise<void> {
  await chat(page, w.b, w.a, '에이손님', '안녕하세요 에이')
  await chat(page, w.b, w.bb, '비손님', '안녕하세요 비')
  await chat(page, w.b, w.c, '씨손님', '안녕하세요 씨')
  await chat(page, w.b, w.d, '디손님', '안녕하세요 디')
}

function badgeRequests(page: Page): { at: number; buyers: string[]; status: number | null }[] {
  const out: { at: number; buyers: string[]; status: number | null; req?: Request }[] = []
  page.on('request', (r) => {
    if (BADGES_PATH.test(new URL(r.url()).pathname + new URL(r.url()).search)) out.push({ at: Date.now(), buyers: buyersOf(r.url()), status: null, req: r })
  })
  page.on('requestfinished', async (r) => {
    const row = out.find((x) => x.req === r)
    if (row !== undefined) row.status = (await r.response())?.status() ?? null
  })
  return out
}

for (const { name, viewport } of VIEWPORTS) {
  test.describe(`꼬리표 ${name}`, () => {
    test.use({ viewport })

    test(`AC-KP1-14 ${name}: 줄 이름 뒤 "입금 늦음 주의"·"단골 · 누적 125,000원"·"처음"·없음, 화면 읽기 "손님: 단골, 누적 125,000원", 누르는 것이 아니다`, async ({ page }) => {
      test.setTimeout(180_000)
      const w = await badgeWorld(page)
      await chatAll(page, w)
      await openConsole(page, w.b)
      await expect(chatRow(page, '에이손님')).toContainText('입금 늦음 주의')
      await expect(chatRow(page, '비손님')).toContainText('단골 · 누적 125,000원')
      await expect(chatRow(page, '비손님')).toContainText('손님: 단골, 누적 125,000원')
      await expect(chatRow(page, '씨손님')).toContainText('처음')
      await expect(chatRow(page, '디손님')).toContainText('안녕하세요 디')
      for (const word of ['처음', '단골', '입금 늦음 주의', '누적']) await expect(chatRow(page, '디손님')).not.toContainText(word)
      await expect(chatRow(page, '씨손님')).not.toContainText('단골')
      // 꼬리표는 누르는 것이 아니다
      await expect(chatRow(page, '비손님').getByRole('button', { name: /단골/ })).toHaveCount(0)
      await expect(chatRow(page, '비손님').getByRole('link', { name: /단골/ })).toHaveCount(0)
      // 표시는 판정에 영향 없음 — 찜 없음
      expect((await scopeView(page, w.date, false)).claims).toHaveLength(0)
    })
  })
}

test.describe('AC-KP1-14 리허설', () => {
  test.use({ viewport: PHONE })

  test('리허설 콘솔엔 꼬리표가 없고 조회도 부르지 않는다 (같은 채널이 실제 날짜에선 입금 늦음 주의여도)', async ({ page }) => {
    test.setTimeout(150_000)
    const w = await badgeWorld(page)
    const asked = badgeRequests(page)
    const rb = await broadcast(page, kstDate(2), true, '연습')
    await chat(page, rb, w.a, '에이손님', '안녕하세요 에이')
    await chat(page, rb, w.bb, '비손님', '안녕하세요 비')
    await openConsole(page, rb)
    await expect(chatRow(page, '비손님')).toContainText('안녕하세요 비')
    await expect(chatRow(page, '에이손님')).not.toContainText('입금 늦음 주의')
    await expect(chatRow(page, '비손님')).not.toContainText('단골')
    // 꼬리표 조회가 없었다는 것을 상태로 확인: 실제 콘솔을 열면 그때 처음 부른다
    expect(asked).toHaveLength(0)
    await chatAll(page, w)
    await openConsole(page, w.b)
    await expect(chatRow(page, '비손님')).toContainText('단골')
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every((r) => r.buyers.length > 0)).toBe(true)
  })
})

test.describe('AC-KP1-15 끄는 설정', () => {
  test('PC 설정에서 "방송 화면에 손님 표시"를 끄면 휴대폰 콘솔의 꼬리표와 1등 옆 "입금 늦음 주의"가 다시 열지 않아도 모두 사라진다 — 설명 문장, 다시 켜면 돌아온다', async ({ page, browser }) => {
    test.setTimeout(180_000)
    await page.setViewportSize(PHONE)
    const seller = await loginNewSeller(page)
    const t = String(Date.now())
    const a = `UC_A${t}`
    const bb = `UC_B${t}`
    const old = kstDate(10)
    const s = await youtubeSale(page, { date: old, ch: a, nick: '에이손님', prices: [9_000], paid: false, firstNo: 10 })
    await youtubeSale(page, { date: old, b: s.b, ch: bb, nick: '비손님', prices: [125_000], paid: true, firstNo: 20 })
    const date = kstDate(1)
    const b = await broadcast(page, date)
    await registerStock(page, b, 16, '라울', 8_000, 2)
    await registerStock(page, b, 15, '핑크프릴', 10_000, 2)
    await chat(page, b, bb, '비손님', '안녕하세요 비')
    await chat(page, b, a, '에이손님', '15')
    await openConsole(page, b)
    const card = page.getByRole('region', { name: '현재 상품' })
    await expect(card.getByText(/^1등: /)).toContainText('에이손님')
    await expect(card).toContainText('입금 늦음 주의')
    await expect(chatRow(page, '비손님')).toContainText('단골 · 누적 125,000원')
    await expect(chatRow(page, '에이손님')).toContainText('입금 늦음 주의')

    // PC(같은 판매자, 다른 기기)에서 끈다
    const pc = await sameSellerOn(browser, new URL(page.url()).origin, seller, PC)
    try {
      await pc.goto('/settings')
      const section = customerSection(pc)
      const toggle = section.getByRole('checkbox', { name: BADGES_LABEL })
      await expect(toggle).toBeChecked() // 기본 켬
      await expect(section.getByText(BADGES_HELP)).toBeVisible()
      await toggle.uncheck()
      await saveButton(pc).click()
      await expect(pc.getByRole('region', { name: '저장', exact: true }).getByText('저장했어요.')).toBeVisible()
      await expect.poll(async () => ((await (await pc.request.get('/api/ledger-settings')).json()) as { settings: { consoleBadges: boolean } }).settings.consoleBadges).toBe(false)

      // 휴대폰 콘솔: 다시 열지 않고 바로 모두 사라진다
      await expect(chatRow(page, '비손님')).not.toContainText('단골')
      await expect(chatRow(page, '에이손님')).not.toContainText('입금 늦음 주의')
      await expect(card.getByText(/^1등: /)).toHaveText('1등: 에이손님')
      await expect(card).not.toContainText('입금 늦음 주의')
      // 다시 열어도 없다
      await page.reload()
      await expect(page.getByLabel('빠른 입력')).toBeVisible()
      await expect(chatRow(page, '비손님')).toContainText('안녕하세요 비')
      await expect(chatRow(page, '비손님')).not.toContainText('단골')
      await expect(page.getByRole('region', { name: '현재 상품' })).not.toContainText('입금 늦음 주의')

      // 다시 켜면 돌아온다
      await pc.reload()
      await customerSection(pc).getByRole('checkbox', { name: BADGES_LABEL }).check()
      await saveButton(pc).click()
      await expect(pc.getByRole('region', { name: '저장', exact: true }).getByText('저장했어요.')).toBeVisible()
      await expect(chatRow(page, '비손님')).toContainText('단골 · 누적 125,000원', { timeout: 15_000 })
      await expect(page.getByRole('region', { name: '현재 상품' })).toContainText('입금 늦음 주의')
    } finally {
      await pc.context().close()
    }
  })
})

test.describe('AC-KP1-16 받기 간격', () => {
  test.use({ viewport: PC })

  test('새 채팅 구매자 60명 → 한 번에 50명 이하, 받기 사이 4초 이상, 모든 구매자를 정확히 한 번 — 받은 구매자가 다시 쳐도 다시 묻지 않고 새 구매자만', async ({ page }) => {
    test.setTimeout(240_000)
    await loginNewSeller(page)
    const date = kstDate(1)
    const b = await broadcast(page, date)
    const asked = badgeRequests(page)
    await openConsole(page, b)
    const t = String(Date.now())
    const ids = Array.from({ length: 60 }, (_, i) => `UC_N${t}_${String(i).padStart(2, '0')}`)
    for (const [i, id] of ids.entries()) await chat(page, b, id, `손님${String(i).padStart(2, '0')}`, `안녕 ${String(i)}`)
    await expect(chatRow(page, '손님59')).toBeVisible()
    // 60명 모두 물을 때까지
    await expect.poll(() => new Set(asked.flatMap((r) => r.buyers)).size, { timeout: 30_000 }).toBe(60)
    await expect(chatRow(page, '손님59')).toContainText('처음')
    for (const r of asked) expect(r.buyers.length).toBeLessThanOrEqual(50)
    expect(asked.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < asked.length; i++) expect(asked[i]!.at - asked[i - 1]!.at, `받기 ${String(i)}과 그 앞 사이`).toBeGreaterThanOrEqual(3_950)
    expect(asked.flatMap((r) => r.buyers)).toHaveLength(60) // 겹쳐 묻지 않았다
    const before = asked.length

    // 받은 구매자가 다시 친다 + 새 구매자 하나
    await chat(page, b, ids[0]!, '손님00', '또 왔어요')
    await chat(page, b, ids[1]!, '손님01', '또 왔어요 둘')
    const fresh = `UC_F${t}`
    await chat(page, b, fresh, '새손님', '처음 왔어요')
    await expect.poll(() => asked.length, { timeout: 15_000 }).toBe(before + 1)
    expect(asked[before]!.buyers).toEqual([fresh])
    await expect(chatRow(page, '새손님')).toContainText('처음')
  })

  test('조회가 실패하면 꼬리표 없이 그대로 — 오류 띠 없음, 채팅·찜은 계속', async ({ page }) => {
    test.setTimeout(150_000)
    const w = await badgeWorld(page)
    await chatAll(page, w)
    let failed = 0
    await page.route(BADGES_PATH, async (route) => {
      failed += 1
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: '서버 오류' } }) })
    })
    await openConsole(page, w.b)
    await expect.poll(() => failed).toBeGreaterThan(0)
    await expect(chatRow(page, '비손님')).toContainText('안녕하세요 비')
    await expect(chatRow(page, '비손님')).not.toContainText('단골')
    await expect(chatRow(page, '씨손님')).not.toContainText('처음')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.locator('main')).not.toContainText(/불러오지 못했어요|서버 오류/)
    await chat(page, w.b, w.c, '씨손님', '15')
    await expect(page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^15번 / })).toContainText('씨손님')
  })
})
