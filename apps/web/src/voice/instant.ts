// V3 바로 등록 (VOC-04·PRD-06, R-17 8·R-22, D-V3-01~D-V3-21): 번호('N번')와 가격('…원')이 들리는 순간 등록하고, 이미 있는 번호는 무시·바로 고침·묻기.
// 판단은 음성 패키지(readRegistration·decideForExisting) — 이 파일은 화면 문장(D-V3-17)과 저장값 읽기만, 순수 함수다.
import { formatWon } from '@livejjim/core'

/** 저장 키 (같은 음성 설정 저장값 `livejjim.voiceSettings` 안, 기본 켬 — 끈 때만 false로 남긴다, D-V3-16) */
export const INSTANT_KEY = 'voice.autoRegister'
/** 설정 칸 글 (D-V3-17) */
export const INSTANT_LABEL = '번호와 가격이 들리면 바로 등록'
export const INSTANT_HELP = "'○○번'과 '○○원'이 들리면 그 자리에서 등록해요. 같은 번호를 다시 말하면 새로 만들지 않고, 찜이 없는 상품은 들은 대로 고쳐요. 등록 뒤 5초 안에 되돌릴 수 있어요."
/** 처음 켤 때 안내 창 한 줄 (D-V3-17) */
export const INSTANT_CONSENT_LINE = '번호와 가격이 들리면 바로 등록돼요. 음성 설정에서 끌 수 있어요.'
/** 음성 기록 까닭 */
export const LOG_INSTANT = '번호와 가격이 들려 바로 등록했어요'
export const LOG_INSTANT_DONE = '같은 말에서 바로 등록한 번호예요'
export const LOG_ALREADY = '이미 등록됨'
export const LOG_PENDING = '등록하는 중인 번호라 등록이 끝난 뒤 다시 봐요'
export const LOG_AUTO_FIX = '이미 등록된 번호라 들린 값으로 고쳤어요'
export const LOG_ASK = '이미 등록된 번호라 고칠지 물었어요'
export const LOG_MERGED = '같은 번호 카드가 열려 있어 그 카드에 합쳤어요'
export const LOG_TOUCHED = '고치는 중인 카드라 바꾸지 않았어요'
export const LOG_UNDONE = '취소가 들려 등록을 되돌렸어요'
/** 빠진 0을 되살린 번호 (실방송 "36번" = 306번) — 큰 글자 칸·기록 끝에 붙인다 */
export const droppedZeroNote = (heard: number, fixed: number): string => `${String(heard)}번으로 들려 ${String(fixed)}번으로 봤어요`
/** 고치지 못했을 때 (D-V3-07 — V2 문장) */
export const AUTO_FIX_FAILED = '고치지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.'
/** 묻기 카드의 까닭 줄 (D-V3-06) */
export const REASON_CLAIMS = '찜이 있는 상품이라 저절로 고치지 않았어요.'
export const REASON_NOT_OPEN = '판매 중이 아닌 상품이라 저절로 고치지 않았어요.'
export const REASON_PRICE_NOT_SURE = "가격 끝에 '원'이 들리지 않아 저절로 고치지 않았어요."
export const REASON_BARE_NUMBER = "번호를 '번' 없이 들어 저절로 고치지 않았어요."
/** 같은 번호 가격 고침 문턱 (실방송 333번): 다른 가격을 한 번만 들었을 때 — 묻기 카드 까닭 줄 */
export const REASON_PRICE_ONCE = '다른 가격이 한 번만 들려 저절로 고치지 않았어요.'
/** 중간·최종 가격 다름 (R-17 8, D-V3-103 — 실방송 경성 63번): 같은 크롬 결과의 중간 글과 최종 글 가격이 다를 때 — 묻기·제안 카드 까닭 줄 */
export const interimFinalNote = (interim: number, final: number): string => `듣는 중엔 ${formatWon(interim)}, 마지막엔 ${formatWon(final)}으로 들렸어요.`
/** 음성 기록 까닭 — 중간·최종 가격 다름 */
export const LOG_INTERIM_FINAL = '중간·최종 가격이 달라 바로 하지 않고 물었어요'
/** 음성 기록 까닭 — 고침 후보(고치지 않음) */
export const LOG_FIX_CANDIDATE = '고침 후보: 다른 가격이 한 번만 들려 그대로 두고 물었어요'
/** 음성 기록 까닭 — 번호 흐름 밖의 '번' 없는 수 */
export const LOG_BARE_OFF_RUN = "앞 번호들과 멀어 '번' 없는 수를 번호로 쓰지 않았어요"

/** 저장값에서 바로 등록 켬/끔 (없거나 모르는 값은 켬, 옛 `voice.autoConfirm`은 읽지 않는다 — D-V3-16) */
export function readInstant(stored: unknown): boolean {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return true
  return (stored as Record<string, unknown>)[INSTANT_KEY] !== false
}

/** 고칠 값 (지금과 같은 값은 뺀다) */
export interface InstantChanges {
  readonly name?: string
  readonly price?: number
}

export function pickChanges(current: { readonly name: string; readonly price: number }, next: { readonly name: string | null; readonly price: number | null }): InstantChanges {
  const out: { name?: string; price?: number } = {}
  if (next.price !== null && next.price !== current.price) out.price = next.price
  if (next.name !== null && next.name !== '' && next.name !== current.name) out.name = next.name
  return out
}

/** "가격 100,000원 → 120,000원, 품종 없음 → 핑크프릴" */
export function changeWords(current: { readonly name: string; readonly price: number }, changes: InstantChanges): string {
  const parts: string[] = []
  if (changes.price !== undefined) parts.push(`가격 ${formatWon(current.price)} → ${formatWon(changes.price)}`)
  if (changes.name !== undefined) parts.push(`품종 ${current.name === '' ? '없음' : current.name} → ${changes.name}`)
  return parts.join(', ')
}

/** 바로 고친 뒤: "108번을 고쳤어요: 가격 100,000원 → 120,000원" */
export function fixedMessage(no: number, current: { readonly name: string; readonly price: number }, changes: InstantChanges): string {
  return `${String(no)}번을 고쳤어요: ${changeWords(current, changes)}`
}

/** 고치는 중 */
export function fixingMessage(no: number, current: { readonly name: string; readonly price: number }, changes: InstantChanges): string {
  return `${String(no)}번을 고치는 중이에요: ${changeWords(current, changes)}`
}

/** 묻기: "108번을 고칠까요? 가격 100,000원 → 120,000원" */
export function askMessage(no: number, current: { readonly name: string; readonly price: number }, changes: InstantChanges): string {
  return `${String(no)}번을 고칠까요? ${changeWords(current, changes)}`
}

/** 바로 등록 뒤 큰 글자 칸: "108번 100,000원 등록했어요", 사전 이름이 있으면 "180번 삼광색금 350,000원 등록했어요" (D-V3-37) */
export function registeredReadout(no: number, name: string | null, price: number): string {
  const shown = name === null || name === '' ? '' : ` ${name}`
  return `${String(no)}번${shown} ${formatWon(price)} 등록했어요`
}

/** 무시: "108번은 이미 등록됐어요" */
export const alreadyReadout = (no: number): string => `${String(no)}번은 이미 등록됐어요`


/** 등록 뒤 다른 번호 (D-V3-05): "189번으로 등록했는데 139번도 들렸어요. 맞는지 확인해 주세요." */
export const otherNumberMessage = (registered: number, others: readonly number[]): string =>
  `${String(registered)}번으로 등록했는데 ${others.map((no) => `${String(no)}번`).join('·')}도 들렸어요. 맞는지 확인해 주세요.`

/** 덩어리 안 취소로 되돌림 (D-V3-21) */
export const undoneReadout = (no: number): string => `${String(no)}번 등록을 되돌렸어요`

/** 바로 고친 상품에 찜이 있을 때 (D-V3-57 — 찜 가격은 그대로, NEW_ONLY) */
export const claimsKeptNote = (count: number): string => `찜 ${String(count)}개는 전 가격 그대로예요. 바꾸려면 상품에서 고쳐 주세요.`

/** 다른 화분일 수 있는 같은 번호 (D-V3-59): "65번이 이미 있어요 (30,000원, 찜 2개)" */
export const maybeOtherMessage = (no: number, price: number, claims: number): string => `${String(no)}번이 이미 있어요 (${formatWon(price)}, 찜 ${String(claims)}개)`
export const MAYBE_OTHER_FIX = '새 가격으로 바꾸기'
export const MAYBE_OTHER_RENUMBER = '아까 것을 다른 번호로'

/** 고쳐 말함이 아닌 바로 바꿈 (D-V3-59): "65번을 바꿨어요: 30,000원 → 50,000원 · 아까 것이 다른 번호였으면 '아까 65번은 61번'이라고 말해 주세요" */
export function notRecentReadout(no: number, current: { readonly name: string; readonly price: number }, changes: InstantChanges): string {
  const parts: string[] = []
  if (changes.price !== undefined) parts.push(`${formatWon(current.price)} → ${formatWon(changes.price)}`)
  if (changes.name !== undefined) parts.push(`품종 ${current.name === '' ? '없음' : current.name} → ${changes.name}`)
  return `${String(no)}번을 바꿨어요: ${parts.join(', ')} · 아까 것이 다른 번호였으면 '아까 ${String(no)}번은 61번'이라고 말해 주세요`
}

/** 음성 번호 옮기기 (R-24, D-V3-58) */
export const renumberDone = (from: number, to: number): string => `${String(from)}번을 ${String(to)}번으로 옮겼어요`
export const renumberTaken = (to: number): string => `${String(to)}번이 이미 있어 옮기지 않았어요`
export const renumberClaims = (from: number): string => `${String(from)}번에 찜이 있어 번호를 옮기지 않았어요. 상품 목록에서 고쳐 주세요.`
export const renumberNotOpen = (from: number): string => `${String(from)}번이 없거나 판매 중이 아니라 번호를 옮기지 않았어요.`
export const RENUMBER_FAILED = '번호를 옮기지 못했어요. 인터넷 연결을 확인하고 상품 목록에서 고쳐 주세요.'

/** 기다리는 번호 (D-V3-67) */
export const missedPriceNote = (no: number): string => `${String(no)}번 가격을 못 들었어요`
export const TAKEN_MARK = '이어 받음'
export const LOG_TAKEN = '이어 받음'
/** "가격을 못 들었어요" 카드의 가격 칸 (D-V3-67) */
export const MISSED_PRICE_LABEL = '가격'
export const MISSED_PRICE_PROBLEM = '가격을 확인해 주세요. 숫자로 적으면 그 방송 가격 단위로 들어가요.'
export const LOG_INTERIM = '중간 글로 등록'
export const renumberRevertClaims = (to: number): string => `${String(to)}번에 찜이 생겨 번호를 되돌리지 않았어요. 상품 목록에서 고쳐 주세요.`
/** 서버가 막은 번호 옮기기 (409 VOICE_RENUMBER_CLAIMED) */
export const RENUMBER_CLAIMED = '찜이 있는 상품이라 번호를 옮기지 않았어요.'
