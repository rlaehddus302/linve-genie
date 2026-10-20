// 입금 맞추기 (DEPOSIT_RULES DP-5, 후보 묶음의 날짜 범위·판매 시각 DP-4, D-N3-02·D-N3-06·D-N3-07, 골든 tests/golden/deposit/match.json — AC-N3-03).
// 서버의 자동 확인(받을 때)과 확인 필요 조회(볼 때 다시 계산)가 모두 이 함수를 부른다 — 규칙을 다른 곳에 다시 구현하지 않는다.
// 순수 함수: 시계·난수·실행 환경 시간대·Intl·localeCompare를 쓰지 않는다(정렬은 문자 코드 순). 같은 입력에 늘 같은 출력이다.
import { addDays, kstDateOf } from './calendar.ts'
import { normalizeDepositName } from './name.ts'

/** 후보가 될 수 있는 묶음 (서버가 실제 범위에서 모은 것) */
export interface MatchBundle {
  /** 묶음 키 (지금의 구매자·날짜 — 함수는 글자로만 다룬다) */
  readonly key: string
  /** 지금의 구매자 ID */
  readonly buyer: string
  /** 묶음 날짜 YYYY-MM-DD */
  readonly date: string
  /** 이름 후보 (정규화 전 글 — 함수가 DP-3으로 정규화한다) */
  readonly names: readonly string[]
  readonly total: number
  readonly received: number
  /** 판매 시각 (UTC 밀리초). 품목이 없으면 null — 후보가 아니다 */
  readonly saleAt: number | null
}

/** 입금 하나 */
export interface MatchDeposit {
  readonly no: number
  /** 거래 시각 (UTC 밀리초 — 분까지만 있으면 그 분의 0초) */
  readonly at: number
  readonly amount: number
  readonly name: string
}

export type ReviewReason = 'POSSIBLE_DUPLICATE' | 'SAME_NAME' | 'MULTIPLE' | 'NAME_MISMATCH' | 'AMOUNT_MISMATCH' | 'NO_MATCH'

/** 입금 하나를 정한 결과 (골든 `out`의 한 줄) */
export type MatchOutcome =
  | { readonly no: number; readonly auto: string }
  | { readonly no: number; readonly review: ReviewReason; readonly twin?: number; readonly suggestions: readonly string[]; readonly preselect: string | null }

/** 입금 하나의 자세한 판단 — 자동 확인이어도 제안을 함께 낸다(볼 때 다시 계산한 결과의 `ONE_MATCH`가 그 묶음을 미리 고른다) */
export interface Evaluation {
  readonly no: number
  /** 자동 확인할 묶음 키 (DP-5 3번 줄), 아니면 null */
  readonly auto: string | null
  /** 확인 필요 사유 (자동 확인이면 null) */
  readonly reason: ReviewReason | null
  /** 가장 앞선 쌍둥이의 입금 번호 (POSSIBLE_DUPLICATE일 때만) */
  readonly twin: number | null
  /** 제안 묶음 키 (세 단 순서, 5개까지) */
  readonly suggestions: readonly string[]
  /** 미리 고른 묶음 키 (세 단을 합친 제안이 정확히 하나일 때, 자동 확인이면 그 묶음) */
  readonly preselect: string | null
}

/** 제안 수 상한 */
export const SUGGESTIONS_MAX = 5
/** 후보 묶음의 날짜 범위: 입금 날짜 − 30일 ~ 입금 날짜 (DP-4) */
export const MATCH_DAYS_BACK = 30

interface Prepared {
  readonly bundle: MatchBundle
  readonly names: ReadonlySet<string>
}

/** 같은 단 안의 순서: 날짜가 늦은 것 먼저, 같으면 지금의 구매자 ID의 문자 코드 순 */
function byDateThenBuyer(a: Prepared, b: Prepared): number {
  if (a.bundle.date !== b.bundle.date) return a.bundle.date < b.bundle.date ? 1 : -1
  if (a.bundle.buyer !== b.bundle.buyer) return a.bundle.buyer < b.bundle.buyer ? -1 : 1
  return a.bundle.key < b.bundle.key ? -1 : a.bundle.key > b.bundle.key ? 1 : 0
}

function prepare(bundles: readonly MatchBundle[]): Prepared[] {
  return bundles.map((bundle) => {
    const names = new Set<string>()
    for (const name of bundle.names) {
      const normalized = normalizeDepositName(name)
      if (normalized !== '') names.add(normalized)
    }
    return { bundle, names }
  })
}

/**
 * 입금 하나를 정한다 (DP-5 표). received = 묶음 키 → 지금 받은 금액(자동으로 정한 입금을 더한 값), before = 이 입금보다 먼저 저장된 입금 전부(쌍둥이 후보).
 */
function evaluate(prepared: readonly Prepared[], received: ReadonlyMap<string, number>, before: readonly MatchDeposit[], deposit: MatchDeposit): Evaluation {
  const n = normalizeDepositName(deposit.name)
  const a = deposit.amount
  const day = kstDateOf(deposit.at)
  const from = addDays(day, -MATCH_DAYS_BACK)
  const remaining = (item: Prepared): number => item.bundle.total - (received.get(item.bundle.key) ?? item.bundle.received)
  const named = (item: Prepared): boolean => n !== '' && item.names.has(n)
  // 후보 묶음 E(d): 날짜 범위 안, 품목이 있고 판매 시각 ≤ 입금 시각
  const candidates = prepared.filter((item) => item.bundle.saleAt !== null && item.bundle.date >= from && item.bundle.date <= day && item.bundle.saleAt <= deposit.at)
  const sameName = new Set(candidates.filter(named).map((item) => item.bundle.buyer))
  const amountMatch = candidates.filter((item) => remaining(item) === a)
  const bothMatch = amountMatch.filter(named)
  let twin: number | null = null
  if (n !== '') {
    for (const other of before) {
      if (other.amount === a && kstDateOf(other.at) === day && normalizeDepositName(other.name) === n && (twin === null || other.no < twin)) twin = other.no
    }
  }
  // 제안: 1단 = M, 2단 = A 중 M이 아닌 것, 3단 = 이름이 맞고 남은 금액이 다른 묶음
  const tier1 = [...bothMatch].sort(byDateThenBuyer)
  const tier2 = amountMatch.filter((item) => !named(item)).sort(byDateThenBuyer)
  const tier3 = candidates.filter((item) => named(item) && remaining(item) !== a).sort(byDateThenBuyer)
  const all = [...tier1, ...tier2, ...tier3].map((item) => item.bundle.key)
  const suggestions = all.slice(0, SUGGESTIONS_MAX)
  const single = all.length === 1 ? (all[0] as string) : null
  const review = (reason: ReviewReason): Evaluation => ({ no: deposit.no, auto: null, reason, twin: reason === 'POSSIBLE_DUPLICATE' ? twin : null, suggestions, preselect: single })
  if (twin !== null) return review('POSSIBLE_DUPLICATE')
  if (sameName.size >= 2) return review('SAME_NAME')
  if (bothMatch.length === 1) {
    const key = (bothMatch[0] as Prepared).bundle.key
    return { no: deposit.no, auto: key, reason: null, twin: null, suggestions, preselect: key }
  }
  if (bothMatch.length >= 2) return review('MULTIPLE')
  if (amountMatch.length >= 1) return review('NAME_MISMATCH')
  if (sameName.size === 1) return review('AMOUNT_MISMATCH')
  return review('NO_MATCH')
}

/**
 * 새 입금을 주어진 순서대로 하나씩 정한다. 자동으로 정한 입금은 그 묶음의 받은 금액에 더한 뒤 다음 입금을 정한다
 * (같은 묶음이 두 번 자동으로 채워지지 않게). 쌍둥이는 earlier 전부와 이번 목록에서 그 입금 앞의 것에서 찾는다.
 */
export function evaluateDeposits(input: { readonly bundles: readonly MatchBundle[]; readonly earlier: readonly MatchDeposit[]; readonly incoming: readonly MatchDeposit[] }): Evaluation[] {
  const prepared = prepare(input.bundles)
  const received = new Map<string, number>()
  for (const item of prepared) received.set(item.bundle.key, item.bundle.received)
  const before: MatchDeposit[] = [...input.earlier]
  const out: Evaluation[] = []
  for (const deposit of input.incoming) {
    const result = evaluate(prepared, received, before, deposit)
    if (result.auto !== null) received.set(result.auto, (received.get(result.auto) ?? 0) + deposit.amount)
    out.push(result)
    before.push(deposit)
  }
  return out
}

/** 골든 모양의 결과 (`out`): 자동 확인이면 { no, auto }, 아니면 { no, review, twin?, suggestions, preselect } */
export function matchDeposits(input: { readonly bundles: readonly MatchBundle[]; readonly earlier: readonly MatchDeposit[]; readonly incoming: readonly MatchDeposit[] }): MatchOutcome[] {
  return evaluateDeposits(input).map((result) => {
    if (result.auto !== null) return { no: result.no, auto: result.auto }
    const reason = result.reason as ReviewReason
    return {
      no: result.no,
      review: reason,
      ...(reason === 'POSSIBLE_DUPLICATE' && result.twin !== null ? { twin: result.twin } : {}),
      suggestions: result.suggestions,
      preselect: result.preselect,
    }
  })
}
