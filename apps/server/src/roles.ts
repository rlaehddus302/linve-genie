// 계정 역할과 보조자 허용 목록 (SYS-04, D-I3-11, AC-I3-61).
// - 판매자(SELLER)는 지금과 같다. 보조자(ASSISTANT)는 문자찜 입력 화면이 쓰는 것만 — 아래 목록 밖의 경로는 모두 403 ASSISTANT_FORBIDDEN이다.
//   목록은 "허용"만 적는다: 나중에 경로를 더해도 따로 막지 않아도 막힌다(기본 거부).
// - 이벤트 쓰기는 종류도 본다: 실제 방송의 문자찜(sms)과, 그 번호에서 그 구매자의 지금 찜이 문자찜으로 생긴 찜일 때의 방송자 취소(host.cancel)만.
//   "문자찜으로 생긴 찜"은 그 범위의 지금 상태를 코어 조회 함수(activeClaimId·listClaims)로 읽어 정한다 — 서버에 판정을 복제하지 않는다(AC-I3-99).
import { activeClaimId, listClaims, type EngineEvent, type EngineState } from '@livejjim/core'
import type { Rejection } from './writer.ts'

export type AccountRole = 'SELLER' | 'ASSISTANT'

export const ASSISTANT_FORBIDDEN_MESSAGE = '보조자 계정으로는 할 수 없는 일이에요.'

export const assistantForbidden = (): Rejection => ({ status: 403, code: 'ASSISTANT_FORBIDDEN', message: ASSISTANT_FORBIDDEN_MESSAGE, problems: [] })

/** 보조자가 쓸 수 있는 이벤트 종류 */
export const ASSISTANT_EVENT_TYPES: readonly string[] = ['sms', 'host.cancel']

/** 보조자가 부를 수 있는 경로 (메서드 · 경로 모양). HEAD는 GET과 같다 */
const ASSISTANT_ROUTES: readonly { readonly method: 'GET' | 'POST'; readonly path: RegExp }[] = [
  { method: 'GET', path: /^\/api\/me$/ },
  { method: 'GET', path: /^\/api\/client-config$/ },
  { method: 'GET', path: /^\/api\/broadcasts$/ },
  { method: 'GET', path: /^\/api\/days$/ },
  { method: 'GET', path: /^\/api\/days\/[^/]+$/ },
  { method: 'GET', path: /^\/api\/days\/[^/]+\/changes$/ },
  { method: 'GET', path: /^\/api\/stream$/ },
  { method: 'POST', path: /^\/api\/logout$/ },
  { method: 'POST', path: /^\/api\/events$/ },
  // 댓글 붙여넣기 — 문자찜 입력과 같은 권한 (실제 회차만 — 리허설은 처리기가 403, D-N2b-2-08)
  { method: 'POST', path: /^\/api\/broadcasts\/[^/]+\/paste\/preview$/ },
  { method: 'POST', path: /^\/api\/broadcasts\/[^/]+\/paste$/ },
]

/** 보조자 세션이 이 요청을 할 수 있는지 (경로·메서드, 리허설 범위 조회는 안 됨) */
export function assistantMayCall(method: string, path: string, rehearsalQuery: string | undefined): boolean {
  const verb = method === 'HEAD' ? 'GET' : method
  if (rehearsalQuery !== undefined && rehearsalQuery !== 'false') return false
  return ASSISTANT_ROUTES.some((route) => route.method === verb && route.path.test(path))
}

/**
 * 보조자의 방송자 취소: 그 번호에서 대상 구매자(지금의 구매자)의 활성 찜이 문자찜으로 생긴 찜일 때만 (기록 트랜잭션 안의 지금 상태로)
 */
export function assistantCancelCheck(state: EngineState, event: EngineEvent): Rejection | null {
  const fields = event as unknown as { readonly b?: unknown; readonly no?: unknown; readonly buyer?: unknown }
  if (typeof fields.b !== 'string' || typeof fields.no !== 'number' || typeof fields.buyer !== 'string') return assistantForbidden()
  const id = activeClaimId(state, fields.b, fields.no, fields.buyer)
  if (id === null) return assistantForbidden()
  const claim = listClaims(state).find((item) => item.id === id)
  return claim?.origin === 'sms' ? null : assistantForbidden()
}
