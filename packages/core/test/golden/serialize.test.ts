// 결정성 검사용 직렬화의 빠른 길 = 기준 구현 (AC-S00-27, NFR-02). 결과 글자와 오류 문장이 같아야 한다.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { referenceSerialize, stableSerialize } from './serialize.ts'

type Outcome = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly message: string }

const outcome = (serialize: (value: unknown) => string, value: unknown): Outcome => {
  try {
    return { ok: true, text: serialize(value) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
}

const same = (value: unknown): void => {
  expect(outcome(stableSerialize, value)).toEqual(outcome(referenceSerialize, value))
}

describe('직렬화 빠른 길', () => {
  it('속성: 아무 값이나 — 빠른 길과 기준 구현의 결과(또는 오류 문장)가 같다', () => {
    fc.assert(
      fc.property(
        fc.anything({
          withBigInt: true,
          withMap: true,
          withSet: true,
          withNullPrototype: true,
          withBoxedValues: true,
          withDate: true,
          withSparseArray: true,
          withTypedArray: true,
          withUnicodeString: true,
          maxDepth: 6,
        }),
        (value) => {
          same(value)
        },
      ),
      { numRuns: 2000 },
    )
  })

  it('같은 글자를 여러 번 적어도(기억해 둔 글자) 결과가 같다 — 키 순서·따옴표·제어 글자·서로게이트', () => {
    const texts = ['a', '"', '\\', '\n', '\u0000', '\ud800', '🌵', '__proto__', 'constructor', '0', '31', '']
    for (let round = 0; round < 3; round++) {
      for (const text of texts) {
        same(text)
        same({ [text]: text })
        same([text, { k: text }])
      }
    }
    expect(stableSerialize({ b: 1, a: 2 })).toBe('{"b":1,"a":2}')
    expect(stableSerialize({ '\n': '"' })).toBe('{"\\n":"\\""}')
  })

  it('아주 깊은 값(순환 아님)은 기준 구현으로 다시 돌아 같은 글자', () => {
    let deep: unknown = 'leaf'
    for (let i = 0; i < 400; i++) deep = i % 2 === 0 ? [deep] : { d: deep }
    same(deep)
    expect(stableSerialize(deep)).toContain('"leaf"')
  })

  it('깊은 곳의 순환 참조·함수·클래스 인스턴스 — 오류 문장(경로 포함)이 기준 구현과 같다', () => {
    const cyclic: Record<string, unknown> = { a: [{ b: new Map<unknown, unknown>([['k', null]]) }] }
    ;((cyclic.a as Record<string, unknown>[])[0]?.b as Map<unknown, unknown>).set('loop', cyclic)
    same(cyclic)
    expect(() => stableSerialize(cyclic)).toThrow('순환 참조가 있다: a[0].b<1>')
    same({ x: [1, { y: new Set([() => 1]) }] })
    expect(() => stableSerialize({ x: [1, { y: new Set([() => 1]) }] })).toThrow('직렬화할 수 없는 값(function)이 있다: x[1].y<0>')
    same({ when: new Date(0) })
    same(new Map([[{ k: Symbol('s') }, 1]]))
    same(Symbol('top'))
    same(() => 1)
  })
})
