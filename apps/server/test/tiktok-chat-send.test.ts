// 틱톡 감사 채팅 (D-TT-SEND-01~08). 실제 틱톡에는 아무것도 쓰지 않는다:
// - 실행기: 가짜 보내는 곳(FakeTikTokSender)으로 확정 → 발송함(via TIKTOK) → 올림 → 게시 보고, 실패·확인 못 함·고르지 않은 판매자.
// - 봇 감사 글이 틱톡 채팅에 다시 뜨면 찜으로 읽지 않는다(직접 연결).
// - 브라우저 길: 127.0.0.1의 가짜 틱톡 라이브 화면(실물에서 확인한 data-e2e 이름)에 Playwright로 넣고 확인. 허락한 호스트 밖으로 가는 요청은 막는다.
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listEffects } from '@livejjim/core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readTiktokChatSend } from '../src/config.ts'
import { BrowserTikTokSender, type TikTokChatSender } from '../src/tiktok-live/thanks/browser-sender.ts'
import { OwnThanks } from '../src/tiktok-live/thanks/own.ts'
import { ChatSendError } from '../src/youtube/chat-send/sender.ts'
import { TIKTOK_REASON_MESSAGES, outboxRowView } from '../src/youtube/outbox.ts'
import { findRow, type RunnerRow } from '../src/youtube/outbox-store.ts'
import { realTimer } from '../src/youtube/timer.ts'
import { client, rid } from './support.ts'
import { chats, connected, DATE, linkTiktok, realBroadcast, tiktokComment, tiktokSeller, ttWorld, type TtWorld } from './tiktok-live-support.ts'

class FakeTikTokSender implements TikTokChatSender {
  readonly sent: { tiktokId: string; text: string }[] = []
  /** 다음 보내기들의 실패 (앞에서부터) */
  readonly failures: ChatSendError['kind'][] = []
  onSend: ((tiktokId: string, text: string) => Promise<void>) | null = null
  async send(tiktokId: string, text: string): Promise<void> {
    const failure = this.failures.shift()
    if (failure !== undefined) {
      if (failure === 'unverified') this.sent.push({ tiktokId, text })
      throw new ChatSendError(failure)
    }
    this.sent.push({ tiktokId, text })
    await this.onSend?.(tiktokId, text)
  }
  async loggedIn(): Promise<boolean> {
    return true
  }
  async close(): Promise<void> {}
}

const worlds: TtWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})

async function setup(options: { sellers?: 'mine' | 'other' } = {}) {
  const sender = new FakeTikTokSender()
  // 한 세계에 판매자 하나 — '*'는 그 판매자, 'other'는 다른 판매자만 고름
  const w = await ttWorld({
    overrides: {
      tiktokThanks: {
        sender,
        sellers: options.sellers === 'other' ? ['someone_else'] : '*',
        autoRun: false,
      },
    },
  })
  worlds.push(w)
  const { seller, tiktokId } = await tiktokSeller(w, {
    tiktokId: 'seller_kim',
  })
  const b = await realBroadcast(w, seller)
  const linked = await linkTiktok(w, seller, b)
  expect(linked.status, linked.text).toBe(200)
  await connected(w, seller, b)
  for (const no of [15, 16]) {
    const registered = await client(w, seller.cookie).post('/api/events', {
      requestId: rid('reg'),
      type: 'product.register',
      b,
      no,
      name: `상품${String(no)}`,
      price: 10_000,
    })
    expect(registered.status, registered.text).toBe(200)
  }
  return { w, sender, seller, tiktokId, b }
}

const thanksRows = async (w: TtWorld, sellerId: string) =>
  (
    await w.database.pglite?.query<{
      id: number
      product: string
      state: string | null
      reason: string | null
      via: string | null
      attempts: number
      post_text: string | null
    }>(`select id, body::jsonb->>'product' as product, state, reason, via, attempts, post_text from outbox where seller_id = $1 and kind = 'POST_THANKS' order by id`, [sellerId])
  )?.rows ?? []

describe('D-TT-SEND 틱톡 감사 실행기 (가짜 보내는 곳)', () => {
  it('고른 판매자: 틱톡 구매자 찜 확정 → via TIKTOK 기다림 → 봇이 그 틱톡 아이디 방송에 감사 한 줄 → 게시됨·게시 보고', async () => {
    const { w, sender, seller, tiktokId } = await setup()
    await tiktokComment(w, tiktokId, {
      userId: '7101000000000000001',
      uniqueId: 'buyer_a',
      nickname: '에이',
      comment: '15',
    })
    const before = await thanksRows(w, seller.sellerId)
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({
      state: 'WAITING',
      reason: 'TIKTOK',
      via: 'TIKTOK',
    })
    // 유튜브 실행기는 이 행을 집지 않는다 (유튜브가 없는 회차라도 "이어진 유튜브 방송이 없어요"로 실패하지 않는다)
    await w.server.tiktokThanks?.tick()
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0]?.tiktokId).toBe(tiktokId)
    expect(sender.sent[0]?.text).toMatch(/^15번 .*에이님 구매 감사합니다$/)
    const after = await thanksRows(w, seller.sellerId)
    expect(after[0]).toMatchObject({ state: 'SENT', reason: null })
    const effects = listEffects((await w.server.writer.read(seller.sellerId, DATE)).state).filter((effect) => effect.kind === 'POST_THANKS')
    expect(effects[0]?.status).toBe('DONE')
    // 다음 바퀴에 다시 올리지 않는다
    await w.server.tiktokThanks?.tick()
    expect(sender.sent).toHaveLength(1)
  })

  it('봇 감사 글이 틱톡 채팅에 다시 뜨면 찜으로 읽지 않는다 (같은 글 거르개) — 시청자 댓글은 그대로 기록', async () => {
    const { w, sender, seller, tiktokId } = await setup()
    // 실제처럼: 봇이 올리자마자 그 글이 방송 채팅 댓글로 들어온다(봇 숫자 ID는 모름)
    sender.onSend = async (id, text) => {
      await tiktokComment(w, id, {
        userId: '7999000000000000009',
        uniqueId: 'livegenie_bot',
        nickname: '라이브지니',
        comment: text,
      })
    }
    await tiktokComment(w, tiktokId, {
      userId: '7101000000000000001',
      uniqueId: 'buyer_a',
      nickname: '에이',
      comment: '15',
    })
    await w.server.tiktokThanks?.tick()
    expect(sender.sent).toHaveLength(1)
    const recorded = await chats(w, seller.sellerId)
    expect(recorded.map((chat) => chat.ch)).toEqual(['tt:7101000000000000001'])
    // 16번 찜이 엉뚱하게 생기지 않았고, 감사 행도 하나뿐
    expect(await thanksRows(w, seller.sellerId)).toHaveLength(1)
  })

  it('올라가지 않은 실패(로그인 풀림)는 2초 뒤 다시, 누른 뒤 확인 못 함은 확인 필요(UNCONFIRMED)로 끝내고 다시 올리지 않는다', async () => {
    const { w, sender, seller, tiktokId } = await setup()
    sender.failures.push('auth', 'unverified')
    await tiktokComment(w, tiktokId, {
      userId: '7101000000000000001',
      uniqueId: 'buyer_a',
      nickname: '에이',
      comment: '15',
    })
    await w.server.tiktokThanks?.tick()
    expect((await thanksRows(w, seller.sellerId))[0]).toMatchObject({
      state: 'WAITING',
      reason: 'RETRY',
      attempts: 1,
    })
    // 때가 안 됐으면 보내지 않는다
    await w.server.tiktokThanks?.tick()
    expect(sender.sent).toHaveLength(0)
    await w.tclock.advance(2000)
    await w.server.tiktokThanks?.tick()
    expect(sender.sent).toHaveLength(1)
    const failed = (await thanksRows(w, seller.sellerId))[0]
    expect(failed).toMatchObject({ state: 'FAILED', reason: 'UNCONFIRMED' })
    await w.tclock.advance(60_000)
    await w.server.tiktokThanks?.tick()
    expect(sender.sent).toHaveLength(1)
    // 화면 문장은 틱톡 낱말로, 확장 표시는 없다 (발송함 보기 — 같은 행을 유튜브 콘솔 목록이 보인다)
    const row = (await findRow(w.database.db, seller.sellerId, failed?.id ?? 0)) as RunnerRow
    const view = outboxRowView(row)
    expect(view.reasonMessage).toBe(TIKTOK_REASON_MESSAGES.UNCONFIRMED)
    expect(view.viaExtension).toBe(false)
  })

  it('고르지 않은 판매자: 지금처럼 건너뜀(NOT_SUPPORTED) — 보내지 않는다', async () => {
    const { w, sender, seller, tiktokId } = await setup({ sellers: 'other' })
    await tiktokComment(w, tiktokId, {
      userId: '7101000000000000001',
      uniqueId: 'buyer_a',
      nickname: '에이',
      comment: '15',
    })
    await w.server.tiktokThanks?.tick()
    expect(sender.sent).toHaveLength(0)
    expect((await thanksRows(w, seller.sellerId))[0]).toMatchObject({
      state: 'SKIPPED',
      reason: 'NOT_SUPPORTED',
      via: null,
    })
  })

  it('10분 기한이 지나면 보내지 않음(EXPIRED)', async () => {
    const { w, sender, seller, tiktokId } = await setup()
    await tiktokComment(w, tiktokId, {
      userId: '7101000000000000001',
      uniqueId: 'buyer_a',
      nickname: '에이',
      comment: '15',
    })
    await w.tclock.advance(10 * 60_000 + 1)
    await w.server.tiktokThanks?.tick()
    expect(sender.sent).toHaveLength(0)
    expect((await thanksRows(w, seller.sellerId))[0]).toMatchObject({
      state: 'FAILED',
      reason: 'EXPIRED',
    })
  })
})

describe('OwnThanks·설정', () => {
  it('봇 숫자 ID거나 15분 안에 보낸 같은 글(빈칸 차이 무시)이면 우리 글', () => {
    let now = 0
    const own = new OwnThanks(() => now, ['7999'])
    expect(own.isOwn('s1', { userId: '7999', text: '아무 글' })).toBe(true)
    own.remember('s1', '15번 상품 10,000원 에이님 구매 감사합니다')
    expect(
      own.isOwn('s1', {
        userId: '1',
        text: ' 15번 상품  10,000원 에이님 구매 감사합니다',
      }),
    ).toBe(true)
    expect(
      own.isOwn('s2', {
        userId: '1',
        text: '15번 상품 10,000원 에이님 구매 감사합니다',
      }),
    ).toBe(false)
    now = 15 * 60_000 + 1
    expect(
      own.isOwn('s1', {
        userId: '1',
        text: '15번 상품 10,000원 에이님 구매 감사합니다',
      }),
    ).toBe(false)
  })

  it('LIVEJJIM_TT_SEND_*: 비면 꺼짐, 켜면 로그인 파일 필수, 봇 ID는 숫자만', () => {
    expect(readTiktokChatSend({})).toEqual({ ok: true, send: null })
    expect(readTiktokChatSend({ LIVEJJIM_TT_SEND_SELLERS: '*' }).ok).toBe(false)
    expect(
      readTiktokChatSend({
        LIVEJJIM_TT_SEND_SELLERS: 'a, b',
        LIVEJJIM_TT_SEND_STATE_FILE: '/x',
        LIVEJJIM_TT_SEND_BOT_USER_IDS: '12,x',
      }).ok,
    ).toBe(false)
    expect(
      readTiktokChatSend({
        LIVEJJIM_TT_SEND_SELLERS: 'a, b',
        LIVEJJIM_TT_SEND_STATE_FILE: '/x',
        LIVEJJIM_TT_SEND_BOT_USER_IDS: '12',
      }),
    ).toEqual({
      ok: true,
      send: {
        sellers: ['a', 'b'],
        stateFile: '/x',
        botUserIds: ['12'],
        chromiumPath: null,
        headless: false,
      },
    })
  })
})

// ── 브라우저 길: 가짜 틱톡 라이브 화면 ───────────────────────────────────

type Mode = 'ok' | 'drop' | 'ended'
let mode: Mode = 'ok'
let posts: string[] = []
const PAGE = (live: boolean) => `<!doctype html><html><body>
<div data-e2e="live-chat-container">
  <div data-e2e="chat-message"><div data-e2e="message-owner-name">시청자</div><div>앞 손님 글</div></div>
</div>
${live ? '<div data-e2e="live-chat-input-container"><div data-e2e="room-chat-input-field" contenteditable="plaintext-only"></div><div data-e2e="room-chat-send-btn">보내기</div></div>' : '<div>라이브가 끝났어요</div>'}
<script>
const input = document.querySelector('[data-e2e="room-chat-input-field"]')
document.querySelector('[data-e2e="room-chat-send-btn"]')?.addEventListener('click', async () => {
  const text = input.textContent
  input.textContent = ''
  const response = await fetch('/post', { method: 'POST', body: text })
  if ((await response.text()) !== 'show') return
  const item = document.createElement('div')
  item.setAttribute('data-e2e', 'chat-message')
  item.innerHTML = '<div data-e2e="message-owner-name">라이브지니</div><div></div>'
  item.lastChild.textContent = text
  setTimeout(() => document.querySelector('[data-e2e="live-chat-container"]').appendChild(item), 200)
})
</script></body></html>`

let server: Server
let base = ''
let statePath = ''
let emptyStatePath = ''
const senders: BrowserTikTokSender[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/post') {
      let body = ''
      req.on('data', (chunk: Buffer) => (body += chunk.toString()))
      req.on('end', () => {
        posts.push(body)
        res.end(mode === 'drop' ? 'hide' : 'show')
      })
      return
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(PAGE(mode !== 'ended'))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`
  const dir = await mkdtemp(join(tmpdir(), 'tt-send-'))
  statePath = join(dir, 'state.json')
  emptyStatePath = join(dir, 'empty.json')
  await writeFile(
    statePath,
    JSON.stringify({
      cookies: [
        {
          name: 'sessionid',
          value: 'fake',
          domain: '127.0.0.1',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
  )
  await writeFile(emptyStatePath, JSON.stringify({ cookies: [], origins: [] }))
})

afterAll(async () => {
  for (const sender of senders) await sender.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function browser(state = statePath, extra: Partial<ConstructorParameters<typeof BrowserTikTokSender>[0]> = {}) {
  const sender = new BrowserTikTokSender({
    storageStatePath: state,
    timer: realTimer(),
    headless: true,
    baseUrl: base,
    allowedHosts: ['127.0.0.1'],
    gapMs: 0,
    timeoutMs: 5000,
    confirmMs: 2000,
    ...extra,
  })
  senders.push(sender)
  return sender
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof ChatSendError ? error.kind : String(error)),
  )

describe('D-TT-SEND-04 브라우저 길 (127.0.0.1 가짜 틱톡 라이브 화면)', () => {
  afterEach(() => {
    mode = 'ok'
    posts = []
  })

  it('입력 칸에 넣고 보내기 → 새로 뜬 같은 글을 보고 게시됨, 로그인 상태 파일을 다시 적는다', async () => {
    const sender = browser()
    await sender.send('seller_kim', '15번 상품 10,000원 에이님 구매 감사합니다')
    expect(posts).toEqual(['15번 상품 10,000원 에이님 구매 감사합니다'])
    expect(JSON.parse(await readFile(statePath, 'utf8')).cookies.some((cookie: { name: string }) => cookie.name === 'sessionid')).toBe(true)
  })

  it('보냈는데 채팅에 안 뜨면 unverified — 다시 넣지 않는다(보내기 1번)', async () => {
    mode = 'drop'
    expect(await failure(browser().send('seller_kim', '16번 감사합니다'))).toBe('unverified')
    expect(posts).toHaveLength(1)
  })

  it('로그인 쿠키가 없으면 화면을 열지도 않고 auth, 방송이 끝나 입력 칸이 없으면 rejected — 둘 다 올리지 않음', async () => {
    expect(await failure(browser(emptyStatePath).send('seller_kim', '가'))).toBe('auth')
    mode = 'ended'
    expect(await failure(browser().send('seller_kim', '나'))).toBe('rejected')
    expect(posts).toHaveLength(0)
  })

  it('실제 틱톡 주소: 그 로그인 쿠키가 없으면 나가기 전에 auth — 아무것도 올리지 않음', async () => {
    const real = browser(statePath, { baseUrl: 'https://www.tiktok.com' })
    // 쿠키는 127.0.0.1 것뿐이라 tiktok.com 로그인 없음 → auth (나가기 전에 멈춘다)
    expect(await failure(real.send('seller_kim', '다'))).toBe('auth')
  })
})
