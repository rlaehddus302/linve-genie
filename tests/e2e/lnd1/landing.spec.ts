// LND1 공개 소개 화면 (test-e2e) — AC-LND1-01·02·03·08·09·10·11(화면 쪽)·13. 기대값은 acceptance.md "확정 문장" 표·D-LND1-01~05·08에서 정했다.
// D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 계정으로 /login에서 로그인 → /sms (AC-I3-63)"을 뺐다
import { expect, test, type Page } from '@playwright/test'
import {
  DAY_STEPS,
  ENGLISH,
  OLD_30_DAY,
  THIRD_PARTY_EN,
  GOOGLE_ITEMS,
  HEADINGS,
  LIMITED_USE,
  LIMITED_USE_LINK,
  LOGIN_ID,
  OPERATOR_NAME,
  PASSWORD,
  START_TEXT,
  TAGLINE,
  TITLE,
  USER_DATA_POLICY_URL,
  expectLanding,
  expectLoginScreen,
  fillLogin,
  landingTitle,
  section,
} from './support.ts'

const home = (page: Page) => page.getByRole('button', { name: '새 방송 시작' })

test.describe('AC-LND1-01 로그아웃 상태 "/"는 소개 화면', () => {
  test('새 탭(쿠키 없음)에서 "/" — 주소 그대로, 제목·한 줄 소개·두 링크·네 절·하루 다섯 줄(순서)·상호·정책 링크, 로그인 칸·메뉴·로그아웃·그림 없음, 401은 /api/me 하나', async ({ page }) => {
    const unauthorized: string[] = []
    const apiCalls: string[] = []
    page.on('response', (r) => {
      const path = new URL(r.url()).pathname
      if (!path.startsWith('/api/')) return
      apiCalls.push(path)
      if (r.status() === 401) unauthorized.push(path)
    })
    await page.goto('/')
    await expectLanding(page)
    expect(new URL(page.url()).pathname).toBe('/')
    expect(new URL(page.url()).search).toBe('')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(landingTitle(page)).toHaveText(TITLE)
    await expect(page.getByText(TAGLINE, { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '로그인', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '시작하기', exact: true })).toBeVisible()
    for (const h of HEADINGS) await expect(section(page, h).getByRole('heading', { level: 2, name: h, exact: true })).toBeVisible()
    // 절 순서: 하루 → 시작하려면 → 구글 → 운영 사업자 (D-LND1-03)
    const tops = await Promise.all(HEADINGS.map(async (h) => (await section(page, h).boundingBox())?.y ?? -1))
    expect([...tops].sort((a, b) => a - b)).toEqual(tops)
    const day = section(page, '판매자의 하루').locator('ol')
    await expect(day).toHaveCount(1)
    await expect(day.locator('> li')).toHaveText([...DAY_STEPS])
    await expect(section(page, '시작하려면')).toContainText(START_TEXT)
    await expect(section(page, '운영 사업자')).toContainText(OPERATOR_NAME)
    await expect(page.getByRole('link', { name: '개인정보처리방침', exact: true })).toHaveAttribute('href', '/privacy')
    await expect(page.getByRole('link', { name: '이용약관', exact: true })).toHaveAttribute('href', '/terms')
    await expect(page.getByRole('navigation', { name: '메뉴' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '로그아웃' })).toHaveCount(0)
    await expect(page.locator('img')).toHaveCount(0)
    // 가입 화면·가입 링크 없음 (SYS-01)
    await expect(page.getByText(/회원가입|가입하기/)).toHaveCount(0)
    expect(unauthorized).toEqual(['/api/me'])
    // 판매자 데이터를 부르지 않는다 (로그인 확인 하나)
    expect(apiCalls.filter((p) => p !== '/api/me')).toEqual([])
  })
})

test.describe('AC-LND1-02 "로그인"·"시작하기"', () => {
  test('"로그인" → /login·로그인 칸·아이디 커서·정책 링크 → 뒤로 가기는 소개 → 앞으로 다시 /login', async ({ page }) => {
    await page.goto('/')
    await expectLanding(page)
    await page.getByRole('link', { name: '로그인', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expectLoginScreen(page)
    await expect(page.getByLabel('아이디')).toBeFocused()
    await expect(page.getByRole('link', { name: '개인정보처리방침' })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
    await expectLanding(page)
    await page.goForward()
    await expect(page).toHaveURL(/\/login$/)
    await expectLoginScreen(page)
  })

  test('소개 → "로그인" → 판매자 로그인 → "/" 방송 목록, 뒤로 가기에 로그인 칸이 나오지 않는다(기록을 바꿔 감)', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: '로그인', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await fillLogin(page)
    await expect(home(page)).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
    await page.goBack()
    // 뒤로 가면 소개 화면 주소 "/"이고 로그인한 상태라 방송 목록 — /login의 로그인 칸이 아니다
    await expect(page).toHaveURL(/\/$/)
    await expect(home(page)).toBeVisible()
    await expect(page.getByLabel('아이디')).toHaveCount(0)
    await expect(page.getByText('판매자의 하루', { exact: true })).toHaveCount(0)
  })

  test('/login을 바로 열어 로그인해도 "/"로 바꿔 간다 — 기록 길이가 늘지 않고 앞으로 가기가 /login이 아니다', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel('아이디')).toBeFocused()
    const before = await page.evaluate(() => history.length)
    await fillLogin(page)
    await expect(home(page)).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
    expect(await page.evaluate(() => history.length)).toBe(before)
  })

  test('"시작하기" → 경로·검색값·해시 그대로, "시작하려면" 제목과 문장이 화면 안 · 로그인·가입 화면으로 가지 않음 (375×812, 키보드 Enter도)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')
    await expectLanding(page)
    const start = section(page, '시작하려면')
    await page.getByRole('link', { name: '시작하기', exact: true }).click()
    await expect(start.getByRole('heading', { level: 2, name: '시작하려면' })).toBeInViewport()
    await expect(start.getByText(START_TEXT)).toBeInViewport()
    const url = new URL(page.url())
    expect(url.pathname).toBe('/')
    expect(url.search).toBe('')
    expect(url.hash).toBe('')
    await expect(page.getByLabel('아이디')).toHaveCount(0)
    await expectLanding(page)
    // 키보드로도: 위로 올라가 Tab으로 "시작하기"에 가서 Enter
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(page.getByRole('link', { name: '시작하기', exact: true })).toBeInViewport()
    await page.getByRole('link', { name: '시작하기', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(start.getByText(START_TEXT)).toBeInViewport()
    expect(new URL(page.url()).hash).toBe('')
    expect(new URL(page.url()).pathname).toBe('/')
  })
})

test.describe('AC-LND1-03 로그인한 사람', () => {
  test('"/"는 방송 목록(소개 문장 없음) · /login을 열면 로그인 칸 없이 "/"로 바뀌고 기록을 쌓지 않는다', async ({ page }) => {
    await page.goto('/login')
    await fillLogin(page)
    await expect(home(page)).toBeVisible()
    await page.goto('/')
    await expect(home(page)).toBeVisible()
    await expect(page.getByText('판매자의 하루', { exact: true })).toHaveCount(0)
    await expect(page.getByText(TAGLINE)).toHaveCount(0)
    await page.goto('/settings')
    await expect(page.getByRole('navigation', { name: '메뉴' })).toBeVisible()
    await page.goto('/login')
    await expect(page).toHaveURL(/\/$/)
    await expect(home(page)).toBeVisible()
    await expect(page.getByLabel('아이디')).toHaveCount(0)
    // 바꿔 갔으므로 뒤로 가기는 /login이 아니라 그 앞의 /settings
    await page.goBack()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByLabel('아이디')).toHaveCount(0)
  })
})

test.describe('AC-LND1-08 정책 페이지 "로그인 화면으로"', () => {
  for (const path of ['/privacy', '/terms']) {
    test(`로그아웃 상태 ${path} → 위 줄 "로그인 화면으로" → /login 로그인 칸`, async ({ page }) => {
      await page.goto(path)
      const back = page.getByRole('banner').getByRole('link', { name: '로그인 화면으로' })
      await expect(back).toBeVisible()
      await back.click()
      await expect(page).toHaveURL(/\/login$/)
      await expectLoginScreen(page)
    })
  }

  test('소개 화면 아래 "개인정보처리방침" → /privacy → "로그인 화면으로" → 로그인 → 방송 목록', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('navigation', { name: '약관' }).getByRole('link', { name: '개인정보처리방침' }).click()
    await expect(page).toHaveURL(/\/privacy$/)
    await expect(page.getByRole('heading', { level: 1, name: '개인정보처리방침(초안)' })).toBeVisible()
    await page.getByRole('banner').getByRole('link', { name: '로그인 화면으로' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await fillLogin(page)
    await expect(home(page)).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
  })
})

test.describe('AC-LND1-09 구글 사용자 데이터 고지', () => {
  test('점 목록 여섯 줄(순서, D-LND1-11) · 제한적 사용 문장과 링크(href·rel·새 창 아님) · 영문 단락 글자 그대로 · 단정 문장 없음 · 영문 제3자 문장 한 번 · 옛 30일 문장 없음', async ({ page }) => {
    await page.goto('/')
    const google = section(page, '구글 사용자 데이터를 쓰는 곳')
    await expect(google).toBeVisible()
    const list = google.locator('ul')
    await expect(list).toHaveCount(1)
    await expect(list.locator('> li')).toHaveText([...GOOGLE_ITEMS])
    await expect(google.getByText(LIMITED_USE, { exact: true })).toBeVisible()
    const link = google.getByRole('link', { name: LIMITED_USE_LINK, exact: true })
    await expect(link).toHaveAttribute('href', USER_DATA_POLICY_URL)
    const rel = ((await link.getAttribute('rel')) ?? '').split(/\s+/)
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')
    expect(await link.getAttribute('target')).toBeNull()
    // 링크는 그 문장 안에 있다
    expect(await link.evaluate((a) => a.parentElement?.textContent?.trim())).toBe(LIMITED_USE)
    const english = page.locator('[lang="en"]')
    await expect(english).toHaveCount(1)
    expect(((await english.textContent()) ?? '').trim()).toBe(ENGLISH)
    // D-LND1-11: 영문 단락엔 제3자 문장이 정확히 한 번 (단락 전체 비교와 별도로 횟수를 확인)
    const englishText = (await english.textContent()) ?? ''
    expect(englishText.split(THIRD_PARTY_EN).length - 1).toBe(1)
    // 한국어 글(lang="en" 문단 제외)에는 단정하는 '제3자'·'넘기지 않아요' 문장이 없다
    const body = await page.locator('body').innerText()
    const korean = body.replace(englishText.trim(), '')
    expect(korean).not.toContain('다른 곳에 넘기지 않아요')
    expect(korean).not.toContain('제3자')
    // 옛 30일 문장(RA-LND1-01)은 화면 어디에도 없다 — 영문 포함 전체 글
    for (const old of OLD_30_DAY) expect(body, old).not.toContain(old)
  })
})

test.describe('AC-LND1-10 운영 사업자 (지금 값)', () => {
  test('"운영 사업자" 아래 줄은 "상호: 틈(TEUM)" 하나 · "계정 문의:" 없음 · 자리표시 글 없음', async ({ page }) => {
    await page.goto('/')
    const op = section(page, '운영 사업자')
    await expect(op.getByRole('listitem')).toHaveText([OPERATOR_NAME])
    await expect(section(page, '시작하려면').getByText('계정 문의:')).toHaveCount(0)
    const body = await page.locator('body').innerText()
    for (const w of ['[확인 필요]', '[미정]', '[검토 필요]', '확인 필요', '대표자:', '사업자등록번호:', '통신판매업 신고번호:', '주소:', '문의 이메일:']) expect(body, w).not.toContain(w)
  })
})

test.describe('AC-LND1-13 쉬운 한국어', () => {
  test('영문 단락을 뺀 소개 화면 글에 영어 낱말·밑줄 낱말 없음 (예외: "API"·"TEUM"·"AI 제안")', async ({ page }) => {
    await page.goto('/')
    await expectLanding(page)
    const text = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement
      for (const el of clone.querySelectorAll('[lang="en"]')) el.remove()
      // 숨은 글도 보지 않도록 원본의 보이는 글 기준: innerText는 붙지 않은 노드에서 textContent와 같다 — 영문 단락만 지운 textContent
      return clone.textContent ?? ''
    })
    // 예외(이름, AC-LND1-13): "API"·"TEUM"과 기능 이름 "AI 제안"의 "AI"(D-LND1-11) — "AI"는 "AI 제안"으로 쓰일 때만 뺀다
    const words = (text.replaceAll('AI 제안', '제안').match(/[A-Za-z_][A-Za-z0-9_.-]*/g) ?? []).filter((w) => w !== 'API' && w !== 'TEUM')
    expect(words).toEqual([])
    for (const w of ['youtube.readonly', 'force-ssl', 'openid', 'OAuth', 'scope', 'token', 'NOT_LINKED']) expect(text, w).not.toContain(w)
  })
})

test.describe('AC-LND1-11 자바스크립트가 돌면 정적 글은 화면 글로', () => {
  test('로그인한 방송 목록에 정적 한 줄 소개·정적 정책 링크가 남지 않는다 · 소개 화면의 h1은 하나', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByText(TAGLINE, { exact: true })).toHaveCount(1)
    await page.getByRole('link', { name: '로그인', exact: true }).click()
    await fillLogin(page, { loginId: LOGIN_ID, password: PASSWORD })
    await expect(home(page)).toBeVisible()
    await expect(page.getByText(TAGLINE)).toHaveCount(0)
    await page.reload()
    await expect(home(page)).toBeVisible()
    await expect(page.getByText(TAGLINE)).toHaveCount(0)
  })
})
