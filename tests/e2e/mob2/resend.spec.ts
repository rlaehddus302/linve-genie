// MOB2 F. 연결이 돌아오면 다시 보내기 (AC-MOB2-40~44·47, D-MOB2-07, UX-06) — test-e2e.
// "끊김" = context.setOffline(true)(쓰기 요청이 네트워크 실패 + 실시간 연결 끊김). "돌아옴" = setOffline(false) 뒤 "실시간 연결이 끊겼어요" 안내가 사라짐.
// 보낸 쓰기는 브라우저 요청 사건(request)으로 모은다 — 끊김 중 실패한 것도 사건은 생긴다. 요청 번호(requestId)는 본문에서 읽는다.
import { expect, test, type Browser, type Page, type Request } from '@playwright/test'
import { boardItem, history, uniqueDate } from '../s05/support.ts'
import { smsApi, smsField, writeEvent } from '../s06/support.ts'
import { PC, PHONE, broadcastApi, freshSeller } from '../mob1/support.ts'
import { AUTO_RESEND_NOTE, LOST_NOTICE, RESENT_PREFIX, blockWrites, isWrite, openSmsSole, vacatedEmpty } from './support.ts'

interface Sent {
  readonly requestId: string
  readonly type: string
  readonly no: number | null
  readonly at: number
  done: number | null
}

/** 이 화면의 쓰기 요청을 모은다 (응답·실패 시각도) */
function watchWrites(page: Page): Sent[] {
  const list: Sent[] = []
  const byReq = new Map<Request, Sent>()
  page.on('request', (r) => {
    if (!isWrite(r)) return
    let body: Record<string, unknown>
    try {
      body = JSON.parse(r.postData() ?? '{}') as Record<string, unknown>
    } catch {
      body = {}
    }
    const item: Sent = { requestId: String(body['requestId']), type: String(body['type']), no: typeof body['no'] === 'number' ? body['no'] : null, at: Date.now(), done: null }
    list.push(item)
    byReq.set(r, item)
  })
  const finish = (r: Request) => {
    const item = byReq.get(r)
    if (item !== undefined) item.done = Date.now()
  }
  page.on('requestfinished', finish)
  page.on('requestfailed', finish)
  return list
}

async function seller(browser: Browser, baseURL: string, viewport: { width: number; height: number }): Promise<{ page: Page; close: () => Promise<void> }> {
  const { page, context } = await freshSeller(browser, baseURL, { viewport, touch: viewport.width < 768 })
  return { page, close: () => context.close() }
}

async function goOffline(page: Page): Promise<void> {
  await page.context().setOffline(true)
  await expect(page.getByText(LOST_NOTICE)).toBeVisible({ timeout: 20_000 })
}

/** 돌아옴: 끊김 안내가 사라진 시각 */
async function comeBack(page: Page): Promise<number> {
  await page.context().setOffline(false)
  await expect(page.getByText(LOST_NOTICE)).toHaveCount(0, { timeout: 20_000 })
  return Date.now()
}

const bar = (page: Page) => page.getByRole('region', { name: '보내기 전 조치' })

async function openConsole(page: Page, b: string): Promise<void> {
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeVisible()
}

for (const [label, viewport] of [['375×812', PHONE], ['1440×900', PC]] as const) {
  test.describe(`AC-MOB2-40${viewport === PC ? '·47' : ''} 빠른 입력 등록 — ${label}`, () => {
    test('끊김 중 "15 핑크프릴 10000" 실패 → 안내 두 줄 → 돌아오면 누르지 않아도 5초 안에 같은 요청 번호로 한 번, "연결이 돌아와 보냈어요: 15번을 등록했어요"', async ({ browser, baseURL }) => {
      const s = await seller(browser, baseURL!, viewport)
      try {
        const date = uniqueDate()
        const b = await broadcastApi(s.page, date, false)
        await openConsole(s.page, b)
        const sent = watchWrites(s.page)
        await goOffline(s.page)
        const input = s.page.getByLabel('빠른 입력')
        await input.fill('15 핑크프릴 10000')
        await input.press('Enter')
        await expect(s.page.getByText('저장하지 못했어요. 다시 보내기를 눌러 주세요: 15 핑크프릴 10000', { exact: true })).toBeVisible({ timeout: 20_000 })
        await expect(s.page.getByText(AUTO_RESEND_NOTE, { exact: true }).first()).toBeVisible()
        const first = sent.filter((x) => x.type === 'product.register')
        expect(first.length, '끊김 중 보낸 등록 요청').toBeGreaterThan(0)
        const id = first[0]!.requestId
        expect(new Set(first.map((x) => x.requestId)), '끊김 중 재시도도 같은 요청 번호').toEqual(new Set([id]))
        const before = sent.length
        const back = await comeBack(s.page)
        await expect(boardItem(s.page, 15)).toBeVisible({ timeout: 5_000 })
        expect(Date.now() - back, '돌아온 뒤 5초 안').toBeLessThanOrEqual(5_500)
        const after = sent.slice(before).filter((x) => x.type === 'product.register')
        expect(after.map((x) => x.requestId), '돌아온 뒤 등록 요청 — 처음 요청 번호 그대로 한 번').toEqual([id])
        await expect(bar(s.page).getByRole('status').filter({ hasText: '15번을 등록했어요' })).toHaveText(`${RESENT_PREFIX}15번을 등록했어요`)
        await expect(bar(s.page).getByRole('button', { name: '15번 등록 되돌리기' })).toBeVisible()
        await expect(s.page.getByText(/저장하지 못했어요\. 다시 보내기를 눌러 주세요/)).toHaveCount(0)
        expect((await history(s.page, date, false)).filter((e) => e.type === 'product.register')).toHaveLength(1)
      } finally {
        await s.close()
      }
    })
  })
}

test.describe('AC-MOB2-40 두 줄 차례', () => {
  test('끊김 중 15·16 두 줄 실패 → 돌아오면 15 → 16 하나씩(16 요청은 15 응답 뒤), 각각 한 번', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    try {
      const date = uniqueDate()
      const b = await broadcastApi(s.page, date, false)
      await openConsole(s.page, b)
      const sent = watchWrites(s.page)
      await goOffline(s.page)
      const input = s.page.getByLabel('빠른 입력')
      await input.fill('15 핑크프릴 10000')
      await input.press('Enter')
      await expect(s.page.getByText('저장하지 못했어요. 다시 보내기를 눌러 주세요: 15 핑크프릴 10000', { exact: true })).toBeVisible({ timeout: 20_000 })
      await input.fill('16 청보석 20000')
      await input.press('Enter')
      await expect(s.page.getByText('저장하지 못했어요. 다시 보내기를 눌러 주세요: 16 청보석 20000', { exact: true })).toBeVisible({ timeout: 20_000 })
      const id15 = sent.find((x) => x.no === 15)!.requestId
      const id16 = sent.find((x) => x.no === 16)!.requestId
      const before = sent.length
      await comeBack(s.page)
      await expect(boardItem(s.page, 15)).toBeVisible({ timeout: 10_000 })
      await expect(boardItem(s.page, 16)).toBeVisible({ timeout: 10_000 })
      const after = sent.slice(before).filter((x) => x.type === 'product.register')
      expect(after.map((x) => x.requestId), '15 → 16 각 한 번, 처음 요청 번호').toEqual([id15, id16])
      expect(after[0]!.done, '15 응답').not.toBeNull()
      expect(after[1]!.at, '16 요청은 15 응답 뒤').toBeGreaterThanOrEqual(after[0]!.done!)
      expect((await history(s.page, date, false)).filter((e) => e.type === 'product.register')).toHaveLength(2)
    } finally {
      await s.close()
    }
  })
})

/** 실제 방송 · 15번 핑크프릴(재고 1) · 1등 문자찜(메모 "가나") */
async function winnerWorld(page: Page): Promise<{ b: string; date: string }> {
  const date = uniqueDate()
  const b = await broadcastApi(page, date, false)
  const reg = await writeEvent(page, { type: 'product.register', b, no: 15, name: '핑크프릴', price: 10000 })
  expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
  await smsApi(page, { b, no: 15, memo: '가나' })
  await openConsole(page, b)
  await expect(boardItem(page, 15)).toContainText('문자찜(가나)')
  return { b, date }
}

/** 상품 자세히 → 1등 "찜 취소하기" → 사유 (보내기는 대기 뒤) */
async function queueWinnerCancel(page: Page): Promise<void> {
  await boardItem(page, 15).click()
  const detail = page.getByRole('dialog', { name: '15번 자세히' })
  await detail.locator('li.claim-row').filter({ hasText: '문자찜(가나)' }).getByRole('button', { name: '찜 취소하기' }).click()
  const dlg = page.getByRole('dialog', { name: '15번 문자찜(가나) 취소' })
  await dlg.getByLabel('사유').fill('시청자 요청')
  await dlg.getByLabel('사유').press('Enter')
  await expect(bar(page)).toContainText(/초 뒤 보내요: 15번 문자찜\(가나\) 취소/)
}

for (const [label, viewport] of [['375×812', PHONE], ['1440×900', PC]] as const) {
  test.describe(`AC-MOB2-41${viewport === PC ? '·47' : ''} 방송자 조치 — ${label}`, () => {
    test('끊김 중 1등 찜 취소 → 대기 뒤 보냄 실패 + 안내 → 돌아오면 같은 요청 번호로 한 번, 결과 줄 "15번 1등 자리가 비었어요 · 대기 없음 · 판매 중"', async ({ browser, baseURL }) => {
      const s = await seller(browser, baseURL!, viewport)
      try {
        const { date } = await winnerWorld(s.page)
        const sent = watchWrites(s.page)
        await queueWinnerCancel(s.page)
        await goOffline(s.page)
        const failed = bar(s.page).getByRole('alert')
        await expect(failed).toContainText('15번 문자찜(가나) 취소 — 저장하지 못했어요.', { timeout: 20_000 })
        await expect(failed).toContainText(AUTO_RESEND_NOTE)
        const cancels = sent.filter((x) => x.type === 'host.cancel')
        expect(cancels.length).toBeGreaterThan(0)
        const id = cancels[0]!.requestId
        const before = sent.length
        await comeBack(s.page)
        await expect(bar(s.page).getByRole('status').filter({ hasText: '1등 자리가' })).toHaveText(vacatedEmpty('15번', '판매 중'), { timeout: 10_000 })
        expect(sent.slice(before).filter((x) => x.type === 'host.cancel').map((x) => x.requestId)).toEqual([id])
        expect((await history(s.page, date, false)).filter((e) => e.type === 'host.cancel')).toHaveLength(1)
      } finally {
        await s.close()
      }
    })
  })
}

test.describe('AC-MOB2-41 보내지 않는 경우·다른 기기', () => {
  test('실패 줄에서 "확인"으로 닫음 → 돌아와도 보내지 않는다(요청 0)', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    try {
      const { date } = await winnerWorld(s.page)
      const sent = watchWrites(s.page)
      await queueWinnerCancel(s.page)
      await goOffline(s.page)
      await expect(bar(s.page).getByRole('alert')).toContainText('저장하지 못했어요', { timeout: 20_000 })
      await bar(s.page).getByRole('button', { name: '확인', exact: true }).click()
      await expect(bar(s.page).getByRole('alert')).toHaveCount(0)
      const before = sent.length
      await comeBack(s.page)
      // 돌아온 뒤 화면이 따라잡을 때까지 (보드는 그대로 1등)
      await expect(boardItem(s.page, 15)).toContainText('문자찜(가나)')
      await expect.poll(() => sent.slice(before).filter((x) => x.type === 'host.cancel').length, { timeout: 6_000, intervals: [500, 1000, 1500, 3000] }).toBe(0)
      expect((await history(s.page, date, false)).filter((e) => e.type === 'host.cancel')).toHaveLength(0)
    } finally {
      await s.close()
    }
  })

  test('5초 안에 "되돌리기" → 보내지 않음, 끊겼다 돌아와도 보내지 않음', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    try {
      const { date } = await winnerWorld(s.page)
      const sent = watchWrites(s.page)
      await queueWinnerCancel(s.page)
      await bar(s.page).getByRole('button', { name: '15번 문자찜(가나) 취소 되돌리기' }).click()
      await expect(bar(s.page)).toContainText('보내지 않았어요')
      await goOffline(s.page)
      await comeBack(s.page)
      await expect(boardItem(s.page, 15)).toContainText('문자찜(가나)')
      await expect.poll(() => sent.filter((x) => x.type === 'host.cancel').length, { timeout: 6_000, intervals: [500, 1000, 1500, 3000] }).toBe(0)
      expect((await history(s.page, date, false)).filter((e) => e.type === 'host.cancel')).toHaveLength(0)
    } finally {
      await s.close()
    }
  })

  test('그사이 다른 기기(API)에서 같은 찜을 이미 취소 → 돌아와 보낸 결과 "적용되지 않았어요. 지금 상태를 확인해 주세요."', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    try {
      const { b } = await winnerWorld(s.page)
      await queueWinnerCancel(s.page)
      await goOffline(s.page)
      await expect(bar(s.page).getByRole('alert')).toContainText('저장하지 못했어요', { timeout: 20_000 })
      // 다른 기기 (같은 계정·다른 연결 — 이 화면의 오프라인과 상관없는 요청 컨텍스트)
      const api = await s.page.context().browser()!.newContext({ baseURL: baseURL! })
      try {
        const state = await s.page.context().storageState()
        await api.addCookies(state.cookies)
        const other = await api.newPage()
        const day = (await (await other.request.get(`/api/days/${(await (await other.request.get('/api/broadcasts')).json() as { broadcasts: { id: string; date: string }[] }).broadcasts.find((x) => x.id === b)!.date}`)).json()) as { claims: { no: number; buyer: string; currentBuyer?: string; status: string }[] }
        const winner = day.claims.find((c) => c.no === 15 && c.status === 'CONFIRMED')!
        const res = await other.request.post('/api/events', { data: { requestId: crypto.randomUUID(), type: 'host.cancel', b, no: 15, buyer: winner.currentBuyer ?? winner.buyer, reason: '다른 기기' }, headers: { Origin: baseURL! } })
        expect(res.status(), await res.text()).toBeLessThan(300)
      } finally {
        await api.close()
      }
      await comeBack(s.page)
      await expect(bar(s.page)).toContainText('적용되지 않았어요. 지금 상태를 확인해 주세요.', { timeout: 10_000 })
    } finally {
      await s.close()
    }
  })
})

test.describe('AC-MOB2-42 상품 관리', () => {
  for (const open of [true, false]) {
    test(`끊김 중 "일시 중지" 실패 → 돌아오면 같은 요청 번호로 한 번, 상품 일시 중지 — 창이 ${open ? '열려 있으면 실패 줄이 사라진다' : '닫혀 있으면 상품 카드 상태로'}`, async ({ browser, baseURL }) => {
      const s = await seller(browser, baseURL!, PHONE)
      try {
        const date = uniqueDate()
        const b = await broadcastApi(s.page, date, false)
        const reg = await writeEvent(s.page, { type: 'product.register', b, no: 15, name: '핑크프릴', price: 10000 })
        expect(reg.status).toBeLessThan(300)
        await openConsole(s.page, b)
        const sent = watchWrites(s.page)
        await boardItem(s.page, 15).click()
        const detail = s.page.getByRole('dialog', { name: '15번 자세히' })
        const manage = detail.getByRole('region', { name: '상품 관리' })
        await goOffline(s.page)
        await manage.getByRole('button', { name: '일시 중지' }).click()
        await expect(manage.getByText(AUTO_RESEND_NOTE, { exact: true })).toBeVisible({ timeout: 20_000 })
        await expect(manage.getByRole('button', { name: '다시 보내기' })).toBeVisible()
        const holds = sent.filter((x) => x.type === 'product.hold')
        const id = holds[0]!.requestId
        if (!open) {
          await detail.getByRole('button', { name: '닫기' }).first().click()
          await expect(detail).toHaveCount(0)
        }
        const before = sent.length
        await comeBack(s.page)
        await expect(boardItem(s.page, 15)).toContainText('일시 중지', { timeout: 10_000 })
        expect(sent.slice(before).filter((x) => x.type === 'product.hold').map((x) => x.requestId)).toEqual([id])
        if (open) {
          await expect(manage.getByText(AUTO_RESEND_NOTE, { exact: true })).toHaveCount(0)
          await expect(manage.getByRole('button', { name: '다시 보내기' })).toHaveCount(0)
        }
        expect((await history(s.page, date, false)).filter((e) => e.type === 'product.hold')).toHaveLength(1)
      } finally {
        await s.close()
      }
    })
  }
})

test.describe('AC-MOB2-43 문자찜', () => {
  async function smsWorld(page: Page): Promise<{ date: string }> {
    const date = uniqueDate()
    const title = `다시${String(Math.floor(Math.random() * 1e6))}`
    const b = await broadcastApi(page, date, false, title)
    const reg = await writeEvent(page, { type: 'product.register', b, no: 15, name: '핑크프릴', price: 10000 })
    expect(reg.status).toBeLessThan(300)
    await openSmsSole(page, title)
    return { date }
  }

  test('끊김 중 "15번에 문자찜 넣기" 실패(칸 그대로) → 칸을 그대로 두고 돌아오면 같은 요청 번호로 한 번, 칸 비움, 결과 카드 앞 "연결이 돌아와 보냈어요: "', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    try {
      const { date } = await smsWorld(s.page)
      const sent = watchWrites(s.page)
      await smsField(s.page, '번호').fill('15')
      await smsField(s.page, '메모').fill('오프')
      await goOffline(s.page)
      await s.page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
      await expect(s.page.getByText(/저장하지 못했어요/)).toBeVisible({ timeout: 30_000 })
      await expect(s.page.getByText(AUTO_RESEND_NOTE, { exact: true })).toBeVisible()
      await expect(smsField(s.page, '번호')).toHaveValue('15')
      const id = sent.find((x) => x.type === 'sms')!.requestId
      const before = sent.length
      await comeBack(s.page)
      const card = s.page.getByRole('region', { name: '넣은 결과' }).locator('strong').first()
      await expect(card).toHaveText(new RegExp(`^${RESENT_PREFIX}15번 · 문자찜\\(오프\\) · 1등`), { timeout: 10_000 })
      await expect(smsField(s.page, '번호')).toHaveValue('')
      await expect(smsField(s.page, '메모')).toHaveValue('')
      expect(sent.slice(before).filter((x) => x.type === 'sms').map((x) => x.requestId)).toEqual([id])
      expect((await history(s.page, date, false)).filter((e) => e.type === 'sms')).toHaveLength(1)
    } finally {
      await s.close()
    }
  })

  for (const change of ['번호', '메모', '전화번호', '받은 시각'] as const) {
    test(`실패 뒤 "${change}" 칸을 바꿈 → 돌아와도 보내지 않는다(요청 0), 실패 문장·"다시 보내기" 그대로`, async ({ browser, baseURL }) => {
      const s = await seller(browser, baseURL!, PHONE)
      try {
        const { date } = await smsWorld(s.page)
        const sent = watchWrites(s.page)
        await smsField(s.page, '번호').fill('15')
        await smsField(s.page, '메모').fill('오프')
        await goOffline(s.page)
        await s.page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
        await expect(s.page.getByText(/저장하지 못했어요/)).toBeVisible({ timeout: 30_000 })
        const field = smsField(s.page, change)
        await field.fill(change === '번호' ? '16' : change === '메모' ? '바꿈' : change === '전화번호' ? '010-1234-5678' : '20:01')
        const before = sent.length
        await comeBack(s.page)
        await expect.poll(() => sent.slice(before).filter((x) => x.type === 'sms').length, { timeout: 6_000, intervals: [500, 1000, 1500, 3000] }).toBe(0)
        await expect(s.page.getByText(/저장하지 못했어요/)).toBeVisible()
        await expect(s.page.getByRole('button', { name: '다시 보내기' })).toBeVisible()
        expect((await history(s.page, date, false)).filter((e) => e.type === 'sms')).toHaveLength(0)
      } finally {
        await s.close()
      }
    })
  }
})

test.describe('AC-MOB2-44 저절로 보내지 않는 실패', () => {
  for (const kind of ['INTERNAL_ERROR', 'STATE_FORMAT'] as const) {
    test(`등록이 ${kind}(500)로 실패 → 실시간 연결이 끊겼다 돌아와도 보내지 않는다, 안내 없음, "다시 보내기"는 그대로`, async ({ browser, baseURL }) => {
      const s = await seller(browser, baseURL!, PHONE)
      try {
        const date = uniqueDate()
        const b = await broadcastApi(s.page, date, false)
        await openConsole(s.page, b)
        const sent = watchWrites(s.page)
        await s.page.route('**/api/events**', async (route) => {
          if (route.request().method() !== 'POST') return route.continue()
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: kind, message: '잠시 뒤 다시 해 주세요.' } }) })
        })
        const input = s.page.getByLabel('빠른 입력')
        await input.fill('15 핑크프릴 10000')
        await input.press('Enter')
        await expect(s.page.getByText('저장하지 못했어요. 다시 보내기를 눌러 주세요: 15 핑크프릴 10000', { exact: true })).toBeVisible({ timeout: 20_000 })
        await expect(s.page.getByRole('button', { name: '다시 보내기' })).toBeVisible()
        await expect(s.page.getByText(AUTO_RESEND_NOTE, { exact: true })).toHaveCount(0)
        await s.page.unrouteAll()
        const before = sent.length
        await goOffline(s.page)
        await comeBack(s.page)
        await expect.poll(() => sent.slice(before).length, { timeout: 6_000, intervals: [500, 1000, 1500, 3000] }).toBe(0)
        await expect(s.page.getByRole('button', { name: '다시 보내기' })).toBeVisible()
        expect((await history(s.page, date, false)).filter((e) => e.type === 'product.register')).toHaveLength(0)
      } finally {
        await s.close()
      }
    })
  }

  test('입력 거절(400 칸 오류)·409는 다시 보낼 대상이 아니다 — 돌아와도 요청 0', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    try {
      const date = uniqueDate()
      const b = await broadcastApi(s.page, date, false)
      const reg = await writeEvent(s.page, { type: 'product.register', b, no: 15, name: '핑크프릴', price: 10000 })
      expect(reg.status).toBeLessThan(300)
      await openConsole(s.page, b)
      const sent = watchWrites(s.page)
      let status = 409
      await s.page.route('**/api/events**', async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code: status === 409 ? 'CONFLICT' : 'INVALID_INPUT', message: '받을 수 없어요.', problems: status === 400 ? [{ field: 'name', message: '이름을 적어 주세요.' }] : [] } }) })
      })
      await boardItem(s.page, 15).click()
      const manage = s.page.getByRole('dialog', { name: '15번 자세히' }).getByRole('region', { name: '상품 관리' })
      await manage.getByRole('button', { name: '일시 중지' }).click()
      await expect(manage.getByText('받을 수 없어요.')).toBeVisible({ timeout: 15_000 })
      await expect(manage.getByText(AUTO_RESEND_NOTE, { exact: true })).toHaveCount(0)
      status = 400
      await s.page.unrouteAll()
      const before = sent.length
      await goOffline(s.page)
      await comeBack(s.page)
      await expect.poll(() => sent.slice(before).length, { timeout: 6_000, intervals: [500, 1000, 1500, 3000] }).toBe(0)
      expect((await history(s.page, date, false)).filter((e) => e.type === 'product.hold')).toHaveLength(0)
    } finally {
      await s.close()
    }
  })

  test('끊김 중 실패가 남은 채 새로고침 → 돌아와도 보내지 않는다(메모리에만)', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    try {
      const date = uniqueDate()
      const b = await broadcastApi(s.page, date, false)
      await openConsole(s.page, b)
      await goOffline(s.page)
      const input = s.page.getByLabel('빠른 입력')
      await input.fill('15 핑크프릴 10000')
      await input.press('Enter')
      await expect(s.page.getByText('저장하지 못했어요. 다시 보내기를 눌러 주세요: 15 핑크프릴 10000', { exact: true })).toBeVisible({ timeout: 20_000 })
      // 새로고침은 쓰기가 막힌 채로 한다 — 연결이 먼저 돌아와 새로고침 전에 저절로 보낸 것이 기록되지 않게(그 보내기는 이 시험의 대상이 아니다)
      const block = await blockWrites(s.page)
      await s.page.context().setOffline(false)
      // 떠나기 창(D-103)이 뜨면 떠난다 — 그 창은 지금 그대로
      s.page.once('dialog', (d) => void d.accept())
      await s.page.reload()
      await expect(s.page.getByLabel('빠른 입력')).toBeVisible()
      await block.release()
      const sent = watchWrites(s.page)
      await goOffline(s.page)
      await comeBack(s.page)
      await expect.poll(() => sent.length, { timeout: 6_000, intervals: [500, 1000, 1500, 3000] }).toBe(0)
      expect((await history(s.page, date, false)).filter((e) => e.type === 'product.register')).toHaveLength(0)
    } finally {
      await s.close()
    }
  })
})
