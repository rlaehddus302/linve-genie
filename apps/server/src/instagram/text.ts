// 인스타그램 글 다루기 (D-N2-03, AC-N2-44).

/** 인스타그램 username 모양: 영문·숫자·`.`·`_` 1~30자 (D-N2-03) */
export const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/
/** username 모양이 아니면(없음·다른 글자) 적는 이름 */
export const FALLBACK_NICK = '시청자'

/** 웹훅 from.username → chat nick: 모양이 맞으면 그대로(`.`도 그대로 — 이름 정리를 하지 않는다), 아니면 `시청자` */
export function instagramNick(username: unknown): string {
  return typeof username === 'string' && USERNAME_RE.test(username) ? username : FALLBACK_NICK
}

/** DM 한 줄의 글자 수 상한 (코드 포인트). 넘으면 앞 189자 + `…` */
export const DM_LINE_MAX = 190
/** DM 하나의 줄 수 상한 (메시지 하나의 번호 상한 D-034) */
export const DM_LINES_MAX = 5

const WHITE_SPACE = /\p{White_Space}/gu
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu

/**
 * DM 한 줄 (AC-N2-44): 공백 문자(줄바꿈·탭·U+2028·U+2029 포함) → 한 칸, Unicode Cc·Cf·Default_Ignorable_Code_Point 글자 삭제,
 * 이어진 공백 한 칸·앞뒤 공백 삭제. 190자(코드 포인트)를 넘으면 앞 189자 + `…`
 */
export function dmLine(text: string): string {
  const cleaned = text.replace(WHITE_SPACE, ' ').replace(INVISIBLE, '').replace(/ {2,}/g, ' ').trim()
  const points = [...cleaned]
  return points.length > DM_LINE_MAX ? `${points.slice(0, DM_LINE_MAX - 1).join('')}…` : cleaned
}

/** DM 글: 줄들을 나온 순서로 `\n`으로 잇는다 (최대 5줄 — 부르는 쪽이 5줄까지만 넘긴다) */
export function dmText(lines: readonly string[]): string {
  return lines.slice(0, DM_LINES_MAX).join('\n')
}
