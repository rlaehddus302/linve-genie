// 앞 결과와 이어질 수 있는 번호 (R-17 8 7, D-V3-102 — 실방송 경성 159→59, 231→1, 173·193→3, 128→28).
// 크롬 결과가 바뀌며 번호 앞자리가 앞 결과 끝에 남는다: 앞 결과 "… 3만 원 159", 새 결과 "59번 …".
// 그 번호로 바로 등록·바로 고치지 않고 묻는다 — 저절로 되살리지 않는다(D-V3-81과 다름).
// 순수 함수: 시계를 읽지 않고(now를 받는다) 넘긴 값을 바꾸지 않는다.
import { readingForms } from './extract.ts'
import { WINDOW_ONE_CHAR_FILLERS, isWindowFiller } from './words.ts'

/** 앞 결과가 끝난 뒤 이 시간 안의 새 결과만 본다 (밀리초) — 10,000ms면 보고 10,001ms면 안 본다 */
export const JOIN_PREV_MS = 10_000

export interface JoinPreviousInput {
  /** 바로 앞 크롬 결과(최종)의 글 — 없으면 null */
  readonly previous: string | null
  /** 그 결과가 끝난 시각 (UTC 밀리초) */
  readonly previousAt: number | null
  /** 지금 크롬 결과의 글 (중간이든 최종이든) */
  readonly text: string
  readonly now: number
  readonly maxNumber: number
}

export interface JoinPrevious {
  /** 새 결과 첫 'N번'의 N */
  readonly heard: number
  /** 이어 읽을 수 있는 번호 (ⓐ 앞 결과 끝 수 T · ⓑ T와 N을 이은 수) */
  readonly joined: number
}

const DIGITS = /^[0-9]{1,4}$/
const MARKER = /^([0-9]{1,4})번$/
/** 끝 문장 부호 */
const stripPunctuation = (token: string): string => token.replace(/[.,!?…~·]+$/u, '')

/** 새 결과 첫 'N번' 앞에 와도 되는 말: 한 글자 군말(`자`·`네`·`어` …)만 — "자 좋아요 59번"은 앞에 말이 있어 보지 않는다 (AC-V3-93 (9)) */
const isLeadFiller = (token: string): boolean => WINDOW_ONE_CHAR_FILLERS.includes(token)

/** 새 결과의 첫 번호 표시 'N번' — 그 앞엔 군말만. 없으면 null */
function firstMarker(text: string): number | null {
  for (const raw of text.trim().split(/\s+/)) {
    const token = stripPunctuation(raw)
    if (token === '') continue
    for (const form of readingForms(token)) {
      const m = MARKER.exec(form)
      if (m !== null) return Number(m[1])
    }
    if (!isLeadFiller(token)) return null
  }
  return null
}

/**
 * 앞 결과의 마지막 토큰(군말 건너뜀): 숫자 1~4자리 T면 { tail: T, marker: false },
 * 번호 표시 `T번`(붙여 쓴 꼴·띄어 쓴 `T 번`, D-V3-107)이면 { tail: T, marker: true }, 아니면 null
 */
function lastTail(text: string): { readonly tail: string; readonly marker: boolean } | null {
  const tokens = text.trim().split(/\s+/).map(stripPunctuation).filter((token) => token !== '')
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i] as string
    if (DIGITS.test(token)) return { tail: token, marker: false }
    for (const form of readingForms(token)) {
      const m = MARKER.exec(form)
      if (m !== null) return { tail: m[1] as string, marker: true }
      if (form === '번') {
        const before = tokens[i - 1]
        return before !== undefined && DIGITS.test(before) ? { tail: before, marker: true } : null
      }
    }
    if (!isWindowFiller(token)) return null
  }
  return null
}

/**
 * 새 결과 첫 'N번'이 앞 결과 끝 수 T와 이어질 수 있는가 (R-17 8 7):
 * 앞 결과 끝이 `T번`이면 ⓐ만 (D-V3-107).
 * ⓐ T가 N보다 길고 T의 끝자리들이 N과 같다(`159`·`59번` → 159) 또는 ⓑ T와 N을 이은 수 ≤ maxNumber(`23`·`1번` → 231). 아니면 null
 */
export function joinPrevious(input: JoinPreviousInput): JoinPrevious | null {
  try {
    const { previous, previousAt, now } = input
    if (typeof previous !== 'string' || typeof previousAt !== 'number' || !Number.isFinite(previousAt) || !Number.isFinite(now)) return null
    if (now < previousAt || now - previousAt > JOIN_PREV_MS) return null
    const heard = firstMarker(typeof input.text === 'string' ? input.text : '')
    if (heard === null || heard < 1) return null
    const last = lastTail(previous)
    if (last === null) return null
    const { tail } = last
    const n = String(heard)
    if (tail.length > n.length && tail.endsWith(n) && Number(tail) >= 1) return { heard, joined: Number(tail) }
    // ⓑ 이어 붙이기는 번호 표시에 쓰지 않는다 — `23번` 뒤 `1번`은 번호를 다 말한 것 (D-V3-107)
    if (last.marker) return null
    const joined = Number(tail + n)
    if (Number.isSafeInteger(joined) && joined >= 1 && joined <= input.maxNumber && joined !== heard) return { heard, joined }
    return null
  } catch {
    return null
  }
}

/** 제안 카드 안내 ("59번으로 들렸어요. 159번이 맞는지 확인해 주세요") */
export const joinPreviousNote = (heard: number, joined: number): string => `${String(heard)}번으로 들렸어요. ${String(joined)}번이 맞는지 확인해 주세요`
