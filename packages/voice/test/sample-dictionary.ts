// 추출 시험이 함께 쓰는 고정 시드 사전·문장 (AC-P2-07). 같은 시드 = 같은 사전·문장.
// 정확성 시험(extract-filter.test.ts)과 성능 시험(extract.perf.test.ts, D-902 — pnpm perf)이 같은 재료를 쓴다.
import fc from 'fast-check'
import { DEFAULT_DICTIONARY, normalizeDictionary } from '../src/index.ts'

const SYLLABLES = [...'가나다라마바사아자차카타파하핑크프릴울루벨엘블레티지금방복랑왕비뇌신천사의눈물로황블랙린스보월미인홍옥청을녀심']

/** 고정 시드로 만든 size개 사전 (2~6글자, 가끔 띄어 씀) + 기본 사전 */
export function seededDictionary(size: number, seed: number): string[] {
  const names = fc.sample(
    fc.array(fc.constantFrom(...SYLLABLES), { minLength: 2, maxLength: 6 }).map((chars) => (chars.length > 4 ? `${chars.slice(0, 3).join('')} ${chars.slice(3).join('')}` : chars.join(''))),
    { numRuns: size * 2, seed },
  )
  return normalizeDictionary([...DEFAULT_DICTIONARY, ...names]).slice(0, size)
}

/** 사전에 정확히 같은 이름이 없는 20토큰 문장 (거리 계산을 모두 하는 느린 쪽) */
export function hardSentences(count: number, seed: number): string[] {
  const filler = ['자', '이거', '진짜', '예뻐요', '보세요', '다음', '거', '핑크푸릴이랑', '라울', '나울', '벨루', '만오천', '원에', '15번', '드릴게요', '금이에요', '방울복랑', '하나', '남았어요', '빨리']
  return fc.sample(fc.array(fc.constantFrom(...filler), { minLength: 20, maxLength: 20 }).map((tokens) => tokens.join(' ')), { numRuns: count, seed })
}
