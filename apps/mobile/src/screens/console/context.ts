// 콘솔 화면 조각이 함께 쓰는 값 (웹 console-context와 같은 구실): 방송·범위 자료·이름 표기·쓰기 함수.
import type { LabelView } from '@livejjim/web/src/api/print-types.ts'
import { createContext, useContext } from 'react'
import type { WriteResult } from '@livejjim/web/src/api/types.ts'
import type { BuyerNames } from '../../lib/derive.ts'
import type { ScopeData } from '../../lib/scope-data.ts'

export interface ConsoleApi {
  readonly b: string
  readonly data: ScopeData
  readonly names: BuyerNames
  readonly ended: boolean
  readonly sealed: boolean
  /** 쓰기: 요청 번호를 붙여 보내고 응답 seq까지 따라잡는다 */
  readonly command: (event: Readonly<Record<string, unknown>>, requestId?: string) => Promise<WriteResult>
  /** 채팅 의심 표시 (D-V3-129): 번호 → 문장 ("채팅은 81번을 찾아요 …") */
  readonly doubts?: ReadonlyMap<number, string>
  /** 다른 길로 쓴 뒤(상품 목록 가져오기) 응답 seq까지 따라잡는다 */
  readonly sync?: (seq: number) => Promise<void>
  /** 상품 고르기 (현재 상품 칸) */
  readonly select: (key: string | null) => void
  readonly selected: string | null
  /** 쓰기 뒤 따라잡은 가장 새 범위 자료 (찜 삭제 뒤 승계 확인 — D-UX4-25). 없으면 data */
  readonly latest?: () => ScopeData
  /** 라벨 상태 낱말 (찜 ID → 낱말, 리허설·모르면 없음) */
  readonly labelsOff?: boolean
  readonly productLabels?: readonly LabelView[]
  /** 라벨은 켜져 있는데 이어진 프린터가 없다 — 라벨은 대기열에 쌓인다 (D-LBL-NOPRN-01) */
  readonly printerMissing?: boolean
  /** 라벨 뽑기를 켠다 (상품 자세히의 [라벨 뽑기 켜기] — D-LBL-NOPRN-01). 판매자만 */
  readonly turnLabelsOn?: () => Promise<void>
  readonly labelWords: ReadonlyMap<string, string>
}

export const ConsoleContext = createContext<ConsoleApi | null>(null)

export function useConsoleApi(): ConsoleApi {
  const api = useContext(ConsoleContext)
  if (api === null) throw new Error('콘솔 안에서만 쓴다')
  return api
}
