// LND1 공개 소개 화면 E2E 공용 (test-e2e). 문장은 acceptance.md "확정 문장" 표·D-LND1-03·05 글자 그대로 (구현을 보고 정하지 않음).
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'

export const TITLE = '라이브지니'
export const TAGLINE = '유튜브·인스타그램·틱톡 라이브 판매의 찜을 자동으로 받아 선착순을 정하고, 라벨 출력과 정산까지 도와드려요.'
export const HEADINGS = ['판매자의 하루', '시작하려면', '구글 사용자 데이터를 쓰는 곳', '운영 사업자'] as const
export const DAY_STEPS = [
  '방송 전: 오늘 팔 상품의 번호·이름·가격을 적어요. 말로 불러도 돼요.',
  '방송 중: 손님이 채팅에 상품 번호를 쓰면 찜으로 받아 먼저 쓴 순서대로 정해요.',
  '찜이 정해지면: 상품 라벨이 바로 출력돼요.',
  '방송 뒤: 손님마다 합계·배송비를 정산하고 입금을 확인해요.',
  '포장: 손님별 목록을 보며 담고 포장 라벨을 붙여요.',
] as const
export const START_TEXT = '라이브지니 계정은 운영자가 만들어 드려요. 받은 아이디로 로그인해 주세요.'
export const GOOGLE_ITEMS = [
  '유튜브를 연결하면 판매자 본인 채널의 이름, 본인 라이브 방송 목록, 고른 방송의 채팅 글을 읽어요. 채팅에서 주문을 찾는 데만 써요.',
  '판매자가 설정에서 감사 메시지 자동 게시를 켜고 동의했을 때만 본인 방송 채팅이나 본인 영상 댓글에 짧은 감사 글을 올려요.',
  '구글로 로그인하면 구글 계정 번호와 가린 이메일만 저장해요.',
  '채팅 글과 시청자 이름은 방송 날짜부터 30일 뒤에 지워요. 구글 사용자 데이터를 팔거나 광고에 쓰지 않아요.',
  '설정의 유튜브 칸에서 언제든 연결을 끊을 수 있어요.',
] as const
export const LIMITED_USE = '라이브지니가 구글 API에서 받은 정보를 쓰고 다른 앱으로 옮길 때는 구글 API 서비스 사용자 데이터 정책(제한적 사용 요건 포함)을 따릅니다.'
export const LIMITED_USE_LINK = '구글 API 서비스 사용자 데이터 정책'
export const USER_DATA_POLICY_URL = 'https://developers.google.com/terms/api-services-user-data-policy'
export const ENGLISH =
  "LiveGenie uses Google user data only to provide its features. When a seller connects YouTube, LiveGenie reads the seller's own channel name, the seller's own live broadcasts, and the live chat messages of the chosen broadcast to find orders (youtube.readonly). Only if the seller turns on automatic thank-you messages and agrees, LiveGenie posts short thank-you messages in the seller's own live chat or as a comment on the seller's own video (youtube.force-ssl). Google sign-in uses only openid and email. Live chat text and viewer names are deleted 30 days after the broadcast date. We do not sell Google user data or use it for advertising. LiveGenie's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements."
export const OPERATOR_NAME = '상호: 틈(TEUM)'
export const SESSION_EXPIRED = '로그인이 풀렸어요. 다시 로그인해 주세요.'
export const OFFLINE = '인터넷 연결이 없어요. 연결되면 다시 불러와요.'

export const LOGIN_ID = 'e2e-shop'
export const PASSWORD = 'e2e-pass-1234'

/** 소개 화면의 h1 */
export function landingTitle(page: Page): Locator {
  return page.getByRole('heading', { level: 1, name: TITLE, exact: true })
}

/** 소개 화면의 절 */
export function section(page: Page, name: (typeof HEADINGS)[number]): Locator {
  return page.getByRole('region', { name, exact: true })
}

/** 소개 화면이 보인다 (절 "판매자의 하루" + 로그인 칸 없음) */
export async function expectLanding(page: Page): Promise<void> {
  await expect(landingTitle(page)).toBeVisible()
  await expect(section(page, '판매자의 하루')).toBeVisible()
  await expect(page.getByLabel('아이디')).toHaveCount(0)
  await expect(page.getByLabel('비밀번호')).toHaveCount(0)
}

/** 로그인 화면이 보인다 (아이디·비밀번호 칸·버튼 "로그인", 소개 절 없음) */
export async function expectLoginScreen(page: Page): Promise<void> {
  await expect(page.getByLabel('아이디')).toBeVisible()
  await expect(page.getByLabel('비밀번호')).toBeVisible()
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible()
  await expect(page.getByText('판매자의 하루', { exact: true })).toHaveCount(0)
}

/** 지금 화면의 로그인 칸으로 그 계정 로그인 */
export async function fillLogin(page: Page, account: { loginId: string; password: string } = { loginId: LOGIN_ID, password: PASSWORD }): Promise<void> {
  await page.getByLabel('아이디').fill(account.loginId)
  await page.getByLabel('비밀번호').fill(account.password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
}

/** 쿠키 없는 새 브라우저 탭 */
export async function freshTab(browser: Browser, baseURL: string, opts: { viewport?: { width: number; height: number }; touch?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    baseURL,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    ...(opts.viewport === undefined ? {} : { viewport: opts.viewport }),
    ...(opts.touch === true ? { isMobile: true, hasTouch: true } : {}),
  })
  return { ctx, page: await ctx.newPage() }
}

/** 글자 150% (MOB1 공통 전제와 같은 방법 — 뿌리 글자 크기) */
export async function bigText(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    const put = () => {
      if (document.getElementById('lnd1-big-text') !== null) return
      const style = document.createElement('style')
      style.id = 'lnd1-big-text'
      style.textContent = 'html { font-size: 150% !important }'
      ;(document.head ?? document.documentElement).appendChild(style)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', put)
    else put()
  })
}

/** 보이는 링크·버튼 중 높이 44px 미만 (이름·높이) */
export async function shortTargets(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const out: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('a[href], button, [role=button], [role=link]')) {
      const s = getComputedStyle(el)
      if (s.visibility === 'hidden' || s.display === 'none') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.height < 44 - 0.5) out.push(`${(el.textContent ?? '').trim().slice(0, 40)} ${String(Math.round(r.height))}px`)
    }
    return out
  })
}
