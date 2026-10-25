// V3 바로 등록: 번호('N번')와 가격('…원')이 들리는 순간 등록하고, 이미 있는 번호는 무시·자동 고침·묻기를 고른다 (판단은 음성 패키지 readyToRegister·decideForExisting).
// 이 파일은 화면 문장과 저장값 읽기만 — 순수 함수다.
import { formatWon } from '@livejjim/core'

/** 저장 키 (같은 음성 설정 저장값 `livejjim.voiceSettings` 안에, 끈 때만 false로 남긴다) */
export const INSTANT_KEY = 'voice.instantRegister'
/** 설정 칸 글 */
export const INSTANT_LABEL = '번호와 가격이 들리면 바로 등록'
export const INSTANT_HELP_ON = '"108번 … 10만 원"처럼 번호와 가격이 들리면 기다리지 않고 바로 등록해요. 잘못 들었으면 5초 안에 "되돌리기"를 눌러 주세요.'
export const INSTANT_HELP_OFF = '들린 말은 카드로만 보여요. 맞으면 "등록"을 눌러 주세요.'
/** 음성 기록 까닭 */
export const LOG_INSTANT = '번호와 가격이 들려 바로 등록했어요'
export const LOG_INSTANT_DONE = '같은 말에서 이미 바로 등록한 번호예요'
export const LOG_ALREADY = '이미 등록됨'
export const LOG_PENDING = '방금 등록하는 중인 번호라 그대로 뒀어요'
export const LOG_AUTO_FIX = '이미 등록된 번호라 들린 값으로 고쳤어요'
export const LOG_ASK = '이미 등록된 번호라 고칠지 물었어요'
export const LOG_UPDATED_CARD = '같은 번호 카드가 열려 있어 그 카드를 고쳤어요'
/** 자동으로 고치지 못했을 때 */
export const AUTO_FIX_FAILED = '고치지 못했어요. "고치기"를 다시 눌러 주세요.'

/** 저장값에서 바로 등록 켬/끔 (없거나 모르는 값은 켬) */
export function readInstant(stored: unknown): boolean {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return true
  return (stored as Record<string, unknown>)[INSTANT_KEY] !== false
}

/** 받침이 있으면 '으로', 없거나 ㄹ 받침이면 '로' (한글이 아니면 '(으)로') */
export function ro(word: string): string {
  const last = word.trim().slice(-1)
  if (last === '') return '로'
  if (/[0-9]/.test(last)) return '036'.includes(last) ? '으로' : '로'
  const code = last.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return '(으)로'
  const tail = code % 28
  return tail === 0 || tail === 8 ? '로' : '으로'
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

/** "가격을 100,000원 → 120,000원으로, 품종을 비티에스로" (고칠 것이 없으면 "") */
function changeWords(current: { readonly name: string; readonly price: number }, changes: InstantChanges): string {
  const parts: string[] = []
  if (changes.price !== undefined) {
    const to = formatWon(changes.price)
    parts.push(`가격을 ${formatWon(current.price)} → ${to}${ro(to)}`)
  }
  if (changes.name !== undefined) {
    const to = changes.name
    parts.push(current.name === '' ? `품종을 ${to}${ro(to)}` : `품종을 ${current.name} → ${to}${ro(to)}`)
  }
  return parts.join(', ')
}

/** 자동으로 고친 뒤 알림: "108번 가격을 100,000원 → 120,000원으로 고쳤어요" (품종만 채우면 "채웠어요") */
export function fixedMessage(no: number, current: { readonly name: string; readonly price: number }, changes: InstantChanges): string {
  const verb = changes.price === undefined && current.name === '' ? '채웠어요' : '고쳤어요'
  return `${String(no)}번 ${changeWords(current, changes)} ${verb}`
}

/** 고치는 중 */
export function fixingMessage(no: number, current: { readonly name: string; readonly price: number }, changes: InstantChanges): string {
  return `${String(no)}번 ${changeWords(current, changes)} 고치는 중이에요`
}

/** 묻기: "108번 가격을 100,000원 → 120,000원으로 고칠까요?" */
export function askMessage(no: number, current: { readonly name: string; readonly price: number }, changes: InstantChanges): string {
  return `${String(no)}번은 이미 등록돼 있어요. ${changeWords(current, changes)} 고칠까요?`
}
