// 댓글 붙여넣기 — 순수 함수 (PLT-02, ORD-08, D-N2b-2-07·D-N2b-2-08, 골든 tests/golden/tiktok/paste.json).
// 틱톡 연결이 막히거나 끊겼을 때 판매자가 틱톡 화면의 댓글을 "닉네임: 댓글" 한 줄씩 붙여 넣는다.
// - 줄 읽기(parsePaste)는 골든과 같은 모양을 돌려준다. 바깥 호출·시계·난수가 없다.
// - 번호는 그 회차 스냅샷으로 코어 채팅 파서(R-3·R-4)가 읽는다(classifyPaste) — 서버가 따로 번호를 찾지 않는다.
// - 붙여 넣은 글·닉네임은 신뢰할 수 없는 입력이다: 로그에 남기지 않고, 오류 응답에 되돌려 보내지 않는다(받은 값은 줄 결과로만 — 휴대폰 번호 줄은 닉네임도 돌려주지 않는다).
import { containsPhoneRun, parseChat, type SaleSettings } from '@livejjim/core'
import { cleanNick } from '../youtube/texts.ts'

/** 한 번에 붙여 넣을 수 있는 글 길이 (UTF-16 단위) */
export const PASTE_TEXT_MAX = 20_000
/** 한 번에 붙여 넣을 수 있는 줄 수 (빈 줄 빼고) */
export const PASTE_LINES_MAX = 200
/** 댓글 길이 (코드 포인트) */
export const PASTE_COMMENT_MAX = 500

export type PasteLineError = 'NO_NICKNAME' | 'PHONE_NUMBER' | 'NO_TEXT' | 'TEXT_TOO_LONG'
export type PasteError = 'TOO_LONG' | 'TOO_MANY_LINES'

/** 골든 모양: 줄마다 닉네임·댓글 또는 오류 */
export type PasteRow = { readonly line: number; readonly nickname: string; readonly text: string } | { readonly line: number; readonly error: PasteLineError }
export type PasteParse = { readonly rows: readonly PasteRow[] } | { readonly error: PasteError }

/** 판매자에게 그대로 보이는 문장 (AC-N2b-2-56) */
export const PASTE_MESSAGES = {
  CANCEL_NOT_SUPPORTED: '취소는 붙여넣기로 넣지 않아요. 찜 목록에서 취소해 주세요.',
  NOT_ORDER: '주문이 아니라 넣지 않아요.',
  NO_NICKNAME: '닉네임: 댓글 모양이 아니에요.',
  PHONE_NUMBER: '닉네임에 휴대폰 번호가 있어 넣지 않아요.',
  NO_TEXT: '댓글이 비어 있어요.',
  TEXT_TOO_LONG: '댓글이 너무 길어요. 500자까지 넣을 수 있어요.',
  TOO_LONG: '한 번에 20,000자까지 붙여 넣을 수 있어요. 나눠서 넣어 주세요.',
  TOO_MANY_LINES: '한 번에 200줄까지 붙여 넣을 수 있어요. 나눠서 넣어 주세요.',
  NOTHING_TO_ADD: '넣을 찜이 없어요.',
  SAME_NICKNAME: '같은 닉네임은 한 구매자로 넣어요',
} as const

const LINE_BREAK = /\r\n|\n|\r/
/** 맨 앞의 시각 (ASCII 숫자 — \d는 u 깃발 없이 ASCII만) */
const TIME_PREFIX = /^\d{1,2}:\d{2}(?::\d{2})?\s+/
const DIGITS_ONLY = /^[0-9０-９]+$/

function longerThan(value: string, max: number): boolean {
  if (value.length <= max) return false
  let count = 0
  for (const _ch of value) {
    count += 1
    if (count > max) return true
  }
  return false
}

/** 줄 하나 (앞뒤 공백을 지운, 빈 줄이 아닌 것) */
function parseLine(line: number, raw: string): PasteRow {
  const body = raw.replace(TIME_PREFIX, '')
  const half = body.indexOf(':')
  const full = body.indexOf('：')
  const cut = half === -1 ? full : full === -1 ? half : Math.min(half, full)
  if (cut <= 0) return { line, error: 'NO_NICKNAME' }
  const rawNick = body.slice(0, cut)
  const nickname = cleanNick(rawNick)
  if (nickname === '' || DIGITS_ONLY.test(nickname)) return { line, error: 'NO_NICKNAME' }
  // 메모 칸이 받지 않는 휴대폰 번호 (D-079) — 정리한 값과 정리 전 값 둘 다 본다(잘라 낸 뒤에 숨은 번호도 넣지 않는다)
  if (containsPhoneRun(nickname) || containsPhoneRun(rawNick)) return { line, error: 'PHONE_NUMBER' }
  const text = body.slice(cut + 1).trim()
  if (text === '') return { line, error: 'NO_TEXT' }
  if (longerThan(text, PASTE_COMMENT_MAX)) return { line, error: 'TEXT_TOO_LONG' }
  return { line, nickname, text }
}

/** 붙여 넣은 글 → 줄마다 닉네임·댓글 또는 오류 (골든 tiktok/paste.json) */
export function parsePaste(input: string): PasteParse {
  if (input.length > PASTE_TEXT_MAX) return { error: 'TOO_LONG' }
  const lines = input.split(LINE_BREAK)
  const kept: { line: number; text: string }[] = []
  lines.forEach((raw, index) => {
    const text = raw.trim()
    if (text !== '') kept.push({ line: index + 1, text })
  })
  if (kept.length > PASTE_LINES_MAX) return { error: 'TOO_MANY_LINES' }
  return { rows: kept.map((entry) => parseLine(entry.line, entry.text)) }
}

// ── 미리 보기·넣기 공통: 줄 결과와 같은 닉네임 묶음 (D-N2b-2-08) ─────────────────

export type PasteResult = 'ORDER' | 'CANCEL_NOT_SUPPORTED' | 'NOT_ORDER' | PasteLineError

/** 줄 결과 (응답 모양 — 화면이 글자 그대로 쓴다) */
export interface PasteLineView {
  readonly line: number
  /** 정리한 닉네임 (휴대폰 번호 줄·모양이 아닌 줄은 없음) */
  readonly nickname?: string
  /** 댓글 (주문·취소·주문 아님 줄만) */
  readonly text?: string
  readonly result: PasteResult
  /** 넣을 번호 (주문 줄만, 파서가 낸 순서) */
  readonly numbers: readonly number[]
  readonly message: string
}

export interface PasteGroup {
  readonly nickname: string
  /** 이 닉네임의 주문 줄 번호 */
  readonly lines: readonly number[]
  /** 넣을 찜 수 */
  readonly claims: number
  /** 둘 이상의 줄이면 "같은 닉네임은 한 구매자로 넣어요" */
  readonly message: string | null
}

export interface PastePlan {
  readonly rows: readonly PasteLineView[]
  readonly groups: readonly PasteGroup[]
  /** 넣을 찜 수 */
  readonly total: number
}

function orderMessage(numbers: readonly number[]): string {
  return `${numbers.map((no) => `${String(no)}번`).join('·')} 찜`
}

/**
 * 줄 읽기 결과를 그 회차 설정(스냅샷)의 채팅 파서로 판단한다. 주문과 취소가 함께 나오면 취소로 본다(넣지 않는다).
 * 줄 결과·같은 닉네임 묶음·넣을 찜 수를 돌려준다 (미리 보기·넣기가 같은 함수를 쓴다)
 */
export function classifyPaste(rows: readonly PasteRow[], settings: SaleSettings): PastePlan {
  const views: PasteLineView[] = []
  const groups = new Map<string, { lines: number[]; claims: number }>()
  for (const row of rows) {
    if ('error' in row) {
      views.push({ line: row.line, result: row.error, numbers: [], message: PASTE_MESSAGES[row.error] })
      continue
    }
    const parsed = parseChat(row.text, settings)
    if (parsed.cancels.length > 0) {
      views.push({ line: row.line, nickname: row.nickname, text: row.text, result: 'CANCEL_NOT_SUPPORTED', numbers: [], message: PASTE_MESSAGES.CANCEL_NOT_SUPPORTED })
      continue
    }
    if (parsed.claims.length === 0) {
      views.push({ line: row.line, nickname: row.nickname, text: row.text, result: 'NOT_ORDER', numbers: [], message: PASTE_MESSAGES.NOT_ORDER })
      continue
    }
    const numbers = [...parsed.claims]
    views.push({ line: row.line, nickname: row.nickname, text: row.text, result: 'ORDER', numbers, message: orderMessage(numbers) })
    const group = groups.get(row.nickname) ?? { lines: [], claims: 0 }
    group.lines.push(row.line)
    group.claims += numbers.length
    groups.set(row.nickname, group)
  }
  const list: PasteGroup[] = [...groups].map(([nickname, group]) => ({
    nickname,
    lines: group.lines,
    claims: group.claims,
    message: group.lines.length > 1 ? PASTE_MESSAGES.SAME_NICKNAME : null,
  }))
  return { rows: views, groups: list, total: list.reduce((sum, group) => sum + group.claims, 0) }
}
