// N3 라운드 1 (test-e2e) — 수정 라운드 1로 바뀐 곳을 다시 공격한다.
// - 묶음 찾기 범위(RA-N3-003 수정): 날짜를 고르지 않으면 입금 날짜 60일 전 ~ 30일 뒤만 — 더 먼 날짜도 날짜 고르기로는 찾아 확정할 수 있어야 한다(AC-N3-33·43).
// - 팝빌 사업자번호 묶기(RA-N3-001 수정): 409 CORP_NOT_ALLOWED 문장을 화면이 그대로 보인다(AC-N3-50). E2E 서버엔 팝빌 키가 없어 응답을 바꿔 끼운다.
// - 음성 이력 기다림(SA-N3-04 수정, AC-I4-40·D-I4-06): 켠 직후 이력을 받는 동안 말한 문장은 기록에 바로 남고, 이력을 받으면 이력 사전으로 카드가 된다.
//   이력이 늦으면(2초 넘김) 카드를 잃지 않고 그때 사전으로 만든다.
import { test, expect, type Page, type Route } from '@playwright/test'
import { deposit, depositOne, depositRow, fakeSource, history, kstDate, kstIso, login, noHorizontalScroll, scopeView, smsSale, todayKst, uniq } from './support.ts'
import { card, installFakeSpeech, openExtras, openNewBroadcast, openVoiceLog, registerApi, speak, turnOnVoice, uniqueDate, voiceLogItems, voiceRegion } from '../i4/support.ts'
import { closeMore, expectPhoneBar, fakeReviewCount, moreButton, moreLinks, openMore } from '../menu.ts'
import { cleanupPrint } from '../i1/support.ts'
import { loginNewSeller } from '../i3/support.ts'

// 출력 기록은 판매자 단위 — 판매(1등)가 만든 라벨 작업을 남기면 뒤 시험(N4a 등)의 출력 기기가 쌓인 라벨로 멈춘다 (i1 support "시험끼리 출력 기록이 섞이지 않게")
test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

test.describe('묶음 찾기 범위 (수정 라운드 1)', () => {
  test('날짜를 고르지 않으면 입금 날짜 앞뒤(60일 안)의 묶음만 — 75일 전 묶음은 날짜를 골라 찾고 확정한다 (AC-N3-33·43)', async ({ page }) => {
    await login(page)
    const name = uniq('오래단골')
    const far = await smsSale(page, { memo: name, date: kstDate(75) })
    const near = await smsSale(page, { memo: name, date: kstDate(45) })
    const src = await fakeSource(page)
    const [d] = await deposit(page, src, [{ key: uniq('far'), at: kstIso(5_000), amount: far.remaining, name: uniq('딴이름') }])
    expect(d!.status).toBe('REVIEW')

    await page.goto('/deposits')
    await depositRow(page, d!.no).getByRole('group', { name: `입금 #${String(d!.no)} 처리` }).getByRole('button', { name: '다른 묶음 지정' }).click()
    const search = page.getByRole('dialog', { name: `다른 묶음 지정 · 입금 #${String(d!.no)}` })
    const dateSelect = search.getByLabel('날짜')
    await expect(dateSelect.locator('option:checked')).toHaveText('입금 날짜 앞뒤 (60일 전 ~ 30일 뒤)')
    await search.getByLabel('찾을 말 (구매자 이름·닉네임·메모·전화번호 뒤 4자리)').fill(name)
    const results = search.getByRole('list', { name: '찾은 묶음' }).getByRole('button')
    // 45일 전 묶음만 (75일 전은 날짜를 고르지 않으면 나오지 않는다)
    await expect(results).toHaveCount(1)
    await expect(results.first()).toContainText(name)
    const nearLong = await dateLabel(dateSelect, near.date)
    await expect(results.first()).toContainText(`${nearLong} 묶음`)

    // 날짜 고르기에 75일 전 날짜가 있고, 고르면 그 묶음이 나온다
    const farLong = await dateLabel(dateSelect, far.date)
    await dateSelect.selectOption(far.date)
    await expect(results).toHaveCount(1)
    await expect(results.first()).toContainText(`${farLong} 묶음`)
    await results.first().click()
    const dlg = page.getByRole('dialog', { name: '입금 확정' })
    await expect(dlg).toContainText('미입금 → 입금 완료')
    await dlg.getByRole('button', { name: '확정' }).click()
    await expect(dlg).toHaveCount(0)
    await expect.poll(async () => (await depositOne(page, d!.no)).status).toBe('APPLIED')
    const s = (await scopeView(page, far.date, false)).settlements.find((x) => x.buyer === far.buyer)!
    expect([s.received, s.payment]).toEqual([far.total, 'PAID'])
  })
})

/** 날짜 고르기에서 그 날짜의 보이는 낱말 (연도·요일까지, D-101) */
async function dateLabel(select: ReturnType<Page['getByLabel']>, date: string): Promise<string> {
  const option = select.locator(`option[value="${date}"]`)
  await expect(option).toHaveCount(1)
  const text = (await option.textContent()) ?? ''
  expect(text).toMatch(/^\d{4}년 \d{1,2}월 \d{1,2}일\(.\)$/)
  return text
}

test.describe('계좌 연동 — 다른 판매자의 사업자번호 (수정 라운드 1)', () => {
  const OTHER = '이 사업자번호는 이 계정에서 쓸 수 없어요. 사업자번호를 확인해 주세요.'
  const DIFFERENT = '이 계정에 연결한 사업자번호와 달라요. 사업자번호를 확인해 주세요.'

  async function withPopbill(page: Page): Promise<void> {
    // E2E 서버엔 팝빌 키가 없다 — 원천 목록 응답만 "연동 가능"으로 바꿔 계좌조회 추가 칸을 연다
    await page.route((url) => url.pathname === '/api/deposits/sources', async (route: Route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      const res = await route.fetch()
      const body = (await res.json()) as Record<string, unknown>
      await route.fulfill({ response: res, json: { ...body, popbill: true } })
    })
  }

  test('계좌 연결·계좌 관리 주소가 409 CORP_NOT_ALLOWED면 서버 문장을 그대로 보이고 영어 코드는 없다 (AC-N3-46·50)', async ({ page }) => {
    await login(page)
    await withPopbill(page)
    await page.route((url) => url.pathname === '/api/deposits/sources', async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      expect(route.request().postDataJSON()).toMatchObject({ kind: 'POPBILL' })
      await route.fulfill({ status: 409, json: { error: { code: 'CORP_NOT_ALLOWED', message: OTHER } } })
    })
    await page.route((url) => url.pathname === '/api/deposits/popbill/manage-url', (route: Route) => route.fulfill({ status: 409, json: { error: { code: 'CORP_NOT_ALLOWED', message: DIFFERENT } } }))
    await page.goto('/deposits?tab=sources')
    await page.getByLabel('표시 이름').fill('국민 1234')
    await page.getByLabel('사업자번호').fill('123-45-67890')
    await page.getByLabel('은행').selectOption({ index: 1 })
    await page.getByLabel('계좌번호').fill('123456-78-901234')
    await page.getByRole('button', { name: '계좌 연결' }).click()
    await expect(page.getByText(OTHER)).toBeVisible()
    // 계좌 관리 주소 — 먼저 연 빈 창은 닫히고 문장이 보인다
    const popup = page.waitForEvent('popup')
    await page.getByRole('button', { name: '팝빌에서 계좌 등록·관리' }).click()
    const win = await popup
    await expect.poll(() => win.isClosed()).toBe(true)
    await expect(page.getByText(DIFFERENT)).toBeVisible()
    const text = await page.locator('main').innerText()
    expect(text).not.toContain('CORP_NOT_ALLOWED')
    // 고칠 수 있게 칸 값은 그대로 남는다 (실패한 연결이 입력을 지우지 않음)
    await expect(page.getByLabel('사업자번호')).toHaveValue('123-45-67890')
  })
})

test.describe('음성 — 이력을 받는 동안 말한 문장 (수정 라운드 1, AC-I4-40)', () => {
  function addDays(date: string, n: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
  }

  /** 기본 사전에 없는 네 글자 이름 (시험마다 다르게) */
  function hangulName(): string {
    const pool = '갸냐댜랴먀뱌샤야쟈챠캬탸퍄햐겨녀뎌려며벼셔여져쳐켜텨펴혀교뇨됴료묘뵤쇼요죠쵸쿄툐표효'
    return Array.from({ length: 4 }, () => pool[Math.floor(Math.random() * pool.length)]).join('')
  }

  /** 어제 실제 범위(가장 늦은 지난 범위 — 이력 10개 안)에 이 이름 상품, 오늘 실제 방송을 열어 둔다 */
  async function setup(page: Page, pastName: string): Promise<string> {
    await installFakeSpeech(page, { consent: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await login(page)
    const today = todayKst()
    const past = await smsSale(page, { memo: uniq('이력'), date: addDays(today, -1) })
    await registerApi(page, past.b, 61, pastName, 10000)
    const res = await page.request.post('/api/broadcasts', { data: { requestId: crypto.randomUUID(), date: today, rehearsal: false }, headers: { Origin: new URL(page.url()).origin } })
    expect(res.ok(), await res.text()).toBe(true)
    const body = (await res.json()) as Record<string, Record<string, unknown> | undefined>
    const b = body['result']?.['b'] ?? body['broadcast']?.['id']
    if (typeof b !== 'string') throw new Error(JSON.stringify(body))
    return b
  }

  /** 지난 범위 조회(/api/days 목록)를 붙잡아 두는 문 — release를 부르면 그때 보낸다 */
  async function holdHistory(page: Page): Promise<{ held: () => number; release: () => void }> {
    const waiting: Route[] = []
    let open = false
    await page.route((url) => url.pathname === '/api/days', async (route: Route) => {
      if (open) return route.fallback()
      waiting.push(route)
    })
    return {
      held: () => waiting.length,
      release: () => {
        open = true
        for (const r of waiting.splice(0)) void r.fallback()
      },
    }
  }

  test('이력이 늦게 와도(2초 안) 켜자마자 말한 지난 판매 품종을 알아듣는다 — 기록에도 남는다', async ({ page }) => {
    const pastName = hangulName()
    const b = await setup(page, pastName)
    const gate = await holdHistory(page)
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await turnOnVoice(page)
    await expect.poll(() => gate.held()).toBe(1)
    await speak(page, `41번 ${pastName} 만원`)
    // 이력을 받기 전엔 카드가 없다(미룸) — 받으면(기다림 2초 안) 이력 사전으로
    await expect(page.getByRole('list', { name: '음성 카드' }).getByRole('listitem')).toHaveCount(0)
    gate.release()
    await expect(card(page, `41번 ${pastName} 10,000원`)).toBeVisible()
    await expect(card(page, '41번 품종 미입력 10,000원')).toHaveCount(0)
    // 음성 기록에도 남는다 (D-V2-21 — "들린 말 기록" 대신)
    await openVoiceLog(page)
    await expect(voiceLogItems(page).first()).toContainText(`41번 ${pastName} 만원`)
  })

  test('이력이 끝내 오지 않아도 카드는 2초쯤 뒤 그때 사전으로 나온다 — 말한 문장을 잃지 않는다', async ({ page }) => {
    const b = await setup(page, hangulName())
    const gate = await holdHistory(page)
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await turnOnVoice(page)
    await expect.poll(() => gate.held()).toBe(1)
    await speak(page, '42번 핑크프릴 만원')
    await speak(page, '43번 라울 오천 원')
    // 이력 응답을 붙잡은 채로 카드가 나온다 (온 차례 — 나중 문장이 맨 앞)
    await expect(card(page, '43번 라울 5,000원')).toBeVisible()
    await expect(card(page, '42번 핑크프릴 10,000원')).toBeVisible()
    const order = await page.getByRole('list', { name: '음성 카드' }).getByRole('listitem').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
    expect(order.slice(0, 2)).toEqual(['43번 라울 5,000원 카드', '42번 핑크프릴 10,000원 카드'])
    expect(gate.held()).toBe(1)
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    gate.release()
  })
})

test.describe('음성 — 이력을 받는 동안 미룬 문장과 자동 등록 설정 (TE-N3-004)', () => {
  test('TE-N3-004: 자동 등록을 끈 채 말한 문장은, 이력을 기다리는 사이 자동 등록을 켜도 자동 등록 카드가 되지 않는다 (AC-I4-31 "설정을 끈 채 만든 카드", D-I4-05)', async ({ page }) => {
    // 시계를 멈춰 2초 기다림이 끝나지 않게 한다 — 이력 응답은 붙잡아 두었다가 자동 등록을 켠 뒤 놓아준다
    await installFakeSpeech(page, { consent: true, settings: { 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5 } })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.clock.install()
    await login(page)
    const waiting: Route[] = []
    let open = false
    await page.route((url) => url.pathname === '/api/days', async (route: Route) => {
      if (open) return route.fallback()
      waiting.push(route)
    })
    const date = uniqueDate()
    await openNewBroadcast(page, { date, rehearsal: true })
    await turnOnVoice(page)
    const now = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(now + 500)
    await expect.poll(() => waiting.length).toBe(1)
    await speak(page, '15번 라울 만원') // 자동 등록이 꺼진 채 말함
    const box = (await openExtras(page)).getByRole('checkbox', { name: '확실한 카드는 자동으로 등록' })
    await box.check()
    open = true
    for (const r of waiting.splice(0)) await r.fallback()
    await page.clock.runFor(1800) // 조용한 시간(D-V2-03) 뒤 카드가 나온다 (AC-V2-32)
    const c = card(page, '15번 라울 10,000원')
    await expect(c).toBeVisible()
    await expect(c.getByText(/초 뒤 자동 등록/)).toHaveCount(0)
    await page.clock.runFor(10_000)
    await expect(c).toBeVisible()
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register')).toEqual([])
  })
})

test.describe('휴대폰 메뉴 — 확인 필요 수가 커도 (수정 라운드 1, TE-N3-001)', () => {
  test('375×812에서 "입금 확인 1234"여도 막대 다섯 칸은 한 줄, 목록 항목은 한 줄에 하나 — 모두 44×44px 이상·가로 스크롤 없음 (AC-N3-49·40, UX-04, AC-NAV-01·02·05)', async ({ page, browser }) => {
    await login(page)
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
    const phone = await context.newPage()
    // 혼자 쓰는 판매자 + 라벨 켬 — 다른 시험이 남긴 켬/끔에 기대지 않고, 아래에서 "라벨"까지 다 나온 목록을 잰다
    await loginNewSeller(phone)
    const labels = await phone.request.put('/api/settings/labels', { data: { enabled: true }, headers: { Origin: new URL(phone.url()).origin } })
    expect(labels.status(), await labels.text()).toBe(200)
    // 수는 서버가 주는 값 — 확인 필요 1234건을 흉내 낸다
    await fakeReviewCount(phone, 1234)
    for (const path of ['/sms', '/deposits', '/settlements']) {
      await phone.goto(path)
      // AC-NAV-01·10: 막대는 ['방송','문자찜','구매자','정산','더보기'] (MOB1 D-MOB1-04) 한 줄·44px·화면 안 ("더보기"에는 수를 붙이지 않는다)
      await expectPhoneBar(phone)
      await expect(moreButton(phone)).toHaveText('더보기')
      // AC-NAV-02·05: 목록은 ['입금 확인 1234','포장','라벨','택배','설정'] ('라벨'은 라벨 기능이 켜져 있을 때만)
      await openMore(phone)
      const links = moreLinks(phone)
      // 라벨이 켜진 것을 화면이 안 뒤의 목록으로 잰다 (모르는 동안에는 "라벨"을 만들지 않는다, L-13 9)
      await expect(links, path).toHaveText(['입금 확인 1234', '포장', '라벨', '택배', '설정'], { useInnerText: true })
      const boxes: { text: string; x: number; y: number; w: number; h: number }[] = []
      for (const link of await links.all()) {
        const box = (await link.boundingBox())!
        boxes.push({ text: (await link.innerText()).replace(/\s+/g, ' ').trim(), x: box.x, y: box.y, w: box.width, h: box.height })
      }
      expect(boxes.filter((b) => b.w < 44 || b.h < 44).map((b) => `${b.text} ${String(Math.round(b.w))}×${String(Math.round(b.h))}`), path).toEqual([])
      // 목록 항목은 한 줄에 하나 (위에서 아래로) · 화면 안
      for (let i = 1; i < boxes.length; i += 1) expect(boxes[i]!.y, path).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.h - 0.5)
      expect(boxes.every((b) => b.x >= 0 && b.x + b.w <= 375 + 0.5), path).toBe(true)
      await noHorizontalScroll(phone)
      await closeMore(phone)
    }
    await phone.context().close()
  })
})
