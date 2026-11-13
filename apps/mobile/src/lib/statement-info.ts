// 정산 정보 (D-RETRO-60·61): 정산서에 찍는 계좌·전화번호·방송 이름과 배송비 규칙을 서버에서 받아 기억한다.
// - 서버가 이 주소를 아직 모르면(앱 화면이 먼저 올라간 때) 계좌·전화번호 줄 없이 기본 배송비(5만 원 미만 5,000원)로 만든다 — 묻지도 않는다.
// - 다른 까닭으로 못 받으면 정산서를 만들지 않는다(받지 않기로 한 배송비가 붙어 손님에게 나가지 않게).
// - "처음 한 번 묻기"를 건너뛴 기억은 화면 자료 기억에 둔다 — 로그아웃·다른 계정이면 같이 지워진다.
import { STATEMENT_SHIPPING_DEFAULT, statementInfoMissing, type StatementInfo } from './broadcast-sales.ts'
import { peekCached, rememberCached, useCachedGet } from './cached-get.ts'

export const STATEMENT_INFO_PATH = '/api/statement-info'

/** 서버가 정산 정보를 모를 때 쓰는 값: 빈 칸 · 기본 배송비 */
export const NO_STATEMENT_INFO: StatementInfo = { bank: '', accountNumber: '', accountHolder: '', phone: '', hostName: '', shipping: STATEMENT_SHIPPING_DEFAULT, decided: false }

export interface StatementInfoState {
  /** 받은 정산 정보. 아직 못 받았으면 null */
  readonly info: StatementInfo | null
  /** 이 서버에서 고칠 수 있나 (옛 서버면 거짓 — 묻지 않는다) */
  readonly editable: boolean
  /** 받지 못했다 — 다시 받기 단추를 보인다 */
  readonly failed: boolean
  readonly reload: () => void
}

export function useStatementInfo(): StatementInfoState {
  const { data, error, reload } = useCachedGet<{ info: StatementInfo }>(STATEMENT_INFO_PATH)
  const retry = () => void reload()
  if (data !== null) return { info: data.info, editable: true, failed: false, reload: retry }
  if (error !== null && error.status === 404) return { info: NO_STATEMENT_INFO, editable: false, failed: false, reload: retry }
  return { info: null, editable: false, failed: error !== null, reload: retry }
}

/** 저장한 정산 정보를 기억에 넣는다 — 열려 있는 정산서가 바로 바뀐다 */
export function rememberStatementInfo(info: StatementInfo): void {
  rememberCached(STATEMENT_INFO_PATH, { info })
}

/** 언제 묻나: 방송을 끝낸 직후(end) · 정산서를 처음 만들 때(first) */
export type AskMoment = 'end' | 'first'
const askedKey = (moment: AskMoment, broadcastId: string): string => (moment === 'end' ? `app:statement-asked:end:${broadcastId}` : 'app:statement-asked:first')

/**
 * 지금 정산 정보 화면을 띄울까.
 * - 방송을 끝낸 직후: 한 번도 정하지 않았거나 계좌·전화번호가 비어 있으면 (그 방송에 한 번)
 * - 정산서를 처음 만들 때: 한 번도 정하지 않았으면 (앱을 켠 동안 한 번 — [나중에]를 누르면 다시 묻지 않는다)
 */
export function shouldAskStatementInfo(moment: AskMoment, broadcastId: string, state: Pick<StatementInfoState, 'info' | 'editable'>): boolean {
  if (state.info === null || !state.editable) return false
  if (peekCached<boolean>(askedKey(moment, broadcastId)) === true) return false
  return moment === 'end' ? statementInfoMissing(state.info) : !state.info.decided
}

/** 물었다고 적어 둔다 (끝낸 직후에 물었으면 "처음 만들 때"도 다시 묻지 않는다) */
export function markStatementInfoAsked(moment: AskMoment, broadcastId: string): void {
  rememberCached(askedKey(moment, broadcastId), true)
  if (moment === 'end') rememberCached(askedKey('first', broadcastId), true)
}

/** 보낸 손님 표시 (연속 보내기, D-RETRO-64): 방송마다 이 기기에서 문자 앱을 열어 보낸 손님 */
const sentKey = (broadcastId: string): string => `app:statement-sent:${broadcastId}`
export function sentBuyers(broadcastId: string): readonly string[] {
  return peekCached<readonly string[]>(sentKey(broadcastId)) ?? []
}
export function markBuyerSent(broadcastId: string, buyer: string): readonly string[] {
  const next = [...new Set([...sentBuyers(broadcastId), buyer])]
  rememberCached(sentKey(broadcastId), next)
  return next
}
