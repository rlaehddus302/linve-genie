// AC-S00-21: YAML 1.2 core schema — `no:` 키, `OFF`·`yes`·`on` 값, 날짜는 모두 문자열
import { describe, expect, it } from 'vitest'
import { parseGoldenYaml } from './yaml.ts'

function single(text: string): unknown {
  const result = parseGoldenYaml(text)
  if (!result.ok) throw new Error(`읽기 실패: ${JSON.stringify(result.issues)}`)
  expect(result.documents).toHaveLength(1)
  return result.documents[0]?.value
}

describe('YAML 1.2 core schema (AC-S00-21)', () => {
  it('no: 키는 문자열 키, OFF·yes·on·no·off·y·n 값은 문자열', () => {
    const value = single('no: OFF\nyes: on\nflags: [yes, no, on, off, y, n, Yes, NO, On, Off]\n')
    expect(value).toEqual({ no: 'OFF', yes: 'on', flags: ['yes', 'no', 'on', 'off', 'y', 'n', 'Yes', 'NO', 'On', 'Off'] })
    expect(Object.keys(value as object)).toEqual(['no', 'yes', 'flags'])
  })

  it('date: 2026-10-18 은 날짜 객체가 아닌 문자열 그대로 (시간대 때문에 하루 밀리지 않음)', () => {
    const value = single('date: 2026-10-18\nat: 20:00:00\niso: 2026-10-19T00:00:10+09:00\n') as Record<string, unknown>
    expect(value.date).toBe('2026-10-18')
    expect(typeof value.date).toBe('string')
    expect(value.at).toBe('20:00:00') // YAML 1.1의 60진수 정수(72000)가 아니다
    expect(value.iso).toBe('2026-10-19T00:00:10+09:00')
  })

  it('불리언은 true/false만 (README). True·TRUE·False는 문자열', () => {
    expect(single('a: true\nb: false\nc: True\nd: TRUE\ne: False\n')).toEqual({ a: true, b: false, c: 'True', d: 'TRUE', e: 'False' })
  })

  it('정수·null은 core schema대로', () => {
    expect(single('a: 15\nb: 015\nc: ~\nd: null\ne: 0x10\nf: "15"\n')).toEqual({ a: 15, b: 15, c: null, d: null, e: 16, f: '15' })
  })

  it('병합 키(<<)는 일반 키다 (YAML 1.1 기능을 켜지 않는다)', () => {
    expect(single('a: { <<: { b: 1 } }\n')).toEqual({ a: { '<<': { b: 1 } } })
  })

  it('여러 문서를 순서대로 읽고 문서 번호는 1부터', () => {
    const result = parseGoldenYaml('a: 1\n---\nb: 2\n---\nc: 3\n')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.documents.map((d) => [d.index, d.value])).toEqual([
      [1, { a: 1 }],
      [2, { b: 2 }],
      [3, { c: 3 }],
    ])
  })

  it('경로의 줄 번호를 찾는다 (없는 경로는 가장 가까운 상위 노드)', () => {
    const result = parseGoldenYaml('id: x\nevents:\n  - { at: "20:00:00", type: chat }\n  - { at: "20:00:01" }\n')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.documents[0]
    expect(doc?.lineOf(['events', 1, 'at'])).toBe(4)
    expect(doc?.lineOf(['events', 0, 'type'])).toBe(3)
    expect(doc?.lineOf(['events', 1, 'missing'])).toBe(4)
    expect(doc?.lineOf([])).toBe(1)
  })

  it.each([
    ['중복 키', 'a: 1\na: 2\n', 2, 'unique'],
    ['문법 오류', 'a: [1, 2\n', 2, ''],
    ['명시적 태그 !!timestamp', 'a: !!timestamp 2026-10-18\n', 1, '명시적 태그'],
    ['명시적 태그 !!str', 'a: !!str 15\n', 1, '명시적 태그'],
    ['모르는 태그', 'a: !foo x\n', 1, ''],
  ])('%s는 읽기 오류 (줄 번호 포함)', (_name, text, line, fragment) => {
    const result = parseGoldenYaml(text)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues[0]?.line).toBe(line)
    expect(result.issues.map((i) => i.message).join('\n')).toContain(fragment)
  })

  it('주석만 있는 파일은 문서 0개', () => {
    const result = parseGoldenYaml('# 주석만\n')
    expect(result).toEqual({ ok: true, documents: [] })
  })
})
