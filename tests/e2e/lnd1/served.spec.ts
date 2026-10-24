// LND1 운영처럼 띄운 서버 (@served — 서버가 화면을 같은 출처로 냄) (test-e2e) — AC-LND1-11·15, D-LND1-06·07.
import { expect, test } from '@playwright/test'
import { TAGLINE, TITLE, expectLanding, expectLoginScreen } from './support.ts'

test('@served AC-LND1-15: 쿠키 없이 GET / · /login — 200·text/html·no-cache·CSP와 공통 보안 머리글이 /privacy와 같다', async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL })
  try {
    const privacy = await request.get('/privacy')
    expect(privacy.status()).toBe(200)
    const ref = privacy.headers()
    expect(ref['content-security-policy'] ?? '').not.toBe('')
    // /privacy에 붙는 보안 머리글 모두 (값이 있는 것) — 같은 이름·같은 값
    const security = Object.keys(ref).filter((k) => /^(content-security-policy|x-|referrer-policy|permissions-policy|strict-transport-security|cross-origin-)/.test(k))
    expect(security).toContain('x-content-type-options')
    for (const path of ['/', '/login']) {
      const res = await request.get(path)
      expect(res.status(), path).toBe(200)
      const h = res.headers()
      expect(h['content-type'], path).toContain('text/html')
      expect(h['cache-control'], path).toContain('no-cache')
      for (const k of security) expect(h[k], `${path} ${k}`).toBe(ref[k])
      expect(h['set-cookie'], `${path} 쿠키 없음`).toBeUndefined()
    }
  } finally {
    await request.dispose()
  }
})

test('@served AC-LND1-11: 자바스크립트 없이 읽는 GET / 문서 — meta description = 한 줄 소개, #root 안 제목·한 줄 소개·정책 링크, 인라인 script·style 없음', async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL })
  try {
    const html = await (await request.get('/')).text()
    const meta = /<meta\s+name="description"\s+content="([^"]*)"/.exec(html)
    expect(meta?.[1]).toBe(TAGLINE)
    const root = /<div id="root">([\s\S]*?)<\/div>\s*(<script|<\/body>)/.exec(html)?.[1] ?? ''
    expect(root).toContain(TITLE)
    expect(root).toContain(TAGLINE)
    expect(root).toMatch(/<a[^>]*href="\/privacy"[^>]*>개인정보처리방침<\/a>/)
    expect(root).toMatch(/<a[^>]*href="\/terms"[^>]*>이용약관<\/a>/)
    // 인라인 스크립트(본문 있는 것)·style 속성·style 요소 없음 (CSP 그대로)
    for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) expect((m[1] ?? '').trim(), '인라인 script').toBe('')
    expect(html).not.toMatch(/\sstyle=/)
    expect(html).not.toMatch(/<style\b/)
  } finally {
    await request.dispose()
  }
})

test('@served 소개 화면·/login에 CSP 위반 0 · 자바스크립트를 끈 브라우저에서도 제목·한 줄 소개·정책 링크가 보인다', async ({ page, browser, baseURL }) => {
  const violations: string[] = []
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text())
  })
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`Refused to (CSP) ${e.violatedDirective} ${e.blockedURI}`)
    })
  })
  await page.goto('/')
  await expectLanding(page)
  await page.getByRole('link', { name: '로그인', exact: true }).click()
  await expectLoginScreen(page)
  expect(violations).toEqual([])

  const ctx = await browser.newContext({ baseURL, javaScriptEnabled: false })
  try {
    const p = await ctx.newPage()
    await p.goto('/')
    await expect(p.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
    await expect(p.getByText(TAGLINE, { exact: true })).toBeVisible()
    await expect(p.getByRole('link', { name: '개인정보처리방침' })).toHaveAttribute('href', '/privacy')
    await expect(p.getByRole('link', { name: '이용약관' })).toHaveAttribute('href', '/terms')
  } finally {
    await ctx.close()
  }
})
