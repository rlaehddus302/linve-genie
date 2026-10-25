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
export const LOG_OTHER_NUMBER = '등록한 번호와 다른 번호가 들렸어요'
export const LOG_UNDONE = '취소가 들려 등록을 되돌렸어요'
/** 고치지 못했을 때 (D-V3-07 — V2 문장) */
export const AUTO_FIX_FAILED = '고치지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.'
/** 묻기 카드의 까닭 줄 (D-V3-06) */
export const REASON_CLAIMS = '찜이 있는 상품이라 저절로 고치지 않았어요.'
export const REASON_NOT_OPEN = '판매 중이 아닌 상품이라 저절로 고치지 않았어요.'
export const REASON_PRICE_NOT_SURE = "가격 끝에 '원'이 들리지 않아 저절로 고치지 않았어요."
/** 알림의 단추 */
export const NOTICE_OK = '알겠어요'

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

/** 바로 등록 뒤 큰 글자 칸: "108번 bts 100,000원 등록했어요 · 품종 확인 필요" */
export function registeredReadout(no: number, name: string | null, price: number, needsCheck: boolean): string {
  const shown = name === null || name === '' ? '' : ` ${name}`
  return `${String(no)}번${shown} ${formatWon(price)} 등록했어요${needsCheck && shown !== '' ? ' · 품종 확인 필요' : ''}`
}

/** 무시: "108번은 이미 등록됐어요" */
export const alreadyReadout = (no: number): string => `${String(no)}번은 이미 등록됐어요`

/** 번호 둘 이상 (D-V3-05): "번호 확인 필요 · 들린 번호: 189·139" */
export const numbersNote = (numbers: readonly number[]): string => `번호 확인 필요 · 들린 번호: ${numbers.map(String).join('·')}`

/** 등록 뒤 다른 번호 (D-V3-05): "189번으로 등록했는데 139번도 들렸어요. 맞는지 확인해 주세요." */
export const otherNumberMessage = (registered: number, others: readonly number[]): string =>
  `${String(registered)}번으로 등록했는데 ${others.map((no) => `${String(no)}번`).join('·')}도 들렸어요. 맞는지 확인해 주세요.`

/** 덩어리 안 취소로 되돌림 (D-V3-21) */
export const undoneReadout = (no: number): string => `${String(no)}번 등록을 되돌렸어요`
