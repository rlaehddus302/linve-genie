// TTX E2E 공용 도우미 (test-e2e): 압축 해제 확장(X1 도우미) + 가짜 틱톡 라이브 페이지 + 가짜 웹캐스트(N2b-2 도우미). 여러 플랫폼 묶음(@multi)에서만 돈다.
// 가짜 틱톡 페이지는 Playwright가 https://www.tiktok.com/** 를 돌려준다. 요소 이름은 apps/extension/src/tiktok-selectors.ts의 것만 쓴다
// (실제 틱톡 화면 구조가 아니다 — 실물 확인 HG-TTX). 문장은 acceptance.md "화면 문구" 표 그대로.
import { expect, type BrowserContext, type Page } from '@playwright/test'
import { test as extTest } from '../x1/support.ts'

export { addChat, claimsOf, connectPopup, issueCode, openLiveChat, openPopup, pickBroadcast } from '../x1/support.ts'
export * from '../n2b2/support.ts'

export const test = extTest
export { expect }

/** 콘솔 틱톡 칸 받는 길 / 경고 (acceptance "화면 문구") */
export const ROUTE = {
  DIRECT: '서버 연결로 받는 중',
  DIRECT_STANDBY: '서버 연결로 받는 중 · 확장은 대기 중',
  EXTENSION: '확장으로 받는 중',
} as const
export const WARN = {
  STALE: '확장에서 틱톡 댓글이 오지 않아요',
  HIDDEN: '틱톡 방송 화면을 앞으로 꺼내 두세요',
  UNREADABLE: '틱톡 화면이 바뀌어 댓글을 읽지 못해요',
  ELSEWHERE: '확장이 내 틱톡 방송 화면에 있지 않아요. 내 방송 화면을 열어 주세요.',
} as const
/** 확장 팝업 틱톡 줄 */
export const POPUP = {
  RECORDING: '틱톡 댓글을 라이브지니로 보내고 있어요.',
  STANDBY: '서버 연결로 받고 있어 확장은 기다려요.',
  NOT_OWN_LIVE: '지금 화면은 내 틱톡 방송이 아니에요. 댓글을 보내지 않아요.',
  NO_TIKTOK_ID: '라이브지니 설정에서 내 틱톡 아이디를 먼저 넣어 주세요.',
  NOT_LINKED: '라이브지니 콘솔에서 방송을 틱톡에 먼저 이어 주세요.',
  NO_CONSENT: '틱톡 연결이 꺼져 있어요. 라이브지니 설정에서 안내를 읽고 켜 주세요.',
  PLATFORM_NOT_READY: '지금은 틱톡 연결을 쓸 수 없어요. 댓글을 직접 넣어 주세요.',
  OVERFLOW: '놓친 틱톡 댓글이 있어요. 라이브지니에서 댓글을 붙여 넣어 주세요.',
  ELSEWHERE_PAGE: '내 틱톡 방송 화면을 열면 댓글을 보내요.',
} as const

/** 가짜 틱톡 화면 (빈 댓글 목록 — 확장이 시작한 뒤에 붙인 댓글만 보낸다) */
const TIKTOK_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>틱톡 라이브</title></head><body>
<main><h1>틱톡 라이브(가짜)</h1><div class="tt-comment-list"></div></main></body></html>`

/** 이 브라우저의 www.tiktok.com 요청을 가짜 화면으로 돌려준다 */
export async function routeTiktok(context: BrowserContext): Promise<void> {
  await context.route('https://www.tiktok.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: TIKTOK_HTML }))
}

/** 틱톡 탭 열기 (주소 경로 예: `/@seller/live`) */
export async function openTiktok(context: BrowserContext, path: string): Promise<Page> {
  const tab = await context.newPage()
  await tab.goto(`https://www.tiktok.com${path}`)
  await expect(tab.locator('.tt-comment-list')).toBeAttached()
  return tab
}

let commentCounter = 0n
/** 서로 다른 10진 댓글 ID (2^53보다 큰 값 — 실제 틱톡 ID 길이) */
export function newCommentId(): string {
  commentCounter += 1n
  return (7_400_000_000_000_000_000n + BigInt(Date.now() % 1_000_000) * 1_000n + commentCounter).toString()
}
let userCounter = 0n
export function newUserId(): string {
  userCounter += 1n
  return (7_200_000_000_000_000_000n + BigInt(Date.now() % 1_000_000) * 1_000n + userCounter).toString()
}

export interface TtComment { commentId?: string; userId?: string; uniqueId?: string; nickname: string; text: string }

/** 가짜 틱톡 화면 댓글 목록 끝에 일반 댓글 하나를 붙인다 (닉네임·본문은 글자로) */
export async function addTtComment(tab: Page, c: TtComment): Promise<{ commentId: string; userId: string }> {
  const commentId = c.commentId ?? newCommentId()
  const userId = c.userId ?? newUserId()
  await tab.evaluate((m) => {
    const el = document.createElement('div')
    el.className = 'tt-comment'
    el.setAttribute('data-comment-id', m.commentId)
    el.setAttribute('data-user-id', m.userId)
    el.setAttribute('data-unique-id', m.uniqueId)
    const nick = document.createElement('span')
    nick.className = 'tt-nickname'
    nick.textContent = m.nickname
    const text = document.createElement('span')
    text.className = 'tt-text'
    text.textContent = m.text
    el.append(nick, text)
    document.querySelector('.tt-comment-list')?.append(el)
  }, { commentId, userId, uniqueId: c.uniqueId ?? `viewer_${userId.slice(-6)}`, nickname: c.nickname, text: c.text })
  return { commentId, userId }
}

/** 콘솔 틱톡 칸 받는 길 한 줄 */
export function routeLine(page: Page) {
  return page.getByRole('region', { name: '틱톡', exact: true }).getByRole('status', { name: '틱톡 댓글 받는 길' })
}

/** 팝업 틱톡 줄이 그 문장이 될 때까지 (팝업은 열 때 한 번만 그린다 — 다시 연다) */
export async function expectPopupTiktok(popup: Page, text: string, timeout = 30_000): Promise<void> {
  await expect(async () => {
    await popup.reload()
    await expect(popup.getByRole('region', { name: '틱톡' }).getByRole('status')).toHaveText(text, { timeout: 1000 })
  }).toPass({ timeout })
}

/** 확장이 서버 틱톡 받는 경로(/ext/tiktok/chats)에 보낸 요청 수를 센다 (서비스 워커 요청 포함 — 지나가게 둔다) */
export async function countTiktokChats(context: BrowserContext): Promise<{ count: () => number; items: () => number }> {
  let count = 0
  let items = 0
  await context.route('**/ext/tiktok/chats', async (route) => {
    count += 1
    try {
      const body = route.request().postDataJSON() as { items?: unknown[] } | null
      items += Array.isArray(body?.items) ? body.items.length : 0
    } catch {
      // 본문을 읽지 못해도 요청은 센다
    }
    await route.continue()
  })
  return { count: () => count, items: () => items }
}

/** 틱톡 연결 보기 (서버) */
export async function ttLinkView(page: Page, b: string): Promise<{ state: string; collection: { state: string; reason: string | null } | null; extension: { state: string; active: boolean; route: string | null; warning: string | null; recorded: number; standby: number } | null }> {
  const res = await page.request.get(`/api/broadcasts/${encodeURIComponent(b)}/tiktok`)
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as { link: never }).link
}

let idCounter = 0
/** 시험마다 다른 틱톡 아이디 (소문자) */
export function newTtxId(): string {
  idCounter += 1
  return `ttx_${Math.random().toString(36).slice(2, 8)}_${String(idCounter)}`
}
