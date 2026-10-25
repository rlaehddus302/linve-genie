// 낱말 목록 (V3): 정정 표시·취소·칸 이름(D-V2-05), 품종 추측 군말(R-17 7), 풀이말 끝(D-V3-30), 흔한 말 검사(D-V3-38).
// 의존이 없는 곳에 두어 사전(dictionary.ts)·정정(correction.ts)·등록(register.ts)이 함께 쓴다(가져오기 고리가 생기지 않게).
import { normalizeText } from '@livejjim/core'
import { STOP_WORDS } from './default-dictionary.ts'

export type ChunkField = 'no' | 'name' | 'price'

/** 정정 표시 (D-V2-05). `말고`로 끝나는 토큰은 앞 글 + 표시 */
export const CORRECTION_MARKERS: readonly string[] = Object.freeze(['아니', '아니야', '아니요', '아니고', '다시', '정정', '말고'])
/** 취소 낱말 */
export const CANCEL_WORDS: readonly string[] = Object.freeze(['취소', '취소요', '취소해', '취소해요', '취소할게요'])
/** 칸 이름 → 칸 */
export const FIELD_NAMES: Readonly<Record<string, ChunkField>> = Object.freeze({ 품종은: 'name', 품종: 'name', 이름은: 'name', 가격은: 'price', 번호는: 'no' })
/** 군말 목록 (R-17 7). 실제 군말 = 이 목록 ∪ 기본 사전 stopWords ∪ 정정 표시·취소 낱말·칸 이름 */
export const GUESS_FILLERS: readonly string[] = Object.freeze([
  ...'요거 이거 그거 저거 요것 이것 그것 저것 요건 이건 그건 저건 요게 이게 그게 저게 요놈 이놈 얘 쟤 걔 아이 요아이 유아이'.split(' '),
  ...'그대로 보냅니다 보내요 보내드려요 보내드릴게요 봅니다 봐요 보여요 드려요 드립니다 드릴게요 갑니다 가요 나갑니다 나가요'.split(' '),
  ...'할게요 해요 합니다 있어요 있습니다 있고요 없어요 들었어요 나왔습니다 남았고요 예쁘게 진짜 정말 완전 너무 엄청 아주 되게 많이'.split(' '),
  ...'일단 이제 지금 오늘 여기 거기 저기 이렇게 요렇게 그렇게 그러면 그럼 그리고 그래서 네네 예예 자자 여러분 사장님 언니 고객님'.split(' '),
  ...'다음 다음은 이번 분양 분양합니다'.split(' '),
])
/** 낱말 최대 길이(코드 포인트) */
export const GUESS_WORD_MAX = 20

const lowerAscii = (text: string): string => text.replace(/[A-Z]/g, (char) => char.toLowerCase())
const FILLER_KEYS: ReadonlySet<string> = new Set(
  [...GUESS_FILLERS, ...STOP_WORDS, ...CORRECTION_MARKERS, ...CANCEL_WORDS, ...Object.keys(FIELD_NAMES)].map((word) => lowerAscii(normalizeText(word).split(' ').join(''))),
)
/** 풀이말 끝 모양 (R-17 7, D-V3-30): 낱말이 이 글자로 끝나면 후보 낱말이 아니다 (`나왔네`·`좋다`·`예쁘고`) */
export const PREDICATE_END_CHARS: readonly string[] = Object.freeze(['다', '요', '죠', '네', '까', '고', '게', '서', '면', '데'])
export const looksLikePredicate = (word: string): boolean => PREDICATE_END_CHARS.some((char) => word.endsWith(char))

/** 군말인가 — 영어 대문자는 소문자로 보고 맞춘다(`UI` = `ui`, 크롬이 "요 아이"를 적은 꼴) */
export const isFiller = (text: string): boolean => FILLER_KEYS.has(lowerAscii(text))

/** 흔한 말인가 (D-V3-38): 2글자 이하 · 군말 · 풀이말 끝 · 숫자가 든 글 — 배운 별칭으로 배우지 않고 읽을 때도 버린다 */
export function isCommonWord(text: string): boolean {
  const key = normalizeText(text).split(' ').join('')
  return [...key].length <= 2 || isFiller(key) || looksLikePredicate(key) || /[0-9]/.test(key)
}
