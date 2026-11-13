// 상품별 조치 기록을 상품 ID로 거르기 (AC-S06-70, ORD-12, R-10 번호 변경, D-095).
// 이벤트마다 "그때 그 번호에 있던 상품"으로 돌린다. 번호 ↔ 상품은 코어가 정한다: 지금 상태의 listProducts(상품 ID·방송·번호)에서 시작해
// 기록을 뒤에서 앞으로 보며 번호를 바꾸는 두 이벤트의 결과(기록할 때 엔진이 낸 changed)만 되돌린다 — 판정을 다시 하지 않는다.
// - product.register가 상태를 바꿨다 = 그 번호에 상품이 새로 생겼다 → 그 앞에는 그 번호가 비어 있었다.
// - product.renumber가 상태를 바꿨다 = from의 상품이 to로 옮겨 갔다 → 그 앞에는 그 상품이 from에 있었고 to는 비어 있었다.
// - product.confirm이 상태를 바꿨고 최종 번호(to)가 처음 번호(no)와 다르다 = 번호 변경과 같다 (R-2 "확인 중", D-RETRO-80).
// - product.withdraw가 상태를 바꿨다 = 그 번호의 확인 중 상품이 없어졌다 → 그 앞에는 거둔 상품이 그 번호에 있었다.
//   거둔 상품은 지금 상태에 없으므로(상품 ID를 알 수 없다) 그 상품의 줄은 어느 상품에도 넣지 않는다.
// (상품 기록을 만들거나 옮기거나 없애는 이벤트는 이 넷뿐이다.)
// 돌리는 규칙:
// - product.register: 그 등록 뒤 그 번호에 있는 상품(새로 만든 상품, 이미 있었으면 그 상품).
// - product.renumber: 그때 from에 있던 상품(바뀐 상품).
// - 그 밖의 product.*·host.*(방송 b와 번호 no가 있는 것): 그때 그 번호에 있던 상품. 없었으면 그 뒤 그 번호에 처음 생긴 상품(등록 또는 번호 변경으로 들어온 상품 —
//   그 번호의 보류 찜은 그 상품의 공개 때 판정된다, R-5·R-10). 그 뒤에도 생기지 않았으면 어느 상품에도 넣지 않는다.

/** 한 줄 (seq 오름차순으로 넘긴다) */
export interface ActionRow {
  readonly type: string
  readonly event: Readonly<Record<string, unknown>>
  /** 기록할 때 엔진이 상태를 바꿨는지 */
  readonly changed: boolean
  readonly failed: boolean
}

/** 지금(마지막 줄 뒤) 상태의 상품 하나 (코어 listProducts) */
export interface CurrentProduct {
  readonly id: string
  readonly broadcast: string
  readonly no: number
}

const slot = (b: unknown, no: unknown): string | null =>
  typeof b === 'string' && typeof no === 'number' && Number.isSafeInteger(no) ? JSON.stringify([b, no]) : null

/**
 * 줄마다 그 줄을 돌릴 상품 ID (없으면 null). rows는 seq 오름차순이고 current는 마지막 줄 바로 뒤의 상태여야 한다
 * (rows보다 앞선 이벤트는 볼 필요가 없다 — 어떤 줄의 답은 그 뒤의 이벤트와 지금 상태로만 정해진다)
 */
export function productOwners(rows: readonly ActionRow[], current: readonly CurrentProduct[]): (string | null)[] {
  /** 지금 보고 있는 줄 바로 뒤의 번호 → 상품 */
  const at = new Map<string, string>()
  for (const product of current) {
    const key = slot(product.broadcast, product.no)
    if (key !== null) at.set(key, product.id)
  }
  /** 지금 보고 있는 줄 뒤에 그 번호에 처음 생긴 상품 */
  const next = new Map<string, string>()
  /** 거둔 상품의 자리표 (지금 상태에 없는 상품 — 줄 번호로 만든다. 상품 ID `p1`과 겹치지 않는다) */
  const gone = new Set<string>()
  const owners: (string | null)[] = new Array<string | null>(rows.length).fill(null)
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i] as ActionRow
    const { event } = row
    const applied = row.changed && !row.failed
    if (row.type === 'product.register') {
      const key = slot(event.b, event.no)
      if (key === null) continue
      const after = at.get(key) ?? null
      owners[i] = after
      if (applied && after !== null) {
        at.delete(key)
        // 거둔 상품이 생기기 전의 줄은 그 뒤 그 번호에 생긴 지금 있는 상품으로 간다 (그 번호의 보류 찜은 그 상품의 공개 때 판정된다)
        if (!gone.has(after)) next.set(key, after)
      }
      continue
    }
    if (row.type === 'product.withdraw') {
      const key = slot(event.b, event.no)
      if (key === null) continue
      if (applied) {
        const placeholder = `gone:${String(i)}`
        gone.add(placeholder)
        at.set(key, placeholder)
      }
      owners[i] = at.get(key) ?? next.get(key) ?? null
      continue
    }
    if (row.type === 'product.renumber' || (row.type === 'product.confirm' && event.to !== undefined && event.to !== event.no)) {
      const from = slot(event.b, row.type === 'product.confirm' ? event.no : event.from)
      const to = slot(event.b, event.to)
      if (from === null || to === null) continue
      if (applied && from !== to) {
        const moved = at.get(to)
        if (moved !== undefined) {
          at.delete(to)
          at.set(from, moved)
          if (!gone.has(moved)) next.set(to, moved)
        }
      }
      owners[i] = at.get(from) ?? next.get(from) ?? null
      continue
    }
    const key = slot(event.b, event.no)
    if (key === null) continue
    owners[i] = at.get(key) ?? next.get(key) ?? null
  }
  return owners.map((owner) => (owner !== null && gone.has(owner) ? null : owner))
}
