// 틱톡 댓글 → 공통 댓글 레코드 (PLT-02, D-N2b-1-03·04, AC-N2b-1-20~23·51, 골든 tests/golden/tiktok/comment.json).
// 거르개는 실제 연결기와 가짜 웹캐스트에 같은 코드다. 바깥 호출·시계·난수가 없다(받은 시각은 부르는 쪽이 넘긴다).
// 레코드에는 꼭 필요한 일곱 칸만 둔다(DAT-06) — 프로필 사진·배지·secUid 같은 원본 자료는 꺼내지도 남기지도 않는다.
import { asciiLower } from './target.ts'

/** 공통 댓글 레코드 — 정확히 일곱 칸 */
export interface TikTokCommentRecord {
  readonly platform: 'TIKTOK'
  /** 댓글 ID — 0으로 시작하지 않는 양의 10진 문자열(1~32자리) */
  readonly commentId: string
  /** 숫자 사용자 ID(구매자 키) — 같은 모양. 아이디(uniqueId)로 대신하지 않는다 */
  readonly userId: string
  /** 다듬은 닉네임(비면 다듬은 아이디, 그것도 없으면 빈 글), 64자(코드 포인트)까지 */
  readonly nickname: string
  /** 받은 글 그대로 (다듬지 않는다 — 파서가 읽는다) */
  readonly text: string
  /** 서버가 그 댓글을 받은 시각 (UTC ISO 밀리초) */
  readonly receivedAt: string
  /** 댓글 쓴 사람이 연결한 방송자 본인인가 */
  readonly owner: boolean
}

/** 버림 코드 (이 순서로 검사, 처음 걸린 것) */
export type TikTokDropCode = 'BAD_COMMENT_ID' | 'BAD_USER_ID' | 'NO_TEXT' | 'TEXT_TOO_LONG' | 'DUPLICATE'

export type TikTokCommentOutcome = { readonly record: TikTokCommentRecord } | { readonly drop: TikTokDropCode }

/**
 * 라이브러리 chat 이벤트에서 꺼낸 값 (골든 `raw`와 같은 키). 모두 선택이고 아무 값이나 올 수 있다 — 틀린 모양이 버림 사례다.
 * 키가 없는 것과 null은 둘 다 "값 없음"이다. createTime(틱톡 쪽 시각)은 받기만 하고 쓰지 않는다.
 */
export interface TikTokRawComment {
  readonly msgId?: unknown
  readonly userId?: unknown
  readonly uniqueId?: unknown
  readonly nickname?: unknown
  readonly comment?: unknown
  readonly createTime?: unknown
}

/** 내보낸 레코드·중복·그 밖의 버림 수 */
export interface TikTokCommentCounts {
  readonly received: number
  readonly duplicates: number
  readonly dropped: number
}

/** 반드시 기억하는 가장 최근 댓글 ID 수 (D-N2b-1-04 — 방송 1회 채팅 1만 건의 두 배) */
export const TIKTOK_COMMENT_MEMORY = 20_000
export const TIKTOK_NICKNAME_MAX = 64
export const TIKTOK_TEXT_MAX = 500

const DECIMAL_ID_RE = /^[1-9][0-9]{0,31}$/

/**
 * ID 값 → 0으로 시작하지 않는 양의 10진 문자열(1~32자리), 아니면 null.
 * 문자열은 그대로 검사한다(다듬지 않는다). 숫자는 안전한 양의 정수만, bigint는 양수만 — 숫자(number)로 바꾸는 경로가 없다.
 */
export function decimalId(value: unknown): string | null {
  if (typeof value === 'string') return DECIMAL_ID_RE.test(value) ? value : null
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  if (typeof value === 'bigint') {
    if (value <= 0n) return null
    const text = value.toString()
    return DECIMAL_ID_RE.test(text) ? text : null
  }
  return null
}

/** 코드 포인트 max개까지 자른다 (긴 글도 앞부분만 본다) */
function clipCodePoints(value: string, max: number): string {
  let count = 0
  let end = 0
  for (const ch of value) {
    if (count === max) return value.slice(0, end)
    count += 1
    end += ch.length
  }
  return value
}

/** 코드 포인트 수가 max를 넘는가 (max+1개까지만 센다) */
function longerThan(value: string, max: number): boolean {
  if (value.length <= max) return false
  let count = 0
  for (const _ch of value) {
    count += 1
    if (count > max) return true
  }
  return false
}

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** 같은 댓글 ID를 한 번만 내보내는 거르개 (연결 객체 하나가 하나를 가진다 — 판매자끼리 나누지 않는다) */
export interface TikTokCommentFilter {
  /** 댓글 하나를 받은 순서대로 넣는다. receivedAt = 서버가 받은 시각 */
  accept(raw: unknown, receivedAt: Date): TikTokCommentOutcome
  counts(): TikTokCommentCounts
  /** 기억하는 댓글 ID 수 (시험용 조회) */
  readonly memorySize: number
}

/**
 * 새 거르개. target = 연결한 틱톡 아이디(해석이 돌려준 소문자 아이디). 댓글 쓴 사람의 아이디(다듬고 ASCII 소문자)가 같으면 owner.
 * 검사 순서: 댓글 ID → 사용자 ID → 본문 → 중복. 기억에 넣는 것은 내보낸 레코드의 ID뿐이다.
 */
export function createCommentFilter(target: string, memory: number = TIKTOK_COMMENT_MEMORY): TikTokCommentFilter {
  const limit = Math.max(1, Math.floor(memory))
  const seen = new Set<string>()
  const ring: string[] = []
  let head = 0
  let received = 0
  let duplicates = 0
  let dropped = 0

  const remember = (id: string): void => {
    if (ring.length < limit) {
      ring.push(id)
    } else {
      const oldest = ring[head]
      if (oldest !== undefined) seen.delete(oldest)
      ring[head] = id
      head = (head + 1) % limit
    }
    seen.add(id)
  }

  const drop = (code: TikTokDropCode): TikTokCommentOutcome => {
    if (code === 'DUPLICATE') duplicates += 1
    else dropped += 1
    return Object.freeze({ drop: code })
  }

  return {
    accept(input, receivedAt) {
      const raw: TikTokRawComment = typeof input === 'object' && input !== null ? (input as TikTokRawComment) : {}
      const commentId = decimalId(raw.msgId)
      if (commentId === null) return drop('BAD_COMMENT_ID')
      const userId = decimalId(raw.userId)
      if (userId === null) return drop('BAD_USER_ID')
      const text = raw.comment
      if (typeof text !== 'string' || text.trim() === '') return drop('NO_TEXT')
      if (longerThan(text, TIKTOK_TEXT_MAX)) return drop('TEXT_TOO_LONG')
      if (seen.has(commentId)) return drop('DUPLICATE')
      const nick = trimmed(raw.nickname)
      const record: TikTokCommentRecord = Object.freeze({
        platform: 'TIKTOK',
        commentId,
        userId,
        nickname: clipCodePoints(nick !== '' ? nick : trimmed(raw.uniqueId), TIKTOK_NICKNAME_MAX),
        text,
        receivedAt: receivedAt.toISOString(),
        owner: typeof raw.uniqueId === 'string' && asciiLower(raw.uniqueId.trim()) === target,
      })
      remember(commentId)
      received += 1
      return Object.freeze({ record })
    },
    counts: () => Object.freeze({ received, duplicates, dropped }),
    get memorySize() {
      return seen.size
    },
  }
}

// ── 라이브러리 chat 이벤트 → 다섯 값 (AC-N2b-1-21·22) ─────────────────────────

type Obj = Record<string, unknown>
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null

/**
 * 64비트 정수 모양 → 정밀도 손실 없는 값. tiktok-live-connector 2.1.0은 int64를 `reader.int64().toString()`으로 10진 문자열로 준다.
 * 그 밖의 모양도 받는다: bigint는 그대로, protobuf 정수 객체({ low, high, unsigned })는 bigint로 묶어 10진 문자열로 바꾼다.
 * 숫자(number)는 그대로 두어 거르개가 안전 정수인지 본다. 그 밖의 값은 그대로 두어 거르개가 버린다.
 */
export function int64Value(value: unknown): unknown {
  if (!isObj(value)) return value
  const { low, high, unsigned } = value
  if (typeof low !== 'number' || typeof high !== 'number' || !Number.isInteger(low) || !Number.isInteger(high)) return value
  const bits = (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0)
  return (unsigned === true ? bits : BigInt.asIntN(64, bits)).toString()
}

/**
 * 라이브러리 2.1.0 chat 이벤트(WebcastChatMessage: `common.msgId`·`common.createTime`, `user.userId`·`user.uniqueId`·`user.nickname`, `comment`)에서
 * 거르개가 쓰는 값만 꺼낸다. 모양이 틀려도(필드 없음·user 없음·null·읽으면 오류가 나는 값) 예외 없이 빈 값으로 둔다 → 거르개가 버린다.
 */
export function chatEventFields(event: unknown): TikTokRawComment {
  try {
    if (!isObj(event)) return {}
    const common = isObj(event['common']) ? event['common'] : {}
    const user = isObj(event['user']) ? event['user'] : {}
    return {
      msgId: int64Value(common['msgId']),
      userId: int64Value(user['userId']),
      uniqueId: user['uniqueId'],
      nickname: user['nickname'],
      comment: event['comment'],
      createTime: common['createTime'],
    }
  } catch {
    return {}
  }
}
