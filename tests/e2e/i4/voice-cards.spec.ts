// I4 제안 카드 화면 (AC-I4-20~23) — test-e2e. 기대값은 acceptance·R-17·D-I4-03으로 정했다.
import { test, expect, type Page } from '@playwright/test'
import {
  board,
  boardItem,
  card,
  cardButton,
  cardList,
  day,
  history,
  installFakeSpeech,
  login,
  openNewBroadcast,
  recordRequests,
  registerApi,
  speak,
  turnOnVoice,
  uniqueDate,
  voiceRegion,
  writeEvent,
  openVoiceLog,
} from './support.ts'

const TOO_SOON = '새 카드가 방금 나왔어요. 확인하고 다시 Enter를 눌러 주세요.'

async function setup(page: Page, opts: { rehearsal?: boolean } = {}): Promise<{ b: string; date: string; rehearsal: boolean }> {
  await installFakeSpeech(page, { consent: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  const date = uniqueDate()
  const rehearsal = opts.rehearsal ?? true
  const b = await openNewBroadcast(page, { date, rehearsal })
  await turnOnVoice(page)
  return { b, date, rehearsal }
}

function registers(requests: { method: string; body: string }[]) {
  return requests.filter((r) => r.method === 'POST' && r.body.includes('"product.register"'))
}

test.describe('I4 제안 카드', () => {
  test('AC-I4-20: 카드 글·원래 문장·"확인 필요"·접근 이름, 잡담·끊어 말한 번호·"만원"만은 카드 없음, 새 카드가 맨 앞', async ({ page }) => {
    await setup(page)
    await speak(page, '안녕하세요 여러분')
    // V3 교체(D-V3-54): "십 오번"은 이제 앞 수와 합쳐 15번이 된다 — 끊어 말해 비우는 꼴은 자리가 겹치는 "5 13번"(AC-V3-65)
    await speak(page, '5 13번 라울 오천 원')
    await speak(page, '만원')
    // 받아쓴 말은 [음성 기록]에 남는다 (D-V2-08·D-V2-21 — 덩어리로 묶여 보인다)
    const log = await openVoiceLog(page)
    for (const text of ['안녕하세요 여러분', '5 13번 라울 오천 원', '만원']) await expect(log).toContainText(text)
    await page.keyboard.press('Escape')
    await expect(log).toHaveCount(0)
    await expect(cardList(page)).toHaveCount(0)
    await speak(page, '15번 핑크프릴 만오천 원')
    await speak(page, '16번 핑크푸릴 만원')
    const a = card(page, '15번 핑크프릴 15,000원')
    const b = card(page, '16번 핑크프릴 10,000원')
    await expect(a).toContainText('15번 핑크프릴 15,000원 — 등록할까요?')
    await expect(a).toContainText('들은 말: 15번 핑크프릴 만오천 원')
    await expect(a.getByText('확인 필요')).toHaveCount(0)
    await expect(b.getByText('확인 필요')).toBeVisible()
    await expect(cardList(page).getByRole('listitem')).toHaveText([/^16번/, /^15번/])
    for (const short of ['15번 핑크프릴 15,000원', '16번 핑크프릴 10,000원']) {
      for (const action of ['등록', '고치기', '닫기'] as const) await expect(cardButton(page, short, action)).toHaveCount(1)
    }
    // D-V3-41: 번호 없는 결과는 카드가 되지 않는다 — 세 번째 카드는 번호 있는 말로
    await speak(page, '18번 핑크프릴 만오천 원')
    await speak(page, '17번 라울')
    await expect(card(page, '18번 핑크프릴 15,000원')).toBeVisible()
    await expect(card(page, '17번 라울 가격 없음')).toBeVisible()
    // 손대지 않은 카드는 3장까지 — 가장 오래된 15번이 닫혔다
    await expect(cardList(page).getByRole('listitem')).toHaveCount(3)
    await expect(a).toHaveCount(0)
  })

  test('AC-I4-21: 1초 뒤 맨 앞 카드에만 "Enter 등록", Enter는 맨 앞만 등록, 바로 두 번째 Enter는 막힘, 다음 카드는 그 뒤 1초', async ({ page }) => {
    const { date } = await setup(page)
    const requests = recordRequests(page)
    const input = page.getByLabel('빠른 입력')
    await speak(page, '15번 핑크프릴 만오천 원')
    await speak(page, '16번 라울 만원')
    const a = card(page, '15번 핑크프릴 15,000원')
    const b = card(page, '16번 라울 10,000원')
    await expect(b.getByText('Enter 등록', { exact: true })).toBeVisible()
    await expect(a.getByText('Enter 등록', { exact: true })).toHaveCount(0)
    await expect(input).toBeFocused()
    await input.press('Enter')
    await input.press('Enter')
    await expect(boardItem(page, 16)).toBeVisible()
    await expect(b).toHaveCount(0)
    await expect(page.getByRole('alert').filter({ hasText: TOO_SOON })).toBeVisible()
    await expect(page.getByRole('button', { name: /되돌리기/ }).first()).toBeVisible()
    await expect(input).toBeFocused()
    expect(registers(requests)).toHaveLength(1)
    expect(JSON.parse(registers(requests)[0]!.body)).toMatchObject({ no: 16, name: '라울', price: 10000 })
    // A의 "Enter 등록"이 보이면 막힘 문장은 사라지고 Enter로 등록
    await expect(a.getByText('Enter 등록', { exact: true })).toBeVisible()
    await expect(page.getByText(TOO_SOON)).toHaveCount(0)
    await input.press('Enter')
    await expect(boardItem(page, 15)).toBeVisible()
    await expect(cardList(page)).toHaveCount(0)
    expect(registers(requests)).toHaveLength(2)
    // 카드가 없으면 빈 칸 Enter는 아무 일도 없다
    await input.press('Enter')
    const events = (await history(page, date, true)).filter((e) => e.type === 'product.register')
    expect(events.map((e) => e.fields['no'])).toEqual([16, 15])
  })

  test('AC-I4-21: 맨 앞이 된 지 1초 안의 Enter는 등록 없이 안내', async ({ page }) => {
    // 부하 때 카드가 뜬 뒤 Enter까지 실제 1초가 지나 버리지 않게 브라우저 시계를 멈추고 누른다 (카드가 뜬 뒤 0ms — 1초 안)
    await page.clock.install()
    await setup(page)
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)
    const requests = recordRequests(page)
    const input = page.getByLabel('빠른 입력')
    await speak(page, '15번 핑크프릴 만오천 원')
    // 조용한 시간(V2 D-V2-03, 1.8초)이 지나야 카드가 나온다 (AC-V2-32)
    await page.clock.runFor(1800)
    // 카드가 뜬 뒤에 누른다(카드보다 먼저 누르면 빈 칸 Enter라 아무 일도 없다). 시계가 멈춰 있어 기다리는 동안 1초가 지나지 않는다.
    const c = card(page, '15번 핑크프릴 15,000원')
    await expect(c).toBeVisible()
    await expect(c.getByText('Enter 등록', { exact: true })).toHaveCount(0)
    await input.press('Enter')
    await expect(page.getByRole('alert').filter({ hasText: TOO_SOON })).toBeVisible()
    await expect(c).toBeVisible()
    expect(registers(requests)).toHaveLength(0)
  })

  test('AC-I4-21: 빠른 입력칸에 글자가 있으면 Enter는 빠른 입력, 창이 열린 동안·고치기 칸이 열린 동안은 카드를 등록하지 않는다', async ({ page }) => {
    const { b } = await setup(page)
    const input = page.getByLabel('빠른 입력')
    await registerApi(page, b, 1, '테스트', 10000)
    await expect(boardItem(page, 1)).toBeVisible()
    await speak(page, '15번 핑크프릴 만오천 원')
    const c = card(page, '15번 핑크프릴 15,000원')
    await expect(c.getByText('Enter 등록', { exact: true })).toBeVisible()
    // 글자가 있으면 표시가 없고 Enter는 빠른 입력
    await input.fill('20 라울 10')
    await expect(c.getByText('Enter 등록', { exact: true })).toHaveCount(0)
    await input.press('Enter')
    await expect(boardItem(page, 20)).toBeVisible()
    await expect(c).toBeVisible()
    await expect(boardItem(page, 15)).toHaveCount(0)
    // 창이 열린 동안 (상품 창)
    await expect(c.getByText('Enter 등록', { exact: true })).toBeVisible()
    await boardItem(page, 1).click()
    const dlg = page.getByRole('dialog').first()
    await expect(dlg).toBeVisible()
    await expect(c.getByText('Enter 등록', { exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // 고치기 칸이 열린 동안 빠른 입력칸의 Enter
    await cardButton(page, '15번 핑크프릴 15,000원', '고치기').click()
    await input.focus()
    await expect(c.getByText('Enter 등록', { exact: true })).toHaveCount(0)
    await input.press('Enter')
    await expect(c).toBeVisible()
    await expect(boardItem(page, 15)).toHaveCount(0)
  })

  test('AC-I4-21: 아무 카드의 "등록"은 1초 기다림 없이 바로, 맨 앞이 아니어도', async ({ page }) => {
    await setup(page)
    const requests = recordRequests(page)
    await speak(page, '15번 핑크프릴 만오천 원')
    await speak(page, '16번 라울 만원')
    await cardButton(page, '15번 핑크프릴 15,000원', '등록').click()
    await expect(boardItem(page, 15)).toBeVisible()
    await expect(card(page, '16번 라울 10,000원')).toBeVisible()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    expect(registers(requests)).toHaveLength(1)
  })

  test('AC-I4-21: 휴대폰 폭에서는 "Enter 등록"이 없고 Enter로 카드를 등록하지 않는다', async ({ browser }) => {
    const baseURL = test.info().project.use.baseURL!
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', isMobile: true, hasTouch: true })
    const page = await context.newPage()
    await installFakeSpeech(page, { consent: true })
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await turnOnVoice(page)
    await speak(page, '15번 핑크프릴 만오천 원')
    const c = card(page, '15번 핑크프릴 15,000원')
    await expect(c).toBeVisible()
    const since = await page.evaluate(() => Date.now())
    await page.waitForFunction((end) => Date.now() >= end, since + 1300)
    await expect(c.getByText('Enter 등록', { exact: true })).toHaveCount(0)
    await page.getByLabel('빠른 입력').press('Enter')
    await expect(c).toBeVisible()
    await expect(boardItem(page, 15)).toHaveCount(0)
    await cardButton(page, '15번 핑크프릴 15,000원', '등록').tap()
    await expect(boardItem(page, 15)).toBeVisible()
    await context.close()
  })

  test('AC-I4-22: 번호 없는 카드·가격 없는 카드는 등록하지 않고 그 칸에 커서와 문장', async ({ page }) => {
    const { date } = await setup(page)
    // V3 교체(D-V3-41, AC-V3-51): 번호 없는 결과는 카드가 되지 않는다(기록만) — 번호 없는 카드의 "등록" 단계는 없어졌다
    await speak(page, '핑크프릴 만오천 원')
    await expect(cardList(page)).toHaveCount(0)
    await speak(page, '17번 라울')
    await cardButton(page, '17번 라울 가격 없음', '등록').click()
    const form2 = page.getByRole('group', { name: '17번 라울 가격 없음 고치기 칸' })
    await expect(form2.getByLabel('가격')).toBeFocused()
    await expect(form2.getByRole('alert')).toHaveText('가격이 없어요. 가격을 넣어 주세요.')
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register')).toEqual([])
  })

  test('AC-I4-22: 이미 있는 번호(판매 중·판매 종료)는 "고칠까요?"로 넘기고 카드는 사라진다, 바꾸지 않고 닫으면 쓰기 없음, 고치면 같은 상품 수정', async ({ page }) => {
    const { b, date } = await setup(page)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await registerApi(page, b, 16, '라울', 10000)
    const closed = await writeEvent(page, { type: 'product.close', b, no: 16 })
    expect(closed.status).toBeLessThan(300)
    await expect(boardItem(page, 16)).toBeVisible()
    const before = (await history(page, date, true)).length
    // V3 교체(D-V3-06·D-V3-22 b): 판매 중인 같은 번호는 카드 없이 R-22 — 설정 끔이면 묻기(까닭 줄 없음, 사례 R30). 그대로 두기면 쓰기 없음
    await speak(page, '15번 라울 만원')
    const ask = page.getByRole('list', { name: '방금 등록한 상품 고치기' }).getByRole('listitem', { name: '15번을 고칠까요? 품종 핑크프릴 → 라울', exact: true })
    await expect(ask).toBeVisible()
    await expect(card(page, '15번 라울 10,000원')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await ask.getByRole('button', { name: '그대로 두기' }).click()
    await expect(ask).toHaveCount(0)
    await expect(page.getByLabel('빠른 입력')).toHaveValue('')
    expect((await history(page, date, true)).length).toBe(before)
    await speak(page, '16번 핑크프릴 만오천 원')
    await cardButton(page, '16번 핑크프릴 15,000원', '등록').click()
    const dlg2 = page.getByRole('dialog', { name: '16번은 판매 종료된 상품이에요. 새 값으로 고쳐서 다시 팔까요?' })
    await expect(dlg2).toBeVisible()
    await dlg2.getByRole('button', { name: '예' }).click()
    await expect(dlg2).toHaveCount(0)
    await expect(boardItem(page, 16)).toContainText('15,000원')
    const after = (await history(page, date, true)).slice(before)
    expect(after.filter((e) => e.type === 'product.register')).toEqual([])
    expect(after.some((e) => e.type === 'product.update')).toBe(true)
  })

  test('AC-I4-23: 고치기 칸 — 처음 값·첫 빈 칸 커서·숫자 키패드, 가격 10 = 10,000원, 오류 문장, Esc는 칸만, 닫기는 사라짐', async ({ page }) => {
    const { date } = await setup(page)
    await speak(page, '15번 라울')
    await cardButton(page, '15번 라울 가격 없음', '고치기').click()
    const form = page.getByRole('group', { name: '15번 라울 가격 없음 고치기 칸' })
    await expect(form.getByLabel('번호')).toHaveValue('15')
    await expect(form.getByLabel('품종')).toHaveValue('라울')
    await expect(form.getByLabel('가격')).toHaveValue('')
    await expect(form.getByLabel('가격')).toBeFocused()
    await expect(form.getByLabel('번호')).toHaveAttribute('inputmode', 'numeric')
    await expect(form.getByLabel('가격')).toHaveAttribute('inputmode', 'numeric')
    await expect(cardButton(page, '15번 라울 가격 없음', '고치기')).toHaveAttribute('aria-expanded', 'true')
    // Esc: 칸만 닫힌다
    await page.keyboard.press('Escape')
    await expect(form).toHaveCount(0)
    await expect(card(page, '15번 라울 가격 없음')).toBeVisible()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    // 다시 열고 잘못된 번호 → 오류 문장, 그 칸에 커서
    await cardButton(page, '15번 라울 가격 없음', '고치기').click()
    await form.getByLabel('번호').fill('0')
    await form.getByLabel('가격').fill('10')
    await form.getByLabel('가격').press('Enter')
    await expect(form.getByRole('alert')).toBeVisible()
    await expect(form.getByLabel('번호')).toBeFocused()
    await form.getByLabel('번호').fill('15')
    await form.getByLabel('번호').press('Enter')
    await expect(boardItem(page, 15)).toContainText('10,000원')
    await expect(cardList(page)).toHaveCount(0)
    const reg = (await history(page, date, true)).filter((e) => e.type === 'product.register')
    expect(reg).toHaveLength(1)
    expect(reg[0]!.fields).toMatchObject({ no: 15, name: '라울', price: 10000 })
    // 닫기
    await speak(page, '16번 라울 만원')
    await cardButton(page, '16번 라울 10,000원', '닫기').click()
    await expect(cardList(page)).toHaveCount(0)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register')).toHaveLength(1)
  })

  test('AC-I4-23: 고치기 칸의 번호가 이미 있는 번호면 "고칠까요?"', async ({ page }) => {
    const { b } = await setup(page)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await expect(boardItem(page, 15)).toBeVisible()
    await speak(page, '17번 라울 만원')
    await cardButton(page, '17번 라울 10,000원', '고치기').click()
    const form = page.getByRole('group', { name: '17번 라울 10,000원 고치기 칸' })
    await form.getByLabel('번호').fill('15')
    await form.getByLabel('번호').press('Enter')
    await expect(page.getByRole('dialog', { name: '15번이 이미 있어요. 고칠까요?' })).toBeVisible()
    await expect(card(page, '17번 라울 10,000원')).toHaveCount(0)
  })

  test('AC-I4-23: 키보드(Tab)만으로 카드의 등록·고치기·닫기와 고치기 칸에 닿는다', async ({ page }) => {
    await setup(page)
    await speak(page, '15번 라울 만원')
    const short = '15번 라울 10,000원'
    // 조용한 시간(V2 D-V2-03) 뒤 카드가 나온 다음에 Tab을 센다 (AC-V2-32)
    await expect(card(page, short)).toBeVisible()
    const reached = new Set<string>()
    await page.getByLabel('빠른 입력').focus()
    for (let i = 0; i < 40 && reached.size < 3; i++) {
      await page.keyboard.press('Tab')
      const name = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
      for (const action of ['등록', '고치기', '닫기']) if (name === `${short} ${action}`) reached.add(action)
    }
    expect([...reached].sort()).toEqual(['고치기', '닫기', '등록'])
    await cardButton(page, short, '고치기').focus()
    await page.keyboard.press('Enter')
    const form = page.getByRole('group', { name: `${short} 고치기 칸` })
    await expect(form.getByLabel('번호')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(form.getByLabel('품종')).toBeFocused()
  })

  test('AC-I4-21: 카드 등록과 같은 번호의 빠른 입력이 겹치면 차례대로 — 한 번만 등록, 뒤 줄은 "고칠까요?"', async ({ page }) => {
    const { date } = await setup(page)
    const input = page.getByLabel('빠른 입력')
    await speak(page, '15번 핑크프릴 만오천 원')
    await cardButton(page, '15번 핑크프릴 15,000원', '등록').click()
    await input.fill('15 라울 20')
    await input.press('Enter')
    await expect(boardItem(page, 15)).toBeVisible()
    await expect(page.getByRole('dialog', { name: '15번이 이미 있어요. 고칠까요?' }).or(page.getByRole('button', { name: /고칠까요/ }).first())).toBeVisible()
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register')).toHaveLength(1)
    void board
  })

  // MOB2 D-MOB2-07·14: 카드 등록은 빠른 입력과 같은 등록 경로(D-I4-03)라, 연결이 돌아오면 누르지 않아도 처음 요청 번호로 한 번 저절로 다시 보낸다
  test('AC-I4-21: 오프라인 중 카드 등록 → "다시 보내기"로 남음 → 연결이 돌아오면 저절로 같은 요청 번호로 한 번만 기록, Ctrl+Z는 판매 종료', async ({ page, context }) => { // MOB2 D-MOB2-07
    const { date } = await setup(page)
    const requests = recordRequests(page) // MOB2 D-MOB2-07
    const requestIds = () => registers(requests).map((r) => String((JSON.parse(r.body) as Record<string, unknown>)['requestId'])) // MOB2 D-MOB2-07
    await speak(page, '15번 핑크프릴 만오천 원')
    // APP1b: 서버가 읽어 보낸 카드를 받은 뒤 끊는다. 전송 중이던 글을 버린 경우와 구분한다.
    await expect(cardButton(page, '15번 핑크프릴 15,000원', '등록')).toBeVisible()
    await context.setOffline(true)
    await cardButton(page, '15번 핑크프릴 15,000원', '등록').click()
    const retry = page.getByRole('button', { name: /다시 보내기/ }).first()
    await expect(retry).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('연결이 돌아오면 저절로 다시 보내요.', { exact: false }).first()).toBeVisible() // MOB2 D-MOB2-16
    const first = requestIds() // MOB2 D-MOB2-07
    expect(first.length, '끊김 중 보낸 등록 요청').toBeGreaterThan(0) // MOB2 D-MOB2-07
    expect(new Set(first).size, '끊김 중 재시도도 같은 요청 번호').toBe(1) // MOB2 D-MOB2-07
    const before = first.length // MOB2 D-MOB2-07
    await context.setOffline(false)
    await expect(page.getByText('실시간 연결이 끊겼어요. 다시 연결하는 중이에요.')).toHaveCount(0, { timeout: 20_000 }) // MOB2 D-MOB2-07
    await expect(boardItem(page, 15)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('연결이 돌아와 보냈어요: 15번을 등록했어요')).toBeVisible() // MOB2 D-MOB2-07
    await expect(retry, '누르지 않아도 실패 줄이 사라진다').toHaveCount(0) // MOB2 D-MOB2-07
    expect(requestIds().slice(before), '돌아온 뒤 등록 요청 — 처음 요청 번호 그대로 한 번').toEqual([first[0]]) // MOB2 D-MOB2-07·14
    await page.keyboard.press('Control+z')
    await expect(page.getByText('15번 등록을 되돌렸어요(판매 종료)')).toBeVisible()
    const events = await history(page, date, true)
    expect(events.filter((e) => e.type === 'product.register')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'product.close')).toHaveLength(1)
    void day
    void voiceRegion
  })
})
