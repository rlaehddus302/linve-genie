// LND1 서비스 워커 그대로 (test-e2e) — AC-LND1-14, D-LND1-07. 서비스 워커는 크로미움 묶음에서 막지 않는다.
import { expect, test, type Page } from '@playwright/test'
import { OFFLINE, expectLanding, expectLoginScreen, fillLogin } from './support.ts'

async function controlled(page: Page): Promise<void> {
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration()) !== undefined, null, { timeout: 15_000 })
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 })
}

test('AC-LND1-14: 서비스 워커가 설치된 뒤 인터넷을 끊고 /login을 열면 "인터넷 연결이 없어요. 연결되면 다시 불러와요." → 연결되면 로그인 칸', async ({ page, context }) => {
  await page.goto('/login')
  await expectLoginScreen(page)
  await controlled(page)
  await expectLoginScreen(page)
  await context.setOffline(true)
  try {
    await page.goto('/login')
    await expect(page.getByText(OFFLINE)).toBeVisible()
    await expect(page.getByLabel('아이디')).toHaveCount(0)
  } finally {
    await context.setOffline(false)
  }
  await expectLoginScreen(page)
  await fillLogin(page)
  await expect(page.getByRole('button', { name: '새 방송 시작' })).toBeVisible()
})

test('TE-LND1-001 AC-LND1-14·D-LND1-02: 로그아웃 상태 "/"(소개 화면)도 오프라인이면 같은 문장 — 소개 화면 대신 판매자 화면을 꾸며 보이지 않는다 → 연결되면 소개', async ({ page, context }) => {
  await page.goto('/')
  await expectLanding(page)
  await controlled(page)
  await expectLanding(page)
  await context.setOffline(true)
  try {
    await page.goto('/')
    await expect(page.getByText(OFFLINE)).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
  // 브라우저 탭에서 처음 연 "/"이고 이 탭에서 로그아웃·풀림이 없었다 → 연결되어 로그인 확인이 401이면 소개 화면 (D-LND1-02 "그 밖은 소개")
  await expectLanding(page)
  await expect(page.getByText('로그인이 풀렸어요. 다시 로그인해 주세요.')).toHaveCount(0)
})
