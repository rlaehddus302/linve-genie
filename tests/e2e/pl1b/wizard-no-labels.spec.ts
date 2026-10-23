// PL1B 시작 마법사 4/5 "라벨을 쓰지 않아요" (SPEC UX-02·RCP-01, D-PL1-06) — test-e2e.
// AC-PL1B-19(마법사 흐름), AC-PL1B-17(확인 창 없음·요청 하나·보내는 동안 잠김·5/5 제목 포커스·바꾼 기록·다른 기기 메뉴 1초·5/5 이전은 3/5),
// AC-PL1B-18(네트워크 실패면 4/5에 머묾·라벨 켜짐 그대로·다시 눌림), AC-PL1B-16(라벨 켜짐이면 버튼과 안내).
// 시험마다 새 판매자(마법사 "처음"). tests/e2e/wiz·i3의 기존 시험은 고치지 않는다(도우미만 가져다 쓴다).
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import { loginAs, newSeller, type Seller } from '../i3/support.ts'
import { menuLink } from '../menu.ts'
import { labelSection, labelSettings } from './support.ts'

const TITLES = ['1/5 가게 이름', '2/5 판매 규칙 확인', '3/5 유튜브 연결', '4/5 프린터 연결', '5/5 리허설 해 보기'] as const
const NO_LABELS = '라벨을 쓰지 않아요'
const NO_LABELS_HINT = '라벨 없이 팔아요. 설정에서 언제든 다시 켤 수 있어요.'
const LABEL_WORDS = /라벨 대기|라벨 출력됨|출력 중|재출력 필요|출력 안 함|리허설 방송은 라벨을 출력하지 않아요/

function heading(page: Page, name: string): Locator {
  return page.getByRole('heading', { level: 2, name, exact: true })
}

async function startWizard(page: Page): Promise<Seller> {
  const seller = await newSeller(page.request)
  await loginAs(page, seller)
  await expect(page).toHaveURL(/\/start$/)
  await expect(heading(page, TITLES[0])).toBeFocused()
  return seller
}

async function nextTo(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: '다음', exact: true }).click()
  await expect(heading(page, title)).toBeFocused()
}

async function toPrinterStep(page: Page): Promise<void> {
  for (const title of [TITLES[1], TITLES[2], TITLES[3]]) await nextTo(page, title)
}

/** 같은 판매자로 다른 기기 (PC 폭) */
async function otherDevice(browser: Browser, like: Page, seller: Seller): Promise<Page> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(like.url()).origin, viewport: { width: 1440, height: 900 } })
  const other = await ctx.newPage()
  await loginAs(other, seller, '/settings')
  return other
}

test('AC-PL1B-19·17: 1→2→3→4에서 "라벨을 쓰지 않아요" → 확인 창 없이 끄기 하나(보내는 동안 잠김) → 5/5 제목 포커스, 다른 기기 메뉴 "라벨" 1초 안에 사라짐, 이전은 3/5, 설정 "꺼짐"·바꾼 기록, 리허설 콘솔에 라벨 문장 없음', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const seller = await startWizard(page)
  expect((await labelSettings(page)).enabled, '전제: 새 판매자는 라벨 켜짐').toBe(true)
  const other = await otherDevice(browser, page, seller)
  try {
    await expect(menuLink(other, '라벨')).toBeVisible()
    await toPrinterStep(page)

    // 4/5: 연결 칸 아래 버튼과 안내 (AC-PL1B-16)
    const button = page.getByRole('button', { name: NO_LABELS, exact: true })
    await expect(button).toBeVisible()
    await expect(page.getByText(NO_LABELS_HINT, { exact: true })).toBeVisible()

    // 끄기 요청을 붙잡아 보내는 동안을 본다
    const puts: unknown[] = []
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route((url) => url.pathname === '/api/settings/labels', async (route) => {
      if (route.request().method() !== 'PUT') return await route.continue()
      puts.push(JSON.parse(route.request().postData() ?? 'null'))
      await held
      await route.continue()
    })
    let dialogs = 0
    page.on('dialog', () => {
      dialogs += 1
    })
    await button.click()
    await expect.poll(() => puts.length).toBe(1)
    await expect(button).toBeDisabled()
    await expect(page.getByRole('button', { name: '다음', exact: true })).toBeDisabled()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(heading(page, TITLES[3])).toBeVisible()
    release()

    await expect(heading(page, TITLES[4])).toBeFocused()
    expect(puts).toEqual([{ enabled: false }])
    expect(dialogs).toBe(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect((await labelSettings(page)).enabled).toBe(false)
    // 서버 단계 기록도 5
    const wizard = await (await page.request.get('/api/wizard')).json() as Record<string, unknown>
    expect(JSON.stringify(wizard)).toMatch(/"step":5\b/)

    // 이 기기·다른 기기 메뉴에서 "라벨"이 1초 안에 사라진다
    await expect(menuLink(page, '라벨')).toHaveCount(0, { timeout: 1_000 })
    await expect(menuLink(other, '라벨')).toHaveCount(0, { timeout: 1_000 })
    // 다른 기기의 설정 화면: 꺼짐 + 바꾼 기록 "라벨 끔 · <아이디>"
    const section = labelSection(other)
    await expect(section.getByText('라벨 기능: 꺼짐', { exact: true })).toBeVisible({ timeout: 1_000 })
    const history = section.getByRole('list', { name: '바꾼 기록' }).getByRole('listitem')
    await expect(history).toHaveCount(1)
    await expect(history.first()).toContainText('라벨 끔')
    await expect(history.first()).toContainText(seller.loginId)

    // 5/5 "이전" → 3/5 (꺼지면 프린터 단계를 건너뜀), "다음" → 5/5
    await page.getByRole('button', { name: '이전', exact: true }).click()
    await expect(heading(page, TITLES[2])).toBeFocused()
    await nextTo(page, TITLES[4])

    // 리허설 시작 → 콘솔에 라벨 문장 없음 (L-13 10)
    await page.getByRole('button', { name: '리허설 시작하기' }).click()
    await expect(page.getByText('리허설 중 — 실제 판매가 아니에요')).toBeVisible()
    await page.getByLabel('빠른 입력').fill('15 핑크프릴 10')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('main')).toContainText('핑크프릴')
    await expect(page.getByRole('main')).not.toContainText(LABEL_WORDS)
    await expect(page.getByText(/라벨/)).toHaveCount(0)
  } finally {
    await other.context().close()
  }
})

test('AC-PL1B-18: 끄기 요청이 네트워크 실패 → 4/5 그대로·문장·라벨 켜짐 그대로(메뉴 "라벨" 있음)·버튼 다시 눌림, 다시 누르면 5/5', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await startWizard(page)
  await toPrinterStep(page)
  let fail = true
  await page.route((url) => url.pathname === '/api/settings/labels', async (route) => {
    if (route.request().method() === 'PUT' && fail) return await route.abort('internetdisconnected')
    return await route.continue()
  })
  const button = page.getByRole('button', { name: NO_LABELS, exact: true })
  await button.click()
  await expect(page.getByText('인터넷 연결을 확인하고 다시 눌러 주세요.')).toBeVisible({ timeout: 30_000 })
  await expect(heading(page, TITLES[3])).toBeVisible()
  await expect(button).toBeEnabled()
  await expect(page.getByRole('button', { name: '다음', exact: true })).toBeEnabled()
  await expect(menuLink(page, '라벨')).toBeVisible()
  expect((await labelSettings(page)).enabled).toBe(true)

  fail = false
  await button.click()
  await expect(heading(page, TITLES[4])).toBeFocused()
  expect((await labelSettings(page)).enabled).toBe(false)
})
