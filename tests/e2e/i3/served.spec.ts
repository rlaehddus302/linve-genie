// I3 — 서버가 화면을 같은 출처로 함께 낸다 (@served). AC-I3-70·71·77
import { expect, test, type Page } from '@playwright/test'
import { loginAs, newSeller, openRealBroadcast } from './support.ts'

/** CSP 위반을 모은다 (브라우저 securitypolicyviolation + 콘솔 문장) */
async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = []
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text())
  })
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`Refused to (CSP) ${e.violatedDirective} ${e.blockedURI}`)
    })
  })
  return violations
}

test('@served AC-I3-70·71: 로그인 → 방송 목록 → /settings/youtube 새로고침 → 콘솔·문자찜·구매자·정산·마법사 — CSP 위반 0', async ({ page }) => {
  const violations = await watchCsp(page)
  const seller = await newSeller(page.request)
  await loginAs(page, seller)
  await expect(page).toHaveURL(/\/start$/)
  await page.getByRole('button', { name: '나중에 할게요' }).click()
  await expect(page.getByRole('button', { name: '새 방송 시작' })).toBeVisible()
  await page.goto('/settings/youtube')
  await page.reload()
  await expect(page.getByRole('region', { name: '유튜브', exact: true })).toContainText('유튜브 연동을 준비하지 않은 서버예요.')
  await openRealBroadcast(page, { title: '같은 출처' })
  await page.getByLabel('빠른 입력').fill('15 핑크프릴 10')
  await page.getByLabel('빠른 입력').press('Enter')
  await expect(page.getByRole('region', { name: '상품 보드' })).toContainText('15번')
  for (const path of ['/sms', '/buyers', '/settlements', '/privacy', '/terms']) {
    await page.goto(path)
    await page.reload()
    await expect(page.getByRole('main')).toBeVisible()
  }
  await expect(page.getByRole('heading', { level: 1, name: '이용약관(초안)' })).toBeVisible()
  await page.goto('/')
  await page.evaluate(async () => await navigator.serviceWorker.ready)
  expect(violations).toEqual([])
})

test('@served AC-I3-70·71: 머리글 — index.html CSP·no-cache, /assets immutable, 화면 주소 대체 응답, 없는 파일 404, 점 파일·폴더 밖 404', async ({ request, baseURL }) => {
  const root = baseURL ?? ''
  const index = await request.get(`${root}/settings/youtube`)
  expect(index.status()).toBe(200)
  const csp = index.headers()['content-security-policy'] ?? ''
  for (const part of ["default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"]) expect(csp).toContain(part)
  expect(index.headers()['cache-control']).toContain('no-cache')
  expect(index.headers()['x-content-type-options']).toBe('nosniff')
  expect(index.headers()['x-frame-options']).toBe('DENY')
  expect(index.headers()['referrer-policy']).toBe('no-referrer')
  const html = await index.text()
  const asset = /\/assets\/[^"']+\.js/.exec(html)?.[0]
  expect(asset).toBeDefined()
  const js = await request.get(`${root}${asset ?? ''}`)
  expect(js.status()).toBe(200)
  expect(js.headers()['cache-control']).toBe('public, max-age=31536000, immutable')
  expect(js.headers()['content-type']).toContain('javascript')
  expect((await request.get(`${root}/assets/none.js`)).status()).toBe(404)
  expect((await request.get(`${root}/.env`)).status()).toBe(404)
  expect((await request.get(`${root}/sw.js`)).headers()['cache-control']).toContain('no-cache')
  const api = await request.get(`${root}/api/nothing-here`)
  expect([401, 404]).toContain(api.status())
  expect(api.headers()['content-type']).toContain('json')
})
