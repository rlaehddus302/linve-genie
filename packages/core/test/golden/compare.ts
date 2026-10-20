// expect 비교 규칙 (README "파서 사례 형식", "`expect` 비교 규칙").
// 적힌 것만 검사한다. 틀리면 Problem(경로·기대값·실제값)을 낸다. 비교가 하나라도 틀리면 불일치다.
import { EMPTY_SETTLEMENT, EXPECT_KEYS, VOICE_EXTRACT_KEYS, isPlainObject, type SuiteName } from './contract.ts'
import type { EffectView, GoldenSnapshot, MergeItemsView, MergePreviewView, Problem } from './types.ts'
import type { EffectExpect, Expect, MergeItemsExpect, MergePreviewExpect } from './validate.ts'

function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]))
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a).filter((k) => a[k] !== undefined)
    const keysB = Object.keys(b).filter((k) => b[k] !== undefined)
    return keysA.length === keysB.length && keysA.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
  }
  return false
}

function sortedCopy(values: readonly string[]): string[] {
  return [...values].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
}

/** 순서 무관, 개수까지 같음 */
function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  return deepEqual(sortedCopy(a), sortedCopy(b))
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

// ── 파서 ─────────────────────────────────────────────────────────────────

/** 파서 사례 하나의 out 비교. 경로는 `out`, `out.claims` 처럼 적는다. */
export function compareParserOutput(suite: SuiteName, expected: unknown, actual: unknown): Problem[] {
  switch (suite) {
    case 'chat': {
      if (!isPlainObject(actual) || !isPlainObject(expected)) return [{ path: 'out', expected, actual, message: '결과가 맵이 아니다' }]
      const problems: Problem[] = []
      for (const key of ['claims', 'cancels', 'mentions'] as const) {
        // 없는 키 = 빈 배열 (README)
        const want = own(expected, key) ?? []
        const got = own(actual, key) ?? []
        if (!Array.isArray(got) || !deepEqual(want, got)) problems.push({ path: `out.${key}`, expected: want, actual: got })
      }
      return problems
    }
    case 'amount':
    case 'korean-number':
      // null(해석 실패)과 숫자를 구분한다. undefined는 null이 아니다.
      return actual === expected ? [] : [{ path: 'out', expected, actual }]
    case 'quick-input': {
      if (!isPlainObject(actual) || !isPlainObject(expected)) return [{ path: 'out', expected, actual, message: '결과가 맵이 아니다' }]
      const problems: Problem[] = []
      // out에 없는 키는 실제 결과에도 없어야 한다(undefined는 없음으로 본다)
      const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
      for (const key of keys) {
        const want = own(expected, key)
        const got = own(actual, key)
        if (want === undefined && got === undefined) continue
        if (!deepEqual(want, got)) {
          problems.push({
            path: `out.${key}`,
            expected: want,
            actual: got,
            ...(want === undefined ? { message: 'out에 없는 키가 실제 결과에 있다' } : {}),
          })
        }
      }
      return problems
    }
    case 'voice-extract': {
      // README: 실제 결과는 정확히 네 키 { no, name, price, confidence }이고 네 값이 모두 같아야 한다. out에 적지 않은 no·name·price = null
      if (!isPlainObject(actual) || !isPlainObject(expected)) return [{ path: 'out', expected, actual, message: '결과가 맵이 아니다' }]
      const problems: Problem[] = []
      for (const key of Object.keys(actual)) {
        if (!(VOICE_EXTRACT_KEYS as readonly string[]).includes(key)) {
          problems.push({ path: `out.${key}`, expected: undefined, actual: actual[key], message: '실제 결과에 네 키(no·name·price·confidence) 밖의 키가 있다' })
        }
      }
      for (const key of VOICE_EXTRACT_KEYS) {
        const want = own(expected, key) ?? null
        if (!Object.hasOwn(actual, key)) {
          problems.push({ path: `out.${key}`, expected: want, actual: undefined, message: '실제 결과에 키가 없다' })
          continue
        }
        const got = actual[key]
        if (!deepEqual(want, got)) problems.push({ path: `out.${key}`, expected: want, actual: got })
      }
      return problems
    }
  }
}

// ── 엔진 ─────────────────────────────────────────────────────────────────

class Resolver {
  private readonly snapshot: GoldenSnapshot

  constructor(snapshot: GoldenSnapshot) {
    this.snapshot = snapshot
  }

  one(key: string): string | undefined {
    return own(this.snapshot.buyerKeys, key)
  }

  /** 모두 풀리면 ID 목록, 하나라도 안 풀리면 undefined와 안 풀린 키 */
  list(keys: readonly string[]): { ids: string[]; missing: string[] } {
    const ids: string[] = []
    const missing: string[] = []
    for (const key of keys) {
      const id = this.one(key)
      if (id === undefined) missing.push(key)
      else ids.push(id)
    }
    return { ids, missing }
  }
}

const unresolved = (missing: readonly string[]): string => `구매자 키를 풀 수 없다: ${missing.join(', ')}`

/** 보고용 효과 표시 (상태 제외, 적힌 필드만) */
export function effectForDisplay(effect: EffectView): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: effect.kind }
  for (const key of ['target', 'product', 'buyer', 'text', 'confirmVersion'] as const) {
    if (effect[key] !== undefined) out[key] = effect[key]
  }
  return out
}

function effectMatches(entry: EffectExpect, effect: EffectView, resolver: Resolver): boolean {
  if (entry.kind !== effect.kind) return false
  if (entry.target !== undefined && entry.target !== effect.target) return false
  if (entry.product !== undefined && entry.product !== effect.product) return false
  if (entry.text !== undefined && entry.text !== effect.text) return false
  if (entry.confirmVersion !== undefined && entry.confirmVersion !== effect.confirmVersion) return false
  if (entry.buyer !== undefined) {
    const id = resolver.one(entry.buyer)
    if (id === undefined || id !== effect.buyer) return false
  }
  return true
}

/** 최대 이분 매칭 (적힌 항목마다 서로 다른 실제 효과 하나). 반환: 항목별 짝의 번호(-1 = 짝 없음) */
function maxMatching(left: number, right: number, edge: (i: number, j: number) => boolean): number[] {
  const matchOfRight = new Array<number>(right).fill(-1)
  const tryAssign = (i: number, seen: boolean[]): boolean => {
    for (let j = 0; j < right; j++) {
      if (seen[j] || !edge(i, j)) continue
      seen[j] = true
      const holder = matchOfRight[j] ?? -1
      if (holder === -1 || tryAssign(holder, seen)) {
        matchOfRight[j] = i
        return true
      }
    }
    return false
  }
  for (let i = 0; i < left; i++) tryAssign(i, new Array<boolean>(right).fill(false))
  const matchOfLeft = new Array<number>(left).fill(-1)
  matchOfRight.forEach((i, j) => {
    if (i >= 0) matchOfLeft[i] = j
  })
  return matchOfLeft
}

/** 구매자 키 → 구매자 자신의 ID (S06b `mergePreviews`). 풀리지 않는 키는 그대로 (README `mergePreviews` 비교 규칙의 from·into) */
export function buyerSelfOf(snapshot: GoldenSnapshot, key: string): string {
  return own(snapshot.buyerSelf, key) ?? key
}

/** 적은 필드만: items는 집합(순서 무관, 정확히 같음), subtotal은 같은 값 */
function compareMergeItems(want: MergeItemsExpect, actual: MergeItemsView, base: string, push: (problem: Problem) => void): void {
  if (want.items !== undefined && !(isStringArray(actual.items) && sameMultiset(want.items, actual.items))) {
    push({ path: `${base}.items`, expected: want.items, actual: actual.items, message: '순서 무관 비교' })
  }
  if (want.subtotal !== undefined && want.subtotal !== actual.subtotal) push({ path: `${base}.subtotal`, expected: want.subtotal, actual: actual.subtotal })
}

/**
 * `mergePreviews` 항목 하나 (README `mergePreviews` 비교 규칙, S06b, D-100). 적은 필드만 비교한다.
 * duplicates는 { product, buyer, status } 집합이고 buyer는 구매자 자신으로 풀어 비교한다(지금의 구매자로 풀지 않는다).
 */
function compareMergePreview(want: MergePreviewExpect, actual: MergePreviewView | undefined, base: string, snapshot: GoldenSnapshot, push: (problem: Problem) => void): void {
  if (actual === undefined) {
    push({ path: base, expected: want, actual: undefined, message: '합치기 미리 보기 결과가 없다' })
    return
  }
  if (want.blocked !== undefined && want.blocked !== actual.blocked) push({ path: `${base}.blocked`, expected: want.blocked, actual: actual.blocked })
  if (want.bothConfirmed !== undefined && !(isStringArray(actual.bothConfirmed) && sameMultiset(want.bothConfirmed, actual.bothConfirmed))) {
    push({ path: `${base}.bothConfirmed`, expected: want.bothConfirmed, actual: actual.bothConfirmed, message: '순서 무관 비교' })
  }
  if (want.moving !== undefined) compareMergeItems(want.moving, actual.moving, `${base}.moving`, push)
  if (want.after !== undefined) {
    if (want.after === null || actual.after === null) {
      if (want.after !== actual.after) {
        push({ path: `${base}.after`, expected: want.after, actual: actual.after, message: want.after === null ? '막혀서 합친 뒤가 없어야 한다' : '막혀서 합친 뒤가 없다' })
      }
    } else compareMergeItems(want.after, actual.after, `${base}.after`, push)
  }
  if (want.duplicates !== undefined) {
    const line = (product: string, buyer: string, status: string): string => JSON.stringify([product, buyer, status])
    const wantKeys = want.duplicates.map((d) => line(d.product, buyerSelfOf(snapshot, d.buyer), d.status))
    const actualKeys = actual.duplicates.map((d) => line(d.product, d.buyer, d.status))
    if (!sameMultiset(wantKeys, actualKeys)) {
      push({ path: `${base}.duplicates`, expected: want.duplicates, actual: actual.duplicates, message: '중복이 될 찜 전체와 정확히 같아야 한다 (순서 무관, 구매자는 찜의 구매자 자신)' })
    }
  }
}

/** expect와 함께 비교하는, 스냅샷 밖에서 코어에 물어 얻은 값 */
export interface ExpectExtras {
  /** expect.mergePreviews 항목마다 코어 previewMerge 결과 (같은 순서) */
  readonly mergePreviews?: readonly MergePreviewView[]
}

/**
 * expect 전체를 스냅샷과 비교한다.
 * @param where 중간 검사면 `events[n]`, 마지막 expect면 undefined
 * @param extras 스냅샷 밖의 조회 결과 (합치기 미리 보기 — 러너가 그 시점 상태로 부른 것)
 */
export function compareExpect(expect: Expect, snapshot: GoldenSnapshot, where?: string, extras: ExpectExtras = {}): Problem[] {
  const problems: Problem[] = []
  const resolver = new Resolver(snapshot)
  const push = (problem: Problem): void => {
    problems.push(where === undefined ? problem : { where, ...problem })
  }

  for (const section of EXPECT_KEYS) {
    switch (section) {
      case 'broadcasts': {
        // 적은 필드만: date·title = 처음 선언한 값, ended = broadcast.end를 받았는지 (README 비교 규칙, S04)
        for (const [key, want] of Object.entries(expect.broadcasts ?? {})) {
          const base = `broadcasts.${key}`
          const broadcast = own(snapshot.broadcasts, key)
          if (broadcast === undefined) {
            push({ path: base, expected: want, actual: undefined, message: '그 방송이 없다' })
            continue
          }
          for (const field of ['date', 'title', 'ended'] as const) {
            if (want[field] !== undefined && want[field] !== broadcast[field]) push({ path: `${base}.${field}`, expected: want[field], actual: broadcast[field] })
          }
        }
        break
      }
      case 'products': {
        for (const [key, want] of Object.entries(expect.products ?? {})) {
          const product = own(snapshot.products, key)
          const base = `products.${key}`
          if (want.exists !== undefined && want.exists !== (product !== undefined)) {
            push({ path: `${base}.exists`, expected: want.exists, actual: product !== undefined })
          }
          const fields = Object.keys(want).filter((f) => f !== 'exists')
          if (product === undefined) {
            for (const field of fields) push({ path: `${base}.${field}`, expected: want[field as keyof typeof want], actual: undefined, message: '그 번호의 상품이 없다' })
            continue
          }
          if (want.status !== undefined && want.status !== product.status) push({ path: `${base}.status`, expected: want.status, actual: product.status })
          if (want.winner !== undefined) {
            if (want.winner === null) {
              if (product.winners.length !== 0) push({ path: `${base}.winner`, expected: null, actual: product.winners, message: '확정 구매자가 없어야 한다' })
            } else {
              const id = resolver.one(want.winner)
              if (id === undefined) push({ path: `${base}.winner`, expected: want.winner, actual: product.winners, message: unresolved([want.winner]) })
              else if (product.winners.length !== 1) {
                push({
                  path: `${base}.winner`,
                  expected: want.winner,
                  actual: product.winners,
                  message: product.winners.length === 0 ? '확정 구매자가 없다' : '확정 구매자가 2명 이상이다',
                })
              } else if (product.winners[0] !== id) push({ path: `${base}.winner`, expected: want.winner, actual: product.winners[0] })
            }
          }
          if (want.winners !== undefined) {
            const { ids, missing } = resolver.list(want.winners)
            if (missing.length > 0) push({ path: `${base}.winners`, expected: want.winners, actual: product.winners, message: unresolved(missing) })
            else if (!sameMultiset(ids, product.winners)) push({ path: `${base}.winners`, expected: want.winners, actual: product.winners, message: '순서 무관 비교' })
          }
          if (want.waitlist !== undefined) {
            const { ids, missing } = resolver.list(want.waitlist)
            if (missing.length > 0) push({ path: `${base}.waitlist`, expected: want.waitlist, actual: product.waitlist, message: unresolved(missing) })
            else if (!deepEqual(ids, product.waitlist)) push({ path: `${base}.waitlist`, expected: want.waitlist, actual: product.waitlist, message: '1순위부터 순서까지 같아야 한다' })
          }
          if (want.conflict !== undefined && want.conflict !== product.conflict) push({ path: `${base}.conflict`, expected: want.conflict, actual: product.conflict })
          if (want.price !== undefined && want.price !== product.price) push({ path: `${base}.price`, expected: want.price, actual: product.price })
          if (want.priceHistory !== undefined && !deepEqual(want.priceHistory, product.priceHistory)) {
            push({ path: `${base}.priceHistory`, expected: want.priceHistory, actual: product.priceHistory })
          }
        }
        break
      }
      case 'buyers': {
        for (const [key, want] of Object.entries(expect.buyers ?? {})) {
          const base = `buyers.${key}`
          const id = resolver.one(key)
          if (id === undefined) {
            push({ path: base, expected: want, actual: undefined, message: unresolved([key]) })
            continue
          }
          const buyer = own(snapshot.buyers, id)
          if (buyer === undefined) {
            push({ path: base, expected: want, actual: undefined, message: `구매자 기록이 없다 (ID ${id})` })
            continue
          }
          if (want.items !== undefined && !(isStringArray(buyer.items) && sameMultiset(want.items, buyer.items))) {
            push({ path: `${base}.items`, expected: want.items, actual: buyer.items, message: '순서 무관 비교' })
          }
          if (want.subtotal !== undefined && want.subtotal !== buyer.subtotal) push({ path: `${base}.subtotal`, expected: want.subtotal, actual: buyer.subtotal })
          if (want.byBroadcast !== undefined && !deepEqual(want.byBroadcast, buyer.byBroadcast)) {
            push({ path: `${base}.byBroadcast`, expected: want.byBroadcast, actual: buyer.byBroadcast })
          }
          if (want.display !== undefined && want.display !== buyer.display) push({ path: `${base}.display`, expected: want.display, actual: buyer.display })
          if (want.nameHistory !== undefined && !deepEqual(want.nameHistory, buyer.nameHistory)) {
            push({ path: `${base}.nameHistory`, expected: want.nameHistory, actual: buyer.nameHistory })
          }
          // 지금의 구매자 자신의 뒤 4자리 (README 비교 규칙, D-061)
          if (want.phoneLast4 !== undefined && want.phoneLast4 !== buyer.phoneLast4) push({ path: `${base}.phoneLast4`, expected: want.phoneLast4, actual: buyer.phoneLast4 })
        }
        break
      }
      case 'settlements': {
        for (const [key, want] of Object.entries(expect.settlements ?? {})) {
          const base = `settlements.${key}`
          const at = key.lastIndexOf('@')
          const buyerKey = key.slice(0, at)
          const date = key.slice(at + 1)
          const id = resolver.one(buyerKey)
          if (id === undefined) {
            push({ path: base, expected: want, actual: undefined, message: unresolved([buyerKey]) })
            continue
          }
          // 엔진이 보고하지 않은 묶음 = 품목 없는 묶음 (금액 전부 0, UNPAID)
          const actual = own(snapshot.settlements, `${id}@${date}`) ?? EMPTY_SETTLEMENT
          for (const field of ['subtotal', 'shipping', 'adjustments', 'total', 'refundDue', 'payment'] as const) {
            if (want[field] !== undefined && want[field] !== actual[field]) push({ path: `${base}.${field}`, expected: want[field], actual: actual[field] })
          }
        }
        break
      }
      case 'effects': {
        const entries = expect.effects ?? []
        if (entries.length === 0) break
        const effects = snapshot.effects
        const matching = maxMatching(entries.length, effects.length, (i, j) => effectMatches(entries[i] as EffectExpect, effects[j] as EffectView, resolver))
        matching.forEach((j, i) => {
          if (j !== -1) return
          const entry = entries[i] as EffectExpect
          push({
            path: `effects[${i}]`,
            expected: entry,
            actual: effects.filter((e) => e.kind === entry.kind).map(effectForDisplay),
            message: '적은 필드가 모두 같은 서로 다른 효과가 없다 (실제 값은 같은 종류의 효과 전부)',
          })
        })
        break
      }
      case 'effectCounts': {
        for (const [kind, count] of Object.entries(expect.effectCounts ?? {})) {
          const actual = snapshot.effects.filter((e) => e.kind === kind).length
          if (actual !== count) push({ path: `effectCounts.${kind}`, expected: count, actual })
        }
        break
      }
      case 'pendingEffects': {
        if (expect.pendingEffects === undefined) break
        const entries = expect.pendingEffects
        const pending = snapshot.effects.filter((e) => e.status === 'PENDING')
        const matching = maxMatching(entries.length, pending.length, (i, j) => effectMatches(entries[i] as EffectExpect, pending[j] as EffectView, resolver))
        const complete = entries.length === pending.length && matching.every((j) => j !== -1)
        if (!complete) {
          push({
            path: 'pendingEffects',
            expected: entries,
            actual: pending.map(effectForDisplay),
            message: '아직 실행 대상인 효과 전체와 정확히 같아야 한다 (순서 무관)',
          })
        }
        break
      }
      case 'claims': {
        for (const [i, entry] of (expect.claims ?? []).entries()) {
          const base = `claims[${i}]`
          const id = resolver.one(entry.buyer)
          if (id === undefined) {
            push({ path: base, expected: entry, actual: undefined, message: unresolved([entry.buyer]) })
            continue
          }
          // 같은 (상품, 구매자)의 찜이 여럿이면 가장 최근 것
          const latest = snapshot.claims.findLast((claim) => claim.product === entry.product && claim.buyer === id)
          if (latest === undefined) {
            push({ path: base, expected: entry, actual: undefined, message: '그 상품·구매자의 찜이 없다' })
            continue
          }
          if (latest.status !== entry.status) push({ path: `${base}.status`, expected: entry.status, actual: latest.status })
          if (entry.reason !== undefined && latest.reason !== entry.reason) push({ path: `${base}.reason`, expected: entry.reason, actual: latest.reason })
        }
        break
      }
      case 'pending': {
        for (const [key, want] of Object.entries(expect.pending ?? {})) {
          const actual = own(snapshot.pending, key) ?? []
          const { ids, missing } = resolver.list(want)
          if (missing.length > 0) push({ path: `pending.${key}`, expected: want, actual, message: unresolved(missing) })
          else if (!deepEqual(ids, actual)) push({ path: `pending.${key}`, expected: want, actual, message: '판정 순위 순서까지 같아야 한다' })
        }
        break
      }
      case 'sameBuyer': {
        for (const [i, group] of (expect.sameBuyer ?? []).entries()) {
          const ids = group.map((key) => resolver.one(key))
          const first = ids[0]
          if (first === undefined || ids.some((id) => id !== first)) {
            push({ path: `sameBuyer[${i}]`, expected: group, actual: ids, message: '모든 키가 같은 구매자로 풀려야 한다' })
          }
        }
        break
      }
      case 'claimCount': {
        if (expect.claimCount !== undefined && expect.claimCount !== snapshot.claims.length) {
          push({ path: 'claimCount', expected: expect.claimCount, actual: snapshot.claims.length })
        }
        break
      }
      case 'cancelRequests': {
        if (expect.cancelRequests === undefined) break
        const want = expect.cancelRequests
        const { missing } = resolver.list(want.map((r) => r.buyer))
        const actual = snapshot.cancelRequests
        if (missing.length > 0) {
          push({ path: 'cancelRequests', expected: want, actual, message: unresolved(missing) })
          break
        }
        const wantKeys = want.map((r) => `${r.product}\u0000${resolver.one(r.buyer) ?? ''}`)
        const actualKeys = actual.map((r) => `${r.product}\u0000${r.buyer}`)
        if (!sameMultiset(wantKeys, actualKeys)) push({ path: 'cancelRequests', expected: want, actual, message: '처리 대기 요청 전체와 정확히 같아야 한다 (순서 무관)' })
        break
      }
      case 'mergePreviews': {
        for (const [i, entry] of (expect.mergePreviews ?? []).entries()) compareMergePreview(entry, extras.mergePreviews?.[i], `mergePreviews[${i}]`, snapshot, push)
        break
      }
    }
  }
  return problems
}
