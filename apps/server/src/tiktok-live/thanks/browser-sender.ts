// 틱톡 라이브 감사 채팅 — 브라우저 길 (D-TT-SEND-01·04): 서버의 Chromium(Playwright)이 라이브지니 봇 계정으로 판매자의 틱톡 라이브 화면
// (https://www.tiktok.com/@<아이디>/live)을 열어 채팅 칸에 글을 넣고 보낸다. 틱톡 웹캐스트 보내기 API는 요청 서명이 필요해 직접 부르지 않는다.
// - 로그인: 사람이 한 번 로그인해 만든 Playwright 로그인 상태(storageState JSON, `pnpm --filter @livejjim/server tiktok-bot login`).
//   서버는 틱톡에 로그인하지 않는다. 보낼 때마다 새 쿠키를 같은 파일에 다시 적는다. sessionid 쿠키가 없으면 열지도 않고 auth.
// - 방송마다(틱톡 아이디) 페이지 하나를 열어 둔다(많아야 maxPages, 오래 안 쓴 것부터 닫는다).
// - 보내기: 지금 보이는 댓글에 표시를 붙이고 → 입력 칸을 비우고 글을 넣고 → 보내기 단추. confirmMs 안에 표시 없는 새 댓글 중 같은 글이 보이면 게시됨,
//   못 보면 unverified — 다시 넣지 않는다(두 번 올라가는 것보다 빠짐이 안전하다, D-Y1-06).
// - 실패 약속: 보내기 단추를 누르기 전의 실패(auth·blocked·rejected·network·ended)는 "올라가지 않음"이 확실하다 → 실행기가 다시 시도해도 된다.
//   누른 뒤의 실패는 모두 unverified.
// - allowedHosts를 주면 그 밖의 주소로 가는 브라우저 요청을 모두 막는다(시험은 127.0.0.1만 — 실제 틱톡에 아무것도 쓰지 않는다).
// - 화면 모양: 실물 확인(2026-11-11, 틱톡 웹 라이브 화면 — 읽기만): 입력 칸 data-e2e="room-chat-input-field"(contenteditable="plaintext-only" div),
//   보내기 data-e2e="room-chat-send-btn"(div), 댓글 data-e2e="chat-message"(요소 id·댓글 ID 속성 없음), 쓴 사람 data-e2e="message-owner-name".
//   틱톡이 화면을 바꾸면 아래 상수만 고친다.
// 이 길은 틱톡이 허락한 연동이 아니다(자동화 제한 약관) — 운영자가 판매자를 골라 켤 때만 쓴다(기본 꺼짐).
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import type { Timer } from '../../youtube/timer.ts'
import { ChatSendError, Pacer } from '../../youtube/chat-send/sender.ts'

/** 브라우저 안에서 도는 함수(evaluate·waitForFunction)가 만지는 요소 — 저장소 전체 타입 검사 설정에는 DOM 타입이 없다 (D-CI-01) */
interface PageNode {
  textContent: string | null
  setAttribute(name: string, value: string): void
  hasAttribute(name: string): boolean
}
interface PageDocument {
  querySelectorAll(selector: string): Iterable<PageNode>
}

export const TT_SEND_BASE_URL = 'https://www.tiktok.com'
export const TT_SEND_TIMEOUT_MS = 20_000
export const TT_SEND_CONFIRM_MS = 8000
/** 한 계정의 글 사이 간격 — 틱톡 스팸 제한을 피하려고 유튜브(3초)보다 넉넉히 */
export const TT_SEND_GAP_MS = 5000
export const TT_SEND_MAX_PAGES = 4
/** 틱톡 라이브 댓글 한 번에 넣을 수 있는 글자 수 (코드 포인트) — 넘는 감사는 묶음에서 나눈다 */
export const TT_COMMENT_MAX = 150
/** 로그인 쿠키 이름 */
export const TT_SESSION_COOKIE = 'sessionid'
/** 우리가 이미 본 댓글 표시 (보낸 뒤 새로 뜬 것만 본다) */
const SEEN_ATTR = 'data-livegenie-seen'

export const TT_SEND_SELECTORS = {
  input: '[data-e2e="room-chat-input-field"]',
  send: '[data-e2e="room-chat-send-btn"]',
  message: '[data-e2e="chat-message"]',
  owner: '[data-e2e="message-owner-name"]',
  /** 로그아웃 상태에서 입력·보내기를 누르면 뜨는 로그인 창 */
  login: '[data-e2e="login-modal"], #login-modal, [data-e2e="modal-close-inner-button"]',
} as const

/** 틱톡 감사 보내는 곳 (실행기가 쓴다 — 시험은 가짜) */
export interface TikTokChatSender {
  /** 그 틱톡 아이디의 라이브 채팅에 글 하나. 실패는 ChatSendError(위 "실패 약속") */
  send(tiktokId: string, text: string): Promise<void>
  /** 로그인 상태 파일에 살아 있는 로그인 쿠키가 있는가 (읽기만 — 틱톡에 나가지 않는다) */
  loggedIn(): Promise<boolean>
  close(): Promise<void>
}

export interface BrowserTikTokSenderOptions {
  readonly storageStatePath: string
  readonly timer: Timer
  readonly baseUrl?: string
  readonly executablePath?: string
  /** 기본 false(창 있음 — 서버는 xvfb-run). 틱톡도 HeadlessChrome 사용자 에이전트를 가려낼 수 있다 */
  readonly headless?: boolean
  readonly allowedHosts?: readonly string[]
  readonly timeoutMs?: number
  readonly confirmMs?: number
  readonly gapMs?: number
  readonly maxPages?: number
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

export class BrowserTikTokSender implements TikTokChatSender {
  readonly #options: BrowserTikTokSenderOptions
  readonly #pacer: Pacer
  #browser: Promise<{ browser: Browser; context: BrowserContext }> | null = null
  /** 틱톡 아이디 → 열어 둔 라이브 화면 (넣은 순서 = 오래 안 쓴 순서) */
  readonly #pages = new Map<string, Page>()

  constructor(options: BrowserTikTokSenderOptions) {
    this.#options = options
    this.#pacer = new Pacer(options.timer, options.gapMs ?? TT_SEND_GAP_MS)
  }

  get #base(): string {
    return this.#options.baseUrl ?? TT_SEND_BASE_URL
  }

  #open(): Promise<{ browser: Browser; context: BrowserContext }> {
    if (this.#browser !== null) return this.#browser
    this.#browser = (async () => {
      const browser = await chromium.launch({
        headless: this.#options.headless ?? false,
        ...(this.#options.executablePath === undefined ? {} : { executablePath: this.#options.executablePath }),
      })
      try {
        const context = await browser.newContext({
          storageState: this.#options.storageStatePath,
          locale: 'ko-KR',
        })
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

  async loggedIn(): Promise<boolean> {
    try {
      const { context } = await this.#open()
      const now = Date.now() / 1000
      return (await context.cookies(this.#base)).some((cookie) => cookie.name === TT_SESSION_COOKIE && cookie.value !== '' && (cookie.expires === -1 || cookie.expires > now))
    } catch {
      return false
    }
  }

  async #page(tiktokId: string): Promise<Page> {
    const cached = this.#pages.get(tiktokId)
    if (cached !== undefined && !cached.isClosed()) {
      this.#pages.delete(tiktokId)
      this.#pages.set(tiktokId, cached)
      return cached
    }
    this.#pages.delete(tiktokId)
    const { context } = await this.#open()
    while (this.#pages.size >= (this.#options.maxPages ?? TT_SEND_MAX_PAGES)) {
      const [oldest, page] = this.#pages.entries().next().value as [string, Page]
      this.#pages.delete(oldest)
      await page.close().catch(() => {})
    }
    const page = await context.newPage()
    const url = new URL(`/@${encodeURIComponent(tiktokId)}/live`, this.#base)
    try {
      await page.goto(url.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: this.#options.timeoutMs ?? TT_SEND_TIMEOUT_MS,
      })
    } catch {
      await page.close().catch(() => {})
      throw new ChatSendError('network')
    }
    this.#pages.set(tiktokId, page)
    return page
  }

  async #drop(tiktokId: string): Promise<void> {
    const page = this.#pages.get(tiktokId)
    this.#pages.delete(tiktokId)
    await page?.close().catch(() => {})
  }

  async send(tiktokId: string, text: string): Promise<void> {
    return this.#pacer.run(async () => {
      // ── 보내기 단추 전: 실패는 모두 "올라가지 않음" ──
      if (!(await this.loggedIn())) throw new ChatSendError('auth')
      const timeout = this.#options.timeoutMs ?? TT_SEND_TIMEOUT_MS
      let page: Page
      try {
        page = await this.#page(tiktokId)
      } catch (error) {
        throw error instanceof ChatSendError ? error : new ChatSendError('network')
      }
      const input = page.locator(TT_SEND_SELECTORS.input).first()
      try {
        await input.waitFor({ state: 'visible', timeout })
      } catch {
        // 입력 칸이 없다 — 방송이 끝났거나(끝난 화면), 화면이 바뀌었다. 무엇이든 올리지 않았다
        await this.#drop(tiktokId)
        throw new ChatSendError('rejected')
      }
      const wanted = normalize(text)
      try {
        await page.locator(TT_SEND_SELECTORS.message).evaluateAll((elements, attr) => {
          for (const element of elements as unknown as PageNode[]) element.setAttribute(attr, '1')
        }, SEEN_ATTR)
        await input.click({ timeout: 3000 })
        // 봇 계정 화면 — 남은 글은 지우고 우리 글만 넣는다(글자로만, HTML 아님)
        await input.evaluate((element) => {
          ;(element as unknown as PageNode).textContent = ''
        })
        await page.keyboard.insertText(text)
        const typed = normalize((await input.textContent()) ?? '')
        if (typed !== wanted) throw new Error('typed')
      } catch {
        await input
          .evaluate((element) => {
            ;(element as unknown as PageNode).textContent = ''
          })
          .catch(() => {})
        // 로그인 창이 떴으면 로그인이 풀린 것 (쿠키는 남아 있어도)
        const login =
          (await page
            .locator(TT_SEND_SELECTORS.login)
            .count()
            .catch(() => 0)) > 0
        await this.#drop(tiktokId)
        throw new ChatSendError(login ? 'auth' : 'rejected')
      }
      try {
        await page.locator(TT_SEND_SELECTORS.send).first().click({ timeout: 2000 })
      } catch {
        await input
          .evaluate((element) => {
            ;(element as unknown as PageNode).textContent = ''
          })
          .catch(() => {})
        throw new ChatSendError('rejected')
      }
      // ── 누른 뒤: 확인하지 못하면 모두 unverified (다시 넣지 않는다) ──
      try {
        const found = await page
          .waitForFunction(
            ({ selector, attr, want }) => {
              for (const element of (globalThis as unknown as { document: PageDocument }).document.querySelectorAll(selector)) {
                if (element.hasAttribute(attr)) continue
                if ((element.textContent ?? '').replace(/\s+/g, ' ').includes(want)) return true
              }
              return false
            },
            {
              selector: TT_SEND_SELECTORS.message,
              attr: SEEN_ATTR,
              want: wanted,
            },
            {
              timeout: this.#options.confirmMs ?? TT_SEND_CONFIRM_MS,
              polling: 100,
            },
          )
          .then(() => true)
          .catch(() => false)
        if (!found) throw new ChatSendError('unverified')
      } catch {
        throw new ChatSendError('unverified')
      }
      // 로그인 상태를 새로 적는다 (쿠키가 돌아도 세션을 잇는다). 실패해도 게시는 됐다
      const { context } = await this.#open()
      await context.storageState({ path: this.#options.storageStatePath }).catch(() => {})
    })
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
