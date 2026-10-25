// 판매 이력 사전의 지난 범위 (VOC-03, D-I4-06, AC-I4-40): 이미 있는 범위 조회만 쓴다(서버 작업 없음).
// GET /api/days(실제 범위 목록) → 지금 범위를 뺀 실제 범위 중 날짜가 가장 늦은 10개 → 날짜마다 GET /api/days/:date 의 상품 이름.
// 음성을 켤 때만 부른다(켜기 전에는 이력 조회 0번). 하나라도 받지 못하면 실패다 — 콘솔은 지금 범위 + 기본 사전으로 계속한다.
import { get, isApiError } from '../api/client.ts'
import { pickHistoryDays, type DayRef } from '../lib/voice.ts'
import type { PastDay } from './controller.ts'

export async function fetchPastNames(current: { readonly date: string; readonly rehearsal: boolean }): Promise<PastDay[]> {
  const list = await get<{ days?: readonly DayRef[] }>('/api/days')
  const dates = pickHistoryDays(Array.isArray(list.days) ? list.days : [], current)
  const views = await Promise.all(
    dates.map((date) =>
      get<{ products?: unknown }>(`/api/days/${date}`).catch((error: unknown) => {
        // 목록과 조회 사이에 범위가 없어졌으면(404) 이름이 없는 날로 본다
        if (isApiError(error) && error.status === 404) return { products: [] as unknown }
        throw error
      }),
    ),
  )
  return dates.map((date, index) => {
    const products: unknown = views[index]?.products
    const names: string[] = []
    if (Array.isArray(products)) {
      for (const product of products as readonly unknown[]) {
        const name = typeof product === 'object' && product !== null ? (product as { name?: unknown }).name : undefined
        if (typeof name === 'string') names.push(name)
      }
    }
    return { date, names }
  })
}

/** 판매자 품종 사전 (GET /api/voice/seller-names — 판매자 채팅에서 배운 이름, R-23·D-V3-49). 글자만 걸러 낸다(화면은 글자로만 그린다) */
export async function fetchSellerNames(): Promise<string[]> {
  const body = await get<{ names?: unknown }>('/api/voice/seller-names')
  const names = Array.isArray(body.names) ? (body.names as readonly unknown[]) : []
  return names.filter((name): name is string => typeof name === 'string' && name.trim() !== '' && [...name].length <= 20)
}
