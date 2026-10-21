// I3 — 보조자 계정·시작 마법사·설정 화면 (기본 묶음, 유튜브 준비 안 됨). AC-I3-44~47·50~56·63·64·77
import { expect, test } from '@playwright/test'
import { loginAs, loginNewSeller, newSeller, noHorizontalScroll, settingsRegion, smsUi } from './support.ts'

test.describe('보조자', () => {
  test('AC-I3-64·63: 만들기 → 다른 컨텍스트로 로그인 → 문자찜 → 판매자가 지움 → 보조자 화면이 로그인 화면으로', async ({ page, browser }) => {
    await loginNewSeller(page)
    const res = await page.request.post('/api/broadcasts', { data: { requestId: crypto.randomUUID(), rehearsal: false, title: '보조자 방송' }, headers: { Origin: new URL(page.url()).origin } })
    expect(res.ok(), await res.text()).toBe(true)
    await page.goto('/settings')
    const section = settingsRegion(page, '보조자')
    await section.getByLabel('보조자 이름').fill('민지')
    await section.getByRole('button', { name: '보조자 만들기' }).click()
    const dialog = page.getByRole('dialog', { name: '보조자 민지을(를) 만들었어요' })
    await expect(dialog).toContainText('이 아이디와 비밀번호는 지금 한 번만 보여요. 보조자에게 전해 주세요.')
    const [idText, pwText] = await dialog.locator('dd').allInnerTexts()
    const loginId = (idText ?? '').trim()
    const password = (pwText ?? '').trim()
    expect(loginId).toMatch(/^bo-/)
    expect(password.length).toBeGreaterThanOrEqual(16)
    await dialog.getByRole('button', { name: '다 적었어요' }).click()
    await expect(dialog).toHaveCount(0)
    // 비밀번호는 창을 닫은 뒤 화면·저장소 어디에도 없다
    expect(await page.locator('body').innerText()).not.toContain(password)
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href)
    expect(stored).not.toContain(password)

    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
    const phone = await ctx.newPage()
    await loginAs(phone, { loginId, password })
    await expect(phone).toHaveURL(/\/sms$/)
    await expect(phone.getByRole('banner')).toContainText('보조자')
    await expect(phone.getByRole('region', { name: '고른 방송' })).toContainText('보조자 방송')
    await expect(phone.getByRole('region', { name: '최근 넣은 문자찜' })).toBeVisible()
    await smsUi(phone, { no: 7, phone: '010-1234-5678' })

    await section.getByRole('button', { name: '민지 지우기' }).click()
    const confirm = page.getByRole('dialog', { name: '보조자 민지을(를) 지울까요?' })
    await expect(confirm.getByRole('button', { name: '그대로 두기' })).toBeFocused()
    await confirm.getByRole('button', { name: '지우기' }).click()
    await expect(confirm).toHaveCount(0)
    // 판매자가 지우면 보조자 화면은 (아무것도 누르지 않아도) 로그인 화면이 된다 — 열린 실시간 연결은 1초 안에 닫힌다
    await expect(phone.getByRole('button', { name: '로그인' })).toBeVisible({ timeout: 15_000 })
    await ctx.close()
  })

  test('AC-I3-63: 보조자가 다른 화면 주소를 열면 안내만 — 데이터 요청 없음', async ({ page, browser }) => {
    await loginNewSeller(page)
    const created = await page.request.post('/api/assistants', { data: { name: '도우미' }, headers: { Origin: new URL(page.url()).origin } })
    expect(created.ok()).toBe(true)
    const { assistant, password } = await created.json() as { assistant: { loginId: string }; password: string }
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await loginAs(p, { loginId: assistant.loginId, password })
    for (const path of ['/', '/buyers', '/settlements', '/settings', '/start', '/broadcasts/x']) {
      const forbidden: string[] = []
      p.on('response', (r) => {
        if (r.status() === 403) forbidden.push(r.url())
      })
      await p.goto(path)
      await expect(p.getByText('보조자 계정으로는 쓸 수 없는 화면이에요.')).toBeVisible()
      await expect(p.getByRole('link', { name: '문자찜 입력으로 가기' })).toBeVisible()
      expect(forbidden, path).toEqual([])
    }
    await ctx.close()
  })
})

test.describe('시작 마법사', () => {
  test('AC-I3-50: 새 판매자 → 처음 로그인에 저절로 열림 → 나중에 할게요 → 다른 컨텍스트로 로그인해도 안 열림', async ({ page, browser }) => {
    const seller = await newSeller(page.request)
    await loginAs(page, seller)
    await expect(page).toHaveURL(/\/start$/)
    await expect(page.getByRole('heading', { level: 2, name: '1/5 가게 이름' })).toBeFocused()
    await page.getByRole('button', { name: '나중에 할게요' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('button', { name: '새 방송 시작' })).toBeVisible()
    const ctx = await browser.newContext()
    const other = await ctx.newPage()
    await loginAs(other, seller)
    await expect(other.getByRole('button', { name: '새 방송 시작' })).toBeVisible()
    await expect(other).toHaveURL(/\/$/)
    await ctx.close()
  })

  test('AC-I3-50: 끝까지 가서 마치기 → 다시 저절로 열리지 않는다 ', async ({ page }) => {
    const seller = await newSeller(page.request)
    await loginAs(page, seller)
    await expect(page).toHaveURL(/\/start$/)
    for (const title of ['2/5 판매 규칙 확인', '3/5 유튜브 연결', '4/5 프린터 연결', '5/5 리허설 해 보기']) {
      await page.getByRole('button', { name: '다음' }).click()
      await expect(page.getByRole('heading', { level: 2, name: title })).toBeFocused()
    }
    await page.getByRole('button', { name: '마치기' }).click()
    await expect(page.getByRole('button', { name: '새 방송 시작' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: '새 방송 시작' })).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
  })

  test('AC-I3-51·52: 1단계 이름을 바꾸지 않으면 저장 요청 없음, 2단계 기본값 여섯 줄·바꾸지 않고 다음이면 설정 요청 없음', async ({ page }) => {
    const seller = await newSeller(page.request)
    const writes: string[] = []
    page.on('request', (r) => {
      if (r.method() !== 'GET' && (r.url().includes('/api/shop') || r.url().includes('/api/settings'))) writes.push(`${r.method()} ${r.url()}`)
    })
    await loginAs(page, seller)
    await expect(page.getByRole('heading', { level: 2, name: '1/5 가게 이름' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '가게 이름' })).toHaveValue(seller.shopName)
    await page.getByRole('button', { name: '다음' }).click()
    await expect(page.getByRole('heading', { level: 2, name: '2/5 판매 규칙 확인' })).toBeVisible()
    for (const line of ['대기 인원: 5명', '1등이 취소되면: 대기 1순위가 바로 1등', '시청자가 채팅으로 취소하면: 내가 확인하고 처리해요', '가격 단위: 천원 (10 → 10,000원)', '기본 배송비: 4,000원', '무료배송 기준: 없음']) {
      await expect(page.getByText(line, { exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: '다음' }).click()
    await expect(page.getByRole('heading', { level: 2, name: '3/5 유튜브 연결' })).toBeVisible()
    expect(writes).toEqual([])
  })

  test('AC-I3-47·51: 1단계에서 틀린 이름은 다음으로 가지 않고, 맞는 이름은 위 줄이 바로 바뀐다', async ({ page }) => {
    const seller = await newSeller(page.request)
    await loginAs(page, seller)
    const field = page.getByRole('textbox', { name: '가게 이름' })
    await field.fill('가'.repeat(31))
    await page.getByRole('button', { name: '다음' }).click()
    await expect(page.getByText('가게 이름은 1~30자로 적어 주세요.')).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: '1/5 가게 이름' })).toBeVisible()
    await field.fill('  새 가게  ')
    await page.getByRole('button', { name: '다음' }).click()
    await expect(page.getByRole('heading', { level: 2, name: '2/5 판매 규칙 확인' })).toBeVisible()
    await expect(page.getByRole('banner')).toContainText('새 가게')
  })

  test('AC-I3-55: 리허설 시작하기 두 번 눌러도 리허설 하나, 그 콘솔로', async ({ page }) => {
    const seller = await newSeller(page.request)
    await loginAs(page, seller, '/start')
    await page.goto('/start')
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '다음' }).click()
    const start = page.getByRole('button', { name: '리허설 시작하기' })
    await start.dblclick()
    await expect(page.getByText('리허설 중 — 실제 판매가 아니에요')).toBeVisible()
    const list = await (await page.request.get('/api/broadcasts')).json() as { broadcasts: { rehearsal: boolean }[] }
    expect(list.broadcasts.filter((x) => x.rehearsal)).toHaveLength(1)
    const wizard = await (await page.request.get('/api/wizard')).json() as { wizard: { status: string } }
    expect(wizard.wizard.status).toBe('DONE')
  })

  test('AC-I3-56: 375×812에서 가로 스크롤 없음·누르는 곳 44px 이상·글자 16px 이상 (다섯 단계 모두)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const seller = await newSeller(page.request)
    await loginAs(page, seller)
    for (let step = 1; step <= 5; step++) {
      await expect(page.getByRole('heading', { level: 2, name: new RegExp(`^${String(step)}/5`) })).toBeVisible()
      await noHorizontalScroll(page)
      const small = await page.evaluate(() => {
        const out: string[] = []
        for (const el of document.querySelectorAll<HTMLElement>('main button, main a, main input')) {
          const r = el.getBoundingClientRect()
          if (r.width === 0) continue
          if (r.height < 44 || r.width < 44) out.push(`${el.tagName} ${el.textContent ?? ''} ${String(r.width)}x${String(r.height)}`)
        }
        for (const el of document.querySelectorAll<HTMLElement>('main p, main li, main label, main button, main h2')) {
          if (parseFloat(getComputedStyle(el).fontSize) < 16 && (el.textContent ?? '').trim() !== '') out.push(`font ${el.tagName} ${el.textContent ?? ''}`)
        }
        return out
      })
      expect(small, `단계 ${String(step)}`).toEqual([])
      if (step < 5) await page.getByRole('button', { name: '다음' }).click()
    }
  })
})

test.describe('설정 화면', () => {
  test('AC-I3-44: 칸 제목 일곱·그 밖 링크·/settings/youtube는 유튜브 칸 제목에 포커스', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings')
    for (const title of ['가게', '판매 규칙', '배송비', '구매 감사 메시지', '유튜브', '보조자', '그 밖']) await expect(settingsRegion(page, title)).toBeVisible()
    const other = settingsRegion(page, '그 밖')
    await expect(other.getByRole('link', { name: '시작 마법사 다시 하기' })).toHaveAttribute('href', '/start')
    await expect(other.getByRole('link', { name: '개인정보처리방침' })).toHaveAttribute('href', '/privacy')
    await expect(other.getByRole('link', { name: '이용약관' })).toHaveAttribute('href', '/terms')
    await page.goto('/settings/youtube')
    await expect(settingsRegion(page, '유튜브').getByRole('heading', { name: '유튜브' })).toBeFocused()
    await expect(settingsRegion(page, '유튜브')).toContainText('유튜브 연동을 준비하지 않은 서버예요.')
    await expect(settingsRegion(page, '유튜브').getByRole('button')).toHaveCount(0)
  })

  test('AC-I3-45·46: 낱말·더 보기 접힘·경고·바뀐 키만 저장·범위 밖은 칸 옆 문장', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings')
    const rules = settingsRegion(page, '판매 규칙')
    const more = rules.getByRole('button', { name: '더 보기 (잘 모르면 그대로 두세요)' })
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await expect(rules.getByRole('radiogroup', { name: '주문 인식 방식' })).toBeHidden()
    await rules.getByRole('radiogroup', { name: '시청자가 채팅으로 취소하면' }).getByRole('radio', { name: '바로 취소해요' }).check()
    await expect(rules.getByText('장난 취소도 바로 처리돼요.')).toBeVisible()
    await more.click()
    await rules.getByRole('radiogroup', { name: '주문 인식 방식' }).getByRole('radio', { name: /^느슨하게/ }).check()
    await expect(rules.getByText("느슨하게 하면 '15번 예뻐요' 같은 채팅도 주문이 될 수 있어요.")).toBeVisible()
    await expect(rules.getByLabel('대기 인원 (0이면 대기 없음)')).toHaveAttribute('inputmode', 'numeric')
    await rules.getByLabel('대기 인원 (0이면 대기 없음)').fill('101')
    const patches: unknown[] = []
    page.on('request', (r) => {
      if (r.method() === 'PATCH' && r.url().endsWith('/api/settings')) patches.push(r.postDataJSON())
    })
    await rules.getByRole('button', { name: '저장' }).click()
    await expect(rules.getByText('0부터 100까지의 정수로 적어 주세요', { exact: false })).toBeVisible()
    const before = await (await page.request.get('/api/settings')).json() as { settings: Record<string, unknown> }
    expect(before.settings['waitlist.max']).toBe(5)
    expect(before.settings['cancel.buyerChat']).toBe('REQUEST')
    await rules.getByLabel('대기 인원 (0이면 대기 없음)').fill('1')
    await rules.getByRole('button', { name: '저장' }).click()
    await expect(rules.getByText('저장했어요. 다음에 시작하는 방송부터 적용돼요.')).toBeVisible()
    expect(patches.at(-1)).toEqual({ settings: { 'waitlist.max': 1, 'cancel.buyerChat': 'AUTO', 'claim.parseMode': 'LOOSE' } })
    const body = await page.locator('main').innerText()
    for (const word of ['waitlist', 'cancel.', 'LOOSE', 'STRICT', 'THOUSAND', 'settlement.groupBy', 'print.autoOnConfirm']) expect(body).not.toContain(word)
  })

  test('AC-I3-46: 배송비 — 빈 무료배송 기준은 없음, 저장 문장', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings')
    const ship = settingsRegion(page, '배송비')
    await ship.getByLabel('무료배송 기준 금액 (원, 비우면 없음)').fill('50,000')
    await ship.getByRole('button', { name: '저장' }).click()
    await expect(ship.getByText('저장했어요. 다음에 시작하는 방송부터 적용돼요. 그날 첫 방송이 이미 있으면 그날 정산은 그대로예요.')).toBeVisible()
    let s = await (await page.request.get('/api/settings')).json() as { settings: Record<string, unknown> }
    expect(s.settings['shipping.freeThreshold']).toBe(50000)
    await ship.getByLabel('무료배송 기준 금액 (원, 비우면 없음)').fill('')
    await ship.getByRole('button', { name: '저장' }).click()
    await expect.poll(async () => {
      s = await (await page.request.get('/api/settings')).json() as { settings: Record<string, unknown> }
      return s.settings['shipping.freeThreshold']
    }).toBeNull()
  })

  test('AC-I3-46: 저장하지 않은 값이 있으면 메뉴로 떠날 때 묻고, 닫기면 남는다', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings')
    await settingsRegion(page, '판매 규칙').getByLabel('대기 인원 (0이면 대기 없음)').fill('3')
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '방송', exact: true }).click()
    const ask = page.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
    await expect(ask).toContainText('저장하지 않은 값이 있어요. 떠나면 저장하지 않아요.')
    await ask.getByRole('button', { name: '닫기' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '방송', exact: true }).click()
    await page.getByRole('dialog', { name: '다른 화면으로 갈까요?' }).getByRole('button', { name: '저장하지 않고 떠나기' }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  test('AC-I3-90: 375×812 설정 화면 가로 스크롤 없음·금지 낱말 없음', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await loginNewSeller(page)
    await page.goto('/settings')
    await expect(settingsRegion(page, '보조자')).toBeVisible()
    await noHorizontalScroll(page)
    const text = await page.locator('main').innerText()
    for (const word of ['OAuth', '토큰', 'API', '스트림', '폴링', 'SSE', '할당량 단위', 'CONNECTED', 'NOT_', '503']) expect(text, word).not.toContain(word)
  })
})

test.describe('정책 페이지', () => {
  test('AC-I3-77: 세션 없는 새 브라우저에서 /privacy·/terms — 내용이 보이고 로그인 화면으로 바뀌지 않는다', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
    const p = await ctx.newPage()
    await p.goto('/privacy')
    await expect(p.getByRole('heading', { level: 1, name: '개인정보처리방침(초안)' })).toBeVisible()
    await expect(p.getByText('초안이에요. 법률 검토 전이라 실제 서비스 전에 바뀔 수 있어요.')).toBeVisible()
    await expect(p.getByRole('link', { name: /policies\.google\.com|구글 개인정보처리방침/ }).first()).toHaveAttribute('href', 'https://policies.google.com/privacy')
    await noHorizontalScroll(p)
    await p.goto('/terms')
    await expect(p.getByRole('heading', { level: 1, name: '이용약관(초안)' })).toBeVisible()
    await expect(p.getByText('구매 내역 확인서는 세금계산서·현금영수증 같은 세법상 증빙이 아니에요', { exact: false })).toBeVisible()
    await expect(p.getByLabel('아이디')).toHaveCount(0)
    await noHorizontalScroll(p)
    await ctx.close()
  })
})

test.describe('보조자 — 두 번 누르기', () => {
  test('AC-I3-64: "보조자 만들기"를 빠르게 두 번 눌러도 보조자는 한 명 (비밀번호를 본 적 없는 계정이 생기지 않는다)', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings')
    const section = settingsRegion(page, '보조자')
    await section.getByLabel('보조자 이름').fill('두번')
    const posts: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/assistants') posts.push(r.url())
    })
    await section.getByRole('button', { name: '보조자 만들기' }).dblclick()
    await expect(page.getByRole('dialog', { name: '보조자 두번을(를) 만들었어요' })).toBeVisible()
    await page.getByRole('dialog', { name: '보조자 두번을(를) 만들었어요' }).getByRole('button', { name: '다 적었어요' }).click()
    const list = await (await page.request.get('/api/assistants')).json() as { assistants: { name: string }[] }
    expect(list.assistants.filter((a) => a.name === '두번')).toHaveLength(1)
    expect(posts).toHaveLength(1)
  })
})
