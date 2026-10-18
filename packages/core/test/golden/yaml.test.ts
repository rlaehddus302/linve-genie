// AC-S00-21: YAML 1.2 core schema — `no:` 키, `OFF`·`yes`·`on` 값, 날짜는 모두 문자열
import { describe, expect, it } from 'vitest'
import { createFakeCore, emptySnapshot } from './fake-core.ts'
import { run, scenario } from './test-helpers.ts'
import { YamlFloat, parseGoldenYaml } from './yaml.ts'

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

describe('실수 표기는 숫자로 바꾸지 않는다 — 정수 자리에 쓰면 그 경로의 읽기 오류 (README 형식 계약 "정수", D-021, TD-S00-006)', () => {
  it('core schema의 실수(!!float)는 원문을 든 YamlFloat, 정수(10진·0o·0x)는 숫자 그대로', () => {
    const value = single('a: 10.000\nb: 1e4\nc: 10000.0\nd: .5\ne: .inf\nf: -.inf\ng: .nan\nh: 1.\ni: 10000\nj: -5\nk: +3\nl: 0o17\nm: 0x1F\nn: "10.000"\n') as Record<string, unknown>
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) expect(value[key], key).toBeInstanceOf(YamlFloat)
    expect((value.a as YamlFloat).source).toBe('10.000')
    expect((value.b as YamlFloat).source).toBe('1e4')
    expect([value.i, value.j, value.k, value.l, value.m, value.n]).toEqual([10000, -5, 3, 15, 31, '10.000'])
  })

  it('목록 안과 별칭도 같다, 맵 키는 바꾸지 않는다', () => {
    const value = single('a: [15, 15.0]\nb: &x 2.5\nc: *x\n1.5: y\n') as Record<string, unknown>
    expect((value.a as unknown[])[0]).toBe(15)
    expect((value.a as unknown[])[1]).toBeInstanceOf(YamlFloat)
    expect(value.b).toBeInstanceOf(YamlFloat)
    expect(value.c).toBeInstanceOf(YamlFloat)
    expect(value['1.5']).toBe('y')
  })

  const scenarioWith = (priceLiteral: string): string =>
    [
      'id: G-ENG-950',
      'title: 실수 표기',
      'refs: [R-4]',
      'broadcasts:',
      '  - { id: b1, date: 2026-10-18, title: 1부 }',
      'events:',
      `  - { at: "20:00:00", type: product.register, b: b1, no: 15, name: 핑크프릴, price: ${priceLiteral} }`,
      'expect: {}',
      '',
    ].join('\n')

  it.each(['10.000', '1e4', '10000.0', '1.0e+4', '.inf'])('이벤트 price: %s → events[0].price 읽기 오류 (값 원문과 안내)', (literal) => {
    const report = run(scenarioWith(literal), { fake: { snapshot: emptySnapshot() } })
    expect(report.totals.readError).toBe(1)
    const issue = report.readErrors[0]?.issues.find((i) => i.path === 'events[0].price')
    expect(issue?.line).toBe(7)
    expect(issue?.message).toBe(`0 이상 정수여야 한다 (값: ${literal} (YAML 실수 표기)) — 금액·번호·개수는 정수로만 적는다. 천 단위 구분 점·소수점·지수 표기는 쓸 수 없다`)
    expect(report.items).toEqual([])
    expect(report.ok).toBe(false)
  })

  it('정수 표기는 그대로 통과 (회귀)', () => {
    const report = run(scenarioWith('10000'), { fake: { snapshot: emptySnapshot() } })
    expect(report.totals.readError).toBe(0)
    expect(report.items[0]?.status).toBe('pass')
  })

  it.each([
    ['amount out', 'suite: amount\ncases:\n  - { in: "만원", out: 1e4 }\n', 'cases[0].out'],
    ['chat claims', 'suite: chat\ncases:\n  - { in: "15", out: { claims: [15.0] } }\n', 'cases[0].out.claims'],
    ['quick-input price', 'suite: quick-input\ncases:\n  - { in: "15 1만", out: { no: 15, price: 10.000 } }\n', 'cases[0].out.price'],
    ['설정 maxNumber', 'suite: chat\nsettings: { maxNumber: 999.0 }\ncases:\n  - { in: "15", out: { claims: [15] } }\n', 'settings.maxNumber'],
    ['expect claimCount', scenario({ expect: { claimCount: 1 } }).replace('claimCount: 1', 'claimCount: 1.0'), 'expect.claimCount'],
    ['settlement.adjust amount (음수 허용 정수)', scenario({ events: [{ at: '20:00:00', type: 'settlement.adjust', buyer: 'UC_A', date: '2026-10-18', amount: -1, reason: '할인' }] }).replace('amount: -1', 'amount: -1.5'), 'events[0].amount'],
  ])('%s에 실수 → 그 경로의 읽기 오류', (_name, text, path) => {
    const report = run(text, { core: createFakeCore({ snapshot: emptySnapshot(), parser: { amount: () => 10000, chat: () => ({ claims: [15] }), quickInput: () => ({ no: 15, price: 10000 }) } }) })
    expect(report.totals.readError).toBe(1)
    const issue = report.readErrors[0]?.issues.find((i) => i.path === path)
    expect(issue?.message).toContain('(YAML 실수 표기)')
    expect(report.ok).toBe(false)
  })
})
