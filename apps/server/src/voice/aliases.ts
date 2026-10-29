// APP1b: 배운 품종 별칭만 계정에 저장한다. 음성 세션·받아쓴 문장은 저장하지 않는다.
import { containsPhoneRun } from '@livejjim/core'
import { readLearnedAliases, type LearnedAlias } from '@livejjim/voice'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import type { Env } from '../api.ts'
import type { Db } from '../db/database.ts'
import { voiceAliases } from '../db/schema.ts'
import { apiError } from '../errors.ts'
import { lockSeller } from '../store.ts'

function checked(value: unknown): LearnedAlias[] | null {
  if (!Array.isArray(value) || value.length > 200) return null
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const fields = item as Record<string, unknown>
    if (Object.keys(fields).some((key) => !['heard', 'name', 'usedAt'].includes(key))) return null
    if (typeof fields.heard !== 'string' || typeof fields.name !== 'string' || fields.heard.length > 120 || fields.name.length > 120 ||
      containsPhoneRun(fields.heard) || containsPhoneRun(fields.name) || typeof fields.usedAt !== 'number' || !Number.isSafeInteger(fields.usedAt) || fields.usedAt < 0) return null
  }
  return readLearnedAliases(value)
}
export class VoiceAliases {
  readonly #db: Db
  constructor(db: Db) { this.#db = db }
  async read(sellerId: string, db: Db = this.#db): Promise<LearnedAlias[]> {
    const rows = await db.select({ aliases: voiceAliases.aliases }).from(voiceAliases).where(eq(voiceAliases.sellerId, sellerId)).limit(1)
    try { return readLearnedAliases(JSON.parse(rows[0]?.aliases ?? '[]')) } catch { return [] }
  }
  /** 최초 기기 이전은 계정 우선. 명시적으로 다시 배우면 새 값 우선. 판매자 행 잠금으로 동시 이전도 잃지 않는다. */
  async merge(sellerId: string, value: unknown, migration: boolean): Promise<LearnedAlias[] | null> {
    const incoming = checked(value)
    if (incoming === null) return null
    return this.#db.transaction(async (tx) => {
      if (!(await lockSeller(tx, sellerId))) return null
      const current = await this.read(sellerId, tx)
      const keep = new Map<string, LearnedAlias>()
      for (const alias of migration ? [...incoming, ...current] : [...current, ...incoming]) keep.set(alias.heard, alias)
      const aliases = readLearnedAliases([...keep.values()])
      await tx.insert(voiceAliases).values({ sellerId, aliases: JSON.stringify(aliases) })
        .onConflictDoUpdate({ target: voiceAliases.sellerId, set: { aliases: JSON.stringify(aliases) } })
      return aliases
    })
  }
  /** 읽기 화면에서 명시적으로 [배운 품종 이름 지우기]를 고른 경우에만 쓴다. 빈 이전 요청은 이 경로를 타지 않는다. */
  async clear(sellerId: string): Promise<void> {
    await this.#db.transaction(async (tx) => {
      if (!(await lockSeller(tx, sellerId))) return
      await tx.delete(voiceAliases).where(eq(voiceAliases.sellerId, sellerId))
    })
  }
}
export function registerVoiceAliasRoutes(api: Hono<Env>, aliases: VoiceAliases): void {
  api.get('/voice/aliases', async (c) => c.json({ aliases: await aliases.read(c.get('session').sellerId) }))
  api.post('/voice/aliases', async (c) => {
    const input = c.get('body')
    if (input === null || Object.keys(input).some((key) => !['aliases', 'migration'].includes(key)) || (input.migration !== undefined && typeof input.migration !== 'boolean'))
      return apiError(400, 'INVALID_INPUT', '배운 품종 이름을 확인해 주세요.')
    const list = await aliases.merge(c.get('session').sellerId, input.aliases, input.migration === true)
    return list === null ? apiError(400, 'INVALID_INPUT', '배운 품종 이름을 확인해 주세요.') : c.json({ aliases: list })
  })
}
