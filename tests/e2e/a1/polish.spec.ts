// A1 감사 마무리 화면 (AC-A1-20·21·22, D-A1-13~18) — test-e2e, 묶음 chromium-assist(@assist).
// 기대값은 acceptance.md·DECISIONS(D-A1-13~18)에서 정했다(구현을 보고 정하지 않음).
// 0.5초 누름 막기(D-A1-15)는 화면 안에서 제안 칸이 나타나는 순간 바로 누르는 탐침으로 시험한다 — 시험 쪽 지연과 상관없게.
import { expect, test, type Page } from '@playwright/test'
import {
  CONSENT,
  LIMIT,
  ON,
  READING,
  SOURCE_AI,
  SOURCE_RULE,
  SWITCH,
  assistWorld,
  chat,
  enableAssistApi,
  fakeLlm,
  fakeRequests,
  history,
  openReviews,
  reviewLine,
  waitReviews,
  type OptionItem,
} from './support.ts'

const LIMIT_UNKNOWN = '오늘 AI 제안을 다 썼어요. 비슷한 글자로 찾은 제안만 보여요.'
const OFF_STATE = '꺼져 있어요'
/** S / M(별칭 미디움) / L / XL — "혹시: XL?" 후보가 나오게 */
const SIZES_XL: OptionItem[] = [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['미디움'] }, { label: 'L' }, { label: 'XL' }] }]

const undoRegion = (page: Page) => page.getByRole('region', { name: '보내기 전 조치' })
const results = (page: Page) => page.getByRole('list', { name: '보낸 결과' })

interface Probe { elapsed: number; disabled: boolean[]; band: boolean; size: string | null }

/**
 * 화면 안 탐침: `${line}번째 줄 이대로 주문`이 처음 나타나는 순간(MutationObserver) [고치기]와 [이대로 주문]을 바로 누르고,
 * 두 화면 그림 뒤 되돌리기 띠가 생겼는지·사이즈 칸 값을 적어 둔다 → window.__probe.
 */
async function armProbe(page: Page, line: number): Promise<void> {
  await page.addInitScript((n: number) => {
    const w = window as unknown as { __probe?: unknown }
    const start = (): void => {
      const obs = new MutationObserver(() => {
        const accept = document.querySelector<HTMLButtonElement>(`button[aria-label="${String(n)}번째 줄 이대로 주문"]`)
        const edit = document.querySelector<HTMLButtonElement>(`button[aria-label="${String(n)}번째 줄 고치기"]`)
        if (accept === null || edit === null) return
        obs.disconnect()
        const t0 = performance.now()
        const disabled = [edit.disabled, accept.disabled]
        edit.click()
        accept.click()
        const elapsed = performance.now() - t0
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const region = document.querySelector('[aria-label="보내기 전 조치"]')
          const band = region !== null && [...region.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('되돌리기') || (b.getAttribute('aria-label') ?? '').includes('되돌리기'))
          const row = document.querySelector(`li[aria-label="${String(n)}번째 줄"]`)
          const size = [...(row?.querySelectorAll('label') ?? [])].find((l) => (l.textContent ?? '').trim().startsWith('사이즈'))?.querySelector('select')?.value ?? null
          w.__probe = { elapsed, disabled, band, size }
        }))
      })
      obs.observe(document, { childList: true, subtree: true })
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
    else start()
  }, line)
}

async function probeResult(page: Page): Promise<Probe> {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __probe?: unknown }).__probe !== undefined)).toBe(true)
  return await page.evaluate(() => (window as unknown as { __probe: Probe }).__probe)
}

test.beforeEach(async ({ request }) => {
  await fakeLlm(request, '/_fake/reset')
})

test('D-A1-13 @assist: 제안과 같은 선택지의 "혹시"만 숨긴다 — [고치기] 뒤에도, 다른 선택지 후보·제안 없는 줄은 O2 그대로', async ({ page, request }) => {
  const { b } = await assistWorld(page, { sizes: SIZES_XL })
  await enableAssistApi(page)
  await chat(page, b, '김철수', '반바지 미디엄') // 규칙 제안 M — "혹시: M?" 숨김
  await chat(page, b, '이영희', '반바지 XXL') // AI 제안 XL — "혹시: XL?" 숨김
  await chat(page, b, '박민수', '반바지 XS') // AI 제안 S — 후보 "혹시: S?"는 숨기고 다른 선택지 "혹시: XL?"는 남음
  await chat(page, b, '최지우', '반바지 XXl') // AI 제안 없음 — "혹시: XL?" 그대로
  await fakeLlm(request, '/_fake/answers', { text: '반바지 XXL', suggestion: { no: 21, options: { 사이즈: 'XL' }, qty: 1 } })
  await fakeLlm(request, '/_fake/answers', { text: '반바지 XS', suggestion: { no: 21, options: { 사이즈: 'S' }, qty: 1 } })
  await fakeLlm(request, '/_fake/answers', { text: '반바지 XXl', suggestion: null })
  const items = await waitReviews(page, b, true, 4)
  expect(items.map((x) => x.reason)).toEqual(['UNKNOWN_WORD', 'UNKNOWN_WORD', 'UNKNOWN_WORD', 'UNKNOWN_WORD'])
  await openReviews(page, b, true)
  await expect(page.getByText(READING)).toHaveCount(0)
  const [l1, l2, l3, l4] = [1, 2, 3, 4].map((n) => reviewLine(page, n))
  await expect(l1!.getByRole('group', { name: '1번째 줄 제안' })).toContainText('제안: 21번 반바지 M 1개')
  await expect(l2!.getByRole('group', { name: '2번째 줄 제안' })).toContainText('제안: 21번 반바지 XL 1개')
  await expect(l3!.getByRole('group', { name: '3번째 줄 제안' })).toContainText('제안: 21번 반바지 S 1개')
  await expect(l4!.getByRole('group', { name: '4번째 줄 제안' })).toHaveCount(0)
  await expect(l1!.getByRole('button', { name: '혹시: M?' })).toHaveCount(0)
  await expect(l2!.getByRole('button', { name: '혹시: XL?' })).toHaveCount(0)
  await expect(l3!.getByRole('button', { name: '혹시: XL?' })).toBeVisible()
  await expect(l3!.getByRole('button', { name: '혹시: S?' })).toHaveCount(0)
  await expect(l4!.getByRole('button', { name: '혹시: XL?' })).toBeVisible()
  // [고치기] 뒤에도 같은 값 후보는 숨긴 채
  await l1!.getByRole('button', { name: '1번째 줄 고치기' }).click()
  await expect(l1!.getByLabel('사이즈')).toHaveValue('M')
  await expect(l1!.getByRole('button', { name: '혹시: M?' })).toHaveCount(0)
  // AI 제안 칸은 막 나타났으니 0.5초 누름 막기(D-A1-15) — 눌릴 때까지 다시 누른다
  await expect(async () => {
    await l2!.getByRole('button', { name: '2번째 줄 고치기' }).click({ timeout: 1000 })
    await expect(l2!.getByLabel('사이즈')).toHaveValue('XL', { timeout: 300 })
  }).toPass({ timeout: 10_000 })
  await expect(l2!.getByRole('button', { name: '혹시: XL?' })).toHaveCount(0)
  // 다른 선택지 후보는 O2처럼 칸만 채운다
  await l3!.getByRole('button', { name: '혹시: XL?' }).click()
  await expect(l3!.getByLabel('사이즈')).toHaveValue('XL')
})

test('D-A1-13 @assist: AI가 꺼져 있으면 제안 없는 줄의 "혹시: M?"은 O2 그대로 — 규칙 제안이 붙은 같은 값 줄에서만 숨김', async ({ page }) => {
  const { b } = await assistWorld(page, { sizes: SIZES_XL })
  await chat(page, b, '최지우', '반바지 XXl')
  await chat(page, b, '김철수', '반바지 미디엄')
  await waitReviews(page, b, true, 2)
  await openReviews(page, b, true)
  await expect(reviewLine(page, 1).getByRole('button', { name: '혹시: XL?' })).toBeVisible()
  await expect(reviewLine(page, 2).getByRole('group', { name: '2번째 줄 제안' })).toContainText(SOURCE_RULE)
  await expect(reviewLine(page, 2).getByRole('button', { name: '혹시: M?' })).toHaveCount(0)
})

test('D-A1-14 @assist: [이대로 주문]의 띠·결과 끝에 "→ 21번 반바지 M 1개" — 칸으로 고른 "주문으로"는 그대로', async ({ page, request }) => {
  const { b, date } = await assistWorld(page)
  await enableAssistApi(page)
  await chat(page, b, '김철수', '반바지 미디엄')
  await chat(page, b, '이영희', '반바지')
  await fakeLlm(request, '/_fake/answers', { text: '반바지', suggestion: null })
  await waitReviews(page, b, true, 2)
  await openReviews(page, b, true)
  await expect(page.getByText(READING)).toHaveCount(0)
  await reviewLine(page, 1).getByRole('button', { name: '1번째 줄 이대로 주문' }).click()
  await expect(undoRegion(page)).toContainText('김철수 "반바지 미디엄" 주문으로 → 21번 반바지 M 1개')
  await expect(results(page).getByRole('status').filter({ hasText: '김철수' })).toContainText('김철수 · 반바지 미디엄 → 21번 반바지 M 1개 — 1등')
  await expect(undoRegion(page).getByRole('button', { name: /되돌리기/ })).toHaveCount(0)
  // 남은 줄(이영희)은 칸으로 직접 고른다 — 띠·결과에 "→"가 붙지 않는다
  const line = reviewLine(page, 1)
  await expect(line).toContainText('이영희')
  await line.getByLabel('사이즈').selectOption('L')
  await line.getByLabel('수량').fill('1')
  await line.getByRole('button', { name: '1번째 줄 주문으로' }).click()
  await expect(undoRegion(page)).toContainText('이영희 "반바지" 주문으로')
  await expect(undoRegion(page)).not.toContainText('→')
  const second = results(page).getByRole('status').filter({ hasText: '이영희' })
  await expect(second).toContainText('1등')
  await expect(second).not.toContainText('→')
  const resolved = (await history(page, date, true)).filter((e) => e.type === 'host.resolveReview')
  expect(resolved.map((e) => e.fields['options'])).toEqual([{ 사이즈: 'M' }, { 사이즈: 'L' }])
})

test('D-A1-14 @assist: 띠·결과의 제안 글은 이스케이프 — 상품 이름 <b>는 글자로', async ({ page }) => {
  const { b } = await assistWorld(page, { productName: '<b>반바지</b>' })
  await chat(page, b, '김철수', '<b>반바지</b> 미디엄')
  await waitReviews(page, b, true, 1)
  await openReviews(page, b, true)
  await reviewLine(page, 1).getByRole('button', { name: '1번째 줄 이대로 주문' }).click()
  await expect(undoRegion(page)).toContainText('→ 21번 <b>반바지</b> M 1개')
  await expect(undoRegion(page).locator('b')).toHaveCount(0)
  await expect(results(page)).toContainText('→ 21번 <b>반바지</b> M 1개 — 1등')
  await expect(results(page).locator('b')).toHaveCount(0)
})

test('D-A1-15 @assist: AI 제안 칸이 새로 나타난 순간 [고치기]·[이대로 주문]을 눌러도 아무 일도 없다(모양 그대로) — 조금 뒤엔 눌린다', async ({ page, request }) => {
  const { b, date } = await assistWorld(page)
  await enableAssistApi(page)
  await chat(page, b, '이영희', '반바지 엠사이즈') // 규칙으로 안 풀림 — AI 제안만
  await waitReviews(page, b, true, 1)
  await fakeLlm(request, '/_fake/answers', { text: '반바지 엠사이즈', suggestion: { no: 21, options: { 사이즈: 'M' }, qty: 1 } })
  await fakeLlm(request, '/_fake/fail', { kind: 'slow', delayMs: 1000 })
  await armProbe(page, 1)
  await openReviews(page, b, true)
  const probe = await probeResult(page)
  expect(probe.elapsed).toBeLessThan(500)
  expect(probe.disabled).toEqual([false, false]) // 모양(누를 수 있음)은 그대로
  expect(probe.band).toBe(false)
  expect(probe.size).toBe('')
  const line = reviewLine(page, 1)
  await expect(line.getByRole('group', { name: '1번째 줄 제안' })).toContainText(SOURCE_AI)
  await expect(line.getByLabel('사이즈')).toHaveValue('')
  await expect(undoRegion(page).getByRole('button', { name: /되돌리기/ })).toHaveCount(0)
  // 0.5초가 지나면 눌린다 — 시간을 재지 않고 눌릴 때까지 다시 누른다
  await expect(async () => {
    await line.getByRole('button', { name: '1번째 줄 이대로 주문' }).click({ timeout: 1000 })
    await expect(undoRegion(page)).toContainText('→ 21번 반바지 M 1개', { timeout: 300 })
  }).toPass({ timeout: 10_000 })
  await expect(results(page)).toContainText('이영희 · 반바지 엠사이즈 → 21번 반바지 M 1개 — 1등')
  const resolved = (await history(page, date, true)).filter((e) => e.type === 'host.resolveReview')
  expect(resolved).toHaveLength(1)
  expect(resolved[0]!.fields['options']).toEqual({ 사이즈: 'M' })
})

test('D-A1-15 @assist: 화면을 처음 열 때부터 있던 규칙 제안은 나타난 순간 눌러도 바로 눌린다', async ({ page }) => {
  const { b } = await assistWorld(page)
  await chat(page, b, '김철수', '반바지 미디엄')
  await waitReviews(page, b, true, 1)
  await armProbe(page, 1)
  await openReviews(page, b, true)
  const probe = await probeResult(page)
  expect(probe.elapsed).toBeLessThan(500)
  expect(probe.size).toBe('M') // [고치기]가 칸을 채웠다
  expect(probe.band).toBe(true) // [이대로 주문]이 띠를 띄웠다
  await expect(results(page)).toContainText('김철수 · 반바지 미디엄 → 21번 반바지 M 1개 — 1등')
})

test('D-A1-16 @assist: PC가 AI를 부르는 동안 휴대폰을 열면(진행 중) 몇 초 안에 휴대폰도 AI 제안을 본다 — 휴대폰은 다시 부르지 않는다', async ({ page, browser, request }) => {
  const { b } = await assistWorld(page)
  await enableAssistApi(page)
  await chat(page, b, '이영희', '반바지 엠사이즈')
  await waitReviews(page, b, true, 1)
  await fakeLlm(request, '/_fake/answers', { text: '반바지 엠사이즈', suggestion: { no: 21, options: { 사이즈: 'M' }, qty: 1 } })
  await fakeLlm(request, '/_fake/fail', { kind: 'slow', delayMs: 1800 })
  const state = await page.context().storageState()
  const phoneCtx = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 } })
  try {
    const phone = await phoneCtx.newPage()
    const phonePosts: string[] = []
    const phoneLists: string[] = []
    phone.on('request', (r) => {
      const path = new URL(r.url()).pathname
      if (r.method() === 'POST' && path === '/api/assist/suggest') phonePosts.push(r.url())
      if (r.method() === 'GET' && path === '/api/reviews') phoneLists.push(r.url())
    })
    await phone.goto('/settings') // 화면 파일을 미리 받아 둔다
    await expect(phone.getByRole('heading', { level: 1 })).toBeVisible()
    const pcAsks = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/assist/suggest')
    await openReviews(page, b, true)
    await pcAsks // PC가 부르는 중 (가짜 AI 1.8초 — 서버 시간 제한 2초 안)
    const busy = phone.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/assist/suggest')
    await openReviews(phone, b, true)
    expect(((await (await busy).json()) as { result: string }).result).toBe('BUSY')
    // 16초 한 번이 아니라 짧은 간격으로 다시 읽는다 — PC 답(1.8초) 뒤 몇 초 안에
    await expect(reviewLine(phone, 1).getByRole('group', { name: '1번째 줄 제안' })).toContainText(SOURCE_AI, { timeout: 9_000 })
    await expect(reviewLine(page, 1).getByRole('group', { name: '1번째 줄 제안' })).toContainText(SOURCE_AI)
    await expect(phone.getByText(READING)).toHaveCount(0)
    expect(phonePosts).toHaveLength(1)
    expect(phoneLists.length).toBeGreaterThanOrEqual(2)
    expect(await fakeRequests(request)).toHaveLength(1)
  } finally {
    await phoneCtx.close()
  }
})

test('D-A1-17 @assist: 상한에 닿았는데 설정을 읽지 못하면 "오늘 AI 제안을 다 썼어요. 비슷한 글자로 찾은 제안만 보여요." — "하루 0번" 없음', async ({ page, request }) => {
  const { b } = await assistWorld(page)
  await enableAssistApi(page)
  await chat(page, b, '김철수', '반바지 미디엄')
  const words = ['반바지 엠사이즈', '반바지 큰거요', '반바지 작은거']
  for (const [i, text] of words.entries()) {
    await chat(page, b, `시청자${String(i)}`, text)
    await waitReviews(page, b, true, i + 2)
    await openReviews(page, b, true)
    await expect.poll(async () => (await fakeRequests(request)).length).toBe(i + 1)
    await expect(page.getByText(READING)).toHaveCount(0)
  }
  await chat(page, b, '시청자9', '반바지 중간거')
  await waitReviews(page, b, true, 5)
  await page.route('**/api/assist/settings', (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 500, body: '{}' }) : route.fallback()))
  await openReviews(page, b, true)
  await expect(page.getByRole('status').filter({ hasText: LIMIT_UNKNOWN })).toHaveText(LIMIT_UNKNOWN)
  await expect(page.locator('main')).not.toContainText('하루 0번')
  await expect(page.locator('main')).not.toContainText(LIMIT(0))
  expect(await fakeRequests(request)).toHaveLength(3)
  await expect(reviewLine(page, 1).getByRole('group', { name: '1번째 줄 제안' })).toContainText(SOURCE_RULE)
})

test('D-A1-18 @assist: 설정 꺼짐 — 상태 글 "꺼져 있어요"와 스위치의 보이는 글 [켜기](이름은 "AI 제안 받기"), 켜면 [끄기], 끄면 다시 "꺼져 있어요"', async ({ page }) => {
  await assistWorld(page)
  await page.goto('/settings')
  const region = page.getByRole('region', { name: 'AI 제안' })
  await expect(region.getByText(OFF_STATE, { exact: true })).toBeVisible()
  const sw = region.getByRole('switch', { name: SWITCH })
  await expect(sw).toHaveText('켜기')
  await expect(region).not.toContainText('꺼짐')
  await expect(sw).toBeDisabled()
  await region.getByLabel(CONSENT).check()
  await sw.click()
  await expect(region.getByRole('status')).toHaveText(ON(0, 3))
  await expect(region.getByText(OFF_STATE, { exact: true })).toHaveCount(0)
  await region.getByRole('button', { name: '끄기' }).click()
  await expect(region.getByText(OFF_STATE, { exact: true })).toBeVisible()
  await expect(region.getByRole('switch', { name: SWITCH })).toHaveText('켜기')
  await expect(region).not.toContainText('꺼짐')
})
