// browser 길 (D-YT-SEND-03): 서버에서 Chromium(Playwright)을 띄워 봇 계정으로 팝아웃 채팅(live_chat?is_popout=1&v=)에 글을 넣고 보낸다.
// - 로그인: 저장해 둔 Playwright 로그인 상태(storageState JSON). 서버에서 구글 로그인을 하지 않는다(구글은 자동 제어 브라우저 로그인을 막을 수 있다) —
//   사람이 한 번 로그인해 상태 파일을 만들고, 보낼 때마다 새 쿠키를 같은 파일에 다시 적어 세션을 이어 간다.
// - 방송마다 페이지 하나를 열어 둔다(많아야 maxPages, 오래 안 쓴 것부터 닫는다).
// - 보내기: 입력 칸이 보이면 비우고 글을 넣고 보내기 단추를 누른다 → confirmMs 안에 새로 뜬 일반 채팅 중 같은 글이 있으면 그 요소 id(유튜브 메시지 ID)로 게시됨,
//   못 보면 "모름"(unverified) — 다시 넣지 않는다. 입력 칸이 없으면: 로그인 링크가 있으면 auth, 아니면 rejected(채팅을 쓸 수 없음).
// - allowedHosts를 주면 그 밖의 주소로 가는 브라우저 요청을 모두 막는다(시험은 127.0.0.1만 — 실제 유튜브에 아무것도 쓰지 않는다).
// - 화면 모양은 크롬 확장(apps/extension/src/selectors.ts, HG-X1 실물 확인)과 같다. 유튜브가 화면을 바꾸면 아래 상수를 고친다.
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import type { Timer } from '../timer.ts'
import { ChatSendError, Pacer, type ChatSender, type ChatSendResult, type ChatSendTarget } from './sender.ts'

export const BROWSER_BASE_URL = 'https://www.youtube.com'
/** 페이지 열기·입력 칸 기다리기 */
export const BROWSER_TIMEOUT_MS = 15_000
/** 보낸 뒤 내 글이 뜨기를 기다리는 시간 */
export const BROWSER_CONFIRM_MS = 8000
/** 임시 항목이 뜬 뒤 진짜 메시지 ID를 기다리는 시간 */
export const BROWSER_SERVER_ID_MS = 4000
export const BROWSER_GAP_MS = 3000
export const BROWSER_MAX_PAGES = 4

/** 화면 모양 (apps/extension/src/selectors.ts와 같은 값) */
export const SELECTORS = {
  input: 'yt-live-chat-message-input-renderer #input[contenteditable]',
  send: 'yt-live-chat-message-input-renderer #send-button button, yt-live-chat-message-input-renderer button#send-button',
  message: 'yt-live-chat-text-message-renderer',
  body: '#message',
  signIn: 'a[href*="ServiceLogin"], a[href*="accounts.google.com"], yt-live-chat-restricted-participation-renderer a[href*="signin"]',
} as const

export interface BrowserSenderOptions {
  /** Playwright 로그인 상태 파일 (봇 계정). 보낼 때마다 새 쿠키를 다시 적는다 */
  readonly storageStatePath: string
  /** 봇 계정 채널 ID (UC…) */
  readonly authorChannelId: string
  readonly timer: Timer
  readonly baseUrl?: string
  /** Chromium 실행 파일 (없으면 Playwright가 설치한 것) */
  readonly executablePath?: string
  /**
   * 기본 false(창 있음). 실물(2026-11-08): 유튜브 팝아웃 채팅은 사용자 에이전트가 HeadlessChrome이면 "이전 버전의 브라우저" 화면만 내고 입력 칸이 없다.
   * 사용자 에이전트를 꾸미지 않는다 — 서버(리눅스)는 가상 화면(Xvfb, 예: xvfb-run)에서 창 있는 브라우저로 띄운다
   */
  readonly headless?: boolean
  /** 이 호스트로 가는 요청만 보낸다 (없으면 막지 않음) */
  readonly allowedHosts?: readonly string[]
  readonly timeoutMs?: number
  readonly confirmMs?: number
  readonly gapMs?: number
  readonly maxPages?: number
}

export class BrowserChatSender implements ChatSender {
  readonly route = 'browser' as const
  readonly needsLiveChatId = false
  readonly authorChannelId: string
  readonly #options: BrowserSenderOptions
  readonly #pacer: Pacer
  #browser: Promise<{ browser: Browser; context: BrowserContext }> | null = null
  /** 영상 ID → 열어 둔 채팅 페이지 (넣은 순서 = 오래 안 쓴 순서) */
  readonly #pages = new Map<string, Page>()

  constructor(options: BrowserSenderOptions) {
    this.#options = options
    this.authorChannelId = options.authorChannelId
    this.#pacer = new Pacer(options.timer, options.gapMs ?? BROWSER_GAP_MS)
  }

  #open(): Promise<{ browser: Browser; context: BrowserContext }> {
    if (this.#browser !== null) return this.#browser
    this.#browser = (async () => {
      const browser = await chromium.launch({ headless: this.#options.headless ?? false, ...(this.#options.executablePath === undefined ? {} : { executablePath: this.#options.executablePath }) })
      try {
        const context = await browser.newContext({ storageState: this.#options.storageStatePath, locale: 'ko-KR' })
        const allowed = this.#options.allowedHosts
        if (allowed !== undefined) {
          await context.route('**/*', async (route) => {
            let host: string
            try {
              host = new URL(route.request().url()).hostname
            } catch {
              host = ''
            }
            if (allowed.includes(host)) await route.continue()
            else await route.abort('blockedbyclient')
          })
        }
        return { browser, context }
      } catch (error) {
        await browser.close()
        throw error
      }
    })()
    this.#browser.catch(() => {
      this.#browser = null
    })
    return this.#browser
  }

  async #page(videoId: string): Promise<Page> {
    const cached = this.#pages.get(videoId)
    if (cached !== undefined && !cached.isClosed()) {
      // 가장 최근에 쓴 것으로
      this.#pages.delete(videoId)
      this.#pages.set(videoId, cached)
      return cached
    }
    this.#pages.delete(videoId)
    const { context } = await this.#open()
    while (this.#pages.size >= (this.#options.maxPages ?? BROWSER_MAX_PAGES)) {
      const [oldest, page] = this.#pages.entries().next().value as [string, Page]
      this.#pages.delete(oldest)
      await page.close().catch(() => {})
    }
    const page = await context.newPage()
    const url = new URL('/live_chat', this.#options.baseUrl ?? BROWSER_BASE_URL)
    url.searchParams.set('is_popout', '1')
    url.searchParams.set('v', videoId)
    try {
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: this.#options.timeoutMs ?? BROWSER_TIMEOUT_MS })
    } catch (error) {
      await page.close().catch(() => {})
      const name = error instanceof Error ? error.name : ''
      throw new ChatSendError(name === 'TimeoutError' ? 'timeout' : 'network')
    }
    // 유튜브가 서버(IP)를 막아 봇 확인(/sorry)으로 돌려보냈다 — 계정 문제가 아니다 (D-YT-SEND-12)
    if (new URL(page.url()).pathname.startsWith('/sorry')) {
      await page.close().catch(() => {})
      throw new ChatSendError('blocked')
    }
    this.#pages.set(videoId, page)
    return page
  }

  /** 그 영상 페이지를 닫는다 (다음 보내기는 새로 연다) */
  async #drop(videoId: string): Promise<void> {
    const page = this.#pages.get(videoId)
    this.#pages.delete(videoId)
    await page?.close().catch(() => {})
  }

  async send(target: ChatSendTarget, text: string, signal?: AbortSignal): Promise<ChatSendResult> {
    return this.#pacer.run(async () => {
      if (signal?.aborted === true) throw new ChatSendError('timeout')
      const timeout = this.#options.timeoutMs ?? BROWSER_TIMEOUT_MS
      const page = await this.#page(target.videoId)
      const input = page.locator(SELECTORS.input).first()
      try {
        await input.waitFor({ state: 'visible', timeout })
      } catch {
        const signedOut = (await page.locator(SELECTORS.signIn).count().catch(() => 0)) > 0
        await this.#drop(target.videoId)
        throw new ChatSendError(signedOut ? 'auth' : 'rejected')
      }
      if (signal?.aborted ?? false) throw new ChatSendError('timeout')
      // 지금 보이는 메시지 (보낸 뒤 새로 뜬 것만 본다)
      const before = await page.locator(SELECTORS.message).evaluateAll((elements) => elements.map((element) => element.id))
      // 봇 계정 화면이다 — 남은 글은 지우고 우리 글만 넣는다(글자로만, HTML 아님)
      await input.click({ timeout })
      await input.evaluate((element) => {
        element.textContent = ''
      })
      await page.keyboard.insertText(text)
      try {
        await page.locator(SELECTORS.send).first().click({ timeout: 2000 })
      } catch {
        // 보내지 못했다 — 넣은 글을 지우고 안 올림
        await input.evaluate((element) => {
          element.textContent = ''
        }).catch(() => {})
        throw new ChatSendError('rejected')
      }
      const wanted = text.replace(/\s+/g, ' ').trim()
      // 새로 뜬 같은 글 (serverOnly면 유튜브 메시지 ID 모양 — Ch로 시작 — 인 것만)
      const appeared = (serverOnly: boolean, timeout: number) =>
        page
          .waitForFunction(
            ({ selector, body, wanted: want, before: seen, serverOnly: strict }) => {
              for (const element of document.querySelectorAll(selector)) {
                if (seen.includes(element.id)) continue
                if (strict && !/^Ch[A-Za-z0-9_-]{16,}$/.test(element.id)) continue
                const shown = (element.querySelector(body)?.textContent ?? '').replace(/\s+/g, ' ').trim()
                if (shown === want) return element.id
              }
              return null
            },
            { selector: SELECTORS.message, body: SELECTORS.body, wanted, before, serverOnly },
            { timeout, polling: 100 },
          )
          .then(async (handle) => (await handle.jsonValue()) as string | null)
          .catch(() => null)
      const found = await appeared(false, this.#options.confirmMs ?? BROWSER_CONFIRM_MS)
      if (found === null) throw new ChatSendError('unverified')
      // 실물(2026-11-08): 먼저 뜨는 것은 화면이 바로 그린 임시 항목(id가 COCp… 모양)이고, 유튜브가 받은 뒤 진짜 메시지 ID(ChwK…)로 바뀐다.
      // 임시 id는 메시지 ID로 쓰지 않는다 — 잠깐 진짜 ID를 기다리고, 못 보면 ID 없이 게시됨(수집기가 같은 글로 짝짓는다)
      const serverId = /^Ch[A-Za-z0-9_-]{16,}$/.test(found) ? found : await appeared(true, BROWSER_SERVER_ID_MS)
      // 로그인 상태를 새로 적는다 (쿠키가 돌아도 세션을 잇는다). 실패해도 게시는 됐다
      const { context } = await this.#open()
      await context.storageState({ path: this.#options.storageStatePath }).catch(() => {})
      return { messageId: serverId }
    }, signal)
  }

  async close(): Promise<void> {
    const opened = this.#browser
    this.#browser = null
    this.#pages.clear()
    if (opened === null) return
    try {
      const { browser } = await opened
      await browser.close()
    } catch {
      // 열지 못했던 브라우저
    }
  }
}
