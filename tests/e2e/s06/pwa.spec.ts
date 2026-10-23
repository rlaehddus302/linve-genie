// PWA (AC-S06-50~52, UX-07, D-093) — test-e2e. 서비스 워커는 막지 않는다.
import { test, expect, type Page } from '@playwright/test'
import { login } from './support.ts'

async function controlled(page: Page): Promise<void> {
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration()) !== undefined, null, { timeout: 15_000 })
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 })
}

test.describe('PWA', () => {
  test('AC-S06-50: 매니페스트·아이콘 크기·index.html 링크·설치 가능(CDP)', async ({ page }) => {
    await page.goto('/')
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(manifestHref).not.toBeNull()
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1)
    const appleHref = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')
    expect(appleHref).not.toBeNull()
    const res = await page.request.get(manifestHref!)
    expect(res.ok()).toBe(true)
    expect(res.headers()['content-type']).toContain('application/manifest+json')
    const manifest = await res.json() as { name: string; short_name: string; lang: string; start_url: string; scope: string; display: string; background_color?: string; theme_color?: string; icons: { src: string; sizes: string; type: string; purpose?: string }[] }
    expect(manifest).toMatchObject({ name: '라이브지니', short_name: '라이브지니', lang: 'ko', start_url: '/', scope: '/', display: 'standalone' })
    expect(manifest.background_color).toBeTruthy()
    expect(manifest.theme_color).toBeTruthy()
    const any192 = manifest.icons.find((i) => i.sizes === '192x192' && (i.purpose ?? 'any').split(' ').includes('any'))
    const any512 = manifest.icons.find((i) => i.sizes === '512x512' && (i.purpose ?? 'any').split(' ').includes('any'))
    const mask512 = manifest.icons.find((i) => i.sizes === '512x512' && (i.purpose ?? '').split(' ').includes('maskable'))
    expect(any192 && any512 && mask512).toBeTruthy()
    const sizes = await page.evaluate(async (srcs) => {
      const out: string[] = []
      for (const src of srcs) {
        const blob = await (await fetch(src)).blob()
        const bmp = await createImageBitmap(blob)
        out.push(`${blob.type} ${String(bmp.width)}x${String(bmp.height)}`)
      }
      return out
    }, [any192!.src, any512!.src, mask512!.src, appleHref!])
    expect(sizes).toEqual(['image/png 192x192', 'image/png 512x512', 'image/png 512x512', 'image/png 180x180'])
    const cdp = await page.context().newCDPSession(page)
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors') as { installabilityErrors: unknown[] }
    expect(installabilityErrors).toEqual([])
  })

  test('AC-S06-51: 등록·다시 열면 제어, /api/는 서비스 워커를 거치지 않고 Cache Storage에 없음, 오프라인 다시 열기 문장 → 연결되면 저절로', async ({ page, context }) => {
    await login(page)
    await controlled(page)
    const swScope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope)
    expect(new URL(swScope!).pathname).toBe('/')
    const viaSw: string[] = []
    page.on('response', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/') && r.fromServiceWorker()) viaSw.push(r.url())
    })
    await page.reload()
    await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
    await page.goto('/sms')
    await expect(page.getByRole('region', { name: '고른 방송' })).toBeVisible()
    expect(viaSw).toEqual([])
    const cached = await page.evaluate(async () => {
      const urls: string[] = []
      for (const key of await caches.keys()) for (const req of await (await caches.open(key)).keys()) urls.push(new URL(req.url).pathname)
      return urls
    })
    expect(cached.length).toBeGreaterThan(0)
    expect(cached.filter((u) => u.startsWith('/api'))).toEqual([])
    // 오프라인으로 다시 열기
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByText('인터넷 연결이 없어요. 연결되면 다시 불러와요.')).toBeVisible()
    await expect(page.getByRole('region', { name: '고른 방송' })).toHaveCount(0)
    await context.setOffline(false)
    await expect(page.getByRole('region', { name: '고른 방송' })).toBeVisible({ timeout: 15_000 })
  })

  test('AC-S06-51: 새 버전은 기다렸다가 안내 — 저절로 다시 열지 않고 치던 입력이 남는다, "지금 새로고침"으로 바뀜', async ({ page }) => {
    await login(page)
    await controlled(page)
    await page.goto('/sms')
    await page.getByLabel('메모', { exact: true }).fill('치던 메모')
    // 새 버전 흉내: 같은 범위에 스크립트 주소를 바꿔 다시 등록 (Playwright는 서비스 워커 스크립트 요청을 가로채지 못한다)
    await page.evaluate(async () => {
      await navigator.serviceWorker.register(`/sw.js?v=${String(Date.now())}`, { scope: '/' })
    })
    await expect(page.getByText('새 버전이 있어요. 방송이 끝나면 새로고침해 주세요.')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel('메모', { exact: true })).toHaveValue('치던 메모')
    await page.getByRole('button', { name: '지금 새로고침' }).click()
    await expect(page.getByText('새 버전이 있어요. 방송이 끝나면 새로고침해 주세요.')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
  })

  test('AC-S06-52: 가짜 beforeinstallprompt → "앱으로 설치" → 브라우저 창 호출, 닫기 뒤 다시 안 보임, standalone이면 숨김', async ({ page, browser }) => {
    await login(page)
    const fire = () => page.evaluate(() => {
      const w = window as unknown as { __prompted: number }
      w.__prompted = 0
      const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: () => {
          w.__prompted += 1
          return Promise.resolve()
        },
        userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
      })
      window.dispatchEvent(event)
    })
    await fire()
    const install = page.getByRole('button', { name: '앱으로 설치' })
    await expect(install).toBeVisible()
    await install.click()
    expect(await page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1)
    // standalone 흉내 → 숨김
    const baseURL = test.info().project.use.baseURL!
    const ctx = await browser.newContext({ baseURL })
    // standalone 흉내: display-mode 질의만 참으로 (Playwright가 자기 미디어 흉내를 다시 걸어 CDP 값이 덮이므로 init script로)
    await ctx.addInitScript(() => {
      const original = window.matchMedia.bind(window)
      window.matchMedia = (query: string) => (/display-mode:\s*standalone/.test(query) ? ({ ...original(query), matches: true, media: query } as MediaQueryList) : original(query))
    })
    const other = await ctx.newPage()
    await login(other)
    await other.evaluate(() => {
      window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: () => Promise.resolve(), userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }) }))
    })
    await expect(other.getByRole('button', { name: '로그아웃' })).toBeVisible()
    await expect(other.getByRole('button', { name: '앱으로 설치' })).toHaveCount(0)
    await ctx.close()
    // "닫기"를 누르면 이 기기에서 다시 보이지 않는다
    await page.reload()
    await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
    await fire()
    await expect(install).toBeVisible()
    await page.getByRole('button', { name: '앱 설치 안내 닫기' }).click()
    await expect(install).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
    await fire()
    await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
    await expect(install).toHaveCount(0)
  })
})
