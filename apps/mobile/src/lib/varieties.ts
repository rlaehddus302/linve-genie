// 품종 후보 단추 (D-VARIETY-01, 사용자 메모 2026-11-13 "자주 등록되는 품종이나 최근에 등록된 품종을 버튼으로 보여줘서 눌러서 빠르게 품종을 수정", 개선 계획 E1).
// 순서: 일꾼이 들은 이름(확인 중 상품의 품종 후보) → 이 방송에서 최근 등록한 품종 → 이 판매자가 최근 방송들에서 많이 쓴 품종. 겹치지 않게, 지금 품종은 빼고.
// 서버(GET /api/broadcasts/:id/varieties)가 지난 기록을 센다. 서버에 닿지 못하면 이 방송의 상품(앱이 가진 자료)만으로 만든다 — 단추가 없을 뿐 고치기는 그대로다.
// 앱은 이름을 바꾸지 않는다(품종·옵션 말이 섞여 있어도 저장된 이름 그대로). 이름은 글자로만 그린다.
import { useEffect, useState } from 'react'
import type { Product } from '@livejjim/web/src/api/types.ts'
import { get } from '../api/client.ts'

/** 한 줄에 놓는 후보 수 (넘치면 가로로 민다) */
export const VARIETY_CHOICES_MAX = 12

export interface VarietyLists {
  readonly recent: readonly string[]
  readonly frequent: readonly string[]
}

const EMPTY: VarietyLists = { recent: [], frequent: [] }
/** 방송마다 받은 목록을 잠깐 둔다 — 상품을 연달아 열 때 단추가 깜빡이지 않게 */
const KEEP_MS = 30_000
const kept = new Map<string, { readonly at: number; readonly lists: VarietyLists }>()

const clean = (name: string): string => name.trim().replace(/\s+/gu, ' ')

/** 서버 답을 모양 검사해 읽는다 (글 목록만) */
export function readVarietyLists(body: unknown): VarietyLists {
  if (typeof body !== 'object' || body === null) return EMPTY
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && clean(item) !== '').map(clean) : [])
  const record = body as Record<string, unknown>
  return { recent: list(record['recent']), frequent: list(record['frequent']) }
}

/** 이 방송에서 최근 등록한 품종 — 앱이 가진 상품만으로 (상품 ID가 큰 것부터) */
export function localRecent(products: Iterable<Pick<Product, 'id' | 'broadcast' | 'name'>>, b: string): string[] {
  const order = (id: string) => Number(/^p(\d+)$/u.exec(id)?.[1] ?? 0)
  const out: string[] = []
  for (const product of [...products].filter((item) => item.broadcast === b).sort((x, y) => order(y.id) - order(x.id))) {
    const name = clean(product.name)
    if (name !== '' && !out.includes(name)) out.push(name)
  }
  return out
}

/**
 * 단추로 놓을 품종: 일꾼이 들은 이름 → 이번 방송 최근 → 자주 판 것. 겹치지 않게, 지금 품종(current)은 빼고, max개까지
 */
export function varietyChoices(input: { readonly heard?: readonly string[]; readonly recent: readonly string[]; readonly frequent: readonly string[]; readonly current?: string; readonly max?: number }): string[] {
  const current = clean(input.current ?? '')
  const out: string[] = []
  for (const name of [...(input.heard ?? []), ...input.recent, ...input.frequent]) {
    const value = clean(name)
    if (value === '' || value === current || out.includes(value)) continue
    out.push(value)
    if (out.length === (input.max ?? VARIETY_CHOICES_MAX)) break
  }
  return out
}

/** 서버에서 그 방송의 품종 후보를 받는다. 받기 전·못 받으면 빈 목록 (단추 없이 고치기는 그대로) */
export function useVarietyLists(b: string, enabled: boolean): VarietyLists {
  const [lists, setLists] = useState<VarietyLists>(() => kept.get(b)?.lists ?? EMPTY)
  useEffect(() => {
    if (!enabled) return
    const hit = kept.get(b)
    if (hit !== undefined) setLists(hit.lists)
    if (hit !== undefined && Date.now() - hit.at < KEEP_MS) return
    let live = true
    get<unknown>(`/api/broadcasts/${encodeURIComponent(b)}/varieties`)
      .then((body) => {
        const read = readVarietyLists(body)
        kept.set(b, { at: Date.now(), lists: read })
        if (live) setLists(read)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [b, enabled])
  return lists
}

/** 시험용: 잠깐 둔 목록을 비운다 */
export function forgetVarietyLists(): void {
  kept.clear()
}
