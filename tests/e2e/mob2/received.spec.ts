// MOB2 수정 라운드 2 — 받은 시각을 비운 문자찜의 다시 보내기 (AC-MOB2-43 받은 시각, D-MOB2-09, RA-MOB2-02) — test-e2e.
// 기대 문장·값은 acceptance.md AC-MOB2-43과 DECISIONS D-MOB2-09에서 정했다(구현을 보고 정하지 않음).
// 화면 시계는 page.clock.setFixedTime으로 당긴다(타이머는 그대로 돈다). 서버 시계는 당길 수 없어 실제 시각 그대로다.
// "끊김" = context.setOffline(true), "돌아옴" = setOffline(false) 뒤 끊김 안내가 사라짐(resend.spec과 같음).
import { expect, test, type Browser, type Page } from '@playwright/test'
import { history, uniqueDate } from '../s05/support.ts'
import { openSms, scopeView, smsField, writeEvent } from '../s06/support.ts'
import { PHONE, broadcastApi, freshSeller } from '../mob1/support.ts'
import { AUTO_RESEND_NOTE, LOST_NOTICE, RESENT_PREFIX, expectAutoFail, filledReceived, kstClock, kstTodayAt, openSmsSole, otherDevice, watchBodies } from './support.ts'

async function seller(browser: Browser, baseURL: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const { page, context } = await freshSeller(browser, baseURL, { viewport: PHONE, touch: true })
  return { page, close: () => context.close() }
}

async function goOffline(page: Page): Promise<void> {
  await page.context().setOffline(true)
  await expect(page.getByText(LOST_NOTICE)).toBeVisible({ timeout: 20_000 })
}

async function comeBack(page: Page): Promise<void> {
  await page.context().setOffline(false)
  await expect(page.getByText(LOST_NOTICE)).toHaveCount(0, { timeout: 20_000 })
}

/** 15번 핑크프릴을 등록한 방송 하나 + 문자찜 화면 */
async function smsWorld(page: Page, opts: { rehearsal: boolean }): Promise<{ b: string; date: string }> {
  const date = uniqueDate()
  const title = `받은시각${String(Math.floor(Math.random() * 1e6))}`
  const b = await broadcastApi(page, date, opts.rehearsal, title)
  const reg = await writeEvent(page, { type: 'product.register', b, no: 15, name: '핑크프릴', price: 10000 })
  expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
  // 실제 방송 하나뿐이면 화면이 저절로 고른다. 리허설은 저절로 고르지 않아 고르기 창으로 고른다
  if (opts.rehearsal) await openSms(page, title)
  else await openSmsSole(page, title)
  return { b, date }
}

// SRV1 D-APP-24: 문자찜 받은 시각 칸은 원문 그대로 `receivedText`로 보낸다(서버가 읽는다 — 옛 `received` 값 칸 대신). 기록된 사건의 `received`는 그대로
const smsBodies = (bodies: Record<string, unknown>[]) => bodies.filter((x) => x['type'] === 'sms')
const failed = (page: Page) => page.getByText(/저장하지 못했어요/)

test.describe('AC-MOB2-43 받은 시각을 비운 문자찜 (D-MOB2-09)', () => {
  test('20:01:05에 비운 채 "넣기" → 끊김 실패 → 칸에 "20:01:05"·안내, 20:01:30 직접 "다시 보내기"도 20:01:05, 20:01:45 돌아오면 저절로 본문 "20:01:05"·처음 요청 번호, 결과 카드 받은 시각 20:01:05·"늦게 들어갔어요" 없음', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!)
    try {
      const { date } = await smsWorld(s.page, { rehearsal: false })
      const bodies = watchBodies(s.page)
      await smsField(s.page, '번호').fill('15')
      await smsField(s.page, '메모').fill('비움')
      await expect(smsField(s.page, '받은 시각')).toHaveValue('')
      await goOffline(s.page)
      await s.page.clock.setFixedTime(kstTodayAt('20:01:05'))
      await s.page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
      await expect(failed(s.page)).toBeVisible({ timeout: 30_000 })
      await expect(s.page.getByText(AUTO_RESEND_NOTE, { exact: true })).toBeVisible()
      await expectAutoFail(s.page.getByRole('region', { name: '문자찜 넣기' }), true) // MOB2 D-MOB2-18
      // 칸에 처음 누른 시각, 칸 아래 안내 (D-MOB2-09)
      await expect(smsField(s.page, '받은 시각')).toHaveValue('20:01:05')
      await expect(s.page.getByText(filledReceived('20:01:05'), { exact: true })).toBeVisible()
      const first = smsBodies(bodies)
      expect(first.length, '끊김 중 보낸 문자찜 요청').toBeGreaterThan(0)
      const id = String(first[0]!['requestId'])
      expect(first[0]!['receivedText'], '처음 요청은 받은 시각 없이 (비운 칸 — ORD-08 AC6)').toBeUndefined()

      // 20:01:30 판매자가 직접 "다시 보내기" (아직 끊김) — 다시 누른 시각이 아니라 처음 누른 시각
      await s.page.clock.setFixedTime(kstTodayAt('20:01:30'))
      const beforeManual = smsBodies(bodies).length
      await s.page.getByRole('button', { name: '다시 보내기' }).click()
      await expect.poll(() => smsBodies(bodies).length, { timeout: 30_000 }).toBeGreaterThan(beforeManual)
      await expect(failed(s.page)).toBeVisible({ timeout: 30_000 })
      const manual = smsBodies(bodies).slice(beforeManual)
      expect(manual.map((x) => x['receivedText']), '직접 다시 보내기의 받은 시각').toEqual(manual.map(() => '20:01:05'))
      expect(new Set(manual.map((x) => x['requestId'])), '직접 다시 보내기도 처음 요청 번호').toEqual(new Set([id]))
      await expect(smsField(s.page, '받은 시각')).toHaveValue('20:01:05')
      // 받은 시각을 화면이 채운 것은 판매자가 칸을 바꾼 것이 아니다 — 직접 다시 보낸 뒤에도 저절로 보낼 문장 그대로 (D-MOB2-09·D-MOB2-18)
      await expectAutoFail(s.page.getByRole('region', { name: '문자찜 넣기' }), true) // MOB2 D-MOB2-18

      // 20:01:45 돌아옴 → 저절로
      await s.page.clock.setFixedTime(kstTodayAt('20:01:45'))
      const before = smsBodies(bodies).length
      await comeBack(s.page)
      const card = s.page.getByRole('region', { name: '넣은 결과' })
      await expect(card.locator('strong').first()).toHaveText(new RegExp(`^${RESENT_PREFIX}15번 · 문자찜\\(비움\\) · 1등 · 받은 시각 .*20:01:05$`), { timeout: 10_000 })
      const after = smsBodies(bodies).slice(before)
      expect(after.map((x) => [x['requestId'], x['receivedText']]), '돌아온 뒤 한 번, 처음 요청 번호·받은 시각 20:01:05').toEqual([[id, '20:01:05']])
      await expect(s.page.getByText(/늦게 들어갔어요/)).toHaveCount(0)
      await expect(s.page.getByText(/취소하고 받은 시각을 적어/)).toHaveCount(0)
      await expect(smsField(s.page, '받은 시각')).toHaveValue('')
      await expect(s.page.getByText(filledReceived('20:01:05'), { exact: true })).toHaveCount(0)
      const events = (await history(s.page, date, false)).filter((e) => e.type === 'sms')
      expect(events.map((e) => e.fields['received']), '기록된 받은 시각').toEqual(['20:01:05'])
    } finally {
      await s.close()
    }
  })

  test('채운 뒤 판매자가 받은 시각 칸을 지움 → 돌아와도 보내지 않는다(요청 0), 안내도 사라진다', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!)
    try {
      const { date } = await smsWorld(s.page, { rehearsal: false })
      const bodies = watchBodies(s.page)
      await smsField(s.page, '번호').fill('15')
      await goOffline(s.page)
      await s.page.clock.setFixedTime(kstTodayAt('20:01:05'))
      await s.page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
      await expect(failed(s.page)).toBeVisible({ timeout: 30_000 })
      await expect(smsField(s.page, '받은 시각')).toHaveValue('20:01:05')
      await smsField(s.page, '받은 시각').fill('')
      await expect(s.page.getByText(filledReceived('20:01:05'), { exact: true })).toHaveCount(0)
      const before = smsBodies(bodies).length
      await comeBack(s.page)
      await expect.poll(() => smsBodies(bodies).length - before, { timeout: 6_000, intervals: [500, 1000, 1500, 3000] }).toBe(0)
      await expect(failed(s.page)).toBeVisible()
      await expect(s.page.getByRole('button', { name: '다시 보내기' })).toBeVisible()
      expect((await history(s.page, date, false)).filter((e) => e.type === 'sms')).toHaveLength(0)
    } finally {
      await s.close()
    }
  })

  test('받은 시각을 적고 보낸 끊김 실패 → 칸은 적은 그대로, 채움 안내 없음 · 저절로 보내지 않는 실패(500)는 비운 칸을 채우지 않는다', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!)
    try {
      await smsWorld(s.page, { rehearsal: false })
      await smsField(s.page, '번호').fill('15')
      await smsField(s.page, '받은 시각').fill('20:00:30')
      await goOffline(s.page)
      await s.page.clock.setFixedTime(kstTodayAt('20:01:05'))
      await s.page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
      await expect(failed(s.page)).toBeVisible({ timeout: 30_000 })
      await expect(smsField(s.page, '받은 시각')).toHaveValue('20:00:30')
      await expect(s.page.getByText(/받은 시각을 비워 두셔서/)).toHaveCount(0)
      await comeBack(s.page)
      await expect(s.page.getByRole('region', { name: '넣은 결과' }).locator('strong').first()).toHaveText(new RegExp(`^${RESENT_PREFIX}15번 · .*받은 시각 .*20:00:30$`), { timeout: 10_000 })

      // 500: 다시 보낼 실패가 아니다 → 비운 칸 그대로
      await s.page.route('**/api/events**', async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: '잠시 뒤 다시 해 주세요.' } }) })
      })
      await smsField(s.page, '번호').fill('15')
      await expect(smsField(s.page, '받은 시각')).toHaveValue('')
      await s.page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
      await expect(s.page.getByRole('region', { name: '문자찜 넣기' }).getByRole('alert')).toContainText('잠시 뒤 다시 해 주세요.', { timeout: 30_000 })
      await expect(s.page.getByText(AUTO_RESEND_NOTE, { exact: true })).toHaveCount(0)
      await expect(smsField(s.page, '받은 시각')).toHaveValue('')
      await expect(s.page.getByText(/받은 시각을 비워 두셔서/)).toHaveCount(0)
    } finally {
      await s.page.unrouteAll({ behavior: 'ignoreErrors' })
      await s.close()
    }
  })

  test('RECEIVED_TIME 방송: 끊긴 사이 같은 번호 채팅찜이 먼저 1등 → 돌아와 채운 받은 시각으로 들어간 문자찜이 R-7 1 자동 역전으로 1등, 채팅찜은 대기 1', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!)
    const other = await otherDevice(s.page, baseURL!)
    try {
      const set = await s.page.request.patch('/api/settings', { data: { settings: { 'contention.policy': 'RECEIVED_TIME' } }, headers: { Origin: baseURL! } })
      expect(set.status(), await set.text()).toBe(200)
      // 리허설 방송 — 채팅찜을 리허설 채팅으로 넣는다(라벨·감사가 없어 잠금 전 그대로)
      const { b, date } = await smsWorld(s.page, { rehearsal: true })
      const bodies = watchBodies(s.page)
      await smsField(s.page, '번호').fill('15')
      await smsField(s.page, '메모').fill('먼저')
      await goOffline(s.page)
      // 처음 누른 시각 = 지금 실제 시각보다 40초 전(초 단위) — 끊긴 사이 들어올 채팅찜(서버 실제 시각)보다 앞선다
      const pressed = Math.floor((Date.now() - 40_000) / 1000) * 1000
      await s.page.clock.setFixedTime(pressed)
      await s.page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
      await expect(failed(s.page)).toBeVisible({ timeout: 30_000 })
      await expect(smsField(s.page, '받은 시각')).toHaveValue(kstClock(pressed))
      // 끊긴 사이 다른 기기에서 보이는 같은 번호 채팅찜 → 1등
      const chat = await other.post(`/api/broadcasts/${b}/rehearsal/chat`, { nick: '채팅손님', text: '15', channel: `sim_mob2_rt_${String(Math.floor(Math.random() * 1e6))}` })
      expect(chat.status, JSON.stringify(chat.body)).toBeLessThan(300)
      await expect.poll(async () => (await scopeView(s.page, date, true)).claims.filter((c) => c.no === 15).map((c) => `${c.origin}:${c.status}`), { timeout: 10_000 }).toEqual(['chat:CONFIRMED'])
      // 돌아옴 (화면 시계도 돌려 둔다)
      await s.page.clock.setFixedTime(Date.now())
      const before = smsBodies(bodies).length
      await comeBack(s.page)
      await expect(s.page.getByRole('region', { name: '넣은 결과' }).locator('strong').first()).toHaveText(new RegExp(`^${RESENT_PREFIX}15번 · 문자찜\\(먼저\\) · 1등`), { timeout: 10_000 })
      expect(smsBodies(bodies).slice(before).map((x) => x['receivedText'])).toEqual([kstClock(pressed)])
      const claims = (await scopeView(s.page, date, true)).claims.filter((c) => c.no === 15)
      expect(Object.fromEntries(claims.map((c) => [c.origin, c.status])), 'R-7 1 자동 역전').toEqual({ sms: 'CONFIRMED', chat: 'WAITLISTED' })
      const product = (await scopeView(s.page, date, true)).products.find((p) => p.no === 15)!
      expect(product.waitlist, '채팅찜이 대기 1').toHaveLength(1)
    } finally {
      await other.dispose()
      await s.close()
    }
  })
})
