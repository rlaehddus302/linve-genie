// APP1b: 메모리 안 읽기 세션의 전송 모양. 이 파일에는 추출·사전·브라우저 코드가 없다.
export type WireValue = null | boolean | number | string | readonly WireValue[] | { readonly [key: string]: WireValue }

/** Map/Set을 포함하는 기존 상태를 값 손실 없이 보낸다. 함수는 전송하지 않는다. */
export function toWire(value: unknown): WireValue {
  if (value === undefined || typeof value === 'function') return null
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Map) return { $map: [...value].map(([key, item]) => [toWire(key), toWire(item)]) }
  if (value instanceof Set) return { $set: [...value].map(toWire) }
  if (Array.isArray(value)) return value.map(toWire)
  if (typeof value === 'object') {
    const out: Record<string, WireValue> = {}
    for (const [key, item] of Object.entries(value)) if (item !== undefined && typeof item !== 'function') out[key] = toWire(item)
    return out
  }
  return null
}

/** JSON에서만 받은 값을 푼다. 원형/함수/프로토타입을 전달하는 통로가 아니다. */
export function fromWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromWire)
  if (!isRecord(value)) return value
  if (Object.keys(value).length === 1 && Array.isArray(value.$map)) {
    return new Map(value.$map.filter((pair): pair is [unknown, unknown] => Array.isArray(pair) && pair.length === 2).map(([key, item]) => [fromWire(key), fromWire(item)]))
  }
  if (Object.keys(value).length === 1 && Array.isArray(value.$set)) return new Set(value.$set.map(fromWire))
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '__proto__' && key !== 'constructor' && key !== 'prototype').map(([key, item]) => [key, fromWire(item)]))
}

export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** 서버에서 호출 가능한 사용자 동작만. 임의 메서드·생성자·private 값 접근 금지. */
export const VOICE_COMMANDS = [
  'turnOff', 'acceptConsent', 'declineConsent', 'dismissFlushedClosed', 'dismissUnsupported', 'noteRegistered',
  'setInstant', 'setArchive', 'instantExists', 'confirm', 'take', 'close', 'rejectNumber', 'stopAuto', 'openForm', 'editForm',
  'formProblem', 'closeForm', 'restore', 'setAutoConfirm', 'setSeconds', 'setQuietSeconds', 'chooseCandidate', 'learnFrom',
  'clearLearned', 'clearLog', 'noteVoiceRegistered', 'dismissOffer', 'fixCardOffer', 'setOfferPrice', 'fixOffer', 'renumberOffer',
  'revertOffer', 'undoOffer', 'refresh', 'smsSkip', 'smsDroppedSeen', 'smsDismiss', 'smsSend', 'smsChoose', 'smsNewBuyer',
  'setSmsListen', 'setSmsSeconds', 'submitMissed', 'submitForm',
] as const
export type VoiceCommand = (typeof VOICE_COMMANDS)[number]

export interface VoiceClientContext {
  readonly now: number
  readonly dialogOpen: boolean
  readonly smsAutoAllowed: boolean
  readonly settings?: unknown
  readonly smsSettings?: unknown
  readonly consent?: boolean
  readonly learned?: unknown
  readonly resumeToken?: string
  readonly listening?: boolean
}

export type VoiceClientMessage =
  | { readonly type: 'voice.session'; readonly op: 'hello' | 'context'; readonly context: VoiceClientContext }
  | { readonly type: 'voice.session'; readonly op: 'capture'; readonly at: number }
  | { readonly type: 'voice.session'; readonly op: 'command'; readonly method: VoiceCommand; readonly args: readonly unknown[] }
  | { readonly type: 'voice.session'; readonly op: 'effectResult'; readonly id: number; readonly value: unknown }
  | { readonly type: 'voice.session'; readonly op: 'chromeResult'; readonly result: { readonly text: string; readonly final: boolean; readonly flushedAtEnd?: boolean; readonly slot?: string; readonly lead?: boolean } }

export interface VoiceStateMessage {
  readonly type: 'voice.state'
  readonly sessionId: string
  readonly sessionReady: boolean
  readonly resumeToken: string
  readonly snapshot: WireValue
  readonly display: WireValue
}

export interface VoiceEffectMessage {
  readonly type: 'voice.effect'
  readonly sessionId: string
  readonly id: number
  readonly method: string
  readonly args: WireValue
  readonly spokenEndAt?: number
  readonly automatic?: boolean
  readonly source?: 'chrome' | 'livegenie'
}

export type VoiceServerMessage = VoiceStateMessage | VoiceEffectMessage | { readonly type: 'voice.error'; readonly code?: 'RESUME_INVALID'; readonly message: string }

export interface VoiceConfirmation {
  readonly sessionId: string
  readonly broadcastId: string
  readonly device: string
  readonly cardId: string
  readonly cardVersion: number
  readonly registration: { readonly no: number; readonly name: string; readonly price: number }
}

const textIn = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value.length <= max && (empty || value.length > 0)
const integerIn = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
function validCard(value: unknown): boolean {
  if (!isRecord(value)) return false
  return textIn(value.id, 200) && textIn(value.text, 2000, true) && (value.no === null || integerIn(value.no, 1, 9999)) && (value.name === null || textIn(value.name, 200, true)) && (value.price === null || integerIn(value.price, 100)) && ['HIGH', 'MEDIUM', 'LOW'].includes(String(value.confidence)) && ['OPEN', 'CLOSED', 'CONFIRMED'].includes(String(value.status)) && typeof value.touched === 'boolean' && integerIn(value.createdAt, 0) && (value.autoConfirmAt === null || integerIn(value.autoConfirmAt, 0)) && [value.flushedAtEnd, value.nameExact, value.nameNeedsCheck].every((item) => item === undefined || typeof item === 'boolean')
}

/** websocket 입구의 구조 검증. 프레임 크기·속도·계정 검사는 relay가 담당한다. */
export function isVoiceClientMessage(value: unknown): value is VoiceClientMessage {
  if (!isRecord(value) || value.type !== 'voice.session' || typeof value.op !== 'string') return false
  if (value.op === 'hello' || value.op === 'context') {
    const item = value.context
    return isRecord(item) && typeof item.now === 'number' && Number.isSafeInteger(item.now) && item.now >= 0 && typeof item.dialogOpen === 'boolean' && typeof item.smsAutoAllowed === 'boolean' && (item.resumeToken === undefined || textIn(item.resumeToken, 12000)) && (item.listening === undefined || typeof item.listening === 'boolean')
  }
  if (value.op === 'capture') return typeof value.at === 'number' && Number.isFinite(value.at) && value.at >= 0
  if (value.op === 'effectResult') return typeof value.id === 'number' && Number.isSafeInteger(value.id) && value.id > 0
  if (value.op === 'chromeResult') {
    const result = value.result
    return isRecord(result) && typeof result.text === 'string' && result.text.length <= 2000 && typeof result.final === 'boolean' && (result.slot === undefined || (typeof result.slot === 'string' && result.slot.length <= 80)) && (result.lead === undefined || typeof result.lead === 'boolean') && (result.flushedAtEnd === undefined || typeof result.flushedAtEnd === 'boolean')
  }
  if (value.op !== 'command' || typeof value.method !== 'string' || !VOICE_COMMANDS.some((method) => method === value.method) || !Array.isArray(value.args) || value.args.length > 4) return false
  const [first, second] = value.args
  if (['setInstant', 'setArchive', 'setAutoConfirm', 'setSmsListen'].includes(value.method)) return typeof first === 'boolean'
  if (['setSeconds', 'setQuietSeconds', 'setSmsSeconds'].includes(value.method)) return typeof first === 'string' && first.length <= 30
  if (value.method === 'rejectNumber') return integerIn(first, 1, 9999)
  if (value.method === 'noteVoiceRegistered') return isRecord(first) && textIn(first.id, 200) && integerIn(first.no, 1, 9999) && textIn(first.name, 200, true) && integerIn(first.price, 100)
  if (['instantExists', 'restore', 'learnFrom'].includes(value.method)) {
    if (!validCard(first)) return false
    if (value.method === 'learnFrom') return textIn(second, 200, true)
    if (value.method === 'restore' && second !== undefined) return isRecord(second) && (second.note === undefined || textIn(second.note, 2000, true)) && (second.touched === undefined || typeof second.touched === 'boolean')
    return true
  }
  if (['confirm', 'take', 'close', 'stopAuto', 'openForm', 'editForm', 'formProblem', 'closeForm', 'chooseCandidate', 'dismissOffer', 'fixCardOffer', 'setOfferPrice', 'fixOffer', 'renumberOffer', 'revertOffer', 'undoOffer', 'smsSkip', 'smsDroppedSeen', 'smsDismiss', 'smsSend', 'smsChoose', 'smsNewBuyer', 'submitMissed', 'submitForm'].includes(value.method)) {
    if (!textIn(first, 200)) return false
    if (['chooseCandidate', 'setOfferPrice', 'smsChoose', 'submitMissed', 'formProblem'].includes(value.method) && !textIn(second, 2000, true)) return false
    if (value.method === 'editForm' && (!isRecord(second) || Object.entries(second).some(([key, item]) => !['no', 'name', 'price'].includes(key) || !textIn(item, 200, true)))) return false
    if (value.method === 'formProblem' && !['no', 'name', 'price'].includes(String(value.args[2]))) return false
    if (value.method === 'confirm' && !['enter', 'click', 'auto', 'instant'].includes(String(second))) return false
  }
  return true
}
