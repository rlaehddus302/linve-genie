// 음성 인식 기록 모아 두기 (VOC-01, D-V3-56, AC-V3-66): 기기(IndexedDB)에 남기기 전 가리기와 내려받기 JSON 형식. 저장·화면은 apps/web.
// 순수 함수: 시각은 부르는 쪽이 넘기고, 넘긴 값을 바꾸지 않는다. 서버로 보내지 않는다(이 패키지는 연결이 없다).
import { ENDINGS } from './extract.ts'
import { MASKED_DIGITS, maskLongDigits } from './voice-log.ts'

/** 기록 모아 두기의 가린 글 (AC-V3-66 — `****`) */
export const ARCHIVE_MASK = '****'

/** 내려받기 형식 이름·판 */
export const VOICE_ARCHIVE_FORMAT = 'livegenie-voice-log'
export const VOICE_ARCHIVE_VERSION = 1
/** 남겨 두는 기간 — 30일 지난 덩어리는 지운다 */
export const VOICE_ARCHIVE_KEEP_MS = 30 * 24 * 60 * 60 * 1000
/** 덩어리마다 한 일 */
export const VOICE_ARCHIVE_ACTIONS = Object.freeze(['REGISTERED', 'IGNORED', 'FIXED', 'ASKED', 'DROPPED'] as const)
export type VoiceArchiveAction = (typeof VOICE_ARCHIVE_ACTIONS)[number]
/** 켤 때 안내 (D-V3-56) */
export const VOICE_ARCHIVE_NOTICE = '판매자 목소리를 글로 바꾼 것이 이 기기에 남아요. 시청자 이름이 들어갈 수 있어요.'

/** 끝자리 낱말에 붙는 끝말 (R-17 2 끝말, 긴 것부터) */
const ENDING_PATTERN = [...ENDINGS].sort((a, b) => b.length - a.length).join('|')

/** 자리 글자 (숫자·한글 자리 글자 공·영·일~구, D-V3-75) */
const DIGIT_CHAR = '[0-9공영일이삼사오육칠팔구]'
/** 자리 글자로만 된 토큰 */
const DIGIT_RUN = `${DIGIT_CHAR}+`

/** 문자찜 끝자리 낱말 (R-21 4) — 바로 뒤 숫자 4개를 가린다 */
const LAST4_WORDS = ['끝자리', '뒷번호', '뒷자리', '끝번호', '끝 자리', '뒷 번호']

/**
 * 남기기 전 가리기: 숫자 8자리 이상(공백·`-`이 끼어도, D-V2-20과 같은 판단) → `****`,
 * 끝자리 낱말(끝자리·뒷번호·뒷자리·끝번호·끝 자리·뒷 번호) 바로 뒤 숫자 4개 → `****` ("끝자리 1234 김민지님" → "끝자리 **** 김민지님").
 */
export function maskArchiveText(text: unknown): string {
  if (typeof text !== 'string') return ''
  let out = maskLongDigits(text).split(MASKED_DIGITS).join(ARCHIVE_MASK)
  // 한글 자리 글자(공·영·일~구, 숫자 섞여도)만으로 된 토큰이 공백을 사이에 두고 이어져 자리가 8개 이상이면 전부 (D-V3-75 — "공일공 일이삼사 오육칠팔")
  out = out.replace(new RegExp(`(?<![가-힣])${DIGIT_RUN}(?:\\s+${DIGIT_RUN})*(?![가-힣])`, 'g'), (run) => (run.replace(/\s/g, '').length >= 8 ? ARCHIVE_MASK : run))
  for (const word of LAST4_WORDS) {
    const escaped = word.replace(/ /g, '\\s*')
    // 낱말에 끝말이 붙어도(`끝자리는`·`뒷번호가`, R-21 4 읽는 모양 — TD-V3-006) 바로 뒤 자리 4개(숫자 또는 한글 자리 글자, 사이 공백 허용 — D-V3-75)를 가린다. 뒤 끝말(`1234요`)은 그대로 둔다
    out = out.replace(new RegExp(`(${escaped}(?:${ENDING_PATTERN})?)(\\s*)(?:${DIGIT_CHAR}\\s*){3}${DIGIT_CHAR}(?![0-9])(?![공영일이삼사오육칠팔구]+(?:\\s|$))`, 'g'), (_match, lead: string, space: string) => `${lead}${space}${ARCHIVE_MASK}`)
  }
  return out
}

export interface VoiceArchiveReading {
  readonly no: number | null
  readonly price: number | null
  readonly name: string | null
  readonly numberFrom: 'marker' | 'bare' | null
  readonly priceFrom: 'won' | 'quick' | null
}

/** 덩어리 하나 (내려받기 모양 그대로) */
export interface VoiceArchiveChunk {
  /** UTC 밀리초 */
  readonly at: number
  readonly text: string
  readonly interims?: readonly string[]
  readonly reading: VoiceArchiveReading
  readonly action: VoiceArchiveAction
  readonly reason: string | null
  readonly undone: boolean
  readonly edited: boolean
}

export interface VoiceArchiveBroadcast {
  readonly broadcastId: string
  readonly title: string
  /** 방송 날짜 (YYYY-MM-DD) */
  readonly date: string
  readonly chunks: readonly VoiceArchiveChunk[]
}

export interface VoiceArchiveExport {
  readonly format: typeof VOICE_ARCHIVE_FORMAT
  readonly version: typeof VOICE_ARCHIVE_VERSION
  /** 내려받은 시각 (ISO 문자열) */
  readonly exportedAt: string
  readonly broadcasts: readonly VoiceArchiveBroadcast[]
}

const isAction = (value: unknown): value is VoiceArchiveAction => (VOICE_ARCHIVE_ACTIONS as readonly unknown[]).includes(value)
const intOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) ? value : null)
const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** 덩어리 하나를 남길 모양으로 (가리기·모양 맞추기). 넘긴 값을 바꾸지 않는다 */
export function createArchiveChunk(input: {
  readonly at: number
  readonly text: string
  readonly interims?: readonly string[]
  readonly reading?: Partial<VoiceArchiveReading> | null
  readonly action: VoiceArchiveAction
  readonly reason?: string | null
  readonly undone?: boolean
  readonly edited?: boolean
}): VoiceArchiveChunk {
  const reading = input.reading ?? {}
  const numberFrom = reading.numberFrom === 'marker' || reading.numberFrom === 'bare' ? reading.numberFrom : null
  const priceFrom = reading.priceFrom === 'won' || reading.priceFrom === 'quick' ? reading.priceFrom : null
  const interims = Array.isArray(input.interims) ? input.interims.map(maskArchiveText) : undefined
  return {
    at: typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : 0,
    text: maskArchiveText(input.text),
    ...(interims === undefined || interims.length === 0 ? {} : { interims }),
    reading: { no: intOrNull(reading.no), price: intOrNull(reading.price), name: textOrNull(reading.name), numberFrom, priceFrom },
    action: isAction(input.action) ? input.action : 'DROPPED',
    reason: textOrNull(input.reason),
    undone: input.undone === true,
    edited: input.edited === true,
  }
}

/** 30일 지난 덩어리를 뺀 새 목록 (now = UTC 밀리초) */
export function pruneArchive<T extends { readonly at: number }>(chunks: readonly T[], now: number): T[] {
  return chunks.filter((chunk) => now - chunk.at <= VOICE_ARCHIVE_KEEP_MS)
}

/** 내려받기 JSON 값 — 정확히 { format, version, exportedAt, broadcasts } (exportedAt = UTC 밀리초 → ISO) */
export function createArchiveExport(broadcasts: readonly VoiceArchiveBroadcast[], exportedAt: number): VoiceArchiveExport {
  return {
    format: VOICE_ARCHIVE_FORMAT,
    version: VOICE_ARCHIVE_VERSION,
    exportedAt: new Date(Number.isFinite(exportedAt) ? exportedAt : 0).toISOString(),
    broadcasts: broadcasts.map((item) => ({
      broadcastId: String(item.broadcastId),
      title: String(item.title),
      date: String(item.date),
      chunks: item.chunks.map((chunk) => createArchiveChunk(chunk)),
    })),
  }
}
