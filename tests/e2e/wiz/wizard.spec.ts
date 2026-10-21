// 시작 마법사 순서·위 줄 "다시 연결" (UX-02, D-WIZ-01, AC-WIZ-01~04). test-e2e.
// 문제: 프린터 연결(브라우저 안의 연결) 뒤에 구글로 떠났다 돌아오면 연결이 끊겨 "출력 멈춤"이 됐다.
// 새 순서는 3/5 유튜브 → 4/5 프린터이고, 끊기면 위 줄 "다시 연결" 한 번으로 잇는다.
// 시험마다 새 판매자(서로 출력 기록이 섞이지 않는다). 시험용 프린터는 서버 시험 모드의 window.livejjimTestPrinter.
// 전체 새로고침이 없었는지는 창의 표시 값(새로고침이면 사라진다)과 load 사건 수로 본다.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { fake, fakeChannel, loginAs, newSeller, type Seller } from '../i3/support.ts'
import { postJson, printOverview, printedCount, registerApi, smsApi, TEST_PRINTER, uniqueDate, waitPrinted } from '../i1/support.ts'
import { setLabels } from '../n4a/support.ts'

const TITLES = ['1/5 가게 이름', '2/5 판매 규칙 확인', '3/5 유튜브 연결', '4/5 프린터 연결', '5/5 리허설 해 보기'] as const

function heading(page: Page, name: string): Locator {
  return page.getByRole('heading', { level: 2, name, exact: true })
}
function banner(page: Page): Locator {
  return page.getByRole('banner')
}
/** 위 줄 프린터 상태 링크 */
function printerStatus(page: Page): Locator {
  return banner(page).getByRole('link', { name: /^(프린터 .+ · (연결됨|끊김)|출력 멈춤|출력 기기 없음)/ })
}
function bannerReconnect(page: Page): Locator {
  return banner(page).getByRole('button', { name: '다시 연결', exact: true })
}

/** 새로고침 없이 이어지는지 보는 표시 */
async function markPage(page: Page): Promise<{ loads: () => number }> {
  let loads = 0
  page.on('load', () => {
    loads += 1
  })
  await page.evaluate(() => {
    (window as unknown as { __wizMark: string }).__wizMark = 'kept'
  })
  return { loads: () => loads }
}
async function expectSameDocument(page: Page, mark: { loads: () => number }): Promise<void> {
  expect(await page.evaluate(() => (window as unknown as { __wizMark?: string }).__wizMark)).toBe('kept')
  expect(mark.loads()).toBe(0)
}

/** 마법사 4/5(또는 라벨 화면)의 프린터 칸에서 시험용 프린터 연결 → 테스트 인쇄 → 예 → 이 기기에서 출력 */
async function connectHere(page: Page, name: string): Promise<void> {
  const printer = page.getByRole('region', { name: '프린터', exact: true })
  await expect(page.evaluate(() => 'livejjimTestPrinter' in window)).resolves.toBe(true)
  await printer.getByRole('group', { name: '연결 방법' }).getByRole('button', { name: TEST_PRINTER }).click()
  await expect(printer.getByText('이 기기의 프린터: 연결됨')).toBeVisible()
  await printer.getByRole('button', { name: '테스트 인쇄' }).click()
  const result = printer.getByRole('group', { name: '테스트 인쇄 결과' })
  await expect(result).toBeVisible()
  await result.getByRole('button', { name: '예' }).click()
  await printer.getByLabel('기기 이름').fill(name)
  await printer.getByRole('button', { name: '이 기기에서 출력' }).click()
  await expect(printer.getByText('이 기기가 출력 기기예요')).toBeVisible()
  await expect(printerStatus(page)).toHaveText(`프린터 ${name} · 연결됨 · 대기 0장`)
}

/** 화면을 옮기지 않고(API만) 실제 방송을 만든다 */
async function broadcastApi(page: Page, date: string): Promise<string> {
  const res = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), date, rehearsal: false })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  const body = res.body
  const b = (body['result'] as Record<string, unknown> | undefined)?.['b'] ?? (body['broadcast'] as Record<string, unknown> | undefined)?.['id'] ?? body['b'] ?? body['id']
  if (typeof b !== 'string') throw new Error(`방송 ID 없음: ${JSON.stringify(body)}`)
  return b
}

/** 라벨 n장이 생기게: 상품 등록 + 문자찜 (1등 확정 → 자동 출력 대기) */
async function makeLabels(page: Page, b: string, from: number, count: number): Promise<void> {
  for (let no = from; no < from + count; no += 1) {
    await registerApi(page, b, no, `품종${String(no)}`, 1000 * no)
    await smsApi(page, { b, no, phone: `010-7777-${String(1000 + no)}` })
  }
}

async function startWizard(page: Page): Promise<Seller> {
  const seller = await newSeller(page.request)
  await loginAs(page, seller)
  await expect(page).toHaveURL(/\/start$/)
  await expect(heading(page, TITLES[0])).toBeFocused()
  return seller
}

async function nextTo(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: '다음', exact: true }).click()
  await expect(heading(page, title)).toBeFocused()
}

test.describe('AC-WIZ-01 단계 순서', () => {
  test('AC-WIZ-01: 다음 → 1/5 가게 이름 … 3/5 유튜브 연결 → 4/5 프린터 연결 → 5/5, 이전은 거꾸로 — 제목에 포커스, 3/5는 유튜브 칸, 4/5는 연결 마법사', async ({ page }) => {
    await startWizard(page)
    await nextTo(page, TITLES[1])
    await nextTo(page, TITLES[2])
    // 3/5: 설정의 유튜브 칸과 같은 내용 — 이 묶음은 유튜브를 준비하지 않은 서버라 그 문장 + "다음"
    await expect(page.getByRole('main')).toContainText('유튜브 연동을 준비하지 않은 서버예요.')
    await expect(page.getByRole('region', { name: '프린터', exact: true })).toHaveCount(0)
    await nextTo(page, TITLES[3])
    // 4/5: I1 연결 마법사 (시험용 프린터 연결 버튼), 유튜브 버튼 없음
    await expect(page.getByRole('region', { name: '프린터', exact: true }).getByRole('group', { name: '연결 방법' }).getByRole('button', { name: TEST_PRINTER })).toBeVisible()
    await expect(page.getByRole('button', { name: '구글로 유튜브 연결하기' })).toHaveCount(0)
    await nextTo(page, TITLES[4])
    await expect(page.getByRole('button', { name: '다음', exact: true })).toHaveCount(0)
    for (const title of [TITLES[3], TITLES[2], TITLES[1], TITLES[0]]) {
      await page.getByRole('button', { name: '이전', exact: true }).click()
      await expect(heading(page, title)).toBeFocused()
    }
    await expect(page.getByRole('button', { name: '이전', exact: true })).toHaveCount(0)
  })

  test('AC-WIZ-01: 라벨 기능 꺼짐 — 3/5 다음은 5/5, 5/5 이전은 3/5 (프린터 단계를 4/5 자리에서 건너뜀)', async ({ page }) => {
    await startWizard(page)
    // 라벨 끄기는 로그인한 세션이 필요하다 — 끈 뒤 마법사를 다시 연다
    await setLabels(page, false)
    await page.goto('/start')
    await expect(heading(page, TITLES[0])).toBeVisible()
    await nextTo(page, TITLES[1])
    await nextTo(page, TITLES[2])
    await nextTo(page, TITLES[4])
    await page.getByRole('button', { name: '이전', exact: true }).click()
    await expect(heading(page, TITLES[2])).toBeFocused()
    await setLabels(page, true)
  })
})

test.describe('AC-WIZ-02 저장된 단계 번호', () => {
  for (const [step, title] of [[3, TITLES[2]], [4, TITLES[3]]] as const) {
    test(`AC-WIZ-02: 서버에 저장된 진행 중 단계 ${String(step)}는 새 순서의 번호 그대로 "${title}"로 열린다`, async ({ page }) => {
      await startWizard(page)
      const res = await page.request.put('/api/wizard', { data: { status: 'IN_PROGRESS', step }, headers: { Origin: new URL(page.url()).origin } })
      expect(res.ok(), await res.text()).toBe(true)
      await page.goto('/start')
      await expect(heading(page, title)).toBeVisible()
      const wizard = await (await page.request.get('/api/wizard')).json() as { wizard: { status: string; step: number | null } }
      expect(wizard.wizard).toMatchObject({ status: 'IN_PROGRESS', step })
    })
  }

  test('@youtube AC-WIZ-02: 저장된 단계가 5여도 구글(가짜)에서 돌아오면 3/5 유튜브 연결에 결과, 서버에도 3단계, 다음은 4/5 프린터', async ({ page }) => {
    await fake(page.request, '/_fake/clear-faults')
    await startWizard(page)
    await nextTo(page, TITLES[1])
    await nextTo(page, TITLES[2])
    await fakeChannel(page.request, '돌아온 채널')
    const res = await page.request.put('/api/wizard', { data: { status: 'IN_PROGRESS', step: 5 }, headers: { Origin: new URL(page.url()).origin } })
    expect(res.ok(), await res.text()).toBe(true)
    await page.getByRole('button', { name: '구글로 유튜브 연결하기' }).click()
    await expect(heading(page, TITLES[2])).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '유튜브 채널을 연결했어요.' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText('돌아온 채널')
    await expect(page).toHaveURL(/\/start$/)
    await expect.poll(async () => ((await (await page.request.get('/api/wizard')).json()) as { wizard: { step: number | null } }).wizard.step).toBe(3)
    await nextTo(page, TITLES[3])
  })
})

test.describe('AC-WIZ-03 프린터 연결 뒤엔 페이지를 떠나지 않는다', () => {
  test('@youtube AC-WIZ-03: 3/5 유튜브 연결(구글 가짜 이동) → 4/5 시험용 프린터 연결·테스트 인쇄 → 5/5 → 마치기 → 라벨이 출력 멈춤 없이 나간다', async ({ page }) => {
    await fake(page.request, '/_fake/clear-faults')
    await startWizard(page)
    await nextTo(page, TITLES[1])
    await nextTo(page, TITLES[2])
    await fakeChannel(page.request, '순서 채널')
    await page.getByRole('button', { name: '구글로 유튜브 연결하기' }).click()
    await expect(page.getByRole('status').filter({ hasText: '유튜브 채널을 연결했어요.' })).toBeVisible()
    await nextTo(page, TITLES[3])
    const mark = await markPage(page)
    await connectHere(page, '마법사 PC')
    const afterTest = await printedCount(page)
    expect(afterTest).toBe(1)
    // 4/5 이후엔 구글로 가는 버튼·다른 주소로 가는 링크가 없다
    await expect(page.getByRole('button', { name: '구글로 유튜브 연결하기' })).toHaveCount(0)
    const outside = await page.locator('main a[href]').evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href).filter((href) => new URL(href).origin !== location.origin))
    expect(outside).toEqual([])
    await nextTo(page, TITLES[4])
    await page.getByRole('button', { name: '이전', exact: true }).click()
    await expect(heading(page, TITLES[3])).toBeFocused()
    await nextTo(page, TITLES[4])
    await page.getByRole('button', { name: '마치기' }).click()
    await expect(page.getByRole('button', { name: '새 방송 시작' })).toBeVisible()
    await expectSameDocument(page, mark)
    await expect(printerStatus(page)).toHaveText('프린터 마법사 PC · 연결됨 · 대기 0장')

    // 라벨 두 장: 자동 출력되고 멈춤이 없다
    const b = await broadcastApi(page, uniqueDate())
    await makeLabels(page, b, 1, 2)
    await waitPrinted(page, afterTest + 2)
    await expect.poll(async () => (await printOverview(page)).queue.waiting).toBe(0)
    const ov = await printOverview(page)
    expect(ov.queue.pause).toBeNull()
    expect(ov.queue.device?.printerConnected).toBe(true)
    await expect(printerStatus(page)).toHaveText('프린터 마법사 PC · 연결됨 · 대기 0장')
    await expect(bannerReconnect(page)).toHaveCount(0)
    await expectSameDocument(page, mark)
  })

  for (const exit of ['리허설 시작하기', '마치기', '나중에 할게요'] as const) {
    test(`AC-WIZ-03: 4/5에서 연결한 뒤 "${exit}" — 새로고침 없이 이동하고 위 줄은 "연결됨"`, async ({ page }) => {
      await startWizard(page)
      for (const title of [TITLES[1], TITLES[2], TITLES[3]]) await nextTo(page, title)
      const mark = await markPage(page)
      await connectHere(page, '나가기 PC')
      if (exit !== '나중에 할게요') await nextTo(page, TITLES[4])
      await page.getByRole('button', { name: exit }).click()
      if (exit === '리허설 시작하기') await expect(page.getByText('리허설 중 — 실제 판매가 아니에요')).toBeVisible()
      else await expect(page.getByRole('button', { name: '새 방송 시작' })).toBeVisible()
      await expectSameDocument(page, mark)
      await expect(printerStatus(page)).toHaveText('프린터 나가기 PC · 연결됨 · 대기 0장')
      await expect(banner(page)).not.toContainText('출력 멈춤')
      const ov = await printOverview(page)
      expect(ov.queue.pause).toBeNull()
      expect(ov.queue.device?.printerConnected).toBe(true)
    })
  }
})

test.describe('AC-WIZ-04 위 줄 "다시 연결"', () => {
  /** 마법사 4/5에서 출력 기기가 되고 마친 뒤 방송 목록 */
  async function deviceThenHome(page: Page, name: string): Promise<Seller> {
    const seller = await startWizard(page)
    for (const title of [TITLES[1], TITLES[2], TITLES[3]]) await nextTo(page, title)
    await connectHere(page, name)
    await nextTo(page, TITLES[4])
    await page.getByRole('button', { name: '마치기' }).click()
    await expect(page.getByRole('button', { name: '새 방송 시작' })).toBeVisible()
    return seller
  }

  test('AC-WIZ-04: 새로고침으로 끊김 → 위 줄 "출력 멈춤", 멈춘 동안 라벨 2장 대기 옆 "다시 연결" 한 번 → 그 화면 그대로 대기 맨 앞부터 출력', async ({ page }) => {
    await deviceThenHome(page, '새로고침 PC')
    await page.reload()
    await expect(printerStatus(page)).toHaveText('출력 멈춤 · 대기 0장')
    await expect(bannerReconnect(page)).toBeVisible()
    expect((await printOverview(page)).queue.pause?.reason).toBe('DISCONNECTED')
    expect(await printedCount(page)).toBe(0)

    // 멈춘 동안 들어온 라벨은 대기열에 쌓인다
    const b = await broadcastApi(page, uniqueDate())
    await makeLabels(page, b, 1, 2)
    await expect(printerStatus(page)).toHaveText('출력 멈춤 · 대기 2장')
    expect(await printedCount(page)).toBe(0)
    const before = (await printOverview(page)).jobs.map((j) => j.label.no)
    expect(before).toEqual([1, 2])

    const url = page.url()
    const mark = await markPage(page)
    await bannerReconnect(page).click()
    await waitPrinted(page, 2)
    await expect(printerStatus(page)).toHaveText('프린터 새로고침 PC · 연결됨 · 대기 0장')
    await expect(bannerReconnect(page)).toHaveCount(0)
    expect(page.url()).toBe(url)
    await expectSameDocument(page, mark)
    const ov = await printOverview(page)
    expect(ov.queue.pause).toBeNull()
    expect(ov.queue.waiting).toBe(0)
  })

  test('AC-WIZ-04: 다시 연결 실패 — L-7 문장이 위 줄 근처에 한 줄, 대기열 그대로, 다시 누르면 이어진다', async ({ page }) => {
    await deviceThenHome(page, '실패 PC')
    await page.reload()
    await expect(bannerReconnect(page)).toBeVisible()
    const b = await broadcastApi(page, uniqueDate())
    await makeLabels(page, b, 1, 1)
    await expect(printerStatus(page)).toHaveText('출력 멈춤 · 대기 1장')
    await page.evaluate(() => (window as unknown as { livejjimTestPrinter: { setConnectError(c: string | null): void } }).livejjimTestPrinter.setConnectError('BLUETOOTH_OFF'))
    await bannerReconnect(page).click()
    const alert = banner(page).getByRole('alert')
    await expect(alert).toHaveText('블루투스가 꺼져 있어요. 블루투스를 켠 뒤 다시 연결해 주세요.')
    await expect(printerStatus(page)).toHaveText('출력 멈춤 · 대기 1장')
    expect(await printedCount(page)).toBe(0)
    expect((await printOverview(page)).queue.waiting).toBe(1)
    await page.evaluate(() => (window as unknown as { livejjimTestPrinter: { setConnectError(c: string | null): void } }).livejjimTestPrinter.setConnectError(null))
    await bannerReconnect(page).click()
    await waitPrinted(page, 1)
    await expect(printerStatus(page)).toHaveText('프린터 실패 PC · 연결됨 · 대기 0장')
    await expect(banner(page).getByRole('alert')).toHaveCount(0)
  })

  test('AC-WIZ-04: 다른 기기는 위 줄에 "다시 연결"이 없고 상태를 누르면 라벨 화면 · 손으로 멈춤도 버튼 없음 · 라벨 꺼짐이면 상태·버튼 모두 없음', async ({ page, browser }) => {
    const seller = await deviceThenHome(page, '출력 PC')
    await page.reload()
    await expect(bannerReconnect(page)).toBeVisible()

    const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
    const other = await ctx.newPage()
    try {
      // 같은 판매자의 다른 기기
      await loginAs(other, seller)
      await expect(printerStatus(other)).toHaveText('출력 멈춤 · 대기 0장')
      await expect(bannerReconnect(other)).toHaveCount(0)
      await printerStatus(other).click()
      await expect(other).toHaveURL(/\/labels$/)
      await expect(other.getByRole('heading', { name: '라벨', level: 1 })).toBeVisible()
    } finally {
      await ctx.close()
    }

    // 손으로 푸는 멈춤(판매자가 멈춤): 이 기기에서 다시 이은 뒤 "출력 멈추기"
    await bannerReconnect(page).click()
    await expect(printerStatus(page)).toHaveText('프린터 출력 PC · 연결됨 · 대기 0장')
    const paused = await postJson(page, '/api/print/pause', {})
    expect(paused.status).toBeLessThan(300)
    await expect(printerStatus(page)).toHaveText('출력 멈춤 · 대기 0장')
    await expect(bannerReconnect(page)).toHaveCount(0)
    await printerStatus(page).click()
    await expect(page).toHaveURL(/\/labels$/)
    await postJson(page, '/api/print/restart', {})

    // 라벨 꺼짐: 위 줄 프린터 상태와 버튼 모두 없음 (끊김 멈춤이어도)
    await page.goto('/')
    await expect(bannerReconnect(page)).toBeVisible()
    await setLabels(page, false)
    await expect(printerStatus(page)).toHaveCount(0)
    await expect(bannerReconnect(page)).toHaveCount(0)
    await setLabels(page, true)
  })

  test('AC-WIZ-04: 375×812 휴대폰 — 위 줄 "다시 연결"은 화면 위 35% 안, 누르는 곳 44px 이상, 한 번에 이어진다', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: baseURL ?? '', isMobile: true, hasTouch: true })
    const phone = await ctx.newPage()
    try {
      await deviceThenHome(phone, '휴대폰')
      await phone.reload()
      const button = bannerReconnect(phone)
      await expect(button).toBeVisible()
      const box = await button.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.y + box!.height).toBeLessThanOrEqual(812 * 0.35)
      const width = await phone.evaluate(() => document.documentElement.scrollWidth)
      expect(width).toBeLessThanOrEqual(375)
      const b = await broadcastApi(phone, uniqueDate())
      await makeLabels(phone, b, 1, 1)
      await expect(printerStatus(phone)).toHaveText('출력 멈춤 · 대기 1장')
      await button.tap()
      await waitPrinted(phone, 1)
      await expect(printerStatus(phone)).toHaveText('프린터 휴대폰 · 연결됨 · 대기 0장')
    } finally {
      await ctx.close()
    }
  })
})
