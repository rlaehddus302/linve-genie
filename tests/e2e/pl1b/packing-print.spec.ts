// PL1B 포장 모드 "포장 라벨 출력" (SPEC STL-08·LBL-02·RCP-01, D-PL1-05) — test-e2e.
// AC-PL1B-15(시험용 프린터로 2장), AC-PL1B-10·11(같은 줄·보통 버튼·누를 때만·누를 때마다 새 requestId·미리 보기 받는 중에도),
// AC-PL1B-12(다른 기기에서 끄면 1초 안에 칸 전체 안내·그림 요청 없음, 켜면 돌아옴), 깨뜨리기: 응답이 끊겨 다시 보내도 작업이 두 배가 되지 않는다.
// 기대 문장은 acceptance.md 따옴표 그대로. 출력 확인은 I1 E2E 방법(다른 컨텍스트를 출력 기기로 + window.livejjimTestPrinter).
// 출력 기록은 판매자 단위라 끝에 cleanupN4a(라벨 켬 + I1 정리)를 부른다.
import { expect, test, type Page, type Request, type Response } from '@playwright/test'
import {
  OFF_NOTE,
  becomeDevice,
  checklistOf,
  cleanupN4a,
  cleanupPrint,
  login,
  packingDay,
  primaryOutsideDialogs,
  printOverview,
  setLabels,
  waitPrinted,
} from './support.ts'

test.afterEach(async ({ page }) => {
  await cleanupN4a(page)
})

const PRINT = '포장 라벨 출력'

/** 포장 라벨 출력 요청 본문을 모은다 */
function recordPackingPrints(page: Page): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  page.on('request', (req: Request) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/print/packing') out.push(JSON.parse(req.postData() ?? '{}') as Record<string, unknown>)
  })
  return out
}

async function jobsOf(res: Response): Promise<{ id: string; kind: string }[]> {
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as { jobs: { id: string; kind: string }[] }).jobs
}

/** 대기열(출력 전)의 이 날짜 포장 라벨 작업 수 — 출력 기기가 없을 때만 쓴다 (출력된 작업은 대기열에 없다) */
async function packingJobs(page: Page, date: string): Promise<number> {
  const ov = await printOverview(page)
  return ov.jobs.filter((j) => j.kind === 'packing' && j.date === date).length
}

test('AC-PL1B-15·10·11: 품목 12개(2쪽) — 체크·포장 완료로는 출력 안 함, 누르면 "포장 라벨 2장 출력을 접수했어요."·시험용 프린터 2장, 두 번째 누름은 새 requestId·2장 더', async ({ page, browser }) => {
  await login(page)
  // 앞 시험(I2 등)이 남긴 대기 작업이 있으면 출력 기기가 될 때 "밀린 출력" 멈춤으로 시작한다(L-11) — 먼저 비운다
  await cleanupPrint(page)
  const { date, buyer } = await packingDay(page, 12, '010-4100-0001')
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
  const station = await ctx.newPage()
  try {
    await login(station)
    await becomeDevice(station, '포장 스테이션')
    expect(await packingJobs(page, date), '전제: 이 날짜 포장 라벨 작업 없음').toBe(0)

    await page.setViewportSize({ width: 375, height: 812 })
    const sent = recordPackingPrints(page)
    await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(buyer)}`)
    const label = page.getByRole('region', { name: '포장 라벨' })
    await expect(label.getByRole('img', { name: '포장 라벨 2/2쪽' })).toBeVisible()
    const print = label.getByRole('button', { name: PRINT, exact: true })
    await expect(print).toHaveCount(1)
    await expect(print).toBeEnabled()
    // "라벨 PDF"와 같은 줄(같은 부모) — 주 버튼이 아니다(주 버튼은 체크리스트의 "포장 완료")
    const pdf = label.getByRole('button', { name: '라벨 PDF' })
    expect(await print.evaluate((el, other) => el.parentElement === other?.parentElement, await pdf.elementHandle())).toBe(true)
    expect(await primaryOutsideDialogs(page)).not.toContain(PRINT)

    // 체크를 모두 하고 포장 완료 → 출력 요청 없음 (AC-PL1B-11)
    const cl = checklistOf(page)
    for (let no = 1; no <= 12; no += 1) await cl.getByRole('checkbox', { name: `${String(no)}번 품종${String(no)}`, exact: true }).click()
    await cl.getByRole('button', { name: '포장 완료', exact: true }).click()
    await expect(cl.getByText('포장 완료로 적었어요.')).toBeVisible()
    expect(sent).toEqual([])
    expect(await packingJobs(page, date)).toBe(0)
    expect(await station.evaluate(() => (window as unknown as { livejjimTestPrinter: { printedCount(): number } }).livejjimTestPrinter.printedCount())).toBe(0)

    // 누름 → 요청 하나 { requestId, date, buyer }, 문장, 대기열 작업 2개, 시험용 프린터 2장
    const first = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/print/packing' && r.request().method() === 'POST')
    await print.click()
    const firstJobs = await jobsOf(await first)
    await expect(label.getByRole('status').filter({ hasText: '출력을 접수했어요' })).toHaveText('포장 라벨 2장 출력을 접수했어요.')
    expect(firstJobs.map((j) => j.kind)).toEqual(['packing', 'packing'])
    expect(sent).toHaveLength(1)
    expect(Object.keys(sent[0]!).sort()).toEqual(['buyer', 'date', 'requestId'])
    expect(sent[0]).toMatchObject({ date, buyer })
    expect(typeof sent[0]!['requestId']).toBe('string')
    await waitPrinted(station, 2)

    // 첫 응답 뒤 한 번 더 → 요청 둘, 서로 다른 requestId, 2장 더
    await expect(print).toBeEnabled()
    const second = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/print/packing' && r.request().method() === 'POST')
    await print.click()
    const secondJobs = await jobsOf(await second)
    expect(secondJobs.map((j) => j.kind)).toEqual(['packing', 'packing'])
    expect(secondJobs.filter((j) => firstJobs.some((f) => f.id === j.id)), '새 작업 둘').toEqual([])
    expect(sent).toHaveLength(2)
    expect(sent[1]!['requestId']).not.toBe(sent[0]!['requestId'])
    await expect(label.getByRole('status').filter({ hasText: '출력을 접수했어요' })).toHaveText('포장 라벨 2장 출력을 접수했어요.')
    await waitPrinted(station, 4)
  } finally {
    await ctx.close()
  }
})

test('AC-PL1B-12·15: 다른 기기에서 라벨을 끄면 1초 안에 칸 전체가 "라벨 쓰지 않음" — 다시 열어도 그림 요청 없음, 켜면 1초 안에 돌아옴, 체크리스트는 그대로', async ({ page }) => {
  await login(page)
  const { date, buyer } = await packingDay(page, 12, '010-4100-0002')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(buyer)}`)
  const label = page.getByRole('region', { name: '포장 라벨' })
  await expect(label.getByRole('button', { name: PRINT, exact: true })).toBeVisible()

  // 다른 기기(API)에서 끔 → 1초 안
  await setLabels(page, false)
  await expect(label.getByText(OFF_NOTE, { exact: true })).toBeVisible({ timeout: 1_000 })
  await expect(label.getByRole('button')).toHaveCount(0)
  await expect(label.getByRole('img')).toHaveCount(0)
  await expect(checklistOf(page).getByRole('button', { name: '포장 완료', exact: true })).toBeVisible()

  // 꺼진 채 다시 열기 → 같은 안내, 포장 라벨 그림 요청(packing-label·.png) 없음
  const pictures: string[] = []
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname
    if (path.includes('packing-label') || path.endsWith('.png')) pictures.push(path)
  })
  await page.reload()
  await expect(label.getByText(OFF_NOTE, { exact: true })).toBeVisible()
  await expect(label.getByRole('button', { name: /포장 라벨 출력|라벨 PDF|그림 저장/ })).toHaveCount(0)
  await expect(checklistOf(page).getByRole('checkbox', { name: '1번 품종1', exact: true })).toBeVisible()
  expect(pictures).toEqual([])

  // 다른 기기에서 켬 → 1초 안에 칸이 돌아온다
  await setLabels(page, true)
  await expect(label.getByRole('button', { name: PRINT, exact: true })).toBeVisible({ timeout: 1_000 })
  await expect(label.getByText(OFF_NOTE, { exact: true })).toHaveCount(0)
  await expect(label.getByRole('img', { name: '포장 라벨 1/2쪽' })).toBeVisible()
})

test('AC-PL1B-10 깨뜨리기: 출력 요청이 서버에 닿은 뒤 응답이 끊김 → 같은 requestId로 다시 보내 작업 2개(두 배 아님), 출력 기기 없어도 같은 성공 문장', async ({ page }) => {
  await login(page)
  const { date, buyer } = await packingDay(page, 12, '010-4100-0003')
  const ids: string[] = []
  let cut = 0
  await page.route((url) => url.pathname === '/api/print/packing', async (route) => {
    if (route.request().method() !== 'POST') return await route.continue()
    ids.push((JSON.parse(route.request().postData() ?? '{}') as { requestId: string }).requestId)
    if (cut === 0) {
      cut += 1
      // 서버는 받아 처리했지만 응답이 오는 길에 끊김
      await route.fetch()
      return await route.abort('connectionreset')
    }
    return await route.continue()
  })
  await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(buyer)}`)
  const label = page.getByRole('region', { name: '포장 라벨' })
  await label.getByRole('button', { name: PRINT, exact: true }).click()
  await expect(label.getByRole('status').filter({ hasText: '출력을 접수했어요' })).toHaveText('포장 라벨 2장 출력을 접수했어요.')
  expect(ids.length).toBeGreaterThanOrEqual(2)
  expect(new Set(ids).size, '다시 보낼 때는 같은 requestId').toBe(1)
  expect(await packingJobs(page, date)).toBe(2)
})

test('AC-PL1B-11: 포장 라벨 그림을 받는 중에도 누를 수 있고 서버가 지금 묶음으로 만든다(화면 그림을 보내지 않음)', async ({ page }) => {
  await login(page)
  const { date, buyer } = await packingDay(page, 1, '010-4100-0004')
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route((url) => url.pathname.includes('packing-label'), async (route) => {
    await held
    await route.continue()
  })
  const sent = recordPackingPrints(page)
  try {
    await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(buyer)}`)
    const label = page.getByRole('region', { name: '포장 라벨' })
    const print = label.getByRole('button', { name: PRINT, exact: true })
    await expect(print).toBeEnabled()
    await print.click()
    await expect(label.getByRole('status').filter({ hasText: '출력을 접수했어요' })).toHaveText('포장 라벨 1장 출력을 접수했어요.')
    expect(sent).toHaveLength(1)
    expect(Object.keys(sent[0]!).sort()).toEqual(['buyer', 'date', 'requestId'])
    expect(await packingJobs(page, date)).toBe(1)
  } finally {
    release()
  }
})

test('AC-PL1B-12: 라벨 켬/끔을 모르는 동안(출력 상태를 받는 중) "포장 라벨 출력"이 없고, 알게 되면 나타난다', async ({ page }) => {
  await login(page)
  const { date, buyer } = await packingDay(page, 1, '010-4100-0005')
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let heldCount = 0
  await page.route((url) => url.pathname === '/api/print' || url.pathname === '/api/settings/labels', async (route) => {
    if (route.request().method() !== 'GET') return await route.continue()
    heldCount += 1
    await held
    await route.continue()
  })
  try {
    await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(buyer)}`)
    const label = page.getByRole('region', { name: '포장 라벨' })
    await expect(checklistOf(page).getByRole('checkbox', { name: '1번 품종1', exact: true })).toBeVisible()
    await expect(label).toBeVisible()
    await expect.poll(() => heldCount).toBeGreaterThan(0)
    await expect(label.getByRole('button', { name: PRINT, exact: true })).toHaveCount(0)
    release()
    await expect(label.getByRole('button', { name: PRINT, exact: true })).toBeVisible()
  } finally {
    release()
  }
})

test('AC-PL1B-10 깨뜨리기: 마구 누름(두 번 탭) → 보내는 동안 잠겨 요청 하나·작업 1개, 대기 중에 또 누르면 서버 거절 문장 그대로', async ({ page }) => {
  await login(page)
  const { date, buyer } = await packingDay(page, 1, '010-4100-0006')
  const sent = recordPackingPrints(page)
  await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(buyer)}`)
  const label = page.getByRole('region', { name: '포장 라벨' })
  const print = label.getByRole('button', { name: PRINT, exact: true })
  await expect(print).toBeEnabled()
  await print.dblclick()
  await expect(label.getByRole('status').filter({ hasText: '출력을 접수했어요' })).toHaveText('포장 라벨 1장 출력을 접수했어요.')
  await expect(print).toBeEnabled()
  expect(sent).toHaveLength(1)
  expect(await packingJobs(page, date)).toBe(1)
  // 출력 기기가 없어 그 작업이 아직 대기 중 — 다시 누르면 서버 거절(I1 PRINT_IN_PROGRESS)이 서버 문장 그대로, 작업은 그대로 1개
  await print.click()
  await expect.poll(() => sent.length).toBe(2)
  expect(sent[1]!['requestId']).not.toBe(sent[0]!['requestId'])
  await expect(label.getByText('이 라벨은 이미 출력을 기다리고 있어요.')).toBeVisible()
  await expect(label.getByRole('status').filter({ hasText: '출력을 접수했어요' })).toHaveCount(0)
  await expect(print).toBeEnabled()
  expect(await packingJobs(page, date)).toBe(1)
})
