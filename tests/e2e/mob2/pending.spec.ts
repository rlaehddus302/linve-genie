// MOB2 E. 시간이 지난 보류 찜 (AC-MOB2-30~33, D-MOB2-06, UX-04, R-5) — test-e2e.
// 공통 Given: claim.preOpenWindowSec = 30(기본), 등록 안 한 번호 31로 문자찜(이름 "문자찜(김씨)"), 들어온 시각 t0 = 찜의 at(서버 도착 시각, D-052).
// 시계: 화면 시계는 page.clock으로 당긴다(t0 + 30초 정각·t0 + 31초). 서버 시계는 당길 수 없어 엔진 만료(AC-MOB2-33)는 실제로 31초를 기다린다.
// AC-MOB2-31의 "t0 + 20초"는 실제 두 찜의 at 차이(몇 초)로 바꿔 같은 경계를 본다 — 화면 시계를 각 찜의 at + 30초 + 1ms에 둔다.
import { expect, test, type Browser, type Page } from '@playwright/test'
import { uniqueDate } from '../s05/support.ts'
import { smsApi, smsUi, writeEvent } from '../s06/support.ts'
import { PC, alerts, broadcastApi, freshSeller } from '../mob1/support.ts'
import { TIMED_OUT_TAIL, TIMED_OUT_WORD, openSmsSole } from './support.ts'

interface ClaimView { id: string; no: number; at: string; status: string; reason?: string | null; origin: string }

async function claimsOf(page: Page, date: string): Promise<ClaimView[]> {
  const res = await page.request.get(`/api/days/${date}`)
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as { claims: ClaimView[] }).claims
}

async function atOf(page: Page, date: string, no: number): Promise<number> {
  const claim = (await claimsOf(page, date)).find((c) => c.no === no)
  expect(claim?.at, `번호 ${String(no)} 찜`).toBeTruthy()
  return Date.parse(claim!.at)
}

async function seller(browser: Browser, baseURL: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const { page, context } = await freshSeller(browser, baseURL, { viewport: PC })
  return { page, close: () => context.close() }
}

/** 화면 시계를 단다 (시간은 흐르다가 pauseAt에서 멈춘다). 바뀌는 때를 재는 타이머는 찜이 들어온 뒤에 걸리므로 그대로 당겨진다 */
async function clock(page: Page): Promise<void> {
  await page.clock.install()
}

const recentRow = (page: Page, no: number) => page.getByRole('region', { name: '최근 넣은 문자찜' }).getByRole('listitem').filter({ hasText: `${String(no)}번` }).first()
const resultCard = (page: Page) => page.getByRole('region', { name: '넣은 결과' })

test.describe('AC-MOB2-30 낱말 — 문자찜 화면', () => {
  test('t0 + 30초 정각은 "보류", t0 + 31초에 최근 넣은 문자찜 줄 "보류 · 시간 지남"·결과 카드 끝 " — 지금 등록해도 판정되지 않아요", "만료" 없음', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!)
    try {
      const date = uniqueDate()
      const title = `보류시간${String(Math.floor(Math.random() * 1e6))}`
      await broadcastApi(s.page, date, false, title)
      await openSmsSole(s.page, title)
      await clock(s.page)
      await smsUi(s.page, { no: 31, memo: '김씨' })
      const t0 = await atOf(s.page, date, 31)
      const row = recentRow(s.page, 31)
      await expect(row).toContainText('문자찜(김씨)')
      // 경계 정각: 아직 유효
      await s.page.clock.pauseAt(t0 + 30_000)
      await expect(row.locator('.tag').first()).toHaveText('보류')
      await expect(resultCard(s.page)).toContainText('31번 · 문자찜(김씨) · 보류 · 받은 시각')
      await expect(resultCard(s.page)).not.toContainText('시간 지남')
      // 1초 넘김 → 1초 안에 바뀐다 (다시 그리는 때가 at + 30초 + 1ms)
      await s.page.clock.fastForward(1_000)
      await expect(row.locator('.tag').first()).toHaveText(TIMED_OUT_WORD, { timeout: 1_000 })
      await expect(row).not.toContainText('만료')
      const card = resultCard(s.page).locator('strong').first()
      await expect(card).toContainText(`31번 · 문자찜(김씨) · ${TIMED_OUT_WORD} · 받은 시각`)
      expect((await card.innerText()).endsWith(TIMED_OUT_TAIL.trim()), `결과 카드 끝: ${await card.innerText()}`).toBe(true)
      await expect(card).toContainText(TIMED_OUT_TAIL.trim())
    } finally {
      await s.close()
    }
  })

  test('번호 31을 공개 전(READY)으로 등록한 상품의 보류 찜 — 상품 자세히 "보류·충돌 찜" 줄도 같은 규칙', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!)
    try {
      const date = uniqueDate()
      const b = await broadcastApi(s.page, date, false)
      const reg = await writeEvent(s.page, { type: 'product.register', b, no: 31, name: '라울', price: 7000, status: 'READY' })
      expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
      await smsApi(s.page, { b, no: 31, memo: '김씨' })
      const t0 = await atOf(s.page, date, 31)
      await clock(s.page)
      await s.page.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(s.page.getByLabel('빠른 입력')).toBeVisible()
      await s.page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^31번 / }).click()
      const detail = s.page.getByRole('dialog', { name: '31번 자세히' })
      const row = detail.locator('li.claim-row').filter({ hasText: '문자찜(김씨)' })
      await s.page.clock.pauseAt(t0 + 30_000)
      await expect(row.locator('.tag').first()).toHaveText('보류')
      await s.page.clock.fastForward(1_000)
      await expect(row.locator('.tag').first()).toHaveText(TIMED_OUT_WORD, { timeout: 1_000 })
    } finally {
      await s.close()
    }
  })
})

test.describe('AC-MOB2-31·32 알림 띠 수·보류 찜 창', () => {
  test('31번(t0)·32번(t1 > t0) — t0 + 31초: "보류 찜 1"(32번만), 창 위 32번·아래 "시간이 지난 보류 찜" "31번 1개"; t1 + 31초: 칩 없음 "알림 없음", Alt+1도 열지 않음', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!)
    try {
      const date = uniqueDate()
      const b = await broadcastApi(s.page, date, false)
      await smsApi(s.page, { b, no: 31, memo: '김씨' })
      const t0 = await atOf(s.page, date, 31)
      // 32번은 t0보다 1.5초 넘게 뒤 (화면이 다시 그리는 때는 at + 30초 + 1ms에서 수 ms 늦을 수 있어 시계를 +200ms에 둔다)
      await expect.poll(() => Date.now(), { intervals: [250] }).toBeGreaterThan(t0 + 1_500)
      await smsApi(s.page, { b, no: 32, memo: '박씨' })
      const t1 = await atOf(s.page, date, 32)
      expect(t1).toBeGreaterThan(t0 + 1_000)
      await clock(s.page)
      await s.page.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(s.page.getByLabel('빠른 입력')).toBeVisible()
      const strip = alerts(s.page)
      await expect(strip.getByRole('button', { name: '보류 찜 2', exact: true })).toBeVisible()
      // t0 + 30초 + 1ms(+ 다시 그리는 틈 200ms): 31번만 시간 지남
      await s.page.clock.pauseAt(t0 + 30_201)
      await expect(strip.getByRole('button', { name: '보류 찜 1', exact: true })).toBeVisible({ timeout: 1_000 })
      await strip.getByRole('button', { name: '보류 찜 1', exact: true }).click()
      const dlg = s.page.getByRole('dialog', { name: '보류 찜' })
      await expect(dlg).toBeVisible()
      const live = dlg.getByRole('listitem').filter({ hasText: '32번' }).first()
      await expect(live.getByRole('button', { name: /번호 넣기/ })).toBeVisible()
      const old = dlg.getByRole('region', { name: '시간이 지난 보류 찜' })
      await expect(old.getByRole('heading', { name: '시간이 지난 보류 찜' })).toBeVisible()
      await expect(old.getByRole('listitem')).toHaveText(['31번 1개'])
      await expect(old.getByRole('button', { name: /번호 넣기/ })).toHaveCount(0)
      // "최근 만료된 찜"은 지금 그대로 (엔진 만료 없음)
      await expect(dlg.getByText('최근 만료된 찜', { exact: true })).toBeVisible()
      await dlg.getByRole('button', { name: '닫기' }).click()
      // 32번도 지남 → 칩 없음, 알림 없음
      await s.page.clock.fastForward(t1 - t0 + 1)
      await expect(strip.getByRole('button', { name: /^보류 찜/, includeHidden: true })).toHaveCount(0, { timeout: 1_000 })
      await expect(strip.getByText('알림 없음')).toBeVisible()
      // Alt+1도 보류 찜 창을 열지 않는다
      await s.page.getByLabel('빠른 입력').focus()
      await s.page.keyboard.press('Alt+1')
      await expect(s.page.getByRole('dialog', { name: '보류 찜' })).toHaveCount(0)
    } finally {
      await s.close()
    }
  })
})

test.describe('AC-MOB2-33 판정은 그대로', () => {
  test('t0 + 31초(실제)에 31번 등록 → 엔진 REJECTED(EXPIRED), 화면 낱말 "만료"', async ({ browser, baseURL }) => {
    test.setTimeout(120_000)
    const s = await seller(browser, baseURL!)
    try {
      const date = uniqueDate()
      const title = `만료${String(Math.floor(Math.random() * 1e6))}`
      const b = await broadcastApi(s.page, date, false, title)
      await openSmsSole(s.page, title)
      await clock(s.page)
      await smsUi(s.page, { no: 31, memo: '김씨' })
      const t0 = await atOf(s.page, date, 31)
      const row = recentRow(s.page, 31)
      await expect(row.locator('.tag').first()).toHaveText(TIMED_OUT_WORD, { timeout: 40_000 })
      // 서버 시계로 31초가 지날 때까지 (서버 도착 시각 기준 — 상태를 기다린다)
      await expect.poll(() => Date.now() - t0, { timeout: 40_000, intervals: [1_000] }).toBeGreaterThan(31_000)
      const reg = await writeEvent(s.page, { type: 'product.register', b, no: 31, name: '라울', price: 7000 })
      expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
      await expect.poll(async () => (await claimsOf(s.page, date)).find((c) => c.no === 31)?.status).toBe('REJECTED')
      expect((await claimsOf(s.page, date)).find((c) => c.no === 31)?.reason).toBe('EXPIRED')
      await expect(row.locator('.tag').first()).toHaveText('만료')
    } finally {
      await s.close()
    }
  })

  test('창 안(화면 시계 t0 + 29초 "보류")에 등록 → 1등', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!)
    try {
      const date = uniqueDate()
      const title = `안${String(Math.floor(Math.random() * 1e6))}`
      const b = await broadcastApi(s.page, date, false, title)
      await openSmsSole(s.page, title)
      await clock(s.page)
      await smsUi(s.page, { no: 31, memo: '김씨' })
      const t0 = await atOf(s.page, date, 31)
      await s.page.clock.pauseAt(t0 + 29_000)
      const row = recentRow(s.page, 31)
      await expect(row.locator('.tag').first()).toHaveText('보류')
      const reg = await writeEvent(s.page, { type: 'product.register', b, no: 31, name: '라울', price: 7000 })
      expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
      await expect.poll(async () => (await claimsOf(s.page, date)).find((c) => c.no === 31)?.status).toBe('CONFIRMED')
      await expect(row.locator('.tag').first()).toHaveText('1등')
    } finally {
      await s.close()
    }
  })
})
