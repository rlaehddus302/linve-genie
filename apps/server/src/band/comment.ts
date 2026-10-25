// 밴드 댓글 → chat 다섯 칸, 한 번 읽은 목록 나누기 (PLT-04, R-1 "밴드 글 댓글의 chat", D-BND1-02~07, 골든 tests/golden/band/*.json).
// 순수 함수다 — 시계·난수·바깥 호출이 없다. 실제 읽기 경로(reader.ts)와 서버 골든 시험이 같은 함수를 부른다(AC-BND1-90).
// - 검사 순서: BAD_COMMENT_KEY → NO_AUTHOR → SELLER → BAD_TIME → NO_TEXT → TEXT_TOO_LONG (처음 걸린 것).
// - 본문은 밴드 태그를 먼저 정리하고 그 뒤 이스케이프를 한 번 푼다(D-BND1-04) — 손님이 친 `&lt;band:refer&gt;`는 태그가 되지 않는다.
// - owner는 늘 false(판매자 댓글은 넣지 않는다), publishedAt은 없다(밴드 회차는 접수순만, D-BND1-06).
import { BAND_PREFIX, PLATFORM_KEY_MAX } from '../platform.ts'
import { sanitizeNick } from '../youtube/texts.ts'

/** 기록할 chat 다섯 칸 (정확히 이 다섯 키) */
export interface BandChatFields {
  readonly id: string
  readonly ch: string
  readonly nick: string
  readonly text: string
  readonly owner: false
}

/** 넣지 않는 이유 (검사 순서 그대로) — DUPLICATE는 같은 읽기 안의 두 번째부터 */
export type BandSkipCode = 'BAD_COMMENT_KEY' | 'NO_AUTHOR' | 'SELLER' | 'BAD_TIME' | 'NO_TEXT' | 'TEXT_TOO_LONG' | 'DUPLICATE'

export const BAND_SKIP_CODES: readonly BandSkipCode[] = Object.freeze(['SELLER', 'NO_AUTHOR', 'BAD_COMMENT_KEY', 'BAD_TIME', 'NO_TEXT', 'TEXT_TOO_LONG', 'DUPLICATE'])

/** 본문 상한 (코드 포인트 — 틱톡과 같다, D-BND1-03) */
export const BAND_TEXT_MAX = 500

export type BandCommentOutcome = { readonly chat: BandChatFields } | { readonly skip: Exclude<BandSkipCode, 'DUPLICATE'> }

type Obj = Record<string, unknown>
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)

const REFER_RE = /<band:refer\b[^>]*>([\s\S]*?)<\/band:refer>/g
const HASHTAG_RE = /<band:hashtag\b[^>]*>([\s\S]*?)<\/band:hashtag>/g
const BAND_TAG_RE = /<\/?band:[A-Za-z0-9_-]+\b[^>]*>/g
const ESCAPES: Readonly<Record<string, string>> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" }
const ESCAPE_RE = /&lt;|&gt;|&quot;|&#39;|&#x27;/g

/**
 * 본문 → 기록할 글 (D-BND1-04): (1) 부르기 → @이름 (2) 해시태그 → 안의 글 (3) 그 밖의 band: 표시 지움
 * (4) &lt; &gt; &quot; &#39; &#x27;를 풀고 마지막에 &amp;를 한 번 (5) 앞뒤 공백 빼기. 글이 아니거나 비면 null
 */
export function bandText(content: unknown): string | null {
  if (typeof content !== 'string') return null
  const tags = content
    .replace(REFER_RE, (_all, inner: string) => `@${inner}`)
    .replace(HASHTAG_RE, (_all, inner: string) => inner)
    .replace(BAND_TAG_RE, '')
  const text = tags.replace(ESCAPE_RE, (entity) => ESCAPES[entity] ?? entity).replace(/&amp;/g, '&').trim()
  return text === '' ? null : text
}

/** 코드 포인트 수가 max를 넘는가 */
export function longerThan(value: string, max: number): boolean {
  if (value.length <= max) return false
  let count = 0
  for (const _ch of value) {
    count += 1
    if (count > max) return true
  }
  return false
}

/** 코드 포인트 max개까지, 넘으면 앞 max개 + … */
export function clipWithEllipsis(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : value
}

/** 메시지 ID (band:<글 키>:<댓글 키>) — 댓글 키가 글이 아니거나 비었거나 256자를 넘으면 null */
export function bandMessageId(postKey: string, commentKey: unknown): string | null {
  if (typeof commentKey !== 'string' || commentKey === '') return null
  const id = `${BAND_PREFIX}${postKey}:${commentKey}`
  return id.length > PLATFORM_KEY_MAX ? null : id
}

/** 댓글 쓴 사람의 user_key (작성자가 없거나 글이 아니거나 비면 null) */
export function authorUserKey(item: unknown): string | null {
  if (!isObj(item)) return null
  const author = item['author']
  if (!isObj(author)) return null
  const key = author['user_key']
  return typeof key === 'string' && key !== '' ? key : null
}

export interface BandCommentInput {
  /** 연결한 판매자의 user_key */
  readonly sellerUserKey: string
  readonly postKey: string
  /** 댓글 목록 응답의 항목 하나 (모르는 칸은 무시한다) */
  readonly item: unknown
}

/** 댓글 하나 → chat 다섯 칸 또는 건너뜀 (골든 kind comment) */
export function bandComment(input: BandCommentInput): BandCommentOutcome {
  const item: Obj = isObj(input.item) ? input.item : {}
  const id = bandMessageId(input.postKey, item['comment_key'])
  if (id === null) return { skip: 'BAD_COMMENT_KEY' }
  const userKey = authorUserKey(item)
  if (userKey === null) return { skip: 'NO_AUTHOR' }
  const ch = `${BAND_PREFIX}${userKey}`
  if (ch.length > PLATFORM_KEY_MAX) return { skip: 'NO_AUTHOR' }
  if (userKey === input.sellerUserKey) return { skip: 'SELLER' }
  const createdAt = item['created_at']
  if (typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) || createdAt <= 0) return { skip: 'BAD_TIME' }
  const text = bandText(item['content'])
  if (text === null) return { skip: 'NO_TEXT' }
  if (longerThan(text, BAND_TEXT_MAX)) return { skip: 'TEXT_TOO_LONG' }
  const author = item['author'] as Obj
  const name = author['name']
  return { chat: { id, ch, nick: sanitizeNick(typeof name === 'string' ? name : ''), text, owner: false } }
}

export interface BandBatchInput {
  readonly sellerUserKey: string
  readonly postKey: string
  /** 이미 본 댓글 키 (기준선·기록한 것·건너뛴 것) */
  readonly known: Iterable<string>
  /** 한 번 읽은 목록 — 오래된 것부터 읽은 차례 */
  readonly items: readonly unknown[]
}

export interface BandBatchSkip {
  /** 댓글 키 (글이 아니면 null) */
  readonly key: string | null
  readonly code: BandSkipCode
}

/** 기록할 댓글 하나 (기록 차례) — key·작성 시각·읽은 차례를 함께 둔다 */
export interface BandBatchRecord {
  readonly key: string
  readonly chat: BandChatFields
  readonly createdAt: number
}

export interface BandBatchResult {
  /** 기록 차례 (작성 시각 오름차순, 같으면 읽은 차례) */
  readonly record: readonly BandBatchRecord[]
  /** 건너뛴 것 (입력 차례) */
  readonly skip: readonly BandBatchSkip[]
}

/** 한 번 읽은 목록 → 기록할 차례와 건너뜀 (골든 kind batch) */
export function bandBatch(input: BandBatchInput): BandBatchResult {
  const known = new Set(input.known)
  const inRead = new Set<string>()
  const recorded: { index: number; record: BandBatchRecord }[] = []
  const skip: BandBatchSkip[] = []
  input.items.forEach((item, index) => {
    const raw = isObj(item) ? item['comment_key'] : undefined
    const key = typeof raw === 'string' ? raw : null
    if (key !== null && known.has(key)) return
    if (key !== null && inRead.has(key)) {
      skip.push({ key, code: 'DUPLICATE' })
      return
    }
    if (key !== null) inRead.add(key)
    const outcome = bandComment({ sellerUserKey: input.sellerUserKey, postKey: input.postKey, item })
    if ('skip' in outcome) {
      skip.push({ key, code: outcome.skip })
      return
    }
    recorded.push({ index, record: { key: key as string, chat: outcome.chat, createdAt: (item as Obj)['created_at'] as number } })
  })
  recorded.sort((a, b) => a.record.createdAt - b.record.createdAt || a.index - b.index)
  return { record: recorded.map((entry) => entry.record), skip }
}

/** 글 목록의 첫 줄 (D-BND1-12): 본문을 D-BND1-04로 바꾼 뒤 첫 줄의 앞 40자(넘으면 …), 비면 "(글 없음)" */
export const BAND_FIRST_LINE_MAX = 40
export const BAND_EMPTY_POST = '(글 없음)'

export function bandFirstLine(content: unknown): string {
  const text = bandText(content)
  const line = text === null ? '' : (text.split(/\r?\n/)[0] ?? '').trim()
  return line === '' ? BAND_EMPTY_POST : clipWithEllipsis(line, BAND_FIRST_LINE_MAX)
}
