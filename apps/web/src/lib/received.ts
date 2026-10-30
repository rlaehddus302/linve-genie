// 문자찜 "받은 시각" 칸의 문장 (AC-S06-12, ORD-08 AC1, R-6, D-023, D-089).
// SRV1 (D-APP-23·24): 칸 글을 시각으로 읽는 일(12/24시 고르기·날짜 정하기)은 서버가 한다(packages/voice-session/src/read.ts readReceived —
// 서버 읽기 입구 kind `received`). 화면은 서버가 읽은 결과를 "오늘 20:01"로 보일 뿐이다.
import type { ReceivedReading } from './read.ts'

export type { ReceivedReading }

export const RECEIVED_INVALID = '받은 시각을 20:01처럼 적어 주세요.'
export const RECEIVED_HELP = '비우면 지금 시각(초까지)으로 넣어요'

/** "오늘 20:01" (서버가 읽은 결과) */
export function receivedWords(read: Extract<ReceivedReading, { kind: 'ok' }>): string {
  return `${read.day} ${read.value}`
}
