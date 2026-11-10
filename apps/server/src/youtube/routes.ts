// 유튜브 API 경로 (AC-Y1-01~62). 계약은 harness/sprints/Y1/dev-notes.md "화면(I3)에게"에 적었다.
// - 모두 세션이 필요하다. 돌아오는 주소(GET /api/youtube/oauth/callback)는 세션 쿠키와 state로 판매자를 정하고 화면 주소로 돌려보낸다(결과는 ?youtube=코드로만).
// - 상태를 바꾸는 요청은 Origin 검사·JSON 본문만(D-074, api.ts가 먼저 거른다), 모르는 필드는 거절, 모든 응답은 Cache-Control: no-store.
// - 다른 판매자의 회차·발송함 행·알림·연결·할당량은 404이거나 보이지 않는다.
import { isValidDate } from '@livejjim/core'
import type { Context, Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { REQUEST_ID_RE, own, ownKeys } from '../api-fields.ts'
import { SESSION_COOKIE, type Auth, type SessionContext } from '../auth.ts'
import { apiError, type ErrorCode } from '../errors.ts'
import { unknownFieldProblems } from '../messages.ts'
import type { Service } from '../service.ts'
import { BOT_CALLBACK_MESSAGES, CALLBACK_MESSAGES, NOT_CONNECTED_MESSAGE, type CallbackResult } from './connect.ts'
import { SELLER_OUTBOX_MESSAGES } from './outbox.ts'
import type { Sealer } from './seal.ts'
import { FIRST_CHANNEL_CONFIRM_MESSAGE, LINK_MESSAGES, type LinkOutcome, type YoutubeSystem } from './system.ts'
import { parseVideoId } from './texts.ts'
import { SERVICE_NAME } from '../brand.ts'

export const CALLBACK_PATH = '/api/youtube/oauth/callback'

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

export interface YoutubeRouteDeps {
  readonly service: Service
  readonly auth: Auth
  readonly youtube: YoutubeSystem | null
  readonly sealer: Sealer | null
}

const NOT_CONFIGURED_MESSAGE = '유튜브 연동을 준비하지 않은 서버예요.'
const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
const notConfigured = () => apiError(503, 'YOUTUBE_NOT_CONFIGURED', NOT_CONFIGURED_MESSAGE)
const invalidRequestId = () =>
  apiError(400, 'INVALID_REQUEST_ID', '요청 번호가 없거나 형식이 올바르지 않아요.', [{ field: 'requestId', message: "요청 번호는 영문·숫자·'_'·'-'로 된 1~64자여야 해요." }])
const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): Response | null => {
  const extra = ownKeys(value).filter((key) => !allowed.includes(key))
  return extra.length === 0 ? null : apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
}
const requestIdOf = (value: Record<string, unknown>): string | null => {
  const id = own(value, 'requestId')
  return typeof id === 'string' && REQUEST_ID_RE.test(id) ? id : null
}

function linkResponse(c: Context, outcome: LinkOutcome): Response {
  if (outcome.kind === 'not_found') return notFound()
  if (outcome.kind === 'rejected') return apiError(outcome.status, outcome.code as ErrorCode, LINK_MESSAGES[outcome.code])
  // 내 채널이 아닌 방송: 잇지 않았다 — 채널 이름(바깥 글)을 함께 돌려주고 화면이 확인 줄을 띄운다 (D-PHN-17·D-INV1-04)
  // 서버 잇기(YT-11)는 처음 잇는 채널일 때 같은 코드·같은 확인 방식으로 문장만 다르다 (D-YT-SRV-03)
  if (outcome.kind === 'confirm') return apiError(409, 'INVITED_CONFIRM_NEEDED', outcome.firstChannel === true ? FIRST_CHANNEL_CONFIRM_MESSAGE : LINK_MESSAGES.INVITED_CONFIRM_NEEDED, [], { channel: outcome.channel })
  return c.json(outcome.view)
}

/** 돌아오기 뒤 보낼 화면 주소 (결과는 코드로만 — 토큰·code는 주소에 넣지 않는다) */
function returnTo(base: string, result: CallbackResult): string {
  const url = new URL(base)
  url.searchParams.set('youtube', result)
  return url.toString()
}

export function registerYoutubeRoutes(api: Hono<Env>, deps: YoutubeRouteDeps): void {
  const { service, auth, youtube } = deps
  const body = (c: Context<Env>) => c.get('body') ?? {}
  const session = (c: Context<Env>) => c.get('session')
  const sellerOf = (c: Context<Env>) => c.get('session').sellerId
  const info = (c: Context<Env>) => ({ sellerId: session(c).sellerId, accountId: session(c).accountId, tokenHash: session(c).tokenHash })

  // ── 구글 연결 (AC-Y1-01~06·31) ────────────────────────────────────────
  api.get('/youtube/connection', async (c) => {
    if (youtube === null) return notConfigured()
    // webChat: 서버가 방송 주소만으로 채팅을 읽는가(YT-11 — 구글 연결 없이 잇기 칸을 연다, 옛 공식 읽기면 null), oauth: 구글 연결(감사 게시용)을 쓸 수 있는가,
    // botThanks: 이 판매자의 실시간 채팅 감사를 라이브지니 봇이 대신 올리는가 (D-YT-SEND-18 — 화면이 구글 연결·게시 동의 대신 감사 스위치 하나만 보인다)
    const seller = sellerOf(c)
    return c.json({ connection: await youtube.status(seller), webChat: youtube.webChatView(), oauth: youtube.oauthReady, botThanks: (youtube.chatSend?.senderFor(seller) ?? null) !== null })
  })
  api.post('/youtube/connection/start', async (c) => {
    if (youtube === null || !youtube.oauthReady) return notConfigured()
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    return c.json({ authorizeUrl: await youtube.connections.start(info(c), 'connect') })
  })
  // 돌아오는 주소: 공개 경로(api.ts가 세션을 강제하지 않는다) — 세션 쿠키와 state로 판매자를 정한다
  api.get('/youtube/oauth/callback', async (c) => {
    const current = await auth.session(getCookie(c, SESSION_COOKIE))
    if (youtube === null || !youtube.oauthReady) return notConfigured()
    const code = c.req.query('code')
    const state = c.req.query('state')
    const error = c.req.query('error')
    // 감사 채팅 봇 연결 (D-YT-SEND-21): 운영자 명령이 만든 state면 세션과 상관없이 봇 연결로 받고, 판매자 화면으로 보내지 않고 문장만 보인다
    const bot = await youtube.connections.botCallback({
      ...(code === undefined ? {} : { code }),
      ...(state === undefined ? {} : { state }),
      ...(error === undefined ? {} : { error }),
    })
    if (bot !== null) {
      return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${SERVICE_NAME}</title><p style="font:16px/1.6 sans-serif;padding:24px">${BOT_CALLBACK_MESSAGES[bot]}</p>`, {
        status: bot === 'connected' ? 200 : 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    const result = await youtube.connections.callback(current === null ? null : { sellerId: current.sellerId, accountId: current.accountId, tokenHash: current.tokenHash }, {
      ...(code === undefined ? {} : { code }),
      ...(state === undefined ? {} : { state }),
      ...(error === undefined ? {} : { error }),
    })
    return new Response(null, { status: 302, headers: { Location: returnTo(youtube.config.returnUrl, result), 'Cache-Control': 'no-store' } })
  })
  api.post('/youtube/connection/disconnect', async (c) => {
    if (youtube === null) return notConfigured()
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    return c.json({ connection: await youtube.connections.disconnect(sellerOf(c)) })
  })
  api.put('/youtube/consent', async (c) => {
    if (youtube === null || !youtube.oauthReady) return notConfigured()
    const input = body(c)
    const extra = onlyKeys(input, ['target', 'enabled'])
    if (extra !== null) return extra
    const target = own(input, 'target')
    const enabled = own(input, 'enabled')
    if ((target !== 'LIVE_CHAT' && target !== 'VIDEO_COMMENT') || typeof enabled !== 'boolean') {
      return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'target', message: '대상(LIVE_CHAT·VIDEO_COMMENT)과 켜기(true·false)를 적어 주세요.' }])
    }
    const result = await youtube.connections.setConsent(info(c), target, enabled)
    if (result.kind === 'not_connected') return apiError(409, 'YOUTUBE_NOT_CONNECTED', NOT_CONNECTED_MESSAGE)
    if (result.kind === 'authorize') return c.json({ authorizeUrl: result.url })
    return c.json({ connection: result.view })
  })

  // ── 방송 잇기 (AC-Y1-10~13) ───────────────────────────────────────────
  api.get('/youtube/live-broadcasts', async (c) => {
    if (youtube === null) return notConfigured()
    const result = await youtube.liveBroadcasts(sellerOf(c))
    if (result.kind === 'rejected') return apiError(result.status, result.code as ErrorCode, LINK_MESSAGES[result.code])
    return c.json({ broadcasts: result.broadcasts })
  })
  // 채널 프로필 사진 주소 (홈 맨 위 라이브 표시, D-UX3-85) — 모르면 null
  api.get('/youtube/channels/:channel/avatar', async (c) => {
    if (youtube === null) return c.json({ avatar: null })
    sellerOf(c)
    return c.json({ avatar: await youtube.channelAvatar(c.req.param('channel')) })
  })
  // 주소·영상 ID 읽기 (유튜브를 부르지 않는다)
  api.post('/youtube/parse-video', (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['video'])
    if (extra !== null) return extra
    const video = own(input, 'video')
    const videoId = typeof video === 'string' && video.length <= 2048 ? parseVideoId(video) : null
    if (videoId === null) return apiError(400, 'INVALID_VIDEO_URL', LINK_MESSAGES.INVALID_VIDEO_URL, [{ field: 'video', message: LINK_MESSAGES.INVALID_VIDEO_URL }])
    return c.json({ videoId })
  })
  api.get('/broadcasts/:id/youtube', async (c) => {
    if (youtube === null) return notConfigured()
    const view = await youtube.linkView(sellerOf(c), c.req.param('id'))
    return view === null ? notFound() : c.json(view)
  })
  api.post('/broadcasts/:id/youtube', async (c) => {
    if (youtube === null) return notConfigured()
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'video', 'confirmInvited'])
    if (extra !== null) return extra
    // 초대 방송 확인 표시 (D-INV1-02): JSON 불리언만 — true만 확인, 없거나 false는 확인 아님, 다른 모양("true"·1·{})은 거절
    const confirm = own(input, 'confirmInvited')
    if (confirm !== undefined && typeof confirm !== 'boolean') {
      return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'confirmInvited', message: '초대받은 방송 확인 값이 올바르지 않아요.' }])
    }
    const raw = own(input, 'video')
    // 잇기는 회차부터 본다(다른 판매자의 회차가 있는지 알리지 않는다) — 주소가 글자가 아니면 빈 주소로 넘겨 그다음에 거른다
    const video = typeof raw === 'string' && raw.length <= 2048 ? raw : ''
    return linkResponse(c, await youtube.link(info(c), c.req.param('id'), video, requestId, confirm === true))
  })
  // 잇기 전 미리 보기 (D-UX4-08): { video } → { title, channelTitle }. 아무것도 넣지 않는다. 서버 읽기가 아니면 404 PREVIEW_UNAVAILABLE(화면은 옛 흐름)
  api.post('/youtube/preview', async (c) => {
    if (youtube === null) return notConfigured()
    const input = body(c)
    const extra = onlyKeys(input, ['video'])
    if (extra !== null) return extra
    const raw = own(input, 'video')
    const video = typeof raw === 'string' && raw.length <= 2048 ? raw : ''
    const outcome = await youtube.preview(sellerOf(c), video)
    if (outcome === null) return apiError(404, 'PREVIEW_UNAVAILABLE', '찾을 수 없어요.')
    if (outcome.kind === 'rejected') return apiError(outcome.status, outcome.code as ErrorCode, LINK_MESSAGES[outcome.code])
    return c.json({ title: outcome.title, channelTitle: outcome.channelTitle, channelId: outcome.channelId })
  })
  api.post('/broadcasts/:id/youtube/unlink', async (c) => {
    if (youtube === null) return notConfigured()
    const input = body(c)
    const extra = onlyKeys(input, ['requestId'])
    if (extra !== null) return extra
    return linkResponse(c, await youtube.unlink(info(c), c.req.param('id')))
  })
  api.post('/broadcasts/:id/youtube/collector/restart', async (c) => {
    if (youtube === null) return notConfigured()
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    return linkResponse(c, await youtube.restartCollector(sellerOf(c), c.req.param('id')))
  })

  // ── 발송함 (AC-Y1-38·39) ──────────────────────────────────────────────
  api.get('/days/:date/outbox', async (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) return notFound()
    const raw = c.req.query('rehearsal')
    if (raw !== undefined && raw !== 'true' && raw !== 'false') return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'rehearsal', message: '리허설 범위는 rehearsal=true로 적어 주세요.' }])
    // 리허설 감사는 게시하지 않으므로 보일 상태가 없다 (YT-09 AC3)
    if (raw === 'true' || youtube === null) return c.json({ date, rehearsal: raw === 'true', rows: [] })
    const scope = await scopeIdOf(service, sellerOf(c), date)
    if (scope === null) return c.json({ date, rehearsal: false, rows: [] })
    return c.json({ date, rehearsal: false, rows: await youtube.outbox.list(sellerOf(c), scope) })
  })
  api.post('/outbox/:id/resend', async (c) => {
    if (youtube === null) return notConfigured()
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId'])
    if (extra !== null) return extra
    const raw = c.req.param('id')
    if (!/^\d{1,15}$/.test(raw)) return notFound()
    const sealedRow = await youtube.outboxSealed(sellerOf(c), Number(raw))
    if (sealedRow === 'not_found') return notFound()
    if (sealedRow) return apiError(409, 'SEALED', LINK_MESSAGES.SEALED)
    const result = await youtube.outbox.resend(sellerOf(c), Number(raw), requestId)
    if (result.kind === 'not_found') return notFound()
    if (result.kind === 'rejected') {
      const extraBody: Record<string, unknown> = result.row === undefined ? {} : { row: result.row }
      // 게시 권한이 없으면 권한을 받으러 갈 승인 주소를 함께 (D-Y02 — 수동 재전송을 처음 할 때)
      if (result.code === 'NO_PERMISSION') extraBody.authorizeUrl = await youtube.connections.publishAuthorizeUrl(info(c))
      return apiError(409, result.code, result.message, [], extraBody)
    }
    return c.json({ row: result.row })
  })

  // ── 게시됨 확인·알림에서 빼기 (AC-I3-36 — 판매자 계정만, 보조자는 api.ts 허용 목록에서 403) ──────
  /** 판매자 조작 앞 확인: 행 번호·리허설(409)·봉인(409). 통과하면 null */
  const rowGate = async (c: Context<Env>): Promise<{ id: number } | Response> => {
    if (youtube === null) return notConfigured()
    const raw = c.req.param('id') ?? ''
    if (!/^\d{1,15}$/.test(raw)) return notFound()
    const id = Number(raw)
    const rehearsal = await youtube.outboxRowRehearsal(sellerOf(c), id)
    if (rehearsal === null) return notFound()
    if (rehearsal) return apiError(409, 'REHEARSAL_OUTBOX', SELLER_OUTBOX_MESSAGES.REHEARSAL_OUTBOX)
    const sealedRow = await youtube.outboxSealed(sellerOf(c), id)
    if (sealedRow === 'not_found') return notFound()
    if (sealedRow) return apiError(409, 'SEALED', LINK_MESSAGES.SEALED)
    return { id }
  }
  api.post('/outbox/:id/confirm-posted', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId'])
    if (extra !== null) return extra
    const gate = await rowGate(c)
    if (gate instanceof Response) return gate
    const result = await (youtube as YoutubeSystem).outbox.confirmPosted(sellerOf(c), gate.id, session(c).accountId, requestId)
    if (result.kind === 'not_found') return notFound()
    if (result.kind === 'rejected') return apiError(409, result.code, result.message)
    return c.json({ rows: result.rows })
  })
  api.post('/outbox/:id/dismiss', async (c) => {
    const extra = onlyKeys(body(c), [])
    if (extra !== null) return extra
    const gate = await rowGate(c)
    if (gate instanceof Response) return gate
    const result = await (youtube as YoutubeSystem).outbox.dismiss(sellerOf(c), gate.id, session(c).accountId)
    if (result.kind === 'not_found') return notFound()
    if (result.kind === 'rejected') return apiError(409, result.code, result.message)
    return c.json({ row: result.row })
  })

  // ── 지운 메시지·차단 알림 (AC-Y1-27) ───────────────────────────────────
  api.get('/days/:date/youtube-notices', async (c) => {
    const date = c.req.param('date')
    if (!isValidDate(date)) return notFound()
    if (youtube === null) return c.json({ date, notices: [] })
    const scope = await scopeIdOf(service, sellerOf(c), date)
    return c.json({ date, notices: scope === null ? [] : await youtube.notices(sellerOf(c), scope) })
  })

  // ── 할당량 (AC-Y1-53) ─────────────────────────────────────────────────
  api.get('/youtube/quota', async (c) => {
    if (youtube === null) return notConfigured()
    return c.json({ quota: await youtube.quota.view(sellerOf(c)) })
  })
}

/** 실제 범위 ID (없으면 null) — 범위 상태를 불러오지 않는다(봉인한 범위도) */
async function scopeIdOf(service: Service, sellerId: string, date: string): Promise<string | null> {
  return (await service.sealed(sellerId, date, false))?.scopeId ?? (await service.scopeId(sellerId, date))
}

export { CALLBACK_MESSAGES }
