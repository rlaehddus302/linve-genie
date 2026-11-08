// 메뉴 공용 도우미 (UX-04 휴대폰 메뉴, D-NAV-01, AC-NAV-10).
// 휴대폰(폭 48rem = 768px 미만)은 아래 막대 다섯 칸 — 링크 "방송"·"문자찜"·"구매자"·"정산" + 버튼 "더보기". // MOB1 D-MOB1-04 (PC 위 줄·h1은 "문자찜 입력")
// 나머지 메뉴("입금 확인"·"포장"·"라벨"·"설정")는 "더보기" 목록 안에 있고, 닫힌 목록은 그리지 않는다.
// 그래서 휴대폰에서 막대 밖 메뉴를 찾거나 누르거나 셀 때는 먼저 목록을 연다. PC는 모든 메뉴가 위 줄에 있다.
import { expect, type Locator, type Page, type Route } from '@playwright/test'

/** 막대 앞 네 칸 (휴대폰에서 늘 보이는 링크) */
export const BAR_LINKS = ['방송', '문자찜', '구매자', '정산'] as const // MOB1 D-MOB1-04
/** 휴대폰 막대 다섯 칸 이름 */
export const BAR_CELLS = [...BAR_LINKS, '더보기'] as const

/** 휴대폰 폭인가 (48rem 미만 — 기본 글자 16px) */
export function isPhone(page: Page): boolean {
  const width = page.viewportSize()?.width
  return width !== undefined && width < 768
}

export function menu(page: Page): Locator {
  return page.getByRole('navigation', { name: '메뉴' })
}

export function moreButton(page: Page): Locator {
  return menu(page).getByRole('button', { name: '더보기', exact: true })
}

/** "더보기" 목록 (열려 있을 때만 있다) */
export function moreList(page: Page): Locator {
  return menu(page).getByRole('list')
}

/** 메뉴 안의 링크 (이름 정확히) — 휴대폰 막대 밖 항목은 목록이 열려 있어야 보인다 */
export function menuLink(page: Page, name: string | RegExp): Locator {
  return typeof name === 'string' ? menu(page).getByRole('link', { name, exact: true }) : menu(page).getByRole('link', { name })
}

/** 휴대폰이면 "더보기" 목록을 연다 (이미 열려 있으면 그대로). PC면 아무것도 하지 않는다 */
export async function openMore(page: Page): Promise<void> {
  if (!isPhone(page)) return
  const button = moreButton(page)
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await expect(moreList(page)).toBeVisible()
}

/** 휴대폰이면 "더보기" 목록을 닫는다 (이미 닫혀 있으면 그대로) */
export async function closeMore(page: Page): Promise<void> {
  if (!isPhone(page)) return
  const button = moreButton(page)
  if ((await button.getAttribute('aria-expanded')) === 'true') await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  await expect(moreList(page)).toHaveCount(0)
}

/** 메뉴 링크를 찾는다 — 휴대폰에서 막대 밖 이름이면 먼저 "더보기"를 연다 */
export async function phoneMenuLink(page: Page, name: string | RegExp): Promise<Locator> {
  const onBar = typeof name === 'string' && (BAR_LINKS as readonly string[]).includes(name)
  if (!onBar) await openMore(page)
  return menuLink(page, name)
}

/** 메뉴 항목을 눌러 그 화면으로 (휴대폰에서 막대 밖이면 "더보기"를 열고) */
export async function clickMenu(page: Page, name: string | RegExp): Promise<void> {
  await (await phoneMenuLink(page, name)).click()
}

/** 목록 안 링크 (목록이 열려 있을 때) */
export function moreLinks(page: Page): Locator {
  return moreList(page).getByRole('link')
}

/** 막대 다섯 칸 (링크 넷 + "더보기") — 이름으로 찾으므로 목록이 열려 있어도 쓴다 */
export function barCells(page: Page): Locator[] {
  return [...BAR_LINKS.map((name) => menuLink(page, name)), moreButton(page)]
}

/** 누르는 곳이 44×44px 이상이고 화면 폭 안인가 */
export async function expectTarget(page: Page, target: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await target.boundingBox()
  const width = page.viewportSize()!.width
  expect(box, '보이는 칸').not.toBeNull()
  expect(box!.width, '폭 44px 이상').toBeGreaterThanOrEqual(44)
  expect(box!.height, '높이 44px 이상').toBeGreaterThanOrEqual(44)
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5)
  return box!
}

/**
 * 휴대폰 막대 (AC-NAV-01): 목록이 닫힌 채 메뉴 안 링크는 "방송"·"문자찜"(MOB1 D-MOB1-04)·"구매자"·"정산" 넷(이 순서)과 버튼 "더보기",
 * 다섯 칸이 한 줄(위 끝이 같다)·칸마다 44×44px 이상·화면 폭 안
 */
export async function expectPhoneBar(page: Page): Promise<void> {
  await expect(moreButton(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(moreList(page)).toHaveCount(0)
  await expect(menu(page).getByRole('link')).toHaveText([...BAR_LINKS])
  await expect(menu(page).getByRole('button')).toHaveText(['더보기'])
  const tops: number[] = []
  for (const cell of barCells(page)) tops.push((await expectTarget(page, cell)).y)
  for (const top of tops) expect(Math.abs(top - tops[0]!), '다섯 칸이 한 줄').toBeLessThanOrEqual(1)
}

/**
 * 로그인했는가 — 메뉴가 보인다 (MOB1 D-MOB1-05: 휴대폰 판매자는 위 줄에 "로그아웃"이 없어 그 버튼을 기다리지 않는다).
 * 로그인 화면에는 메뉴가 없다.
 */
export async function expectSignedIn(page: Page): Promise<void> {
  await expect(menu(page)).toBeVisible()
}

/**
 * "로그아웃" 버튼 (MOB1 D-MOB1-05): 휴대폰 판매자는 "더보기" 목록 맨 끝(먼저 연다), PC는 위 줄.
 * D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 휴대폰 메뉴엔 더보기가 없어 위 줄에서 찾는다"를 뺐다
 */
export async function logoutButton(page: Page): Promise<Locator> {
  if (isPhone(page)) {
    await openMore(page)
    return moreList(page).getByRole('button', { name: '로그아웃', exact: true })
  }
  return page.getByRole('banner').getByRole('button', { name: '로그아웃', exact: true })
}

/**
 * 로그아웃하고 로그인 화면까지 (MOB1 D-MOB1-05·AC-MOB1-06): 끝내지 않은 방송이 있거나 출력 기기면 확인 창 "로그아웃할까요?"가 뜬다 —
 * 창이 뜨면 위험 버튼 "로그아웃"까지 누른다. 창이 뜨는지는 기다려 본다(로그인 화면이 먼저 오면 창 없음).
 */
export async function logoutFully(page: Page): Promise<void> {
  await (await logoutButton(page)).click()
  const dialog = page.getByRole('dialog', { name: '로그아웃할까요?' })
  const loginId = page.getByLabel('아이디')
  await expect(dialog.or(loginId)).toBeVisible()
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: '로그아웃', exact: true }).click()
  await expect(loginId).toBeVisible()
}

/** 컨텍스트(또는 페이지)가 닫혀서 route 처리가 실패했는가 — 닫힘이 아닌 오류는 false */
function closedWhileRouting(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /Request context disposed|Response has been disposed|Target page, context or browser has been closed/.test(message)
}

/** 수를 알려 주는 두 주소 (unroute는 같은 함수로 찾으므로 하나를 함께 쓴다) */
const reviewUrls = (url: URL): boolean => url.pathname === '/api/deposits/count' || url.pathname === '/api/deposits'
const reviewRoutes = new WeakMap<Page, (route: Route) => Promise<void>>()

/**
 * 확인 필요 입금 수를 서버가 review라고 말하는 것처럼 흉내 낸다 (null이면 흉내를 거둔다).
 * 메뉴의 수는 GET /api/deposits/count만이 아니라 입금 확인 화면의 목록 응답(GET /api/deposits의 review)으로도 바뀐다 —
 * 수만 흉내 내면 `/deposits`에서 목록 응답의 실제 수가 늦게 와 흉내 낸 수를 덮는다(두 응답 중 늦게 온 쪽). 그래서 둘 다 같은 수로.
 */
export async function fakeReviewCount(page: Page, review: number | null): Promise<void> {
  const previous = reviewRoutes.get(page)
  if (previous !== undefined) {
    await page.unroute(reviewUrls, previous)
    reviewRoutes.delete(page)
  }
  if (review === null) return
  const handler = async (route: Route): Promise<void> => {
    const url = new URL(route.request().url())
    if (route.request().method() !== 'GET') return route.fallback()
    if (url.pathname === '/api/deposits/count') return route.fulfill({ json: { review } })
    try {
      const response = await route.fetch()
      const body = (await response.json()) as Record<string, unknown>
      await route.fulfill({ response, json: { ...body, review } })
    } catch (error) {
      // 시험이 끝나 컨텍스트가 닫힌 뒤 늦게 온 목록 요청만 조용히 넘긴다 — 다른 오류는 그대로 드러낸다
      if (closedWhileRouting(error)) return
      throw error
    }
  }
  reviewRoutes.set(page, handler)
  await page.route(reviewUrls, handler)
}
