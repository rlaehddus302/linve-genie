// 연습 방송 한 바퀴 (D-RETRO-37, 복기 E3) — 두 자리 교대에서 새 판을 올리기 전에 대기 자리가 정말 일하는지 본다.
// 대기 자리의 HTTP 입구로 "리허설 방송 만들기 → 상품 등록 → 시청자 찜 → 확정 확인 → 방송 끝내기"를 돈다.
//
// 운영 데이터에 닿지 않는 방법:
// - **점검용 가게 하나**(아이디 lg-slot-check)의 **리허설 범위**에만 쓴다. 리허설 범위는 실제 범위와 기록·순번·잠금이 따로이고(writer.ts),
//   발송함 행에 리허설 표시가 붙어 감사 채팅·DM·문자가 나가지 않는다. 다른 판매자의 기록은 읽지도 쓰지도 않는다.
// - 점검용 가게는 처음 한 번 만든다. 비밀번호는 아무도 모르는 무작위 값이라 화면으로 로그인할 수 없다.
//   이 명령은 비밀번호 대신 5분짜리 세션을 DB에 직접 넣어 쓰고, 끝나면 지운다(값을 찍지 않는다).
// - 유튜브·구글 등 바깥으로 나가는 요청이 없다(리허설 방송은 플랫폼에 잇지 않는다).
// 남는 것: 점검용 가게의 리허설 방송 기록(배포마다 하나, 30일 뒤 봉인). 판매자 화면·정산에는 보이지 않는다.
import { randomBytes } from 'node:crypto'
import { createSellerAccount } from './accounts.ts'
import { SESSION_COOKIE } from './auth.ts'
import type { Db } from './db/database.ts'
import { newSessionToken, tokenHash } from './secrets.ts'
import { deleteSession, findAccountByLogin, insertSession } from './store.ts'

export const SMOKE_LOGIN_ID = 'lg-slot-check'
export const SMOKE_SHOP_NAME = '배포 점검'
const SESSION_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000

export type SmokeFetch = (path: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<unknown> }>

export interface SmokeDeps {
  readonly db: Db
  readonly masterKey: Buffer
  /** 앱 주소 (LIVEJJIM_APP_ORIGIN) — 상태를 바꾸는 요청의 Origin */
  readonly origin: string
  /** 대기 자리에 요청을 보낸다 (명령은 http://127.0.0.1:<PORT>, 시험은 app.request) */
  readonly fetch: SmokeFetch
  readonly now?: () => number
}

export type SmokeResult = { readonly ok: true; readonly steps: readonly string[] } | { readonly ok: false; readonly step: string; readonly message: string; readonly steps: readonly string[] }

class SmokeFailure extends Error {}

/** 한 바퀴를 돈다. 실패하면 어느 걸음에서 왜인지(HTTP 상태·오류 코드만 — 값 없음) 돌려준다 */
export async function runSlotSmoke(deps: SmokeDeps): Promise<SmokeResult> {
  const now = deps.now ?? (() => Date.now())
  const steps: string[] = []
  let step = '점검용 가게'
  let session: { tokenHash: string; sellerId: string } | null = null
  try {
    let account = await findAccountByLogin(deps.db, SMOKE_LOGIN_ID)
    if (account === null) {
      const created = await createSellerAccount(deps.db, deps.masterKey, { shopName: SMOKE_SHOP_NAME, loginId: SMOKE_LOGIN_ID, password: randomBytes(32).toString('base64url') })
      if (!created.ok) throw new SmokeFailure('점검용 가게를 만들지 못했어요.')
      account = await findAccountByLogin(deps.db, SMOKE_LOGIN_ID)
      if (account === null) throw new SmokeFailure('점검용 가게를 찾지 못했어요.')
    }
    const token = newSessionToken()
    session = { tokenHash: tokenHash(token), sellerId: account.sellerId }
    await insertSession(deps.db, { tokenHash: session.tokenHash, sellerId: account.sellerId, accountId: account.id, now: new Date(now()), expiresAt: new Date(now() + SESSION_MS) })
    steps.push(step)

    const run = randomBytes(6).toString('hex')
    const call = async (method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const headers: Record<string, string> = { Cookie: `${SESSION_COOKIE}=${token}` }
      if (method === 'POST') {
        headers['Origin'] = deps.origin
        headers['Content-Type'] = 'application/json'
      }
      const response = await deps.fetch(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      let parsed: unknown
      try {
        parsed = await response.json()
      } catch {
        parsed = null
      }
      if (response.status !== 200) {
        const code = (parsed as { error?: { code?: unknown } } | null)?.error?.code
        throw new SmokeFailure(`HTTP ${String(response.status)}${typeof code === 'string' ? ` ${code}` : ''}`)
      }
      if (typeof parsed !== 'object' || parsed === null) throw new SmokeFailure('응답이 JSON 객체가 아니에요.')
      return parsed as Record<string, unknown>
    }

    step = '리허설 방송 만들기'
    const made = (await call('POST', '/api/broadcasts', { requestId: `smoke-${run}-bc`, rehearsal: true })).broadcast as { id?: unknown; date?: unknown; rehearsal?: unknown } | undefined
    if (typeof made?.id !== 'string' || typeof made.date !== 'string' || made.rehearsal !== true) throw new SmokeFailure('리허설 방송이 만들어지지 않았어요.')
    steps.push(step)

    step = '상품 등록'
    await call('POST', '/api/events', { requestId: `smoke-${run}-reg`, type: 'product.register', b: made.id, no: 1, name: '배포 점검', price: 1000 })
    steps.push(step)

    step = '시청자 찜'
    const message = (await call('POST', `/api/broadcasts/${made.id}/rehearsal/chat`, { requestId: `smoke-${run}-chat`, nick: '점검', text: '1' })).message as { channel?: unknown } | undefined
    if (typeof message?.channel !== 'string') throw new SmokeFailure('찜 채팅의 답에 시청자가 없어요.')
    steps.push(step)

    step = '확정 확인'
    const day = await call('GET', `/api/days/${made.date}?rehearsal=true`)
    const product = (day.products as { no?: unknown; winners?: unknown }[] | undefined)?.find((item) => item.no === 1)
    if (!Array.isArray(product?.winners) || !product.winners.includes(message.channel)) throw new SmokeFailure('찜이 확정되지 않았어요.')
    steps.push(step)

    step = '방송 끝내기'
    await call('POST', `/api/broadcasts/${made.id}/end`, { requestId: `smoke-${run}-end` })
    steps.push(step)
    return { ok: true, steps }
  } catch (error) {
    // 우리 문장만 내보낸다 — 모르는 오류의 메시지에는 값이 들어 있을 수 있다(D-073)
    return { ok: false, step, message: error instanceof SmokeFailure ? error.message : '예상하지 못한 오류가 났어요.', steps }
  } finally {
    if (session !== null) await deleteSession(deps.db, session).catch(() => undefined)
  }
}

/** 명령이 쓰는 진짜 요청: 같은 컨테이너의 서버로 (시간 제한 15초) */
export function localFetch(base: string): SmokeFetch {
  return async (path, init) => {
    const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    return { status: response.status, json: () => response.json() as Promise<unknown> }
  }
}
