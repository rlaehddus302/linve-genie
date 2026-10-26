// 판매대장 "음성 기록" 시트 (STL, DOMAIN_RULES R-25, D-V3-65, AC-V3-71): 음성으로 일어난 등록·고침 기록 한 줄씩 (판매자 채팅 출처는 D-V3-68로 없음).
// 열: 시각·번호·한 일·전·후·출처·찜 수·들은 말·표시. 기존 "판매대장" 시트·열은 그대로 두고 시트만 더한다. 기록은 서버에 있어 부르는 쪽이 넘긴다.
import { formatKstLedgerTime } from './kst.ts'

export const VOICE_LEDGER_SHEET_NAME = '음성 기록'
export const VOICE_LEDGER_COLUMNS: readonly string[] = Object.freeze(['시각', '번호', '한 일', '전', '후', '출처', '찜 수', '들은 말', '표시'])

export type VoiceLedgerAction = 'REGISTER' | 'PRICE' | 'NAME' | 'RENUMBER' | 'UNDO'
export type VoiceLedgerSource = 'voice'
export type VoiceLedgerMark = 'BIG_CHANGE' | 'WITH_CLAIMS' | 'UNDONE'

/** 서버 기록 한 줄 (R-25) — 들은 말은 이미 가린 글(D-V3-56) */
export interface VoiceLedgerRow {
  /** UTC 밀리초 */
  readonly at: number
  /** 상품 번호 (옮기기면 전 번호) */
  readonly no: number
  /** 옮기기의 새 번호 */
  readonly toNo?: number | null
  readonly action: VoiceLedgerAction
  /** 전·후 값: 가격은 정수 원, 품종은 글, 번호 옮기기는 번호 — 없으면 null */
  readonly before: number | string | null
  readonly after: number | string | null
  readonly source: VoiceLedgerSource
  /** 그때 그 상품의 살아 있는 찜 수 */
  readonly claims: number
  readonly heard: string
  readonly marks: readonly VoiceLedgerMark[]
}

export const VOICE_LEDGER_ACTION_WORDS: Readonly<Record<VoiceLedgerAction, string>> = Object.freeze({ REGISTER: '등록', PRICE: '가격 고침', NAME: '품종 고침', RENUMBER: '번호 옮기기', UNDO: '되돌리기' })
export const VOICE_LEDGER_SOURCE_WORDS: Readonly<Record<VoiceLedgerSource, string>> = Object.freeze({ voice: '음성' })
export const VOICE_LEDGER_MARK_WORDS: Readonly<Record<VoiceLedgerMark, string>> = Object.freeze({ BIG_CHANGE: '크게 바뀜', WITH_CLAIMS: '찜 있을 때 고침', UNDONE: '되돌림' })

/** 줄 → 칸 값 (수 칸: 번호·찜 수, 가격 전·후는 수, 나머지는 글). 빈 값은 '' */
export function voiceLedgerRowValues(row: VoiceLedgerRow): (string | number)[] {
  const value = (v: number | string | null | undefined): string | number => (v === null || v === undefined ? '' : v)
  const no = row.action === 'RENUMBER' && typeof row.toNo === 'number' ? `${String(row.no)} → ${String(row.toNo)}` : row.no
  return [
    formatKstLedgerTime(row.at, false),
    no,
    VOICE_LEDGER_ACTION_WORDS[row.action] ?? '',
    value(row.before),
    value(row.after),
    VOICE_LEDGER_SOURCE_WORDS[row.source] ?? '',
    row.claims,
    row.heard,
    row.marks.map((mark) => VOICE_LEDGER_MARK_WORDS[mark]).filter((word) => word !== undefined).join(', '),
  ]
}
