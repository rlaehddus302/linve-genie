// 유튜브 글 다루기 — 순수 함수 (AC-Y1-11·22·33·41·46, D-Y03·D-Y05·D-Y07·D-Y08).
// - 시청자 이름 정리(RA-S02-004): 수집 경로가 닉네임을 정리해 기록한다. 엔진·장부·라벨·감사 문구가 모두 같은 이름을 쓴다.
// - 게시 문구 정리: 효과 문구에서 공백 문자 → 한 칸, 보이지 않는 글자 삭제, 이어진 공백 한 칸·앞뒤 공백 삭제만 한다.
// - 묶음 문구·200자 분할(항목 경계), 영상 주소 → 영상 ID, 방송 후 요약 댓글.
// 글자 수는 코드 포인트로 센다(이모지 하나 = 1).

/** 실시간 채팅 메시지 한도 (유튜브, 코드 포인트) */
export const LIVE_CHAT_MAX = 200
/** 댓글 한도 */
export const COMMENT_MAX = 10_000
/** 감사 문구의 끝말 (엔진 formatThanksText) */
export const THANKS_SUFFIX = ' 구매 감사합니다'
/** 요약 댓글 첫 줄 */
export const SUMMARY_HEADER = '구매 감사합니다'
/** 이름 정리 뒤 빈 이름 대체 문구 */
export const EMPTY_NICK = '시청자'
/** 이름 길이 (코드 포인트) */
export const NICK_MAX = 30
/** 방송 후 요약 댓글 발송함 행의 종류 (엔진 효과가 아니다 — 재생 검사의 발송함 대조에서 뺀다) */
export const SUMMARY_KIND = 'SUMMARY_COMMENT'

const WHITE_SPACE = /\p{White_Space}/gu
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu
const AT_SIGNS = /[@＠﹫]/gu
const DOTS = /[.。．｡]/gu
const SPACES = / {2,}/g

const codePoints = (text: string): string[] => [...text]

/** 코드 포인트 수 */
export function charCount(text: string): number {
  return codePoints(text).length
}

/** max 코드 포인트를 넘으면 앞 (max − 1)자 + `…` */
export function truncate(text: string, max: number): string {
  const chars = codePoints(text)
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`
}

/**
 * 시청자 이름 정리 (AC-Y1-22, D-Y05). 이 순서로:
 * (1) 공백 문자(줄바꿈·탭·U+2028·U+2029 포함) → 공백 한 칸 (2) Cc·Cf·Default_Ignorable_Code_Point 삭제 (3) @·＠·﹫ 삭제
 * (4) .·。·．·｡ → ·(U+00B7) (5) 이어진 공백 한 칸, 앞뒤 공백 삭제 (6) 30자 넘으면 앞 30자 + … (7) 비면 `시청자`
 */
export function sanitizeNick(nick: string): string {
  const step = nick.replace(WHITE_SPACE, ' ').replace(INVISIBLE, '').replace(AT_SIGNS, '').replace(DOTS, '·').replace(SPACES, ' ').trim()
  const chars = codePoints(step)
  const cut = chars.length > NICK_MAX ? `${chars.slice(0, NICK_MAX).join('')}…` : step
  return cut === '' ? EMPTY_NICK : cut
}

/** 게시 문구 정리 (AC-Y1-33): 공백 문자 → 한 칸, Cc·Cf·Default_Ignorable 삭제, 이어진 공백 한 칸·앞뒤 공백 삭제 */
export function cleanPostText(text: string): string {
  return text.replace(WHITE_SPACE, ' ').replace(INVISIBLE, '').replace(SPACES, ' ').trim()
}

/** 실시간 채팅 한 건 문구: 정리한 뒤 200자를 넘으면 앞 199자 + … */
export function liveChatText(effectText: string): string {
  return truncate(cleanPostText(effectText), LIVE_CHAT_MAX)
}

/** 영상 댓글 한 건 문구: 정리한 뒤 1만 자를 넘으면 앞 9,999자 + … */
export function commentText(effectText: string): string {
  return truncate(cleanPostText(effectText), COMMENT_MAX)
}

export interface BatchItem {
  /** 발송함 행 ID (나눈 메시지마다 어느 행이 들었는지) */
  readonly id: number
  /** 엔진 효과 문구 */
  readonly text: string
}

export interface BatchMessage {
  readonly ids: readonly number[]
  readonly text: string
}

/** 항목 문구: 끝의 ` 구매 감사합니다`를 뗀 것 (끝말이 없으면 null — 그 효과는 혼자 보낸다) */
function itemOf(text: string): string | null {
  return text.endsWith(THANKS_SUFFIX) && text.length > THANKS_SUFFIX.length ? text.slice(0, -THANKS_SUFFIX.length) : null
}

/**
 * 묶음 문구와 200자 분할 (AC-Y1-41, D-Y07). 항목은 효과가 나온 순서대로 받는다.
 * - 한 건이면 효과 문구 그대로, 여럿이면 각 항목(끝말을 뗀 것)을 `, `로 이은 뒤 ` 구매 감사합니다`.
 * - 메시지 하나는 max자까지. 넘으면 항목 경계에서 나눈다(앞 메시지에 들어갈 수 있는 만큼). 한 사람의 감사가 두 메시지로 갈라지지 않는다.
 * - 항목 하나만으로 넘으면 그 항목은 혼자 한 메시지이고 그 효과의 한 건 문구를 앞 (max − 1)자 + `…`로 자른다.
 */
export function batchMessages(items: readonly BatchItem[], max = LIVE_CHAT_MAX): BatchMessage[] {
  const messages: BatchMessage[] = []
  let group: { id: number; item: string }[] = []
  const compose = (members: readonly { item: string }[]): string => `${members.map((member) => member.item).join(', ')}${THANKS_SUFFIX}`
  const flush = () => {
    if (group.length === 0) return
    messages.push({ ids: group.map((member) => member.id), text: compose(group) })
    group = []
  }
  for (const entry of items) {
    const text = cleanPostText(entry.text)
    const item = itemOf(text)
    if (item === null || charCount(text) > max) {
      // 끝말이 없거나 혼자서도 넘는 항목: 혼자 한 메시지
      flush()
      messages.push({ ids: [entry.id], text: truncate(text, max) })
      continue
    }
    if (group.length > 0 && charCount(compose([...group, { item }])) > max) flush()
    group.push({ id: entry.id, item })
  }
  flush()
  // 한 건만 든 메시지는 효과 문구 그대로 (묶음 문구와 같다: 항목 + 끝말)
  return messages
}

export interface SummaryLine {
  readonly no: number
  /** 지금 상품 이름 (비면 품종과 그 뒤 공백을 뺀다) */
  readonly name: string
  /** 옵션 글 (옵션 찜만 — 코어 ClaimInfo.variant, 감사 문구와 같은 글. O3 감사 D-O3-13) */
  readonly variant?: string
  /** 수량 (2 이상일 때만 — `{수량}개`) */
  readonly qty?: number
  /** 가격 표시 (찜 금액의 formatWon) */
  readonly price: string
  /** 구매자 표시 이름 */
  readonly buyer: string
}

/**
 * 방송 후 요약 댓글 (AC-Y1-46, D-Y08): 첫 줄 `구매 감사합니다`, 판매마다 `{번호}번[ {품종}][ {옵션 글}][ {수량}개] {찜 금액} {구매자}님`, `\n`으로 잇는다.
 * 옵션 글은 옵션이 있을 때만, 수량은 2 이상일 때만 — 감사 문구와 같은 자리(R-19 "표시", O3 감사 D-O3-13). 옵션 없는 수량 1 줄은 O3 전과 같다.
 * 1만 자를 넘으면 줄 경계에서 나눠 여러 댓글(둘째부터 첫 줄 없이). 줄마다 게시 문구 정리를 한다(줄바꿈은 줄 사이에만).
 * 줄 하나가 혼자 1만 자를 넘으면 그 줄을 자른다. 판매가 없으면 빈 목록
 */
export function summaryComments(lines: readonly SummaryLine[], max = COMMENT_MAX): string[] {
  if (lines.length === 0) return []
  const comments: string[] = []
  let current: string[] = [SUMMARY_HEADER]
  let length = charCount(SUMMARY_HEADER)
  for (const line of lines) {
    const name = cleanPostText(line.name)
    const variant = line.variant === undefined ? '' : cleanPostText(line.variant)
    const qty = line.qty !== undefined && line.qty >= 2 ? [`${String(line.qty)}개`] : []
    const raw = cleanPostText([`${String(line.no)}번`, ...(name === '' ? [] : [name]), ...(variant === '' ? [] : [variant]), ...qty, line.price, `${line.buyer}님`].join(' '))
    const onlyHeader = comments.length === 0 && current.length === 1
    if (current.length > 0 && !onlyHeader && length + 1 + charCount(raw) > max) {
      comments.push(current.join('\n'))
      current = []
      length = 0
    }
    const text = truncate(raw, current.length === 0 ? max : max - length - 1)
    length += (current.length === 0 ? 0 : 1) + charCount(text)
    current.push(text)
  }
  comments.push(current.join('\n'))
  return comments
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/**
 * 유튜브 주소·영상 ID → 영상 ID (AC-Y1-11, D-Y03). 받는 것:
 * `youtube.com/watch?v=ID`(www.·m.·http(s)·주소 앞 없이, 다른 매개변수·순서 상관없음), `youtu.be/ID`, `youtube.com/live/ID`,
 * `studio.youtube.com/video/ID/…`, `ID` 그 자체, 앞뒤 공백. 그 밖은 null.
 */
export function parseVideoId(input: string): string | null {
  const text = input.trim()
  if (text === '') return null
  if (VIDEO_ID.test(text)) return text
  const withScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username !== '' || url.password !== '' || url.port !== '') return null
  const host = url.hostname.toLowerCase()
  const parts = url.pathname.split('/').filter((part) => part !== '')
  let id: string | null = null
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    if (parts.length === 1 && parts[0] === 'watch') id = url.searchParams.get('v')
    else if (parts.length === 2 && parts[0] === 'live') id = parts[1] ?? null
  } else if (host === 'youtu.be' || host === 'www.youtu.be') {
    if (parts.length === 1) id = parts[0] ?? null
  } else if (host === 'studio.youtube.com') {
    if (parts.length >= 2 && parts[0] === 'video') id = parts[1] ?? null
  }
  return id !== null && VIDEO_ID.test(id) ? id : null
}
