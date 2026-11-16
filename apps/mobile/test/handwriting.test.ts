// 손글씨 숫자 읽기 (D-HANDWRITE-01): 글자 나누기·읽기·후보·배우기·저장 모양.
// 시험 글씨는 기본 모양(handwriting-templates)과 따로 그린 다른 꼴에 기울임·늘임·떨림·점 간격·획 방향을 섞어 만든다(같은 씨앗 — 늘 같은 결과).
import { describe, expect, it } from 'vitest'
import { addLearned, correctionsOf, dropTaps, LEARNED_PER_DIGIT, makeTemplate, packLearned, readDigits, splitCharacters, unpackLearned, type InkPoint, type InkStroke } from '../src/lib/handwriting.ts'
import { arc, baseTemplates, join, line } from '../src/lib/handwriting-templates.ts'

/** 시험 꼴: 기본 모양과 비율·곡선·획 나눔이 다른 손글씨 */
const STYLES: Readonly<Record<string, readonly (readonly InkStroke[])[]>> = {
  '0': [[arc(50, 50, 26, 46, -80, 285)], [arc(52, 48, 33, 44, 250, -100)]],
  '1': [[line([48, 4], [53, 96])], [line([38, 16], [50, 3], [49, 97])]],
  '2': [
    [join(arc(48, 28, 30, 24, 185, 395), line([74, 40], [18, 96], [85, 94]))],
    [join(arc(50, 32, 26, 27, 190, 410), line([68, 50], [25, 93], [80, 96]))],
  ],
  '3': [
    [join(arc(48, 26, 28, 21, 195, 445), arc(50, 71, 30, 25, 265, 515))],
    [join(arc(50, 27, 22, 22, 205, 450), arc(52, 73, 26, 22, 275, 500))],
  ],
  '4': [
    [line([55, 4], [12, 66], [88, 64]), line([66, 22], [64, 97])],
    [line([28, 6], [22, 58], [82, 58]), line([62, 6], [66, 96])],
  ],
  '5': [
    [join(line([32, 6], [27, 44]), arc(50, 68, 26, 25, 230, 495)), line([32, 6], [78, 8])],
    [join(line([76, 6], [30, 6], [27, 46]), arc(50, 69, 25, 26, 230, 505))],
  ],
  '6': [
    [join(arc(72, 55, 48, 52, 262, 185), arc(48, 72, 24, 23, 185, -175))],
    [join(line([62, 4], [30, 58]), arc(50, 72, 22, 22, 195, -165))],
  ],
  '7': [
    [line([18, 8], [82, 10], [44, 96])],
    [line([14, 22], [16, 6], [84, 8], [48, 96])],
  ],
  '8': [
    [arc(50, 27, 20, 22, 10, 370), arc(50, 72, 26, 24, -80, 280)],
    [
      (() => {
        const out: InkPoint[] = []
        for (let i = 0; i <= 40; i += 1) {
          const t = (i / 40) * Math.PI * 2
          const y = 50 - 44 * Math.cos(t)
          out.push({ x: 50 + 28 * Math.sin(2 * t) * (y < 50 ? 0.8 : 1), y })
        }
        return out
      })(),
    ],
  ],
  '9': [
    [join(arc(46, 28, 24, 23, 5, -355), line([70, 30], [68, 96]))],
    [arc(50, 30, 22, 24, 0, 360), line([72, 28], [66, 96])],
  ],
}

/** 같은 씨앗이면 같은 수 (mulberry32) */
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 손가락 터치처럼 점을 촘촘히 (꺾은선 꼭짓점 사이를 2칸마다) */
function dense(stroke: InkStroke): InkPoint[] {
  const out: InkPoint[] = []
  stroke.forEach((p, index) => {
    const prev = stroke[index - 1]
    if (prev !== undefined) {
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / 2))
      for (let k = 1; k < steps; k += 1) out.push({ x: prev.x + ((p.x - prev.x) * k) / steps, y: prev.y + ((p.y - prev.y) * k) / steps })
    }
    out.push(p)
  })
  return out
}

/** 손 흔들림: 기울임(±12°)·밀림(±0.2)·가로 늘임(0.75~1.25)·크기·떨림·점 간격 솎기·가끔 획 거꾸로 */
function jitter(strokes: readonly InkStroke[], rand: () => number, at = { x: 0, y: 0 }, size = 1): InkStroke[] {
  const angle = ((rand() - 0.5) * 24 * Math.PI) / 180
  const shear = (rand() - 0.5) * 0.4
  const sx = 0.75 + rand() * 0.5
  const scale = size * (0.8 + rand() * 0.4)
  return strokes.map((stroke) => {
    const moved = dense(stroke)
      .filter(() => rand() > 0.2)
      .map((p) => {
        const x0 = (p.x - 50) * sx + shear * (p.y - 50)
        const y0 = p.y - 50
        const x = x0 * Math.cos(angle) - y0 * Math.sin(angle)
        const y = x0 * Math.sin(angle) + y0 * Math.cos(angle)
        return { x: at.x + 50 * size + x * scale + (rand() - 0.5) * 3, y: at.y + 50 * size + y * scale + (rand() - 0.5) * 3 }
      })
    const kept = moved.length >= 2 ? moved : stroke.map((p) => ({ x: at.x + p.x * size, y: at.y + p.y * size }))
    return rand() < 0.3 ? kept.reverse() : kept
  })
}

const templates = baseTemplates()

describe('손글씨 한 글자 읽기 (D-HANDWRITE-01)', { timeout: 60_000 }, () => {
  it('따로 그린 꼴에 손 흔들림을 섞어도 숫자마다 90% 넘게, 모두 합쳐 95% 넘게 맞힌다', () => {
    const rand = seeded(20261117)
    let right = 0
    let total = 0
    const misses: string[] = []
    for (const [digit, styles] of Object.entries(STYLES)) {
      let ok = 0
      let count = 0
      for (const style of styles)
        for (let round = 0; round < 30; round += 1) {
          const got = readDigits(jitter(style, rand), templates).text
          count += 1
          if (got === digit) ok += 1
          else misses.push(`${digit}→${got}`)
        }
      expect(ok / count, `${digit}: ${misses.filter((miss) => miss.startsWith(digit)).join(' ')}`).toBeGreaterThan(0.9)
      right += ok
      total += count
    }
    expect(right / total, misses.join(' ')).toBeGreaterThan(0.95)
  })

  it('틀린 숫자라도 후보 안에는 대개 맞는 숫자가 있다 (98% 넘게)', () => {
    const rand = seeded(7)
    let inOptions = 0
    let total = 0
    for (const [digit, styles] of Object.entries(STYLES))
      for (const style of styles)
        for (let round = 0; round < 20; round += 1) {
          const reading = readDigits(jitter(style, rand), templates)
          total += 1
          if (reading.options.includes(digit)) inOptions += 1
        }
    expect(inOptions / total).toBeGreaterThan(0.98)
  })

  it('크기·자리와 상관없다 — 작게 써도 크게 써도 같은 숫자', () => {
    const seven = STYLES['7']?.[0] ?? []
    const small = seven.map((stroke) => stroke.map((p) => ({ x: 300 + p.x * 0.3, y: 10 + p.y * 0.3 })))
    const big = seven.map((stroke) => stroke.map((p) => ({ x: p.x * 3, y: p.y * 3 })))
    expect(readDigits(small, templates).text).toBe('7')
    expect(readDigits(big, templates).text).toBe('7')
  })
})

describe('여러 글자 나누기', { timeout: 60_000 }, () => {
  /** 글자들을 왼쪽부터 칸(폭 100, 간격 gap)에 놓은 획 — 쓴 차례는 글자 차례 */
  const write = (digits: string, rand: () => number, gap = 20, pick = 0) => digits.split('').flatMap((digit, index) => jitter(STYLES[digit]?.[pick % (STYLES[digit]?.length ?? 1)] ?? [], rand, { x: index * (100 + gap) * 0.7, y: 0 }, 0.7))

  it('가격 15000, 번호 27, 뒷자리 4589를 왼쪽부터 읽는다', () => {
    const rand = seeded(42)
    for (const digits of ['15000', '27', '4589', '360', '1234567890']) {
      let ok = 0
      for (let round = 0; round < 10; round += 1) if (readDigits(write(digits, rand, 25, round), templates).text === digits) ok += 1
      expect(ok, digits).toBeGreaterThanOrEqual(8)
    }
  })

  it('두 획 숫자(4·5·7의 가로줄)는 한 글자로 묶고, 가는 1은 옆 글자에 붙이지 않는다', () => {
    const four = [line([55, 4], [12, 66], [88, 64]), line([66, 22], [64, 97])]
    const one = [line([150, 5], [150, 95])]
    const five = [join(line([200, 6], [195, 44]), arc(218, 68, 26, 25, 230, 495)), line([200, 6], [246, 8])]
    const groups = splitCharacters([...four, ...one, ...five])
    expect(groups.map((group) => group.length)).toEqual([2, 1, 2])
    expect(readDigits([...four, ...one, ...five], templates).text).toBe('415')
  })

  it('나중에 돌아가 그은 획도 그 글자에 붙는다 (7을 쓰고 1을 쓴 뒤 7에 가로줄)', () => {
    const seven = [line([15, 8], [85, 8], [40, 95])]
    const one = [line([140, 5], [140, 95])]
    const bar = [line([40, 50], [78, 50])]
    const groups = splitCharacters([...seven, ...one, ...bar])
    expect(groups.map((group) => group.length)).toEqual([2, 1])
  })

  it('살짝 닿은 점은 글자가 아니다', () => {
    const one = [line([50, 5], [50, 95])]
    const tap = [[{ x: 200, y: 50 }, { x: 201, y: 51 }]]
    expect(dropTaps([...one, ...tap], 300)).toHaveLength(1)
    expect(readDigits([...one, ...tap], templates, 300).text).toBe('1')
  })

  it('아무것도 안 썼으면 빈 글, 후보 없음', () => {
    expect(readDigits([], templates)).toEqual({ text: '', options: [], places: [] })
  })
})

describe('후보·배우기', () => {
  it('첫 후보는 읽은 글이고, 겹치지 않으며 4개를 넘지 않는다', () => {
    const rand = seeded(3)
    for (let round = 0; round < 20; round += 1) {
      const reading = readDigits(jitter(STYLES['1']?.[0] ?? [], rand), templates)
      expect(reading.options[0]).toBe(reading.text)
      expect(new Set(reading.options).size).toBe(reading.options.length)
      expect(reading.options.length).toBeLessThanOrEqual(4)
    }
  })

  it('한 글자면 다른 숫자 후보를 늘 보인다 (틀려도 눌러 고친다)', () => {
    const reading = readDigits([line([50, 5], [50, 95])], templates)
    expect(reading.options.length).toBeGreaterThanOrEqual(2)
  })

  it('고른 후보가 다르면 그 자리 획을 고른 숫자 모양으로 배운다 — 같은 모양을 다음엔 바로 맞힌다', () => {
    // 이상하게 쓴 9 (꼬리가 왼쪽으로 크게 휜 9 — 기본 모양에 없는 꼴)
    const odd: InkStroke[] = [join(arc(50, 25, 22, 20, 0, -360), arc(30, 25, 42, 70, 0, 80))]
    const before = readDigits(odd, templates)
    const chosen = before.text === '9' ? '9' : '9'
    const learned = addLearned([], correctionsOf(before, chosen).map((item) => makeTemplate(item.digit, item.strokes)))
    if (before.text !== '9') expect(learned).toHaveLength(1)
    expect(readDigits(odd, [...templates, ...learned]).text).toBe('9')
  })

  it('자리 수가 다르면 배우지 않는다', () => {
    const reading = readDigits([line([50, 5], [50, 95])], templates)
    expect(correctionsOf(reading, '17')).toEqual([])
    expect(correctionsOf(reading, reading.text)).toEqual([])
  })

  it(`배운 모양은 숫자마다 ${String(LEARNED_PER_DIGIT)}개까지 — 오래된 것부터 버린다`, () => {
    let learned = addLearned([], [])
    const shapes = Array.from({ length: LEARNED_PER_DIGIT + 2 }, (_, index) => makeTemplate('3', [line([0, 0], [10 + index, 50], [0, 100])]))
    for (const shape of shapes) learned = addLearned(learned, [shape])
    learned = addLearned(learned, [makeTemplate('5', [line([0, 0], [50, 50])])])
    expect(learned.filter((item) => item.digit === '3')).toHaveLength(LEARNED_PER_DIGIT)
    expect(learned.filter((item) => item.digit === '3')[0]).toBe(shapes[2])
    expect(learned.filter((item) => item.digit === '5')).toHaveLength(1)
  })

  it('저장 모양을 되살리면 같은 글을 읽고, 깨진 값은 건너뛴다', () => {
    const learned = [makeTemplate('4', [line([10, 10], [60, 60]), line([40, 0], [40, 100])])]
    const back = unpackLearned(packLearned(learned))
    expect(back).toHaveLength(1)
    expect(back[0]?.digit).toBe('4')
    expect(unpackLearned('깨짐')).toEqual([])
    expect(unpackLearned(null)).toEqual([])
    expect(unpackLearned(JSON.stringify([['x', []], ['1', [[0, 0, 0]]], 'bad']))).toEqual([])
  })

  it('한 글자 읽기는 빠르다 (기본 모양 전부와 비교해도 20ms 안)', () => {
    const strokes = STYLES['8']?.[0] ?? []
    const start = performance.now()
    for (let i = 0; i < 10; i += 1) readDigits(strokes, templates)
    expect((performance.now() - start) / 10).toBeLessThan(20)
  })
})
