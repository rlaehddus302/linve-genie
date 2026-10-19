// AC-S05-01·02·10~15 기본 흐름 (test-e2e). 기대값은 acceptance.md 문장에서 정했다.
import { test, expect } from '@playwright/test'
import { LOGIN_ID, PASSWORD, board, boardItem, history, login, newBroadcast, register, uniqueDate } from './support.ts'

test.describe('AC-S05-01 로그인', () => {
  test('로그인 화면 — 가입 없음, 틀린 비밀번호 문장, 아이디 남음, 로그아웃', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByLabel('아이디')).toBeVisible()
    await expect(page.getByLabel('비밀번호')).toHaveAttribute('type', 'password')
    await expect(page.getByText(/가입/)).toHaveCount(0)
    await page.getByLabel('아이디').fill(LOGIN_ID)
    await page.getByLabel('비밀번호').fill('wrong-password-x')
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page.getByText('아이디나 비밀번호가 맞지 않아요.')).toBeVisible()
    await expect(page.getByLabel('아이디')).toHaveValue(LOGIN_ID)
    await page.getByLabel('비밀번호').fill(PASSWORD)
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page.getByText('시험 가게')).toBeVisible()
    await page.getByRole('button', { name: '로그아웃' }).click()
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible()
  })

  test('세션이 끝나면 문장 → 다시 로그인하면 같은 콘솔', async ({ page }) => {
    await login(page)
    const b = await newBroadcast(page, { date: uniqueDate(), title: '세션 방송' })
    // 다른 기기에서 로그아웃해도 이 세션은 남는다 — 같은 쿠키로 로그아웃해 세션을 끝낸다
    // 세션 쿠키가 사라지면 다음 API가 401이다 (세션 만료와 같다)
    await page.context().clearCookies()
    // 어떤 API든 401 → 로그인 화면
    await page.getByLabel('빠른 입력').fill('3 세션품종 5000')
    await page.getByLabel('빠른 입력').press('Enter')
    await expect(page.getByText('로그인이 풀렸어요. 다시 로그인해 주세요.')).toBeVisible()
    await page.getByLabel('아이디').fill(LOGIN_ID)
    await page.getByLabel('비밀번호').fill(PASSWORD)
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page.getByLabel('빠른 입력')).toBeVisible()
    expect(decodeURIComponent(page.url())).toContain(b)
  })
})

test.describe('AC-S05-02 방송 목록', () => {
  test('제목에 휴대폰 번호가 있으면 서버 문장을 보이고 방송을 만들지 않는다', async ({ page }) => {
    await login(page)
    const before = await (await page.request.get('/api/broadcasts')).json() as { broadcasts: unknown[] }
    await page.getByRole('button', { name: '새 방송 시작' }).click()
    await page.getByLabel('제목').fill('문의 010-1234-5678')
    await page.getByLabel('날짜').fill(uniqueDate())
    await page.getByRole('button', { name: '이 방송 시작하기' }).click()
    await expect(page.getByText(/전화번호|휴대폰/).first()).toBeVisible()
    const after = await (await page.request.get('/api/broadcasts')).json() as { broadcasts: unknown[] }
    expect(after.broadcasts.length).toBe(before.broadcasts.length)
  })

  test('새 방송 → 콘솔, 방송 끝내기 → "끝난 방송이에요", 목록에 끝남', async ({ page }) => {
    await login(page)
    const title = `끝낼 방송 ${String(Date.now() % 100000)}`
    await newBroadcast(page, { date: uniqueDate(), title })
    await page.getByRole('button', { name: '방송 끝내기' }).click()
    const dlg = page.getByRole('dialog', { name: '방송 끝내기' })
    await expect(dlg.getByText('방송을 끝낼까요? 끝난 뒤에도 늦게 온 채팅·문자찜은 처리돼요.')).toBeVisible()
    await dlg.getByRole('button', { name: '끝내기' }).click()
    await expect(page.getByText('끝난 방송이에요')).toBeVisible()
    // 끝난 방송에서도 조치는 그대로 (R-1)
    await register(page, '7 끝난뒤 7000', 7)
    await page.getByRole('link', { name: '방송 목록' }).click()
    await expect(page.getByRole('list', { name: '방송' }).getByRole('link', { name: new RegExp(title) })).toContainText('끝남')
  })
})

test.describe('AC-S05-10 빠른 입력 등록', () => {
  test('네 가지 표기 → 품종 핑크프릴·10,000원 판매 중', async ({ page }) => {
    await login(page)
    await newBroadcast(page, { date: uniqueDate() })
    const lines: [string, number][] = [['15 핑크프릴 10000', 15], ['16 핑크프릴 1만', 16], ['17번 핑크프릴 만원', 17], ['18/핑크프릴/10', 18]]
    for (const [line, no] of lines) {
      await register(page, line, no)
      await expect(boardItem(page, no)).toContainText('핑크프릴')
      await expect(boardItem(page, no)).toContainText('10,000원')
      await expect(boardItem(page, no)).toContainText('판매 중')
    }
    await register(page, '31 방울복랑 금 15000', 31)
    await expect(boardItem(page, 31)).toContainText('방울복랑 금')
    await expect(boardItem(page, 31)).toContainText('15,000원')
    await register(page, '32 10000', 32)
    await expect(boardItem(page, 32)).toContainText('품종 미입력')
  })

  test('Enter 다섯 번 연타 → 모두 순서대로 한 번씩', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    await newBroadcast(page, { date })
    const input = page.getByLabel('빠른 입력')
    for (let no = 41; no <= 45; no += 1) {
      await input.pressSequentially(`${String(no)} 연타${String(no)} ${String(no * 1000)}`, { delay: 25 })
      await input.press('Enter')
    }
    for (let no = 41; no <= 45; no += 1) await expect(boardItem(page, no)).toBeVisible()
    await expect(input).toHaveValue('')
    const events = (await history(page, date, false)).filter((e) => e.type === 'product.register')
    expect(events.map((e) => e.fields['no'])).toEqual([41, 42, 43, 44, 45])
  })
})

test('TE-S05-001: 쓰기 응답이 느린(500ms) 동안 다섯 줄을 이어 쳐도 모두 순서대로 한 번씩 등록된다(줄이 이어 붙지 않는다)', async ({ page }) => {
  // 휴대폰 회선·붐비는 서버처럼 쓰기 응답이 500ms 걸린다. 판매자는 짧은 줄을 한 글자 40ms로 친다.
  // 앞 줄 응답 전에 Enter를 친 줄은 판단이 미뤄지고 칸의 글자가 골라지지 않아, 다음 줄이 그 뒤에 이어 붙는다.
  await login(page)
  const date = uniqueDate()
  await newBroadcast(page, { date })
  await page.route('**/api/events**', async (route) => {
    await new Promise((r) => setTimeout(r, 500))
    await route.continue()
  })
  const input = page.getByLabel('빠른 입력')
  for (let no = 51; no <= 55; no += 1) {
    await input.pressSequentially(`${String(no)} 꽃 1만`, { delay: 40 })
    await input.press('Enter')
  }
  for (let no = 51; no <= 55; no += 1) await expect(boardItem(page, no)).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(input).toHaveValue('')
  const events = (await history(page, date, false)).filter((e) => e.type === 'product.register')
  expect(events.map((e) => e.fields['no'])).toEqual([51, 52, 53, 54, 55])
})

test.describe('AC-S05-11 오류 → 고칠 칸', () => {
  test('오류별 문장과 커서, Esc는 아무것도 등록하지 않음', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    await newBroadcast(page, { date })
    const input = page.getByLabel('빠른 입력')
    await input.fill('15 핑크프릴')
    await input.press('Enter')
    await expect(page.getByText('가격을 알아보지 못했어요. 가격 칸에 적어 주세요.')).toBeVisible()
    await expect(page.getByLabel('가격')).toBeFocused()
    await expect(page.getByLabel('번호')).toHaveValue('15')
    await expect(page.getByLabel('품종')).toHaveValue('핑크프릴')
    await page.keyboard.press('Escape')
    await expect(page.getByLabel('가격')).toHaveCount(0)
    await expect(input).toBeFocused()

    await input.fill('15 핑크프릴 50원')
    await input.press('Enter')
    await expect(page.getByText('가격이 100원보다 적어요. 가격을 확인해 주세요.')).toBeVisible()
    await expect(page.getByLabel('가격')).toBeFocused()
    await page.keyboard.press('Escape')

    await input.fill('핑크프릴 10000')
    await input.press('Enter')
    await expect(page.getByText('맨 앞에 상품 번호를 적어 주세요. 예: 15 핑크프릴 10000')).toBeVisible()
    await expect(page.getByLabel('번호')).toBeFocused()
    await page.keyboard.press('Escape')

    await input.fill('1000 핑크프릴 10000')
    await input.press('Enter')
    await expect(page.getByText('번호는 1부터 999까지예요. 번호를 확인해 주세요.')).toBeVisible()
    await expect(page.getByLabel('번호')).toBeFocused()
    await page.keyboard.press('Escape')

    expect((await history(page, date, false)).filter((e) => e.type === 'product.register')).toEqual([])
  })

  test('고치기 칸 Enter → 그 값으로 등록(가격은 빠른 입력과 같은 해석)', async ({ page }) => {
    await login(page)
    await newBroadcast(page, { date: uniqueDate() })
    const input = page.getByLabel('빠른 입력')
    await input.fill('21 홍옥')
    await input.press('Enter')
    await page.getByLabel('가격').fill('1만2천')
    await page.getByLabel('가격').press('Enter')
    await expect(boardItem(page, 21)).toContainText('12,000원')
    await expect(boardItem(page, 21)).toContainText('홍옥')
  })
})

test.describe('AC-S05-12 번호 찾기', () => {
  test('치는 동안 미리 보기, 번호만 Enter → 자세히·현재 상품', async ({ page }) => {
    await login(page)
    await newBroadcast(page, { date: uniqueDate() })
    await register(page, '15 핑크프릴 10000', 15)
    await register(page, '16 청보석 20000', 16)
    const input = page.getByLabel('빠른 입력')
    await input.fill('15 핑')
    const preview = page.getByRole('status', { name: '찾은 상품' })
    await expect(preview).toContainText('15')
    await expect(preview).toContainText('핑크프릴')
    await expect(preview).toContainText('10,000원')
    await expect(preview).toContainText('판매 중')
    await input.fill('15번')
    await input.press('Enter')
    await expect(page.getByRole('dialog', { name: '15번 자세히' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '15번 자세히' }).getByRole('button', { name: '닫기' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('region', { name: '현재 상품' })).toContainText('핑크프릴')
    await expect(input).toBeFocused()
  })
})

test.describe('AC-S05-13 같은 번호 → 고칠까요?', () => {
  test('예 → 바뀐 칸만 product.update, 아니요 → 친 줄 그대로', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    await newBroadcast(page, { date })
    await register(page, '15 핑크프릴 10000', 15)
    const input = page.getByLabel('빠른 입력')
    await input.fill('15 핑크프릴 12000')
    await input.press('Enter')
    const dlg = page.getByRole('dialog', { name: '15번이 이미 있어요. 고칠까요?' })
    await expect(dlg).toBeVisible()
    await dlg.getByRole('button', { name: '아니요' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(input).toHaveValue('15 핑크프릴 12000')
    await input.press('Enter')
    await page.getByRole('dialog', { name: '15번이 이미 있어요. 고칠까요?' }).getByRole('button', { name: '예' }).click()
    await expect(boardItem(page, 15)).toContainText('12,000원')
    const updates = (await history(page, date, false)).filter((e) => e.type === 'product.update')
    expect(updates).toHaveLength(1)
    expect(updates[0]!.fields).not.toHaveProperty('name')
    expect(updates[0]!.fields['price']).toBe(12000)
  })

  test('판매 종료 상품 → "다시 팔까요?" → update 뒤 open', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    await newBroadcast(page, { date })
    await register(page, '15 핑크프릴 10000', 15)
    await boardItem(page, 15).click()
    const detail = page.getByRole('dialog', { name: '15번 자세히' })
    await detail.getByRole('button', { name: '판매 종료' }).click()
    const confirm = page.getByRole('dialog', { name: '판매 종료' })
    await expect(confirm.getByText('15번을 판매 종료할까요? 새 찜을 받지 않아요.')).toBeVisible()
    await confirm.getByRole('button', { name: '판매 종료' }).click()
    await expect(boardItem(page, 15)).toContainText('판매 종료')
    await page.keyboard.press('Escape')
    const input = page.getByLabel('빠른 입력')
    await input.fill('15 핑크프릴 9000')
    await input.press('Enter')
    const ask = page.getByRole('dialog', { name: /15번은 판매 종료된 상품이에요/ })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: '예' }).click()
    await expect(boardItem(page, 15)).toContainText('판매 중')
    await expect(boardItem(page, 15)).toContainText('9,000원')
  })
})

test.describe('AC-S05-14 보드', () => {
  test('가장 최근 등록 순', async ({ page }) => {
    await login(page)
    await newBroadcast(page, { date: uniqueDate() })
    await register(page, '5 다섯 5000', 5)
    await register(page, '3 셋 3000', 3)
    await register(page, '9 아홉 9000', 9)
    const names = await board(page).getByRole('button', { name: /^\d+번 / }).allInnerTexts()
    expect(names.map((t) => /(\d+)/.exec(t)?.[1])).toEqual(['9', '3', '5'])
  })
})
