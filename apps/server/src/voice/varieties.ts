// D-V3-127 내 품종 장부: 판매자가 직접 적은 품종 이름 — 교배로 지은 이름처럼 어떤 사전에도 없는 것을 사장이 알려 준다.
// 쓰임 두 가지: ① 음성 사전 맨 앞(판매 이력보다 먼저, 비슷하게 들려도 맞춤) ② 받아쓰기 일꾼 힌트(composeHint — 처음부터 맞게 적게).
// GET /api/voice/varieties { names, suggested } · PUT /api/voice/varieties { names }. 복구가 지우지 않는다(RESTORE_KEPT_TABLES).
import { containsPhoneRun } from '@livejjim/core'
import { pickHistoryDays } from '@livejjim/voice-session/rules'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import type { Env } from '../api.ts'
import type { Db } from '../db/database.ts'
import { voiceVarieties } from '../db/schema.ts'
import { apiError } from '../errors.ts'
import type { Service } from '../service.ts'
import { lockSeller } from '../store.ts'
import type { Clock } from '../time.ts'
import type { LearnedAlias } from '@livejjim/voice'

/** 장부 한도: 이름 수·이름 길이(글자) */
export const VARIETY_LIMIT = 500
export const VARIETY_NAME_MAX = 40
export const VARIETY_MESSAGES = {
  invalid: '품종 이름을 확인해 주세요.',
  tooMany: `품종은 ${String(VARIETY_LIMIT)}개까지 적을 수 있어요.`,
  tooLong: `품종 이름은 ${String(VARIETY_NAME_MAX)}글자까지예요.`,
} as const

/** 공백 빼고 로마자 소문자 — 같은 이름인지 볼 때 (사전 키와 같은 규칙) */
export const varietyKey = (name: string): string => name.replace(/\s+/g, '').toLowerCase()

/** 보이지 않는 제어 글자(탭·줄바꿈 포함 — 공백으로 이미 바꾼 뒤라 남은 것은 모두 제어 글자) */
const hasControlChar = (name: string): boolean => [...name].some((ch) => { const code = ch.codePointAt(0) ?? 0; return code < 0x20 || code === 0x7f })

/** 이름 목록 정리: 앞뒤 공백 빼고, 빈 것·제어 글자·전화번호 꼴은 거절(null), 같은 이름은 앞의 것 하나만 */
export function checkVarietyNames(value: unknown): { names: string[] } | { error: string } {
  if (!Array.isArray(value)) return { error: VARIETY_MESSAGES.invalid }
  if (value.length > VARIETY_LIMIT) return { error: VARIETY_MESSAGES.tooMany }
  const seen = new Set<string>()
  const names: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return { error: VARIETY_MESSAGES.invalid }
    const name = item.replace(/\s+/g, ' ').trim()
    if (name === '') continue
    if ([...name].length > VARIETY_NAME_MAX) return { error: VARIETY_MESSAGES.tooLong }
    if (hasControlChar(name) || containsPhoneRun(name)) return { error: VARIETY_MESSAGES.invalid }
    const key = varietyKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return { names }
}

/** 한글 수로 쓴 판매 말 보기 — 위스퍼가 숫자로 바꾸지 않고 들리는 대로 적게 (D-V3-127, 사용자 "발음 그대로 이공팔, 이백팔 … 인식하는 모델") */
export const HINT_NUMBER_SAMPLE = '이백팔번 오만 원. 삼백육번 십이만 원. 육십오번 삼만 원까지. 백오십번 십팔만 원이요.'
/** 힌트 글자 한도 — 위스퍼 힌트는 224토큰, 한글은 글자당 1~2토큰이라 넉넉히 자른다(일꾼이 토큰으로 한 번 더 자른다) */
export const HINT_CHAR_LIMIT = 260

/** 받아쓰기 힌트 한 줄: 한글 수 보기 + 품종 이름(장부 먼저, 그다음 최근 판 이름). 빈 목록이면 보기만 */
export function composeHint(names: readonly string[], recent: readonly string[] = []): string {
  const seen = new Set<string>()
  const parts: string[] = []
  let length = HINT_NUMBER_SAMPLE.length + 1
  for (const name of [...names, ...recent]) {
    const key = varietyKey(name)
    if (key === '' || seen.has(key)) continue
    if (length + name.length + 2 > HINT_CHAR_LIMIT) break
    seen.add(key)
    parts.push(name)
    length += name.length + 2
  }
  return parts.length === 0 ? HINT_NUMBER_SAMPLE : `${HINT_NUMBER_SAMPLE} ${parts.join(', ')}.`
}

export class VoiceVarieties {
  readonly #db: Db
  readonly #clock: Clock
  /** 판매자 → 장부 (힌트는 흐름을 열 때 바로 필요해 한 번 읽은 것을 둔다; 쓰면 바로 바꾼다) */
  readonly #cache = new Map<string, string[]>()
  constructor(db: Db, clock: Clock) { this.#db = db; this.#clock = clock }

  async read(sellerId: string): Promise<string[]> {
    const cached = this.#cache.get(sellerId)
    if (cached !== undefined) return cached
    const rows = await this.#db.select({ names: voiceVarieties.names }).from(voiceVarieties).where(eq(voiceVarieties.sellerId, sellerId)).limit(1)
    let names: string[] = []
    try {
      const checked = checkVarietyNames(JSON.parse(rows[0]?.names ?? '[]'))
      if ('names' in checked) names = checked.names
    } catch { names = [] }
    this.#cache.set(sellerId, names)
    return names
  }

  /** 장부 전체를 바꾼다(화면이 목록을 통째로 보낸다). 틀리면 문장 */
  async write(sellerId: string, value: unknown): Promise<{ names: string[] } | { error: string }> {
    const checked = checkVarietyNames(value)
    if ('error' in checked) return checked
    const now = new Date(this.#clock.now())
    await this.#db.transaction(async (tx) => {
      if (!(await lockSeller(tx, sellerId))) return
      await tx.insert(voiceVarieties).values({ sellerId, names: JSON.stringify(checked.names), updatedAt: now })
        .onConflictDoUpdate({ target: voiceVarieties.sellerId, set: { names: JSON.stringify(checked.names), updatedAt: now } })
    })
    this.#cache.set(sellerId, checked.names)
    return checked
  }

  /** 흐름을 열 때 쓰는 힌트 — 아직 안 읽었으면 보기 문장만(다음 흐름부터 장부가 든다) */
  hint(sellerId: string): string {
    return composeHint(this.#cache.get(sellerId) ?? [])
  }
  /** 흐름을 열기 전에 미리 읽어 둔다 */
  async warm(sellerId: string): Promise<void> { await this.read(sellerId) }
  /** 시험·로그아웃용 */
  forget(sellerId: string): void { this.#cache.delete(sellerId) }
}

/** 장부에 더해 볼 만한 이름: 최근 판 상품 이름(지난 실제 범위, 최근 것 먼저)과 배운 별칭의 품종 — 장부에 이미 있는 것은 뺀다 */
export async function suggestedVarieties(service: Service, sellerId: string, have: readonly string[], learned: readonly LearnedAlias[]): Promise<string[]> {
  const keys = new Set(have.map(varietyKey))
  const out: string[] = []
  const add = (name: unknown) => {
    if (typeof name !== 'string') return
    const trimmed = name.replace(/\s+/g, ' ').trim()
    const key = varietyKey(trimmed)
    if (key === '' || keys.has(key) || [...trimmed].length > VARIETY_NAME_MAX) return
    keys.add(key)
    out.push(trimmed)
  }
  for (const alias of learned) add(alias.name)
  const days = pickHistoryDays(await service.days(sellerId, false), { date: '', rehearsal: false }, 30)
  for (const date of days) {
    if (out.length >= 300) break
    const view = await service.scopeView(sellerId, date)
    const products = typeof view === 'object' && view !== null && 'products' in view ? view.products : null
    if (!Array.isArray(products)) continue
    for (const item of products) if (typeof item === 'object' && item !== null && 'name' in item) add(item.name)
  }
  return out.slice(0, 300)
}

export function registerVoiceVarietyRoutes(api: Hono<Env>, varieties: VoiceVarieties, deps: { readonly service: Service; readonly learned: (sellerId: string) => Promise<readonly LearnedAlias[]> }): void {
  api.get('/voice/varieties', async (c) => {
    const sellerId = c.get('session').sellerId
    const names = await varieties.read(sellerId)
    const suggested = await suggestedVarieties(deps.service, sellerId, names, await deps.learned(sellerId))
    return c.json({ names, suggested })
  })
  api.put('/voice/varieties', async (c) => {
    const input = c.get('body')
    if (input === null || Object.keys(input).some((key) => key !== 'names')) return apiError(400, 'INVALID_INPUT', VARIETY_MESSAGES.invalid)
    const result = await varieties.write(c.get('session').sellerId, input.names)
    return 'error' in result ? apiError(400, 'INVALID_INPUT', result.error) : c.json({ names: result.names })
  })
}
