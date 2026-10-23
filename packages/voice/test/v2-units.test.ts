// V2 단위: 데이터 사전(AC-V2-01·02), 사전 순서·배운 별칭(AC-V2-09·10), 모으기 끊기(AC-V2-12), 조용한 시간 설정(AC-V2-16 읽기),
// 기록 상한(AC-V2-29), 어떤 글에도 예외 없음(AC-V2-33).
import { readFileSync } from 'node:fs'
import { normalizeText } from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DICTIONARY,
  DEFAULT_QUIET_MS,
  DEFAULT_VARIETIES,
  LEARNED_ALIAS_MAX,
  STOP_WORDS,
  VOICE_LOG_MAX,
  addLogEntry,
  canLearnAlias,
  checkVoiceSettings,
  clearLog,
  compact,
  createLogEntry,
  createPhraseState,
  describeCandidates,
  describeReading,
  editDistance,
  extractVoice,
  feed,
  formatLogTime,
  isCandidate,
  jamoOf,
  learnAlias,
  nextTickAt,
  prepareVoiceDictionary,
  quietSecToMs,
  readChunk,
  readLearnedAliases,
  resolveQuietMs,
  splitCorrections,
  stopPhrase,
  tick,
  touchLearnedAlias,
  varietyCandidates,
  type LearnedAlias,
  type PhraseOutput,
} from '../src/index.ts'
import { simulate } from './v2-helpers.ts'

const OLD_DEFAULT_NAMES = [
  '핑크프릴', '핑크프릴 금', '방울복랑 금', '라울', '왕비뇌신금', '블루엘프', '레티지아', '십이지권', '천사의눈물', '벨루가', '로라', '황금사', '블랙프린스', '자보',
  '방울복랑', '칠복수', '리틀뷰티', '프리티', '샤비홍', '립스틱', '레드에보니', '블루버드', '퍼플퀸', '핑크루비', '라우이', '미니마', '아메치스', '백모단', '용월', '성미인',
  '월미인', '문스톤', '화이트그리니', '홍옥', '을녀심', '청옥', '오로라', '레드베리', '염자', '화월', '우주목', '성을녀', '희성', '남십자성', '월토이', '흑토이', '은월', '녹영',
  '웅동자', '흑법사', '선버스트', '은행목', '사해파', '리톱스', '코노피튬', '오십령옥', '금황환', '백도선', '알로에 베라',
]

describe('데이터 사전 (AC-V2-01·02)', () => {
  const file = JSON.parse(readFileSync(new URL('../data/varieties.ko.json', import.meta.url), 'utf8')) as { stopWords: string[]; varieties: { name: string; aliases: string[] }[] }

  it('이름 300개 이상, 꼭 넣을 이름·지금까지의 기본 사전 이름이 모두 있다', () => {
    expect(file.varieties.length).toBeGreaterThanOrEqual(300)
    const names = file.varieties.map((v) => v.name)
    for (const name of ['엘레강스', '핑크문', '블루엘프', '라울', '루비', '선버스트', ...OLD_DEFAULT_NAMES]) expect(names).toContain(name)
    expect(DEFAULT_DICTIONARY).toEqual(names)
    expect(DEFAULT_VARIETIES).toHaveLength(names.length)
  })

  it('이름·별칭의 공백 뺀 모양이 서로 겹치지 않고, 1글자 없고, 별칭 0~5개, 정규화되어 있다', () => {
    const keys: string[] = []
    for (const v of file.varieties) {
      expect(Array.isArray(v.aliases)).toBe(true)
      expect(v.aliases.length).toBeLessThanOrEqual(5)
      for (const form of [v.name, ...v.aliases]) {
        expect(normalizeText(form)).toBe(form)
        expect([...compact(form)].length).toBeGreaterThanOrEqual(2)
        keys.push(compact(form))
      }
    }
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('막는 낱말 30개 이상(표의 낱말 포함), 어떤 이름·별칭도 막는 낱말과 같거나 R-17 0.8로 맞지 않는다', () => {
    const must = ['당연', '이거', '저거', '예뻐요', '예쁘다', '감사', '안녕', '오늘', '지금', '이번', '다음', '가격', '번호', '품종', '취소', '아니', '다시', '말고', '정정', '문자찜', '하나', '둘', '만원', '천원']
    expect(file.stopWords.length).toBeGreaterThanOrEqual(30)
    for (const word of must) expect(file.stopWords).toContain(word)
    expect(STOP_WORDS).toEqual(file.stopWords)
    for (const v of file.varieties) {
      for (const form of [v.name, ...v.aliases]) {
        const a = jamoOf(form)
        for (const word of file.stopWords) {
          expect(compact(form)).not.toBe(compact(word))
          const b = jamoOf(word)
          const similarity = { distance: editDistance(a, b), length: Math.max(a.length, b.length) }
          expect(isCandidate(similarity), `${form} ↔ ${word}`).toBe(false)
        }
      }
    }
  })

  it('막는 낱말만 말하면 품종이 채워지지 않는다', () => {
    const dictionary = prepareVoiceDictionary()
    for (const word of STOP_WORDS) expect(extractVoice(`15번 ${word} 만원`, { dictionary }).name).toBeNull()
  })
})

describe('사전 순서·배운 별칭 (AC-V2-09·10)', () => {
  it('같은 공백 뺀 모양이면 배운 별칭 → 판매 이력 → 기본 사전 순으로 앞의 것', () => {
    const learned: LearnedAlias[] = [{ heard: '핑크문', name: '핑크 문 금', usedAt: 1 }]
    const dict = prepareVoiceDictionary({ learned, history: ['핑크 문'] })
    expect(extractVoice('15번 핑크문 만원', { dictionary: dict }).name).toBe('핑크 문 금')
    const noLearn = prepareVoiceDictionary({ history: ['핑크 문'] })
    expect(extractVoice('15번 핑크문 만원', { dictionary: noLearn }).name).toBe('핑크 문')
    expect(extractVoice('15번 핑크문 만원', { dictionary: prepareVoiceDictionary() }).name).toBe('핑크문')
  })

  it('판매 이력 이름이 기본 사전 별칭보다 앞선다', () => {
    // 기본 사전: 엘레강스의 별칭 엘레간스. 판매 이력에 '엘레간스'가 있으면 그 이름
    expect(extractVoice('15번 엘레간스 만원', { dictionary: prepareVoiceDictionary() }).name).toBe('엘레강스')
    expect(extractVoice('15번 엘레간스 만원', { dictionary: prepareVoiceDictionary({ history: ['엘레간스'] }) }).name).toBe('엘레간스')
  })

  it('배운 별칭 선버스 → 선버스트: "30번 선버스 팔천원"이 선버스트·HIGH', () => {
    const before = readChunk('30번 선버스 팔천원', { dictionary: prepareVoiceDictionary() })
    expect(before.name).toBeNull()
    const heard = before.candidates[0]?.heard as string
    const learned = learnAlias([], { heard, name: '선버스트', at: 100 })
    expect(learned).toEqual([{ heard: '선버스', name: '선버스트', usedAt: 100 }])
    const after = readChunk('30번 선버스 팔천원', { dictionary: prepareVoiceDictionary({ learned }) })
    expect(after).toMatchObject({ no: 30, name: '선버스트', price: 8000, confidence: 'HIGH', nameWindow: '선버스' })
  })

  it('막는 낱말·1음절·고른 이름과 같은 말은 배우지 않는다', () => {
    expect(canLearnAlias('이거', '라울')).toBe(false)
    expect(canLearnAlias('라', '라울')).toBe(false)
    expect(canLearnAlias('라 울', '라울')).toBe(false)
    expect(canLearnAlias('라운', '라울')).toBe(true)
    expect(learnAlias([], { heard: '취소', name: '라울', at: 1 })).toEqual([])
  })

  it('같은 들은 말을 다른 이름으로 고르면 새 것으로 바꾼다', () => {
    const one = learnAlias([], { heard: '라운', name: '라울', at: 1 })
    expect(learnAlias(one, { heard: '라운', name: '라우이', at: 2 })).toEqual([{ heard: '라운', name: '라우이', usedAt: 2 }])
  })

  it('200개를 넘으면 가장 오래 안 쓴 것부터 지운다 (쓰면 새로 셈)', () => {
    let list: LearnedAlias[] = []
    for (let i = 0; i < LEARNED_ALIAS_MAX; i++) list = learnAlias(list, { heard: `들은말${String(i)}`, name: '라울', at: i })
    expect(list).toHaveLength(200)
    list = touchLearnedAlias(list, '들은말0', 1000)
    list = learnAlias(list, { heard: '새말', name: '라울', at: 1001 })
    expect(list).toHaveLength(200)
    const heards = list.map((item) => item.heard)
    expect(heards).toContain('들은말0')
    expect(heards).not.toContain('들은말1')
    expect(heards).toContain('새말')
  })

  it('저장소 값 읽기: 모양이 틀린 것은 버린다', () => {
    expect(readLearnedAliases([{ heard: '선버스', name: '선버스트', usedAt: 3 }, { heard: 1 }, null, '라운', { heard: '이거', name: '라울' }])).toEqual([{ heard: '선버스', name: '선버스트', usedAt: 3 }])
    expect(readLearnedAliases('x')).toEqual([])
  })
})

describe('모으기 끊기 (AC-V2-12)', () => {
  const run = (inputs: { text: string; at: number; final?: boolean }[], until: number) => {
    let state = createPhraseState()
    const out: PhraseOutput[] = []
    let i = 0
    for (let now = 0; now <= until; now += 100) {
      while (i < inputs.length && inputs[i]!.at <= now) {
        const r = inputs[i++]!
        const step = feed(state, { text: r.text, final: r.final !== false, at: r.at })
        state = step.state
        out.push(...step.out)
      }
      const step = tick(state, now)
      state = step.state
      out.push(...step.out)
    }
    return { state, out }
  }

  it('1초마다 최종 결과가 계속 오면 15000에 끊긴다', () => {
    const inputs = Array.from({ length: 20 }, (_, k) => ({ text: '예쁘죠', at: k * 1000 }))
    const { out } = run(inputs, 15000)
    expect(out).toHaveLength(1)
    const first = out[0]!
    expect(first.kind === 'chunk' && [first.chunk.endedAt, first.chunk.end, first.chunk.pieces.length]).toEqual([15000, 'max', 15])
  })

  it('모은 글 + 새 결과가 300글자를 넘으면 새 결과 앞에서 끊긴다', () => {
    const a = '가'.repeat(200)
    const b = '나'.repeat(100) // 200 + 1 + 100 = 301
    const { out } = run(
      [
        { text: a, at: 0 },
        { text: b, at: 500 },
      ],
      600,
    )
    expect(out.map((o) => o.kind === 'chunk' && [o.chunk.text, o.chunk.end, o.chunk.endedAt])).toEqual([[a, 'long', 500]])
  })

  it('300글자 딱 맞으면 붙인다', () => {
    const { out } = run(
      [
        { text: '가'.repeat(200), at: 0 },
        { text: '나'.repeat(99), at: 500 },
      ],
      600,
    )
    expect(out).toHaveLength(0)
  })

  it('끝에서 넘긴 결과·음성 끄기는 바로 덩어리가 되고 자동 확정 없음', () => {
    let state = createPhraseState()
    state = feed(state, { text: '15번', final: true, at: 0 }).state
    const flushed = feed(state, { text: '핑크문 만원', final: true, at: 500, flushedAtEnd: true })
    expect(flushed.out.map((o) => o.kind === 'chunk' && [o.chunk.text, o.chunk.end, o.chunk.noAutoConfirm])).toEqual([['15번 핑크문 만원', 'flushed', true]])
    state = feed(createPhraseState(), { text: '16번 라울', final: true, at: 0 }).state
    const stopped = stopPhrase(state, 700)
    expect(stopped.out.map((o) => o.kind === 'chunk' && [o.chunk.text, o.chunk.end, o.chunk.noAutoConfirm])).toEqual([['16번 라울', 'stop', true]])
    expect(stopPhrase(createPhraseState(), 0).out).toEqual([])
  })

  it('다음 tick 시각: 조용한 시간과 15초 중 이른 것', () => {
    let state = createPhraseState()
    expect(nextTickAt(state)).toBeNull()
    state = feed(state, { text: '15번', final: true, at: 100 }).state
    expect(nextTickAt(state)).toBe(1900)
    state = feed(state, { text: '핑크', final: false, at: 1000 }).state
    expect(nextTickAt(state)).toBe(2800)
    for (let at = 2000; at <= 14_000; at += 1000) state = feed(state, { text: '예쁘죠', final: true, at }).state
    expect(nextTickAt(state)).toBe(15_100)
  })
})

describe('조용한 시간 설정 (AC-V2-16 읽기, D-V2-09)', () => {
  it('기본 1800, 1000~4000·100 단위만, 범위 밖·모르는 값은 1800', () => {
    expect(DEFAULT_QUIET_MS).toBe(1800)
    expect(resolveQuietMs(undefined)).toBe(1800)
    expect(resolveQuietMs(3000)).toBe(3000)
    expect(resolveQuietMs({ 'voice.quietMs': 1000 })).toBe(1000)
    for (const bad of [999, 4001, 1850, '3000', null, Number.NaN, 4100, 900]) expect(resolveQuietMs(bad)).toBe(1800)
    expect(quietSecToMs(1.8)).toBe(1800)
    expect(quietSecToMs(3)).toBe(3000)
    expect(quietSecToMs(4.05)).toBeNull()
    expect(quietSecToMs(0.9)).toBeNull()
  })

  it('설정 검사가 voice.quietMs를 안다 (문제 문구에 영어 없음)', () => {
    expect(checkVoiceSettings({ 'voice.quietMs': 2500 })).toEqual([])
    const problems = checkVoiceSettings({ 'voice.quietMs': 5000 })
    expect(problems.map((p) => p.key)).toEqual(['voice.quietMs'])
    expect(problems[0]?.message).not.toMatch(/[A-Za-z]/)
  })

  it('3.0초로 두면 S2의 카드가 5500에 생긴다', () => {
    const results = [
      { text: '십오번', at: 0 },
      { text: '엘레강스', at: 1200 },
      { text: '이만원', at: 2500 },
    ]
    expect(simulate(results, 5400, { quietMs: 3000 }).cards).toHaveLength(0)
    const run = simulate(results, 5500, { quietMs: 3000 })
    expect(run.chunks.map((c) => c.endedAt)).toEqual([5500])
    expect(run.cards).toHaveLength(1)
  })
})

describe('음성 기록 (AC-V2-29)', () => {
  it('51개를 넣으면 50개, 가장 오래된 것이 빠진다. 지우면 0개', () => {
    let log = clearLog()
    for (let i = 0; i < 51; i++) log = addLogEntry(log, createLogEntry({ at: i, pieces: [{ text: `말${String(i)}` }], action: 'discard', reason: '번호와 가격이 안 들렸어요' }))
    expect(log).toHaveLength(VOICE_LOG_MAX)
    expect(log[0]?.at).toBe(50)
    expect(log.at(-1)?.at).toBe(1)
    expect(clearLog()).toHaveLength(0)
  })

  it('301글자 조각은 300글자 + …', () => {
    const entry = createLogEntry({ at: 0, pieces: [{ text: '가'.repeat(301) }, { text: '나'.repeat(300) }], action: 'create' })
    expect(entry.pieces[0]?.text).toBe(`${'가'.repeat(300)}…`)
    expect(entry.pieces[1]?.text).toBe('나'.repeat(300))
  })

  it('읽은 것·후보·시각 글', () => {
    expect(describeReading({ no: 15, name: '엘레강스', price: 20000 })).toBe('15번 · 엘레강스 · 20,000원')
    expect(describeReading({ no: 15, name: null, price: null })).toBe('15번 · 품종 ? · 가격 ?')
    expect(describeCandidates([{ name: '선버스트', score: 77, heard: '선버스' }])).toBe('선버스트 77점')
    expect(formatLogTime(Date.UTC(2026, 9, 24, 5, 3, 9))).toBe('14:03:09')
  })

  it('S2·S9·S18 뒤 기록: 새것부터 3개, 들은 말·읽은 것·한 일·까닭', () => {
    const run = simulate(
      [
        { text: '십오번', at: 0 },
        { text: '엘레강스', at: 1200 },
        { text: '이만원', at: 2500 },
        { text: '19번 선버스 팔천원', at: 6000 },
        { text: '아니 이거 너무 예쁘죠', at: 10_000 },
      ],
      12_000,
    )
    expect(run.log.map((e) => [e.pieces.map((p) => p.text), e.action, e.reason])).toEqual([
      [['아니 이거 너무 예쁘죠'], 'discard', '번호와 가격이 안 들렸어요'],
      [['19번 선버스 팔천원'], 'create', null],
      [['십오번', '엘레강스', '이만원'], 'create', null],
    ])
    expect(describeCandidates(run.log[1]?.read?.candidates ?? [])).toBe('선버스트 77점')
  })
})

describe('어떤 글에도 예외 없음 (AC-V2-33)', () => {
  const dictionary = prepareVoiceDictionary()
  const special = ['', ' ', '말고', '아니', '취소', '아니 아니 아니', '말고 말고', '품종은', '번호는', '가격은', '만오천말고', '가'.repeat(301), '15번 '.repeat(100), '\u0000\uD800', '<b>15번</b>']
  const pieces = ['15번', '핑크문', '만원', '아니', '말고', '취소', '품종은', '가격은', '번호는', '다시', '문자찜', '끝자리', '1234', '선버스', '이거', '<b>', '\u0000', '😀', '만오천말고', '십육']
  const arbitrary = fc.oneof(fc.string({ maxLength: 400 }), fc.array(fc.constantFrom(...pieces), { maxLength: 40 }).map((t) => t.join(' ')))

  it('특수 글', () => {
    for (const text of special) {
      expect(() => readChunk(text, { dictionary })).not.toThrow()
      expect(() => splitCorrections(text, { dictionary })).not.toThrow()
      expect(() => varietyCandidates(text, dictionary)).not.toThrow()
      expect(() => feed(createPhraseState(), { text, final: true, at: 0 })).not.toThrow()
    }
    expect(() => readChunk(undefined)).not.toThrow()
    expect(() => feed(undefined as never, undefined as never)).not.toThrow()
    expect(() => tick(undefined as never, Number.NaN)).not.toThrow()
  })

  it('무작위 글 1,000개', () => {
    fc.assert(
      fc.property(arbitrary, fc.boolean(), fc.integer({ min: 0, max: 100_000 }), (text, final, at) => {
        const reading = readChunk(text, { dictionary })
        expect(reading.candidates.length).toBeLessThanOrEqual(3)
        splitCorrections(text)
        varietyCandidates(text, dictionary)
        const step = feed(createPhraseState(), { text, final, at })
        tick(step.state, at + 5000)
      }),
      { numRuns: 1000, seed: 2410 },
    )
  })
})
