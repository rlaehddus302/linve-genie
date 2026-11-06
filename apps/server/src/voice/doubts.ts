// 채팅 의심 표시 (D-V3-129, 사용자 "81번 82번을 연달아 소개할수도 있는거고 채팅도 섞일 수도 있고 아예 안 칠수도 있다. 이런 변수까지 고려해야 한다"):
// 채팅은 방송 지연 때문에 말보다 15~30초 늦게 오므로 등록을 바꾸는 데는 쓰지 않는다. 등록 **뒤** "틀렸다"는 증거로만 쓴다.
//  - 음성으로 N번을 등록한 뒤 WINDOW 동안 손님 채팅(주문·언급)이 N번을 한 번도 안 가리키고, 그 방송에 없는 다른 번호 Y를 MIN_OTHER번 넘게 가리키면
//    "채팅은 Y번을 찾아요" 표시(판매자가 확인). 자동으로 고치지 않는다.
//  - 81·82를 연달아 팔면 82 채팅이 있어 표시 없음. 채팅이 섞이면(N도 있음) 없음. 채팅이 아예 없으면 없음. Y가 이미 있는 상품이면(늦은 찜) 없음.
//  - 창이 다 지나기 전에는 판단하지 않는다(채팅이 아직 안 왔을 수 있다).
import type { Hono } from 'hono'
import type { Env } from '../api.ts'
import type { Db } from '../db/database.ts'
import { apiError } from '../errors.ts'
import type { Service } from '../service.ts'
import { findBroadcast } from '../store.ts'
import type { Clock } from '../time.ts'

/** 등록 뒤 채팅을 보는 시간 (방송 지연 15~30초 + 손님이 치는 시간) */
export const DOUBT_WINDOW_MS = 60_000
/** 다른 번호를 이만큼 넘게 가리켜야 의심 */
export const DOUBT_MIN_OTHER = 3

export interface DoubtRegistration { readonly no: number; readonly at: number }
export interface DoubtMessage { readonly at: number; readonly owner: boolean; readonly numbers: readonly number[] }
export interface ChatDoubt { readonly no: number; readonly suspected: number; readonly count: number }

export const doubtWords = (doubt: ChatDoubt): string => `채팅은 ${String(doubt.suspected)}번을 찾아요 (${String(doubt.count)}명). 번호를 확인해 주세요.`

/** 순수 규칙: 음성 등록 목록·손님 채팅·지금 상품 번호들 → 의심 목록 */
export function findChatDoubts(input: {
  readonly registrations: readonly DoubtRegistration[]
  readonly messages: readonly DoubtMessage[]
  readonly existing: ReadonlySet<number>
  readonly now: number
  readonly windowMs?: number
  readonly minOther?: number
}): ChatDoubt[] {
  const windowMs = input.windowMs ?? DOUBT_WINDOW_MS
  const minOther = input.minOther ?? DOUBT_MIN_OTHER
  const out: ChatDoubt[] = []
  for (const reg of input.registrations) {
    const end = reg.at + windowMs
    if (input.now < end) continue
    const counts = new Map<number, number>()
    for (const message of input.messages) {
      if (message.owner || message.at < reg.at || message.at > end) continue
      for (const no of new Set(message.numbers)) counts.set(no, (counts.get(no) ?? 0) + 1)
    }
    if ((counts.get(reg.no) ?? 0) > 0) continue
    let best: ChatDoubt | null = null
    for (const [no, count] of counts) {
      if (no === reg.no || count < minOther || input.existing.has(no)) continue
      if (best === null || count > best.count || (count === best.count && no < best.suspected)) best = { no: reg.no, suspected: no, count }
    }
    if (best !== null) out.push(best)
  }
  return out
}

export function registerChatDoubtRoutes(api: Hono<Env>, deps: { readonly db: Db; readonly service: Service; readonly clock: Clock }): void {
  api.get('/broadcasts/:id/voice-doubts', async (c) => {
    const sellerId = c.get('session').sellerId
    const b = c.req.param('id')
    const broadcast = await findBroadcast(deps.db, sellerId, b)
    if (broadcast === null) return apiError(404, 'NOT_FOUND', '그 방송을 찾지 못했어요.')
    const logs = await deps.service.voiceLog(sellerId, { b })
    const registrations = logs
      .filter((entry) => entry.kind === 'REGISTER' && !entry.failed && !entry.undone)
      .map((entry) => ({ no: entry.no, at: Date.parse(entry.at) }))
      .filter((entry) => Number.isFinite(entry.at))
    if (registrations.length === 0) return c.json({ doubts: [] })
    const view = await deps.service.messages(sellerId, broadcast.date, broadcast.rehearsal, { b, limit: 1_000 })
    const messages: DoubtMessage[] = (view?.messages ?? []).map((message) => ({ at: Date.parse(message.at), owner: message.owner, numbers: [...message.orders, ...message.mentions] }))
    const scope = await deps.service.scopeView(sellerId, broadcast.date, broadcast.rehearsal)
    const products = typeof scope === 'object' && scope !== null && 'products' in scope && Array.isArray(scope.products) ? scope.products : []
    const existing = new Set<number>(products.flatMap((item: unknown) => (typeof item === 'object' && item !== null && 'no' in item && typeof item.no === 'number' && 'broadcast' in item && item.broadcast === b ? [item.no] : [])))
    const doubts = findChatDoubts({ registrations, messages, existing, now: deps.clock.now() })
    return c.json({ doubts: doubts.map((doubt) => ({ ...doubt, text: doubtWords(doubt) })) })
  })
}
