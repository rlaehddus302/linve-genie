// X1 E2E 공용 도우미 (test-e2e): 압축 해제 확장을 올린 크로미움 + 가짜 유튜브 live_chat 페이지.
// 확장은 이 묶음의 서버 주소(http://localhost:<api>)로 빌드해 — E2E 화면 서버(apps/web/e2e/serve.ts)가 /ext/를 넘기지 않아서(TE-X1-001).
// 운영처럼 서버가 화면을 함께 내는 경우와 같은 모양(확장은 서버 주소 하나만 안다).
// 빌드 결과는 node_modules/.cache 아래에 둔다(린트·git이 보지 않는 곳).
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test as base, type BrowserContext, type Page } from '@playwright/test'
import { STACKS } from '../../../apps/web/playwright.config.ts'

export * from '../i3/support.ts'

const EXT_SRC = fileURLToPath(new URL('../../../apps/extension', import.meta.url))
const CACHE = fileURLToPath(new URL('../../../node_modules/.cache/livejjim-e2e', import.meta.url))

const built = new Set<string>()
function buildExtension(origin: string): string {
  const out = `${CACHE}/extension-${new URL(origin).port}`
  if (!built.has(out)) {
    execFileSync('node', ['build.mjs'], { cwd: EXT_SRC, env: { ...process.env, LIVEGENIE_ORIGIN: origin, LIVEGENIE_EXT_OUT: out }, stdio: 'pipe' })
    built.add(out)
  }
  return out
}

/** 가짜 유튜브 live_chat 페이지 (실제 요소 이름·모양을 본뜸, 확장 시작 전 메시지 1개) */
const LIVE_CHAT_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>실시간 채팅</title></head><body>
<yt-live-chat-app><yt-live-chat-renderer>
<yt-live-chat-header-renderer><span id="view-selector">실시간 채팅</span></yt-live-chat-header-renderer>
<yt-live-chat-item-list-renderer><div id="item-scroller"><div id="item-offset"><div id="items">
<yt-live-chat-text-message-renderer id="ChwKGkNPbGRfZTJlX3gxX29sZDAwMDAwMDAwMDAw"><div id="content"><span id="author-name">이전손님</span><span id="message">3번</span></div></yt-live-chat-text-message-renderer>
</div></div></div></yt-live-chat-item-list-renderer>
</yt-live-chat-renderer></yt-live-chat-app></body></html>`

export interface ExtFixtures { ext: { context: BrowserContext; page: Page; extId: string } }

export const test = base.extend<ExtFixtures>({
  ext: async ({ baseURL }, use, info) => {
    if (baseURL === undefined) throw new Error('baseURL 없음')
    const stack = STACKS.find((s) => s.name === info.project.name)
    if (stack === undefined) throw new Error('묶음 없음')
    const dir = buildExtension(`http://localhost:${String(stack.api)}`)
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      baseURL,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
    })
    try {
      await context.route('https://www.youtube.com/live_chat*', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: LIVE_CHAT_HTML }))
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
      const extId = new URL(worker.url()).host
      const page = context.pages()[0] ?? (await context.newPage())
      await use({ context, page, extId })
    } finally {
      await context.close()
    }
  },
})
export { expect }

/** 설정 → 확장 연결 → 8자리 코드 */
export async function issueCode(page: Page): Promise<string> {
  await page.goto('/settings/extension')
  const region = page.getByRole('region', { name: '크롬 확장으로 채팅 받기', exact: true })
  await region.getByRole('button', { name: '확장 연결' }).click()
  const code = (await region.getByRole('group', { name: '연결 코드' }).getByLabel(/^연결 코드/).textContent()) ?? ''
  const digits = code.replace(/\D/g, '')
  expect(digits).toMatch(/^\d{8}$/)
  return digits
}

/** 유튜브 팝아웃 채팅 탭 열기 */
export async function openLiveChat(context: BrowserContext, videoId: string): Promise<Page> {
  const chat = await context.newPage()
  await chat.goto(`https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`)
  await expect(chat.locator('#items')).toBeAttached()
  return chat
}

/** 확장 팝업 (탭으로 연다) */
export async function openPopup(context: BrowserContext, extId: string): Promise<Page> {
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  return popup
}

export async function connectPopup(popup: Page, code: string): Promise<void> {
  await popup.getByLabel('연결 코드').fill(`${code.slice(0, 4)} ${code.slice(4)}`)
  await popup.getByRole('button', { name: '연결하기' }).click()
  // 연결되면 상태 줄이 "아직 연결되지 않았어요"에서 바뀐다 (보이기·숨기기는 따로 본다 — TE-X1-002)
  await expect(popup.locator('#state')).not.toHaveText(/아직 라이브지니와 연결되지 않았어요|불러오는 중/)
  await expect(popup.locator('#connect-error')).toHaveText('')
}

/** 유튜브 채팅 창에 새 일반 채팅 하나를 붙인다 (채널 ID·게시 시각은 실제처럼 요소 data에만) */
export async function addChat(chat: Page, m: { id: string; ch: string; nick: string; text: string; atMs?: number }): Promise<void> {
  await chat.evaluate((msg) => {
    const el = document.createElement('yt-live-chat-text-message-renderer') as HTMLElement & { data?: unknown }
    el.id = msg.id
    el.data = { authorExternalChannelId: msg.ch, timestampUsec: String(msg.at * 1000) }
    const content = document.createElement('div')
    content.id = 'content'
    const name = document.createElement('span')
    name.id = 'author-name'
    name.textContent = msg.nick
    const message = document.createElement('span')
    message.id = 'message'
    message.textContent = msg.text
    content.append(name, message)
    el.append(content)
    document.getElementById('items')?.append(el)
  }, { ...m, at: m.atMs ?? Date.now() })
}

/** 그날 그 번호 찜 수 */
export function claimsOf(view: { claims: { no: number; broadcast: string }[] }, b: string, no: number): number {
  return view.claims.filter((c) => c.broadcast === b && c.no === no).length
}

/** 팝업에서 회차를 고르고, 서버에 이어질 때까지 기다린다 (잇기 전에 게시된 채팅은 기록하지 않는 규칙 — AC-X1-13) */
export async function pickBroadcast(popup: Page, seller: Page, label: string, b: string): Promise<void> {
  await popup.getByRole('radio', { name: label }).check()
  await popup.getByRole('button', { name: '이 방송으로 받기' }).click()
  await expect(popup.locator('#pick-error')).toHaveText('')
  await expect.poll(async () => {
    const res = await seller.request.get('/api/extension')
    return ((await res.json()) as { extension: { broadcasts: string[] } }).extension.broadcasts.includes(b)
  }).toBe(true)
}
