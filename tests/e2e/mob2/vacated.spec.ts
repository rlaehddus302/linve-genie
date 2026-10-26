// MOB2 C. 1등 자리를 비운 조치의 결과 한 줄 (AC-MOB2-10~14·16, D-MOB2-04, UX-06, R-8) — test-e2e.
// 기대 문장은 acceptance.md의 따옴표 글자 그대로. 결과 줄 = 되돌리기 띠(section "보내기 전 조치") 안의 role="status".
// 1등은 리허설 채팅 찜(유튜브 채팅과 같은 길 — 닉네임 그대로)으로 만든다. 판매자는 시험마다 새로(설정·방송이 섞이지 않게).
// 시청자는 닉네임으로 같은 사람(채널을 주지 않음 — 리허설 채팅 기본).
import { expect, test, type Browser, type Page } from '@playwright/test'
import { boardItem, history, sendViewerChat, uniqueDate } from '../s05/support.ts'
import { writeEvent } from '../s06/support.ts'
import { PC, PHONE, alerts, broadcastApi, expectBig, freshSeller, newDevice } from '../mob1/support.ts'
import { newWinner, vacatedAsk, vacatedCleared, vacatedEmpty } from './support.ts'

const HACKER = '<b>해커</b>'

interface World {
  readonly page: Page
  readonly b: string
  readonly date: string
  readonly seller: { loginId: string; password: string }
  readonly close: () => Promise<void>
}

/** 새 판매자 · 리허설 방송 · 15번 "핑크프릴"(재고 stock) · 1등들(winners)·대기(waiting) 차례로 채팅 찜 */
async function world(browser: Browser, baseURL: string, opts: { succession?: 'AUTO' | 'ASK' | 'REOPEN'; buyerChat?: 'AUTO'; stock?: number; winners: readonly string[]; waiting: readonly string[]; clock?: boolean; viewport?: { width: number; height: number }; big?: boolean }): Promise<World> {
  const viewport = opts.viewport ?? PC
  const { page, context, seller } = await freshSeller(browser, baseURL, { viewport, touch: viewport.width < 768, big: opts.big === true })
  if (opts.clock === true) await page.clock.install()
  const settings = { ...(opts.succession === undefined ? {} : { 'cancel.succession': opts.succession }), ...(opts.buyerChat === undefined ? {} : { 'cancel.buyerChat': opts.buyerChat }) }
  if (Object.keys(settings).length > 0) {
    const res = await page.request.patch('/api/settings', { data: { settings }, headers: { Origin: baseURL } })
    expect(res.status(), await res.text()).toBe(200)
  }
  const date = uniqueDate()
  const b = await broadcastApi(page, date, true)
  const reg = await writeEvent(page, { type: 'product.register', b, no: 15, name: '핑크프릴', price: 10000, stock: opts.stock ?? 1 })
  expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
  for (const nick of [...opts.winners, ...opts.waiting]) await sendViewerChat(page, b, nick, '15')
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeVisible()
  if (opts.big === true) await expectBig(page)
  for (const nick of opts.winners) await expect(boardItem(page, 15)).toContainText(nick)
  if (opts.waiting.length > 0) await expect(boardItem(page, 15)).toContainText(`대기 ${String(opts.waiting.length)}`)
  return { page, b, date, seller, close: () => context.close() }
}

const bar = (page: Page) => page.getByRole('region', { name: '보내기 전 조치' })

/** 상품 자세히에서 그 사람의 찜 줄 조치 (찜 취소하기·무효로 하기) → 사유 → 대기 (5초 대기는 E2E 묶음에서 2초) */
async function claimAction(page: Page, nick: string, verb: '찜 취소하기' | '무효로 하기', reason = '시청자 요청'): Promise<void> {
  await boardItem(page, 15).click()
  const detail = page.getByRole('dialog', { name: '15번 자세히' })
  await expect(detail).toBeVisible()
  const row = detail.locator('li.claim-row').filter({ has: page.getByText(nick, { exact: true }) }).first()
  await row.getByRole('button', { name: verb }).click()
  const word = verb === '찜 취소하기' ? '취소' : '무효'
  const dlg = page.getByRole('dialog', { name: `15번 ${nick} ${word}` })
  await dlg.getByLabel('사유').fill(reason)
  await dlg.getByLabel('사유').press('Enter')
  await expect(bar(page)).toContainText(`15번 ${nick} ${word}`)
}

const PICK = '1등 고르기'

/** 결과 줄이 보이고 "보냈어요: …"는 없다. 승계를 골라야 하는 줄(ASK)에만 "1등 고르기"가 있다 (D-MOB2-16 (1)) */
async function expectOutcome(page: Page, text: string, pick = false): Promise<void> {
  const line = bar(page).getByRole('status').filter({ hasText: text })
  await expect(line, `결과 줄 "${text}"`).toHaveText(text, { timeout: 15_000 })
  await expect(bar(page)).not.toContainText('보냈어요')
  if (!pick) await expect(bar(page).getByRole('button', { name: PICK }), `"${text}" 줄에는 "${PICK}" 없음`).toHaveCount(0)
}

/** 결과 줄(되돌리기 띠의 그 줄 항목) 안의 "1등 고르기" */
const pickButton = (page: Page, text: string) => bar(page).getByRole('listitem').filter({ has: page.getByRole('status').filter({ hasText: text }) }).getByRole('button', { name: PICK, exact: true })

test.describe('AC-MOB2-10 새 1등이 생김 (AUTO)', () => {
  test('1등 찜 취소 → "15번 새 1등: 김철수", "보냈어요" 없음, 카드 1등도 김철수 — "확인"을 누르면 바로 사라진다', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { winners: [HACKER], waiting: ['김철수', '박영희'] })
    try {
      await claimAction(w.page, HACKER, '찜 취소하기')
      await expectOutcome(w.page, newWinner('15번', '김철수'))
      await expect(boardItem(w.page, 15)).toContainText('김철수')
      await expect(boardItem(w.page, 15)).not.toContainText(HACKER)
      await bar(w.page).getByRole('button', { name: '확인', exact: true }).click()
      await expect(bar(w.page).getByText(newWinner('15번', '김철수'))).toHaveCount(0)
      expect((await history(w.page, w.date, true)).filter((e) => e.type === 'host.cancel')).toHaveLength(1)
    } finally {
      await w.close()
    }
  })

  test('결과 줄은 10초(당긴 시계) 동안 보이고 10초 뒤 사라진다', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { winners: [HACKER], waiting: ['김철수', '박영희'], clock: true })
    try {
      await claimAction(w.page, HACKER, '찜 취소하기')
      // 5초 대기(E2E 2초)를 당긴다
      await w.page.clock.runFor(2_500)
      const text = newWinner('15번', '김철수')
      const line = bar(w.page).getByRole('status').filter({ hasText: text })
      await expect(line).toHaveText(text, { timeout: 15_000 })
      await w.page.clock.runFor(9_000)
      await expect(line, '9초 뒤에도 보인다').toBeVisible()
      await w.page.clock.runFor(1_500)
      await expect(bar(w.page).getByText(text), '10초 뒤 사라진다').toHaveCount(0)
    } finally {
      await w.close()
    }
  })

  test('무효(host.reject)도 같은 문장', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { winners: [HACKER], waiting: ['김철수', '박영희'] })
    try {
      await claimAction(w.page, HACKER, '무효로 하기')
      await expectOutcome(w.page, newWinner('15번', '김철수'))
    } finally {
      await w.close()
    }
  })

  test('1등의 취소 요청 승인(host.approveCancel)도 같은 문장', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { winners: ['홍길동'], waiting: ['김철수', '박영희'] })
    try {
      await sendViewerChat(w.page, w.b, '홍길동', '15 취소')
      await expect(alerts(w.page).getByRole('button', { name: '취소 요청 1' })).toBeVisible({ timeout: 15_000 })
      await w.page.keyboard.press('Alt+1')
      const dlg = w.page.getByRole('dialog', { name: /^취소 요청 — 15번/ })
      await dlg.getByRole('button', { name: '1 취소 승인' }).click()
      await expectOutcome(w.page, newWinner('15번', '김철수'))
    } finally {
      await w.close()
    }
  })
})

test.describe('AC-MOB2-11 대기 없음', () => {
  test('AUTO·대기 없음 → "15번 1등 자리가 비었어요 · 대기 없음 · 판매 중"', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { winners: [HACKER], waiting: [] })
    try {
      await claimAction(w.page, HACKER, '찜 취소하기')
      await expectOutcome(w.page, vacatedEmpty('15번', '판매 중'))
    } finally {
      await w.close()
    }
  })

  test('일시 중지(HOLD)였던 상품 → 끝이 "일시 중지"', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { winners: [HACKER], waiting: [] })
    try {
      const hold = await writeEvent(w.page, { type: 'product.hold', b: w.b, no: 15 })
      expect(hold.status, JSON.stringify(hold.body)).toBeLessThan(300)
      await expect(boardItem(w.page, 15)).toContainText('일시 중지')
      await claimAction(w.page, HACKER, '찜 취소하기')
      await expectOutcome(w.page, vacatedEmpty('15번', '일시 중지'))
    } finally {
      await w.close()
    }
  })
})

test.describe('AC-MOB2-12·13 승계 설정', () => {
  test('ASK·대기 2명 → "15번 1등 자리가 비었어요 · 대기 2명 — 누구를 1등으로 할지 골라 주세요", 알림 띠 "승계 결정 필요"는 그대로, 그 줄의 "1등 고르기"(44px 이상·화면 안) → 15번 승계 결정 창(대기 2명)', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { succession: 'ASK', winners: [HACKER], waiting: ['김철수', '박영희'] })
    try {
      await claimAction(w.page, HACKER, '찜 취소하기')
      const text = vacatedAsk('15번', 2)
      await expectOutcome(w.page, text, true)
      await expect(alerts(w.page).getByRole('button', { name: /^승계 결정 필요 1$/, includeHidden: true })).toHaveCount(1)
      // D-MOB2-16 (1): 결과 줄 안의 "1등 고르기"
      const pick = pickButton(w.page, text)
      await expect(pick).toBeVisible()
      const box = (await pick.boundingBox())!
      const vp = w.page.viewportSize()!
      expect(box.height, '"1등 고르기" 높이 ≥ 44px').toBeGreaterThanOrEqual(44)
      expect(box.x >= -0.5 && box.y >= -0.5 && box.x + box.width <= vp.width + 0.5 && box.y + box.height <= vp.height + 0.5, `"1등 고르기" 상자 전체가 화면 안 ${JSON.stringify(box)}`).toBe(true)
      await pick.click()
      const dlg = w.page.getByRole('dialog', { name: /^승계 결정 — 15번/ })
      await expect(dlg, '알림 칩을 누를 때와 같은 승계 결정 창').toBeVisible()
      await expect(dlg).toContainText('김철수')
      await expect(dlg).toContainText('박영희')
    } finally {
      await w.close()
    }
  })

  test('ASK · 375×812 글자 150% 알림 접힘: 접힌 띠의 승계 칩 글(=단추 이름) "승계 1"이 말줄임 없이, 펼친 띠는 "승계 결정 필요 1"', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { succession: 'ASK', winners: [HACKER], waiting: ['김철수', '박영희'], viewport: PHONE, big: true })
    try {
      await claimAction(w.page, HACKER, '찜 취소하기')
      await expectOutcome(w.page, vacatedAsk('15번', 2), true)
      await w.page.evaluate(() => window.scrollTo(0, 0))
      const strip = alerts(w.page)
      const chip = strip.getByRole('button', { name: '승계 1', exact: true, includeHidden: true })
      await expect(chip).toHaveCount(1)
      await expect(chip).toHaveText('승계 1')
      await expect(strip.getByRole('button', { name: /^승계 결정 필요/, includeHidden: true }), '접힌 휴대폰 띠에는 긴 이름 없음').toHaveCount(0)
      // 알림이 승계 하나뿐이라 첫 칩 = 승계 칩, 늘 보인다(AC-MOB2-02)
      await expect(chip).toBeVisible()
      const fit = await chip.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
      expect(fit.sw, `"승계 1" 말줄임 없음 ${JSON.stringify(fit)}`).toBeLessThanOrEqual(fit.cw + 1)
      await w.page.getByRole('button', { name: '알림 1 펼치기', exact: true }).click()
      await expect(strip.getByRole('button', { name: '승계 결정 필요 1', exact: true })).toBeVisible()
      await expect(strip.getByRole('button', { name: '승계 1', exact: true, includeHidden: true })).toHaveCount(0)
    } finally {
      await w.close()
    }
  })

  test('ASK · 1440×900: 알림 띠 "승계 결정 필요 1" 그대로("승계 1" 아님)', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { succession: 'ASK', winners: [HACKER], waiting: ['김철수', '박영희'] })
    try {
      await claimAction(w.page, HACKER, '찜 취소하기')
      await expectOutcome(w.page, vacatedAsk('15번', 2), true)
      await expect(alerts(w.page).getByRole('button', { name: '승계 결정 필요 1', exact: true })).toBeVisible()
      await expect(alerts(w.page).getByRole('button', { name: '승계 1', exact: true, includeHidden: true })).toHaveCount(0)
    } finally {
      await w.close()
    }
  })

  test('REOPEN·대기 2명 → "15번 1등 자리가 비었어요 · 대기를 비웠어요 · 판매 중"', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { succession: 'REOPEN', winners: [HACKER], waiting: ['김철수', '박영희'] })
    try {
      await claimAction(w.page, HACKER, '찜 취소하기')
      await expectOutcome(w.page, vacatedCleared('15번', '판매 중'))
    } finally {
      await w.close()
    }
  })
})

test.describe('AC-MOB2-14 재고 2·이스케이프', () => {
  test('재고 2·1등 A·B·대기 C → A 취소 "15번 새 1등: C"', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { stock: 2, winners: ['가나', '다라'], waiting: ['마바'] })
    try {
      await claimAction(w.page, '가나', '찜 취소하기')
      await expectOutcome(w.page, newWinner('15번', '마바'))
    } finally {
      await w.close()
    }
  })

  test('재고 2·대기 없음 → "15번 1등 자리가 비었어요 · 대기 없음 · 판매 중", B는 그대로', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { stock: 2, winners: ['가나', '다라'], waiting: [] })
    try {
      await claimAction(w.page, '가나', '찜 취소하기')
      await expectOutcome(w.page, vacatedEmpty('15번', '판매 중'))
      await expect(boardItem(w.page, 15)).toContainText('다라')
    } finally {
      await w.close()
    }
  })

  test('새 1등 이름이 <b>해커</b> → 결과 줄에 글자 그대로, b 요소 0', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { winners: ['김철수'], waiting: [HACKER] })
    try {
      await claimAction(w.page, '김철수', '찜 취소하기')
      await expectOutcome(w.page, newWinner('15번', HACKER))
      expect(await bar(w.page).locator('b, script').count()).toBe(0)
    } finally {
      await w.close()
    }
  })
})

test.describe('AC-MOB2-16 결과 줄이 없는 경우', () => {
  test('대기 찜 취소 → "보냈어요: …" 그대로(결과 줄 없음)', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { winners: [HACKER], waiting: ['김철수'] })
    try {
      await claimAction(w.page, '김철수', '찜 취소하기')
      await expect(bar(w.page)).toContainText('보냈어요: 15번 김철수 취소', { timeout: 15_000 })
      await expect(bar(w.page)).not.toContainText('1등 자리가 비었어요')
      await expect(bar(w.page)).not.toContainText('새 1등')
    } finally {
      await w.close()
    }
  })

  test('5초 안에 되돌리기 → "보내지 않았어요" 그대로, 결과 줄 없음', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { winners: [HACKER], waiting: ['김철수'] })
    try {
      await claimAction(w.page, HACKER, '찜 취소하기')
      await bar(w.page).getByRole('button', { name: `15번 ${HACKER} 취소 되돌리기` }).click()
      await expect(bar(w.page)).toContainText('보내지 않았어요')
      await expect(bar(w.page)).not.toContainText('새 1등')
      expect((await history(w.page, w.date, true)).filter((e) => e.type === 'host.cancel')).toHaveLength(0)
    } finally {
      await w.close()
    }
  })

  test('다른 기기에서 보낸 1등 취소 → 이 기기에는 결과 줄이 없다', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { winners: [HACKER], waiting: ['김철수'] })
    const { loginAs } = await import('../i3/support.ts')
    const other = await newDevice(browser, baseURL!, { viewport: PC })
    try {
      await loginAs(other.page, w.seller, `/broadcasts/${encodeURIComponent(w.b)}`)
      await expect(other.page.getByLabel('빠른 입력')).toBeVisible()
      await claimAction(other.page, HACKER, '찜 취소하기')
      await expectOutcome(other.page, newWinner('15번', '김철수'))
      // 이 기기: 카드는 바뀌지만 결과 줄은 없다
      await expect(boardItem(w.page, 15)).toContainText('김철수')
      await expect(bar(w.page).getByText(/새 1등|1등 자리가 비었어요/)).toHaveCount(0)
    } finally {
      await other.context.close()
      await w.close()
    }
  })

  test('시청자 채팅 자동 취소(cancel.buyerChat = AUTO, 1등의 "15 취소") → 새 1등은 카드에만, 결과 줄 없음', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { buyerChat: 'AUTO', winners: ['홍길동'], waiting: ['김철수'] })
    try {
      await sendViewerChat(w.page, w.b, '홍길동', '15 취소')
      await expect(boardItem(w.page, 15)).not.toContainText('홍길동', { timeout: 15_000 })
      await expect(boardItem(w.page, 15)).toContainText('김철수')
      await expect(bar(w.page).getByText(/새 1등|1등 자리가 비었어요/)).toHaveCount(0)
    } finally {
      await w.close()
    }
  })
})

test.describe('TE-MOB2-001 응답을 잃고 같은 요청 번호로 다시 보낸 1등 취소', () => {
  test('TE-MOB2-001: 서버는 기록했지만 응답을 잃음 → 화면이 실시간으로 취소를 먼저 받은 뒤 다시 보냄 → 결과 줄 "15번 새 1등: 김철수"(보낸 기기), "보냈어요" 아님', async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, { winners: ['홍길동'], waiting: ['김철수'] })
    try {
      let dropped = false
      await w.page.route('**/api/events**', async (route) => {
        if (!dropped && route.request().method() === 'POST' && (route.request().postData() ?? '').includes('host.cancel')) {
          dropped = true
          await route.fetch() // 서버에는 도착해 기록된다
          // 실시간 연결로 취소가 먼저 화면에 온 뒤에 응답을 잃는다 (흔한 순서 — 쓰기 응답보다 실시간 알림이 먼저 올 수 있다)
          await expect(boardItem(w.page, 15)).toContainText('김철수', { timeout: 15_000 })
          await route.abort('connectionreset')
          return
        }
        await route.continue()
      })
      await claimAction(w.page, '홍길동', '찜 취소하기')
      const line = bar(w.page).getByRole('status').filter({ hasText: /보냈어요|새 1등|1등 자리가/ })
      await expect(line).toBeVisible({ timeout: 20_000 })
      // 지금은 "보냈어요: 15번 홍길동 취소" — 다시 보낼 때 조치 전 모양을 다시 잡아(captureVacated) 이미 취소된 찜이라 결과 줄을 잃는다
      const shown = await line.first().innerText()
      expect((await history(w.page, w.date, true)).filter((e) => e.type === 'host.cancel'), '이력에 한 번').toHaveLength(1)
      expect(shown, 'TE-MOB2-001 결과 줄').toBe(newWinner('15번', '김철수'))
    } finally {
      await w.close()
    }
  })
})
