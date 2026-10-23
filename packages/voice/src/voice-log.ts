// 음성 기록 보기 (VOC-01, D-V2-08). 덩어리마다 들은 말·읽은 것·한 일·버린 까닭. 그 탭 메모리에만 둔다 — 저장·전송은 이 모듈 밖에서도 하지 않는다.
// 순수 함수: 넘긴 목록을 바꾸지 않고 새 목록을 돌려준다.
import { formatWon } from '@livejjim/core'
import type { VarietyCandidate } from './candidates.ts'

/** 기록 최대 덩어리 수 (넘으면 오래된 것부터 지운다) */
export const VOICE_LOG_MAX = 50
/** 조각 글 최대 길이(코드 포인트) — 넘으면 300글자 + "…" */
export const VOICE_LOG_TEXT_MAX = 300
export const ELLIPSIS = '…'
/** 끝에서 넘긴 조각 뒤에 붙는 말 */
export const FLUSHED_NOTE = '(끝까지 못 들음)'

/** 버린 까닭 (정해진 문장, D-V2-08) */
export const VOICE_LOG_REASONS = Object.freeze({
  noFields: '번호와 가격이 안 들렸어요',
  conflict: '이미 있는 값과 달라 쓰지 않았어요',
  noTarget: '고칠 카드가 없어요',
  tooLong: '문장이 너무 길어요',
  stopped: '음성을 껐어요',
} as const)

export type VoiceLogAction = 'create' | 'fill' | 'edit' | 'close' | 'offer' | 'sms' | 'discard'

/** 한 일 (화면 낱말) */
export const VOICE_LOG_ACTION_LABELS: Readonly<Record<VoiceLogAction, string>> = Object.freeze({
  create: '카드 만듦',
  fill: '앞 카드 채움',
  edit: '카드 고침',
  close: '카드 닫음',
  offer: '고칠까요 카드',
  sms: '문자찜 카드',
  discard: '버림',
})

export interface VoiceLogPiece {
  readonly text: string
  readonly flushedAtEnd: boolean
}

export interface VoiceLogRead {
  readonly no: number | null
  readonly name: string | null
  readonly price: number | null
  readonly candidates: readonly VarietyCandidate[]
}

export interface VoiceLogEntry {
  /** 덩어리를 읽은 시각 (UTC 밀리초) */
  readonly at: number
  readonly pieces: readonly VoiceLogPiece[]
  /** 읽은 것 (문자찜 덩어리 등 읽지 않았으면 null) */
  readonly read: VoiceLogRead | null
  readonly action: VoiceLogAction
  /** 버린 까닭 (없으면 null) */
  readonly reason: string | null
}

const codePoints = (text: string): string[] => [...text]

/** 300글자 넘는 글은 300글자 + "…" */
export function clipLogText(text: unknown): string {
  const value = typeof text === 'string' ? text : ''
  const chars = codePoints(value)
  return chars.length > VOICE_LOG_TEXT_MAX ? `${chars.slice(0, VOICE_LOG_TEXT_MAX).join('')}${ELLIPSIS}` : value
}

/** 기록 항목 하나 (조각 글 자르기·모양 맞추기) */
export function createLogEntry(input: { readonly at: number; readonly pieces: readonly { readonly text: string; readonly flushedAtEnd?: boolean }[]; readonly read?: VoiceLogRead | null; readonly action: VoiceLogAction; readonly reason?: string | null }): VoiceLogEntry {
  const pieces = Array.isArray(input.pieces) ? input.pieces : []
  return Object.freeze({
    at: typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : 0,
    pieces: Object.freeze(pieces.map((piece) => Object.freeze({ text: clipLogText(piece?.text), flushedAtEnd: piece?.flushedAtEnd === true }))),
    read: input.read === undefined || input.read === null ? null : Object.freeze({ no: input.read.no, name: input.read.name, price: input.read.price, candidates: Object.freeze([...(input.read.candidates ?? [])]) }),
    action: input.action in VOICE_LOG_ACTION_LABELS ? input.action : 'discard',
    reason: typeof input.reason === 'string' ? input.reason : null,
  })
}

/** 새 항목을 맨 앞에 (새것부터). 50개를 넘으면 가장 오래된 것부터 뺀다 */
export function addLogEntry(log: readonly VoiceLogEntry[], entry: VoiceLogEntry): VoiceLogEntry[] {
  return [entry, ...(Array.isArray(log) ? log : [])].slice(0, VOICE_LOG_MAX)
}

/** [기록 지우기] */
export function clearLog(): VoiceLogEntry[] {
  return []
}

/** 읽은 것 한 줄: "15번 · 엘레강스 · 20,000원" (빈 칸은 "번호 ?"·"품종 ?"·"가격 ?", D-V2-07) */
export function describeReading(read: { readonly no: number | null; readonly name: string | null; readonly price: number | null }): string {
  const no = read.no === null ? '번호 ?' : `${String(read.no)}번`
  const name = read.name === null || read.name === '' ? '품종 ?' : read.name
  const price = read.price === null ? '가격 ?' : formatWon(read.price)
  return `${no} · ${name} · ${price}`
}

/** 후보 글: "선버스트 77점" (여럿이면 쉼표로) */
export function describeCandidates(candidates: readonly VarietyCandidate[]): string {
  return (Array.isArray(candidates) ? candidates : []).map((c) => `${c.name} ${String(c.score)}점`).join(', ')
}

/** 들은 말 조각 글 (끝에서 넘긴 조각은 "(끝까지 못 들음)") */
export function describePiece(piece: VoiceLogPiece): string {
  return piece.flushedAtEnd ? `${piece.text} ${FLUSHED_NOTE}` : piece.text
}

/** 시각 "시:분:초" — offsetMinutes는 표시 시간대(한국 540). 화면이 그 기기 시간대를 넘겨도 된다 */
export function formatLogTime(at: number, offsetMinutes = 540): string {
  const total = Math.floor(((Number.isFinite(at) ? at : 0) + offsetMinutes * 60_000) / 1000)
  const day = ((total % 86_400) + 86_400) % 86_400
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(Math.floor(day / 3600))}:${pad(Math.floor((day % 3600) / 60))}:${pad(day % 60)}`
}
