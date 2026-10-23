// 옵션 없는 상품의 "개수" 칸 (ORD-11 화면, AC-ORD11-01~09, D-STK-01).
// 빠른 입력 한 줄 문법(R-16)에는 개수를 넣지 않는다 — 개수는 이 칸으로만 정한다. 기본 1, 1~999 정수.
// 늘림·줄임은 R-10 그대로이고, 확정 수보다 적게 줄이는 것은 화면이 먼저 막는다.
import type { Product } from '../api/types.ts'

export const DEFAULT_COUNT = '1'
export const COUNT_MAX = 999

/** AC-ORD11-04 */
export const COUNT_PROBLEM = '개수는 1~999개로 적어 주세요.'

/** 칸 글자 → 개수. 1~999의 정수만 (0·1000·`2.5`·빈칸·글자는 null) */
export function readCount(text: string): number | null {
  const trimmed = text.trim()
  if (!/^[0-9]{1,3}$/.test(trimmed)) return null
  const value = Number(trimmed)
  return value >= 1 && value <= COUNT_MAX ? value : null
}

/** 확정 수보다 적게 줄이려 할 때 (AC-ORD11-06) */
export function shrinkProblem(confirmed: number): string {
  return `이미 ${String(confirmed)}명이 찜해서 ${String(confirmed)}개보다 적게 줄일 수 없어요. 먼저 찜을 무효로 해 주세요.`
}

/** 이 개수로 고칠 수 있나: 확정 수보다 적으면 그 문장 (R-10) */
export function stockProblem(product: Product, stock: number): string | null {
  return stock < product.confirmedUnits ? shrinkProblem(product.confirmedUnits) : null
}

/** "3개 중 1개 남음" — 옵션 없는 재고 2 이상 상품만 (재고 1이면 null, AC-ORD11-07) */
export function stockLeftWords(product: Product): string | null {
  if (product.hasOptions || product.stock < 2) return null
  const left = Math.max(0, product.stock - product.confirmedUnits)
  return `${String(product.stock)}개 중 ${String(left)}개 남음`
}
