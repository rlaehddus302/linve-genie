// 틱톡 설정·연결·붙여넣기 경로 (N2b-2, AC-N2b-2-21·24·31·34·56~59). 계약은 harness/sprints/N2b-2/dev-notes.md "화면에게".
// - /api 공통 미들웨어(로그인·Origin·JSON·64KB)를 그대로 탄다. 보조자는 허용 목록(roles.ts)의 붙여넣기 두 경로만 — 나머지는 403.
// - 다른 판매자의 회차는 404(있는지 알리지 않는다). 받은 값(아이디·붙여 넣은 글)은 오류 응답에 되돌려 보내지 않는다.
import type { Context, Hono } from 'hono'
import { REQUEST_ID_RE, own, ownKeys } from '../api-fields.ts'
import type { SessionContext } from '../auth.ts'
import { apiError, JSON_CONTENT_TYPE } from '../errors.ts'
import type { LinkOutcome } from '../live-links.ts'
import { unknownFieldProblems } from '../messages.ts'
import type { TikTokLive } from './live.ts'
import type { PasteService } from './paste-service.ts'
import { PASTE_LINES_MAX } from './paste.ts'

type Env = { Variables: { body: Record<string, unknown> | null; session: SessionContext } }

const invalidRequestId = () =>
  apiError(400, 'INVALID_REQUEST_ID', '보내는 중 문제가 생겼어요. 화면을 새로고침한 뒤 다시 해 주세요.', [{ field: 'requestId', message: '화면을 새로고침한 뒤 다시 해 주세요.' }])
const notFound = () => apiError(404, 'NOT_FOUND', '찾을 수 없어요.')

export function outcomeResponse(outcome: LinkOutcome): Response {
  return new Response(JSON.stringify(outcome.body), { status: outcome.status, headers: { 'Content-Type': JSON_CONTENT_TYPE, 'Cache-Control': 'no-store' } })
}

export function registerTiktokRoutes(api: Hono<Env>, tiktok: TikTokLive, paste: PasteService): void {
  const body = (c: Context<Env>) => c.get('body') ?? {}
  const session = (c: Context<Env>) => c.get('session')
  const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): Response | null => {
    const extra = ownKeys(value).filter((key) => !allowed.includes(key))
    return extra.length === 0 ? null : apiError(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
  }
  const requestIdOf = (value: Record<string, unknown>): string | null => {
    const id = own(value, 'requestId')
    return typeof id === 'string' && REQUEST_ID_RE.test(id) ? id : null
  }

  // ── 설정: 고지·동의·아이디 (AC-N2b-2-20·21·24) ─────────────────────────
  api.get('/tiktok', async (c) => c.json({ tiktok: await tiktok.settingsView(session(c).sellerId) }))

  api.post('/tiktok/consent', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'on', 'version'])
    if (extra !== null) return extra
    const on = own(input, 'on')
    if (typeof on !== 'boolean') return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'on', message: '켤지 끌지 예나 아니오로 정해 주세요.' }])
    return outcomeResponse(await tiktok.setConsent(session(c).sellerId, session(c).accountId, requestId, on, own(input, 'version')))
  })

  api.put('/tiktok/account', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['tiktokId'])
    if (extra !== null) return extra
    const value = own(input, 'tiktokId')
    if (value !== null && typeof value !== 'string') return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'tiktokId', message: '틱톡 아이디를 넣어 주세요.' }])
    return outcomeResponse(await tiktok.setTiktokId(session(c).sellerId, session(c).accountId, value))
  })

  // ── 회차의 틱톡 연결 보기·다시 연결 (AC-N2b-2-31·34) ───────────────────
  api.get('/broadcasts/:id/tiktok', async (c) => {
    const link = await tiktok.view(session(c).sellerId, c.req.param('id'))
    return link === null ? notFound() : c.json({ link })
  })

  // 그 회차에 이은 틱톡 계정의 프로필 사진 (홈 "지금 라이브 중"·채널 사진 자리, D-TT-PHOTO-01) — data: 주소, 모르면 null
  api.get('/broadcasts/:id/tiktok/avatar', async (c) => {
    const avatar = await tiktok.avatar(session(c).sellerId, c.req.param('id'))
    return avatar === undefined ? notFound() : c.json({ avatar })
  })

  api.post('/broadcasts/:id/tiktok/reconnect', async (c) => {
    const extra = onlyKeys(body(c), ['requestId'])
    if (extra !== null) return extra
    return outcomeResponse(await tiktok.reconnect(session(c).sellerId, c.req.param('id')))
  })

  // ── 링크로 잇기 (D-UX3-14): 틱톡 방송 링크·짧은 공유 링크 → 아이디를 읽어 저장하고 잇는다 ───
  api.post('/broadcasts/:id/tiktok/link-url', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'url', 'move'])
    if (extra !== null) return extra
    return outcomeResponse(await tiktok.linkByUrl(session(c).sellerId, session(c).accountId, requestId, c.req.param('id'), own(input, 'url'), own(input, 'move') === true))
  })

  // ── 저장 실패 확인 (AC-N2b-2-74, D-N2b-2-16) — 판매자만(보조자 허용 목록 밖 → 403) ─────────
  api.post('/broadcasts/:id/tiktok/save-failed-seen', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['upTo'])
    if (extra !== null) return extra
    const upTo = own(input, 'upTo')
    if (typeof upTo !== 'number' || !Number.isSafeInteger(upTo) || upTo < 0) {
      return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'upTo', message: '확인한 수를 0 이상의 정수로 보내 주세요.' }])
    }
    return outcomeResponse(await tiktok.markSaveFailedSeen(session(c).sellerId, c.req.param('id'), upTo))
  })

  // ── 댓글 붙여넣기 (AC-N2b-2-56~59) — 보조자도 (실제 회차만) ─────────────
  const textOf = (input: Record<string, unknown>): string | Response => {
    const text = own(input, 'text')
    if (typeof text !== 'string') return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'text', message: '붙여 넣은 글을 보내 주세요.' }])
    return text
  }

  api.post('/broadcasts/:id/paste/preview', async (c) => {
    const input = body(c)
    const extra = onlyKeys(input, ['text'])
    if (extra !== null) return extra
    const text = textOf(input)
    if (typeof text !== 'string') return text
    return outcomeResponse(await paste.preview(session(c).sellerId, c.req.param('id'), text))
  })

  api.post('/broadcasts/:id/paste', async (c) => {
    const input = body(c)
    const requestId = requestIdOf(input)
    if (requestId === null) return invalidRequestId()
    const extra = onlyKeys(input, ['requestId', 'text', 'includeOverlaps'])
    if (extra !== null) return extra
    const text = textOf(input)
    if (typeof text !== 'string') return text
    // "그래도 넣기"로 고른 줄 번호 (D-N2b-2-14) — 없으면 빈 목록
    const include = own(input, 'includeOverlaps')
    if (include !== undefined && !(Array.isArray(include) && include.length <= PASTE_LINES_MAX && include.every((line) => Number.isSafeInteger(line) && (line as number) >= 1))) {
      return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'includeOverlaps', message: '고른 줄을 확인해 주세요.' }])
    }
    return outcomeResponse(
      await paste.insert(session(c).sellerId, { kind: 'account', accountId: session(c).accountId }, requestId, c.req.param('id'), text, (include ?? []) as number[]),
    )
  })
}
