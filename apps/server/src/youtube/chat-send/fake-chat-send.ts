// 가짜 감사 채팅 받는 곳 (D-YT-SEND-07 — 가짜 구글·가짜 유튜브 웹처럼). 127.0.0.1에서만 연다. 세 길이 실제와 같은 통신 방식으로 부른다:
// - innertube: POST /youtubei/v1/live_chat/send_message — 쿠키(SAPISID)와 SAPISIDHASH 인증 머리글이 있어야 받는다. 보내기 값(params)에서 영상·채널 ID를 꺼내 적는다.
//   응답은 실제 모양(actions[].addChatItemAction.item.liveChatTextMessageRenderer). 추가 확인 요구(runAttestationCommand)·빈 응답·HTTP 오류·응답 없음·
//   서버(IP) 막힘(/sorry로 돌려보내고 HTML 429)을 넣을 수 있다. 계정(쿠키 SID)마다 계속 실패도 넣는다.
// - browser: GET /live_chat?is_popout=1&v= — 크롬 확장 가짜 페이지와 같은 요소 모양. 로그인 쿠키(SID)가 없으면 입력 칸 대신 로그인 링크를 그린다.
//   보내기 단추 → 페이지가 POST /fake/live_chat/post → 받은 글을 임시 id(COCp…)로 붙였다가 0.3초 뒤 메시지 ID로 바꾼다(글자로만, 실물 2026-11-08 모양).
//   글을 받고도 화면에 안 그리기(drop)·임시 id인 채 두기(tempOnly)를 넣을 수 있다.
// - nightbot: POST /1/channel/send — Bearer 토큰이 맞아야 받는다. 실제처럼 5초 안에 두 번째면 429(간격은 바꿀 수 있다).
// - innertube 지우기 (D-THANKSFIX-03): 올린 글 응답에 그 글의 메뉴 값(contextMenuEndpoint.liveChatItemContextMenuEndpoint.params)을 넣고,
//   POST /youtubei/v1/live_chat/get_item_context_menu는 그 글을 올린 계정에게만 "삭제"(아이콘 DELETE → moderateLiveChatEndpoint) 단추가 든 메뉴를,
//   POST /youtubei/v1/live_chat/moderate는 그 글을 지우고 removed에 적는다. 메뉴·지우기 HTTP 오류를 넣을 수 있다.
// 받은 글은 posts에 쌓고 onPost로 알린다(시험이 가짜 유튜브 웹 채팅에 그대로 붙여 수집기가 보게 한다).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import type { ChatSendRouteName } from './sender.ts'

export const FAKE_SEND_HOST = '127.0.0.1'
export const FAKE_BOT_COOKIE = 'SID=fake-bot-sid; HSID=fake-h; SSID=fake-s; APISID=fake-a; SAPISID=fake-sapisid'
/** 봇 계정 n의 쿠키 (SID 값 = bot-n — 가짜가 어느 계정이 올렸는지 적는다) */
export const fakeBotCookie = (n: number) => `SID=bot-${String(n)}; HSID=h; SSID=s; APISID=a; SAPISID=sapisid-${String(n)}`
export const FAKE_BROWSER_SID = 'fake-bot-sid'
export const FAKE_NIGHTBOT_TOKEN = 'fake-nightbot-token'

export interface FakePost {
  readonly route: ChatSendRouteName
  readonly id: string
  readonly text: string
  /** innertube·browser: 영상 ID */
  readonly videoId: string | null
  /** innertube: 보내기 값에 든 방송 채널 ID */
  readonly channelId: string | null
  /** nightbot: chatId */
  readonly chatId: string | null
  /** innertube: 올린 계정 (쿠키 SID 값) */
  readonly account?: string | null
  readonly at: number
}

/** blocked: 서버(IP) 막힘 — /sorry로 돌려보내고 HTML 429 */
export type FakeInnertubeFault = { readonly status: number } | { readonly kind: 'attestation' | 'noActions' | 'hang' | 'blocked' }
export type FakeBrowserFault = { readonly kind: 'drop' | 'reject' | 'tempOnly' }
export type FakeNightbotFault = { readonly status: number } | { readonly kind: 'hang' }

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

const cookieOf = (req: IncomingMessage, name: string): string | null => {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

/** innertube 보내기 값 → 안에 든 ID 모양 글자들 (btoa(encodeURIComponent(base64(protobuf)))) */
export function idsInParams(params: string): string[] {
  try {
    const inner = decodeURIComponent(Buffer.from(params, 'base64').toString('latin1'))
    const bytes = Buffer.from(inner, 'base64').toString('latin1')
    return bytes.match(/[A-Za-z0-9_-]{11,}/g) ?? []
  } catch {
    return []
  }
}

const PAGE = (videoId: string, signedIn: boolean, seed: readonly { id: string; name: string; text: string }[]) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>live chat</title></head><body>
<yt-live-chat-app><yt-live-chat-renderer>
<yt-live-chat-item-list-renderer><div id="item-scroller"><div id="items"></div></div></yt-live-chat-item-list-renderer>
${
  signedIn
    ? '<yt-live-chat-message-input-renderer><div id="input" contenteditable="true"></div><button id="send-button">보내기</button></yt-live-chat-message-input-renderer>'
    : '<yt-live-chat-restricted-participation-renderer><a href="https://accounts.google.com/ServiceLogin?continue=x">로그인</a>하여 채팅하기</yt-live-chat-restricted-participation-renderer>'
}
</yt-live-chat-renderer></yt-live-chat-app>
<script>
const VIDEO = ${JSON.stringify(videoId)};
const items = document.getElementById('items');
function add(id, name, text) {
  const row = document.createElement('yt-live-chat-text-message-renderer');
  row.id = id;
  const author = document.createElement('span'); author.id = 'author-name'; author.textContent = name;
  const message = document.createElement('span'); message.id = 'message'; message.textContent = text;
  row.append(author, message);
  items.append(row);
  return row;
}
for (const m of ${JSON.stringify(seed)}) add(m.id, m.name, m.text);
const button = document.getElementById('send-button');
if (button) button.addEventListener('click', async () => {
  const input = document.getElementById('input');
  const text = input.textContent;
  if (text.trim() === '') return;
  input.textContent = '';
  const response = await fetch('/fake/live_chat/post', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: VIDEO, text }) });
  if (!response.ok) return;
  const body = await response.json();
  if (!body.show) return;
  // 실물처럼: 화면이 먼저 임시 id로 그리고, 잠시 뒤 유튜브 메시지 ID로 바꾼다 (tempOnly면 바꾸지 않는다)
  const row = add('COCp' + Math.random().toString(36).slice(2, 12), '감사 봇', text);
  if (!body.tempOnly) setTimeout(() => { row.id = body.id; }, 300);
});
</script></body></html>`

export class FakeChatSend {
  readonly #server: Server
  readonly #sockets = new Set<Socket>()
  #port = 0
  #seq = 0
  readonly posts: FakePost[] = []
  readonly #innertubeFaults: FakeInnertubeFault[] = []
  readonly #browserFaults: FakeBrowserFault[] = []
  readonly #nightbotFaults: FakeNightbotFault[] = []
  /** 영상마다 페이지를 열 때 이미 있던 메시지 */
  readonly #seed = new Map<string, { id: string; name: string; text: string }[]>()
  #lastNightbotAt = -Infinity
  /** Nightbot 최소 간격 (실제 시계, 기본 5초) */
  nightbotGapMs = 5000
  /** 받은 글마다 (시험이 가짜 유튜브 웹 채팅에 붙인다) */
  onPost: ((post: FakePost) => void) | null = null
  /** 요청 수 */
  readonly calls = { innertube: 0, browserPage: 0, browserPost: 0, nightbot: 0, accountCheck: 0 }
  /** 로그인이 풀린 계정(쿠키 SID 값) — 계정 목록이 비고, 보내기는 401 (D-YT-SEND-22) */
  readonly loggedOut = new Set<string>()
  /** innertube로 지운 글 (메시지 ID·지운 계정) */
  readonly removed: { readonly id: string; readonly account: string | null }[] = []
  /** innertube 메뉴·지우기 요청 수 */
  readonly removeCalls = { menu: 0, moderate: 0 }
  readonly #removeFaults: { readonly status: number }[] = []

  private constructor() {
    this.#server = createServer((req, res) => {
      void this.#handle(req, res).catch(() => {
        if (!res.headersSent) json(res, 500, { error: 'fake' })
        else res.destroy()
      })
    })
    this.#server.on('connection', (socket) => {
      this.#sockets.add(socket)
      socket.on('close', () => this.#sockets.delete(socket))
    })
  }

  static async start(): Promise<FakeChatSend> {
    const fake = new FakeChatSend()
    await new Promise<void>((resolve) => fake.#server.listen(0, FAKE_SEND_HOST, resolve))
    const address = fake.#server.address()
    fake.#port = typeof address === 'object' && address !== null ? address.port : 0
    return fake
  }

  get url(): string {
    return `http://${FAKE_SEND_HOST}:${String(this.#port)}`
  }

  /** 실제 유튜브 주소로 가는 요청을 이 서버로 돌리는 fetch (innertube 길 시험) */
  get youtubeFetch(): typeof fetch {
    return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      if (url.hostname !== 'www.youtube.com') return Promise.reject(new Error('가짜 감사 받는 곳: 유튜브가 아닌 주소'))
      const target = `${this.url}${url.pathname}${url.search}`
      return fetch(target, { method: request.method, headers: init?.headers ?? request.headers, ...(init?.body === undefined ? {} : { body: init.body }), ...(init?.signal ? { signal: init.signal } : {}) })
    }) as typeof fetch
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy()
    await new Promise<void>((resolve) => this.#server.close(() => resolve()))
  }

  failInnertube(fault: FakeInnertubeFault, times = 1): void {
    for (let i = 0; i < times; i++) this.#innertubeFaults.push(fault)
  }

  /** 그 계정(쿠키 SID 값)의 innertube 요청만 계속 실패 (null이면 풂) */
  readonly innertubeAccountFaults = new Map<string, FakeInnertubeFault>()

  /** innertube 메뉴(get_item_context_menu) 요청이 이 HTTP 상태로 실패 */
  failInnertubeRemove(fault: { readonly status: number }, times = 1): void {
    for (let i = 0; i < times; i++) this.#removeFaults.push(fault)
  }

  failBrowser(fault: FakeBrowserFault, times = 1): void {
    for (let i = 0; i < times; i++) this.#browserFaults.push(fault)
  }

  failNightbot(fault: FakeNightbotFault, times = 1): void {
    for (let i = 0; i < times; i++) this.#nightbotFaults.push(fault)
  }

  /** 채팅 페이지를 열 때 이미 있는 메시지 */
  seed(videoId: string, message: { id: string; name: string; text: string }): void {
    this.#seed.set(videoId, [...(this.#seed.get(videoId) ?? []), message])
  }

  #record(post: Omit<FakePost, 'id' | 'at'>, prefix: string): FakePost {
    this.#seq += 1
    const full: FakePost = { ...post, id: `${prefix}${String(this.#seq).padStart(22, '0')}`, at: Date.now() }
    this.posts.push(full)
    this.onPost?.(full)
    return full
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url)
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    if (req.method === 'POST' && url.pathname === '/youtubei/v1/live_chat/send_message') return this.#innertube(req, res, raw)
    if (req.method === 'POST' && url.pathname === '/youtubei/v1/account/accounts_list') return this.#accountsList(req, res)
    if (req.method === 'POST' && url.pathname === '/youtubei/v1/live_chat/get_item_context_menu') return this.#itemMenu(req, res, raw)
    if (req.method === 'POST' && url.pathname === '/youtubei/v1/live_chat/moderate') return this.#moderate(req, res, raw)
    if (req.method === 'GET' && url.pathname === '/live_chat') return this.#browserPage(req, res, url)
    if (url.pathname.startsWith('/sorry')) {
      res.writeHead(429, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><body>Our systems have detected unusual traffic from your computer network.</body></html>')
      return
    }
    if (req.method === 'POST' && url.pathname === '/fake/live_chat/post') return this.#browserPost(req, res, raw)
    if (req.method === 'POST' && url.pathname === '/1/channel/send') return this.#nightbot(req, res, raw)
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204)
      res.end()
      return
    }
    json(res, 404, { error: 'not found' })
  }

  /**
   * 계정 목록 (채널 전환기, 읽기만 — D-YT-SEND-22 로그인 확인). 실물 모양(2026-11-08): 로그인돼 있으면 채널 만들기 단추 + 고른 계정 하나,
   * 쿠키가 풀렸으면 200에 계정 없이 단추만. 서버 막힘(blocked) 오류를 넣었으면 /sorry로
   */
  #accountsList(req: IncomingMessage, res: ServerResponse): void {
    this.calls.accountCheck += 1
    const sid = cookieOf(req, 'SID') ?? ''
    const fault = this.innertubeAccountFaults.get(sid)
    if (fault !== undefined && 'kind' in fault && fault.kind === 'blocked') {
      res.writeHead(302, { location: '/sorry/index?continue=https://www.youtube.com/' })
      res.end()
      return
    }
    const button = { buttonRenderer: { style: 'STYLE_DEFAULT', isDisabled: false, text: { runs: [{ text: '채널 만들기' }] }, icon: { iconType: 'ADD' } } }
    const signedIn = (req.headers.cookie ?? '').includes('SAPISID=') && !this.loggedOut.has(sid)
    const account = {
      accountItemRenderer: {
        accountName: { simpleText: '감사 봇' },
        accountPhoto: { thumbnails: [] },
        isSelected: true,
        isDisabled: false,
        hasChannel: true,
        serviceEndpoint: { selectActiveIdentityEndpoint: { supportedTokens: [{ accountStateToken: { hasChannel: true, isMerged: false, obfuscatedGaiaId: 'x' } }] } },
        accountByline: { simpleText: '@bot' },
        channelHandle: { simpleText: '@bot' },
      },
    }
    json(res, 200, {
      responseContext: {},
      actions: [{ updateChannelSwitcherPageAction: { page: { channelSwitcherPageRenderer: { contents: signedIn ? [button, account] : [button], targetId: 'x' } } } }],
    })
  }

  #innertube(req: IncomingMessage, res: ServerResponse, raw: string): void {
    this.calls.innertube += 1
    const cookie = req.headers.cookie ?? ''
    const auth = req.headers.authorization ?? ''
    if (!cookie.includes('SAPISID=') || !auth.startsWith('SAPISIDHASH ')) {
      json(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } })
      return
    }
    if (this.loggedOut.has(cookieOf(req, 'SID') ?? '')) {
      json(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } })
      return
    }
    const fault = this.innertubeAccountFaults.get(cookieOf(req, 'SID') ?? '') ?? this.#innertubeFaults.shift()
    if (fault !== undefined && 'status' in fault) {
      json(res, fault.status, { error: { code: fault.status, status: 'FAILED' } })
      return
    }
    if (fault?.kind === 'hang') return
    if (fault?.kind === 'blocked') {
      res.writeHead(302, { location: '/sorry/index?continue=https://www.youtube.com/' })
      res.end()
      return
    }
    if (fault?.kind === 'noActions') {
      json(res, 200, { responseContext: {} })
      return
    }
    if (fault?.kind === 'attestation') {
      json(res, 200, { responseContext: {}, actions: [{ runAttestationCommand: { ids: [{ encryptedVideoId: 'x' }], engagementType: 'ENGAGEMENT_TYPE_LIVE_CHAT' } }] })
      return
    }
    const body = JSON.parse(raw) as { params?: string; richMessage?: { textSegments?: { text?: string }[] }; context?: unknown }
    const text = (body.richMessage?.textSegments ?? []).map((segment) => segment.text ?? '').join('')
    const ids = idsInParams(body.params ?? '')
    const channelId = ids.find((id) => id.startsWith('UC')) ?? null
    const videoId = ids.find((id) => !id.startsWith('UC')) ?? null
    const post = this.#record({ route: 'innertube', text, videoId, channelId, chatId: null, account: cookieOf(req, 'SID') }, 'ChIT')
    json(res, 200, {
      responseContext: {},
      actions: [
        {
          clickTrackingParams: 'x',
          addChatItemAction: {
            item: {
              liveChatTextMessageRenderer: {
                id: post.id,
                message: { runs: [{ text }] },
                authorName: { simpleText: '감사 봇' },
                authorExternalChannelId: 'UCfakebot0000000000000000',
                timestampUsec: `${String(post.at)}000`,
                contextMenuEndpoint: { commandMetadata: { webCommandMetadata: { ignoreNavigation: true } }, liveChatItemContextMenuEndpoint: { params: fakeParams('menu', post.id) } },
              },
            },
            clientId: 'x',
          },
        },
      ],
    })
  }

  /** 로그인한 innertube 요청인가 (아니면 401을 보냈다) */
  #signedIn(req: IncomingMessage, res: ServerResponse): boolean {
    const cookie = req.headers.cookie ?? ''
    const auth = req.headers.authorization ?? ''
    if (!cookie.includes('SAPISID=') || !auth.startsWith('SAPISIDHASH ') || this.loggedOut.has(cookieOf(req, 'SID') ?? '')) {
      json(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } })
      return false
    }
    return true
  }

  /** 글 메뉴: 그 글을 올린 계정이고 아직 있으면 "삭제" 단추, 아니면 신고 단추만 */
  #itemMenu(req: IncomingMessage, res: ServerResponse, raw: string): void {
    this.removeCalls.menu += 1
    if (!this.#signedIn(req, res)) return
    const fault = this.#removeFaults.shift()
    if (fault !== undefined) {
      json(res, fault.status, { error: { code: fault.status, status: 'FAILED' } })
      return
    }
    const id = paramsId('menu', (JSON.parse(raw) as { params?: string }).params ?? '')
    const post = this.posts.find((item) => item.id === id && item.route === 'innertube')
    const mine = post !== undefined && post.account === cookieOf(req, 'SID') && !this.removed.some((item) => item.id === id)
    const flag = { menuServiceItemRenderer: { text: { runs: [{ text: '신고' }] }, icon: { iconType: 'FLAG' }, serviceEndpoint: { commandMetadata: { webCommandMetadata: { ignoreNavigation: true } }, getReportFormEndpoint: { params: 'x' } } } }
    const remove = {
      menuServiceItemRenderer: {
        text: { runs: [{ text: '삭제' }] },
        icon: { iconType: 'DELETE' },
        serviceEndpoint: { commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/live_chat/moderate' } }, moderateLiveChatEndpoint: { params: fakeParams('del', id ?? '') } },
      },
    }
    json(res, 200, { responseContext: {}, liveChatItemContextMenuSupportedRenderers: { menuRenderer: { items: mine ? [flag, remove] : [flag] } } })
  }

  #moderate(req: IncomingMessage, res: ServerResponse, raw: string): void {
    this.removeCalls.moderate += 1
    if (!this.#signedIn(req, res)) return
    const id = paramsId('del', (JSON.parse(raw) as { params?: string }).params ?? '')
    const post = this.posts.find((item) => item.id === id)
    if (id === null || post === undefined || post.account !== cookieOf(req, 'SID')) {
      json(res, 400, { error: { code: 400, status: 'INVALID_ARGUMENT' } })
      return
    }
    if (!this.removed.some((item) => item.id === id)) this.removed.push({ id, account: cookieOf(req, 'SID') })
    json(res, 200, { responseContext: {}, actions: [{ removeChatItemAction: { targetItemId: id } }] })
  }

  #browserPage(req: IncomingMessage, res: ServerResponse, url: URL): void {
    this.calls.browserPage += 1
    const videoId = url.searchParams.get('v') ?? ''
    const signedIn = cookieOf(req, 'SID') === FAKE_BROWSER_SID
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(PAGE(videoId, signedIn, this.#seed.get(videoId) ?? []))
  }

  #browserPost(req: IncomingMessage, res: ServerResponse, raw: string): void {
    this.calls.browserPost += 1
    if (cookieOf(req, 'SID') !== FAKE_BROWSER_SID) {
      json(res, 401, { error: 'signed out' })
      return
    }
    const fault = this.#browserFaults.shift()
    if (fault?.kind === 'reject') {
      json(res, 400, { error: 'rejected' })
      return
    }
    const body = JSON.parse(raw) as { v?: string; text?: string }
    const post = this.#record({ route: 'browser', text: body.text ?? '', videoId: body.v ?? null, channelId: null, chatId: null }, 'ChBR')
    json(res, 200, { id: post.id, show: fault?.kind !== 'drop', tempOnly: fault?.kind === 'tempOnly' })
  }

  #nightbot(req: IncomingMessage, res: ServerResponse, raw: string): void {
    this.calls.nightbot += 1
    if (req.headers.authorization !== `Bearer ${FAKE_NIGHTBOT_TOKEN}`) {
      json(res, 401, { status: 401, message: 'Authorization required' })
      return
    }
    const fault = this.#nightbotFaults.shift()
    if (fault !== undefined && 'status' in fault) {
      json(res, fault.status, { status: fault.status, message: 'fake' })
      return
    }
    if (fault?.kind === 'hang') return
    const now = Date.now()
    if (now - this.#lastNightbotAt < this.nightbotGapMs) {
      json(res, 429, { status: 429, message: 'Too many requests' })
      return
    }
    this.#lastNightbotAt = now
    const body = JSON.parse(raw) as { message?: string; chatId?: string }
    this.#record({ route: 'nightbot', text: body.message ?? '', videoId: null, channelId: null, chatId: body.chatId ?? null }, 'NB')
    json(res, 200, { status: 200 })
  }
}

/** 가짜 메뉴·지우기 값 (실물은 protobuf — 가짜는 꼴만 흉내 낸 글자) */
function fakeParams(kind: 'menu' | 'del', id: string): string {
  return Buffer.from(`${kind}:${id}`, 'utf8').toString('base64url')
}

function paramsId(kind: 'menu' | 'del', params: string): string | null {
  const text = Buffer.from(params, 'base64url').toString('utf8')
  return text.startsWith(`${kind}:`) ? text.slice(kind.length + 1) : null
}
