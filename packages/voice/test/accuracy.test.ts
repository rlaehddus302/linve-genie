// AC-I4-03 정확도 측정 스크립트 (D-I4-08, HG-4) — CSV 읽기·채점·보고서 함수와 명령(종료 코드·출력).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ACCURACY_HEADER,
  ACCURACY_USAGE,
  formatRatio,
  parseAccuracyArgs,
  parseAccuracySamples,
  parseCsv,
  parseDictionaryLines,
  renderAccuracyReport,
  scoreSample,
  scoreSamples,
  summarizeAccuracy,
  tableCell,
  type AccuracySample,
} from '../src/accuracy.ts'
import type { VoiceExtraction } from '../src/index.ts'

const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url))
const SCRIPT = join(PACKAGE_DIR, 'scripts', 'accuracy.ts')
const EXAMPLE = join(PACKAGE_DIR, 'samples', 'accuracy-example.csv')
const HEADER = ACCURACY_HEADER.join(',')

const cellsOf = (text: string): string[][] => {
  const parsed = parseCsv(text)
  if (!parsed.ok) throw new Error(parsed.message)
  return parsed.value.map((row) => [...row.cells])
}
const samplesOf = (text: string): AccuracySample[] => {
  const parsed = parseAccuracySamples(text)
  if (!parsed.ok) throw new Error(parsed.message)
  return parsed.value
}
const errorOf = (text: string): string => {
  const parsed = parseAccuracySamples(text)
  if (parsed.ok) throw new Error('오류가 아니다')
  return parsed.message
}

describe('AC-I4-03 CSV 읽기', () => {
  it('맨 앞 BOM, CRLF·LF·CR 줄 끝, 마지막 줄바꿈은 빈 줄을 만들지 않는다', () => {
    expect(cellsOf('\uFEFFa,b\r\nc,d\ne,f\rg,h\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
      ['g', 'h'],
    ])
    expect(cellsOf('a,b')).toEqual([['a', 'b']])
    expect(cellsOf('')).toEqual([])
  })

  it('큰따옴표로 감싼 칸: 쉼표·줄바꿈·"" (큰따옴표 하나), 빈 칸', () => {
    expect(cellsOf('"1,5",x\n"그는 ""15번""이라고",y\n"줄\r\n바꿈",""\n')).toEqual([
      ['1,5', 'x'],
      ['그는 "15번"이라고', 'y'],
      ['줄\r\n바꿈', ''],
    ])
    expect(cellsOf('a,,b,')).toEqual([['a', '', 'b', '']])
  })

  it('감싸지 않은 칸 가운데의 큰따옴표는 글자 그대로', () => {
    expect(cellsOf('15"짜리,a')).toEqual([['15"짜리', 'a']])
  })

  it('줄 번호는 레코드가 시작하는 줄 (감싼 칸 안의 줄바꿈도 센다)', () => {
    const parsed = parseCsv('h\n"a\nb\nc",x\nnext\n\nlast')
    expect(parsed.ok && parsed.value.map((row) => row.line)).toEqual([1, 2, 5, 6, 7])
  })

  it('닫히지 않은 큰따옴표·닫은 뒤 글자는 몇 번째 줄인지 알리는 오류', () => {
    expect(parseCsv('h\nok\n"열고\n안 닫음')).toEqual({ ok: false, message: '3번째 줄에서 연 큰따옴표가 닫히지 않았어요.' })
    const after = parseCsv('h\n"a"b,c')
    expect(after.ok).toBe(false)
    expect(!after.ok && after.message).toContain('2번째 줄')
  })

  it('속성: 아무 칸(쉼표·큰따옴표·CR·LF·BOM 같은 글자 포함)을 엑셀처럼 써서 읽으면 같은 칸', () => {
    const cell = fc.string({ unit: fc.constantFrom('a', '가', ',', '"', '\r', '\n', ' ', '1', '\uFEFF', '|'), maxLength: 8 })
    const quote = (value: string): string => (/[",\r\n]/.test(value) || value.startsWith('\uFEFF') ? `"${value.replaceAll('"', '""')}"` : value)
    fc.assert(
      fc.property(fc.array(fc.array(cell, { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 6 }), fc.constantFrom('\n', '\r\n'), fc.boolean(), (rows, eol, bom) => {
        // 칸 하나짜리 빈 줄은 쓸 수 없다(빈 줄과 같다) — 감싸서 쓴다
        const text = (bom ? '\uFEFF' : '') + rows.map((row) => row.map((value) => (row.length === 1 && value === '' ? '""' : quote(value))).join(',')).join(eol) + eol
        expect(cellsOf(text)).toEqual(rows)
      }),
      { numRuns: 300 },
    )
  })
})

describe('AC-I4-03 표본 읽기', () => {
  it('열 이름은 정확히 "표본,기대 번호,기대 가격,기대 품종,인식 문장" (BOM은 된다)', () => {
    expect(samplesOf(`\uFEFF${HEADER}\r\n예시-01,15,15000,핑크프릴,15번 핑크프릴 만오천 원\r\n`)).toEqual([
      { line: 2, label: '예시-01', expectedNo: 15, expectedPrice: 15000, expectedName: '핑크프릴', text: '15번 핑크프릴 만오천 원' },
    ])
    const wrong = '첫 줄의 열 이름은 정확히 "표본,기대 번호,기대 가격,기대 품종,인식 문장"이어야 해요.'
    expect(errorOf('표본,기대 가격,기대 번호,기대 품종,인식 문장\na,1,100,,x')).toBe(wrong)
    expect(errorOf('표본,기대 번호,기대 가격,기대 품종\na,1,100,')).toBe(wrong)
    expect(errorOf(`${HEADER},비고\na,1,100,,x,`)).toBe(wrong)
    expect(errorOf(`${HEADER} \na,1,100,,x`)).toBe(wrong)
  })

  it('빈칸의 뜻: 번호·가격 빈칸 = 말하지 않음(null), 품종 빈칸(공백만 포함) = 채점 안 함(null), 문장 빈칸 = 빈 문장', () => {
    expect(samplesOf(`${HEADER}\n,,,,\n잡담,,,  ,\n`)).toEqual([{ line: 3, label: '잡담', expectedNo: null, expectedPrice: null, expectedName: null, text: '' }])
  })

  it('칸이 모두 빈 줄은 건너뛰고, 표본이 0개면 오류', () => {
    expect(errorOf(`${HEADER}\n\n,,,,\n \n`)).toBe('표본이 하나도 없어요 — 첫 줄 아래에 표본을 한 줄에 하나씩 적어 주세요.')
    expect(errorOf(HEADER)).toBe('표본이 하나도 없어요 — 첫 줄 아래에 표본을 한 줄에 하나씩 적어 주세요.')
    expect(errorOf('')).toBe('표본 파일이 비어 있어요.')
    expect(errorOf('\uFEFF\r\n')).toBe('표본 파일이 비어 있어요.')
  })

  it('표본 이름이 비면 "N번째 줄", 기대 품종은 R-3 정규화, 인식 문장은 그대로', () => {
    expect(samplesOf(`${HEADER}\n\n , 15 ,"1,500",  핑크   프릴 ,  15번  핑크프릴 \n잡담,,,,`)).toEqual([
      { line: 3, label: '3번째 줄', expectedNo: 15, expectedPrice: 1500, expectedName: '핑크 프릴', text: '  15번  핑크프릴 ' },
      { line: 4, label: '잡담', expectedNo: null, expectedPrice: null, expectedName: null, text: '' },
    ])
  })

  it('칸 수가 5개가 아니면 몇 번째 줄인지 알린다', () => {
    expect(errorOf(`${HEADER}\na,1,100,x\n`)).toBe('2번째 줄의 칸이 4개예요 — 5개(표본·기대 번호·기대 가격·기대 품종·인식 문장)여야 해요.')
    expect(errorOf(`${HEADER}\n"a\nb",1,100,x,y,z\n`)).toContain('2번째 줄의 칸이 6개예요')
  })

  it.each([
    ['15', 15],
    ['015', 15],
    ['1', 1],
    ['9999', 9999],
  ])('기대 번호 %s → %s', (raw, want) => {
    expect(samplesOf(`${HEADER}\na,${raw},,,x`)[0]?.expectedNo).toBe(want)
  })

  it.each(['0', '10000', '15번', '1.5', '-1', '일오', '１５', '00015'])('기대 번호 %s → 오류(줄 번호)', (raw) => {
    expect(errorOf(`${HEADER}\nok,1,,,x\nbad,${raw},,,x`)).toBe(`3번째 줄: 기대 번호는 1~9999 정수나 빈칸이어야 해요(적힌 값 "${raw}").`)
  })

  it.each([
    ['100', 100],
    ['15000', 15000],
    ['"15,000"', 15000],
    ['"1,234,567"', 1234567],
    ['0100', 100],
  ])('기대 가격 %s → %s', (raw, want) => {
    expect(samplesOf(`${HEADER}\na,,${raw},,x`)[0]?.expectedPrice).toBe(want)
  })

  it.each(['"1,0000"', '50', '99', '-100', '15000원', '1.5만', '"15,00"', '"1,000,"', '0', '1e5', '9999999999999999'])('기대 가격 %s → 오류(줄 번호)', (raw) => {
    expect(errorOf(`${HEADER}\nbad,,${raw},,x`)).toContain('2번째 줄: 기대 가격은 100 이상 정수(원 — 숫자만 또는 천 단위 쉼표)나 빈칸이어야 해요')
  })

  it('오류 문장에 보이는 값은 한 줄로, 길면 줄인다', () => {
    const message = errorOf(`${HEADER}\nbad,"1\n${'2'.repeat(40)}",,,x`)
    expect(message).not.toContain('\n')
    expect(message).toContain('…')
  })

  it('이름 파일: BOM·CRLF, 앞뒤 공백 지우기, 빈 줄 무시', () => {
    expect(parseDictionaryLines('\uFEFF핑크 프릴\r\n\r\n  무지개꽃  \n\n라울')).toEqual(['핑크 프릴', '무지개꽃', '라울'])
  })
})

describe('AC-I4-03 채점', () => {
  const sample = (fields: Partial<AccuracySample>): AccuracySample => ({ line: 2, label: 's', expectedNo: null, expectedPrice: null, expectedName: null, text: '', ...fields })
  const got = (fields: Partial<VoiceExtraction>): VoiceExtraction => ({ no: null, name: null, price: null, confidence: 'LOW', ...fields })

  it('칸마다: 같으면 맞음(둘 다 없음 포함), 기대만 있으면 빈칸, 뽑은 값이 다르면 틀림(기대가 빈칸인데 뽑은 것 포함)', () => {
    expect(scoreSample(sample({}), got({})).no).toBe('맞음')
    expect(scoreSample(sample({ expectedNo: 15 }), got({ no: 15 })).no).toBe('맞음')
    expect(scoreSample(sample({ expectedNo: 15 }), got({})).no).toBe('빈칸')
    expect(scoreSample(sample({ expectedNo: 15 }), got({ no: 5 })).no).toBe('틀림')
    expect(scoreSample(sample({}), got({ no: 5 })).no).toBe('틀림')
    expect(scoreSample(sample({ expectedPrice: 15000 }), got({ price: 10000 })).price).toBe('틀림')
    expect(scoreSample(sample({}), got({ price: 100 })).price).toBe('틀림')
  })

  it('품종: 기대가 빈칸이면 채점 안 함, 공백을 뺀 모양으로 비교', () => {
    expect(scoreSample(sample({}), got({ name: '라울' })).name).toBe('채점 안 함')
    expect(scoreSample(sample({ expectedName: '핑크 프릴' }), got({ name: '핑크프릴' })).name).toBe('맞음')
    expect(scoreSample(sample({ expectedName: '방울복랑금' }), got({ name: '방울복랑 금' })).name).toBe('맞음')
    expect(scoreSample(sample({ expectedName: '라울' }), got({})).name).toBe('빈칸')
    expect(scoreSample(sample({ expectedName: '라울' }), got({ name: '로라' })).name).toBe('틀림')
  })

  it('틀린 값을 채움 = 번호나 가격이 틀림 (품종 틀림은 아님), 확실한데 틀림 = HIGH이고 셋 중 하나라도 틀림', () => {
    const wrongName = scoreSample(sample({ expectedNo: 1, expectedPrice: 100, expectedName: '라울' }), got({ no: 1, price: 100, name: '로라', confidence: 'HIGH' }))
    expect([wrongName.filledWrong, wrongName.confidentWrong]).toEqual([false, true])
    const wrongPriceLow = scoreSample(sample({ expectedNo: 1, expectedPrice: 100 }), got({ no: 1, price: 200 }))
    expect([wrongPriceLow.filledWrong, wrongPriceLow.confidentWrong]).toEqual([true, false])
    const blankHigh = scoreSample(sample({ expectedNo: 1, expectedPrice: 100, expectedName: '라울' }), got({ no: 1, price: null, name: '라울', confidence: 'HIGH' }))
    expect([blankHigh.filledWrong, blankHigh.confidentWrong]).toEqual([false, false])
  })

  it('카드 = isCardWorthy (번호가 있거나 품종·가격이 둘 다)', () => {
    expect(scoreSample(sample({}), got({ no: 3 })).cardWorthy).toBe(true)
    expect(scoreSample(sample({}), got({ name: '라울', price: 100 })).cardWorthy).toBe(true)
    expect(scoreSample(sample({}), got({ name: '라울' })).cardWorthy).toBe(false)
  })

  it('골든과 같은 추출기: 사전 = 이력 이름 + 기본 사전, maxNumber 기본 999', () => {
    const samples = samplesOf(`${HEADER}\na,15,10000,무지개꽃,15번 무지개꽃 만원\nb,1000,10000,라울,1000번 라울 만원`)
    expect(scoreSamples(samples).map((item) => [item.no, item.name])).toEqual([
      ['맞음', '빈칸'],
      ['빈칸', '맞음'],
    ])
    const withHistory = scoreSamples(samples, { history: ['무지개꽃'], maxNumber: 1000 })
    expect(withHistory.map((item) => [item.no, item.name, item.extraction.confidence])).toEqual([
      ['맞음', '맞음', 'HIGH'],
      ['맞음', '맞음', 'HIGH'],
    ])
  })

  it.each([
    [1, 3, '1/3 (33.3%)'],
    [2, 3, '2/3 (66.7%)'],
    [1, 16, '1/16 (6.3%)'],
    [17, 18, '17/18 (94.4%)'],
    [18, 18, '18/18 (100.0%)'],
    [0, 20, '0/20 (0.0%)'],
    [0, 0, '0/0 (채점한 표본 없음)'],
  ])('비율 %s/%s → %s', (correct, total, want) => {
    expect(formatRatio(correct, total)).toBe(want)
  })
})

describe('AC-I4-03 예시 표본 (packages/voice/samples/accuracy-example.csv)', () => {
  const text = readFileSync(EXAMPLE, 'utf8')
  const samples = samplesOf(text)
  const scored = scoreSamples(samples)

  it('20행, 표본 이름이 "예시-01"…"예시-20" (만든 문장임을 이름으로 알 수 있다)', () => {
    expect(samples.map((item) => item.label)).toEqual(Array.from({ length: 20 }, (_, i) => `예시-${String(i + 1).padStart(2, '0')}`))
  })

  it('표본별 결과 (손으로 계산: R-17 — 번호·가격·품종 칸, 신뢰도, 카드)', () => {
    // [번호, 가격, 품종, HIGH?, 카드?]
    const want: [string, string, string, boolean, boolean][] = [
      ['맞음', '맞음', '맞음', true, true], // 01 15번 핑크프릴 만오천 원
      ['맞음', '맞음', '맞음', true, true], // 02 원이요 → 원
      ['맞음', '맞음', '맞음', true, true], // 03 십칠번
      ['맞음', '맞음', '맞음', true, true], // 04 방울복랑 금(품는 이름) 이만 원
      ['빈칸', '빈칸', '맞음', false, false], // 05 "1, 9번" 끊어 말한 번호 → 번호·가격 비움, 카드 없음
      ['빈칸', '빈칸', '맞음', false, false], // 06 이 십 번 → 끊어 말한 번호
      ['맞음', '맞음', '맞음', false, true], // 07 이번(번호 아님) — 기대 번호 빈칸, 품종·가격 카드
      ['맞음', '맞음', '채점 안 함', false, false], // 08 한 번 더 — 잡담
      ['맞음', '빈칸', '맞음', false, true], // 09 숫자만 있는 가격 10000은 가격 아님
      ['맞음', '빈칸', '맞음', false, true], // 10 두 가격(만 원·오천 원) → 비움
      ['맞음', '맞음', '맞음', false, true], // 11 핑크푸릴 → 핑크프릴(바로잡기, 확인 필요)
      ['맞음', '맞음', '채점 안 함', false, false], // 12 인사
      ['맞음', '맞음', '맞음', true, true], // 13 레티지아 삼만 원
      ['맞음', '맞음', '맞음', false, true], // 14 가격을 말하지 않음 — 기대 가격 빈칸
      ['맞음', '틀림', '맞음', true, true], // 15 인식이 '오천'을 놓침: 기대 15,000 / 뽑음 10,000, 확실
      ['틀림', '맞음', '맞음', true, true], // 16 인식이 27을 37로: 확실한데 틀림
      ['맞음', '맞음', '맞음', false, true], // 17 나울 → 라울(확인 필요)
      ['맞음', '틀림', '맞음', false, true], // 18 '오천'을 놓침 + 핑크푸릴(확인 필요): 틀린 값을 채움, 확실은 아님
      ['맞음', '맞음', '틀림', true, true], // 19 블루버드라고 했는데 블루엘프로: 품종만 틀림, 확실
      ['맞음', '맞음', '맞음', true, true], // 20 31번이에요 · 백도선 · 이만 오천 원
    ]
    expect(scored.map((item) => [item.no, item.price, item.name, item.extraction.confidence === 'HIGH', item.cardWorthy])).toEqual(want)
  })

  it('요약 수 (손으로 센 값): 표본 20, 번호 17, 가격 14, 둘 다 13, 품종 17/18, 틀린 값을 채움 3, 확실한데 틀림 3, 카드 16', () => {
    expect(summarizeAccuracy(scored)).toEqual({
      samples: 20,
      noCorrect: 17,
      priceCorrect: 14,
      bothCorrect: 13,
      nameCorrect: 17,
      nameScored: 18,
      filledWrong: 3, // 15·16·18
      confidentWrong: 3, // 15·16·19
      cardWorthy: 16, // 05·06·08·12 빼고
    })
  })
})

describe('AC-I4-03 보고서', () => {
  const samples = samplesOf(readFileSync(EXAMPLE, 'utf8'))
  const scored = scoreSamples(samples)
  const report = renderAccuracyReport(scored, summarizeAccuracy(scored), { sampleFile: 'accuracy-example.csv', maxNumber: 999, historyNames: 0 })

  it('요약 줄', () => {
    for (const line of [
      '- 표본 수: 20',
      '- 번호 맞음: 17/20 (85.0%)',
      '- 가격 맞음: 14/20 (70.0%)',
      '- 번호·가격 둘 다 맞음: 13/20 (65.0%)',
      '- 품종 맞음: 17/18 (94.4%)',
      '- 틀린 값을 채움: 3',
      '- 확실한데 틀림: 3',
      '- 카드가 만들어진 표본: 16',
    ]) {
      expect(report.split('\n')).toContain(line)
    }
  })

  it('표본별 표: 머리 + 표본마다 한 줄, 신뢰도 낱말 "확실"/"확인 필요", 결과 낱말', () => {
    const rows = report.split('\n').filter((line) => line.startsWith('| 예시-'))
    expect(rows).toHaveLength(20)
    expect(rows[0]).toBe('| 예시-01 | 15번 핑크프릴 만오천 원 | 15번 · 핑크프릴 · 15,000원 | 15번 · 핑크프릴 · 15,000원 | 확실 | 맞음 | 맞음 | 맞음 |')
    expect(rows[4]).toBe('| 예시-05 | 1, 9번 라울 만원 | 19번 · 라울 · 10,000원 | 번호 없음 · 라울 · 가격 없음 | 확인 필요 | 빈칸 | 빈칸 | 맞음 |')
    expect(rows[7]).toBe('| 예시-08 | 한 번 더 보여 드릴게요 | 번호 없음 · 품종 안 적음 · 가격 없음 | 번호 없음 · 품종 없음 · 가격 없음 | 확인 필요 | 맞음 | 맞음 | 채점 안 함 |')
  })

  it('영어 상태값·개발 용어가 보이지 않는다', () => {
    expect(report).not.toMatch(/HIGH|LOW|null|undefined|NaN|true|false|OPEN|CONFIRMED/)
  })

  it('표 칸의 | · 줄바꿈 · HTML · ` 이 표를 깨지 않는다', () => {
    const nasty = samplesOf(`${HEADER}\n"a|b\nc",15,,"라울|x","<script>alert(1)</script> 15번 \\| 라울 | 만원\r\n`+'`code`"')
    const nastyScored = scoreSamples(nasty)
    const text = renderAccuracyReport(nastyScored, summarizeAccuracy(nastyScored), { sampleFile: 'x|y<z>.csv', maxNumber: 999, historyNames: 0 })
    const row = text.split('\n').find((line) => line.startsWith('| a'))
    expect(row).toBeDefined()
    // 이스케이프되지 않은 | 수 = 칸 8개 + 1
    const unescapedPipes = (row as string).replace(/\\\\/g, '').replace(/\\\|/g, '').split('|').length - 1
    expect(unescapedPipes).toBe(9)
    expect(text).not.toContain('<script>')
    expect(text).toContain('&lt;script&gt;')
    expect(tableCell('a\r\nb\u2028c')).toBe('a  b c')
    expect(tableCell('\\|')).toBe('\\\\\\|')
  })

  it('살펴볼 표본: 틀린 값을 채움·확실한데 틀림인 표본만', () => {
    const section = report.slice(report.indexOf('## 살펴볼 표본'), report.indexOf('## 표본별 결과'))
    expect(section.split('\n').filter((line) => line.startsWith('- ')).map((line) => line.slice(2, line.indexOf(' (')))).toEqual(['예시-15', '예시-16', '예시-18', '예시-19'])
  })
})

describe('AC-I4-03 명령 인자', () => {
  it('인자 없이 → 사용법', () => {
    expect(parseAccuracyArgs([])).toEqual({ ok: false, message: ACCURACY_USAGE, usage: true })
    expect(parseAccuracyArgs(['--'])).toEqual({ ok: false, message: ACCURACY_USAGE, usage: true })
  })

  it('선택지: --이름 값·--이름=값, -- 뒤는 표본 파일', () => {
    expect(parseAccuracyArgs(['a.csv'])).toEqual({ ok: true, value: { samples: 'a.csv', dictionary: null, maxNumber: 999, out: null } })
    expect(parseAccuracyArgs(['--max-number', '50', '--dictionary=names.txt', 'a.csv', '--out', 'r.md'])).toEqual({
      ok: true,
      value: { samples: 'a.csv', dictionary: 'names.txt', maxNumber: 50, out: 'r.md' },
    })
    expect(parseAccuracyArgs(['--', '--weird.csv'])).toEqual({ ok: true, value: { samples: '--weird.csv', dictionary: null, maxNumber: 999, out: null } })
    expect(parseAccuracyArgs(['a.csv', '--max-number=9999']).ok).toBe(true)
    expect(parseAccuracyArgs(['a.csv', '--max-number=1']).ok).toBe(true)
  })

  it.each([
    [['a.csv', '--verbose'], '모르는 선택지예요: --verbose'],
    [['a.csv', '-h'], '모르는 선택지예요: -h'],
    [['a.csv', '--out'], '--out 뒤에 값을 적어 주세요.'],
    [['a.csv', '--out='], '--out 뒤에 값을 적어 주세요.'],
    [['--out', '--max-number', '5', 'a.csv'], '--out 뒤에 값을 적어 주세요.'],
    [['a.csv', '--out', 'x', '--out', 'y'], '--out 선택지는 한 번만 적어 주세요.'],
    [['--max-number', '50'], '표본 파일을 적어 주세요.'],
    [['a.csv', 'b.csv'], '표본 파일은 하나만 적어 주세요(적힌 것 2개).'],
    [['a.csv', '--max-number', '0'], '--max-number는 1~9999 정수여야 해요(적힌 값 "0").'],
    [['a.csv', '--max-number', '10000'], '--max-number는 1~9999 정수여야 해요(적힌 값 "10000").'],
    [['a.csv', '--max-number', '1.5'], '--max-number는 1~9999 정수여야 해요(적힌 값 "1.5").'],
    [['a.csv', '--max-number', '-5'], '--max-number는 1~9999 정수여야 해요(적힌 값 "-5").'],
    [['a.csv', '--max-number', 'abc'], '--max-number는 1~9999 정수여야 해요(적힌 값 "abc").'],
  ])('%j → 오류', (argv, message) => {
    const result = parseAccuracyArgs(argv)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message.startsWith(message)).toBe(true)
    expect(!result.ok && result.usage).toBe(false)
  })
})

describe('AC-I4-03 명령 (node scripts/accuracy.ts)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'livejjim-accuracy-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const env = { ...process.env }
  delete env['npm_lifecycle_event']
  delete env['INIT_CWD']
  const run = (args: readonly string[]): { code: number | null; stdout: string; stderr: string } => {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, env, encoding: 'utf8', timeout: 30_000 })
    return { code: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  const file = (name: string, content: string | Uint8Array): string => {
    const path = join(dir, name)
    writeFileSync(path, content)
    return path
  }

  it('예시 파일 → 종료 코드 0, 표준 출력에 보고서(요약 수)', () => {
    const result = run([EXAMPLE])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('- 확실한데 틀림: 3\n')
    expect(result.stdout).toContain('- 틀린 값을 채움: 3\n')
    expect(result.stdout).toContain('- 표본 파일: accuracy-example.csv\n')
  })

  it('--out → 같은 보고서를 파일에도 (상대 경로는 지금 폴더 기준)', () => {
    const result = run([EXAMPLE, '--out', 'report.md'])
    expect(result.code).toBe(0)
    expect(readFileSync(join(dir, 'report.md'), 'utf8')).toBe(result.stdout)
  })

  it('--dictionary 이름 파일은 기본 사전 앞에 붙는다, --max-number', () => {
    const samples = file('s.csv', `${HEADER}\n예시,1000,10000,무지개꽃,1000번 무지개꽃 만원\n`)
    const names = file('names.txt', '\uFEFF무지개꽃\r\n\r\n')
    const plain = run([samples])
    expect(plain.stdout).toContain('| 예시 | 1000번 무지개꽃 만원 | 1000번 · 무지개꽃 · 10,000원 | 번호 없음 · 품종 없음 · 10,000원 | 확인 필요 | 빈칸 | 맞음 | 빈칸 |')
    const tuned = run([samples, '--dictionary', 'names.txt', '--max-number', '1000'])
    expect(tuned.code).toBe(0)
    expect(tuned.stdout).toContain('| 예시 | 1000번 무지개꽃 만원 | 1000번 · 무지개꽃 · 10,000원 | 1000번 · 무지개꽃 · 10,000원 | 확실 | 맞음 | 맞음 | 맞음 |')
    expect(tuned.stdout).toContain('- 품종 사전: 판매 이력 이름 1개')
    expect(names).toContain('names.txt')
  })

  it('인자 없이 → 사용법, 종료 코드 1', () => {
    const result = run([])
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('사용법: pnpm --filter @livejjim/voice accuracy <표본 파일>')
  })

  it.each([
    ['없는 파일', () => ['없는.csv'], '표본 파일을 찾지 못했어요: 없는.csv'],
    ['폴더', () => ['.'], '표본 파일 자리에 폴더가 있어요: .'],
    ['열 이름 다름', () => [file('h.csv', '번호,가격\n1,2')], '첫 줄의 열 이름은 정확히'],
    ['기대 가격 형식', () => [file('p.csv', `${HEADER}\na,1,"1,0000",,x`)], '2번째 줄: 기대 가격은'],
    ['표본 0개', () => [file('z.csv', `${HEADER}\r\n`)], '표본이 하나도 없어요'],
    ['UTF-8 아님 (CP949 "표본")', () => [file('cp949.csv', new Uint8Array([0xc7, 0xa5, 0xba, 0xbb, 0x2c, 0x0a]))], '표본 파일이 UTF-8이 아니에요'],
    ['모르는 선택지', () => [EXAMPLE, '--fast'], '모르는 선택지예요: --fast'],
    ['최대 번호 범위 밖', () => [EXAMPLE, '--max-number', '0'], '--max-number는 1~9999 정수여야 해요'],
    ['없는 이름 파일', () => [EXAMPLE, '--dictionary', 'no-names.txt'], '이름 파일을 찾지 못했어요: no-names.txt'],
    ['보고서 폴더 없음', () => [EXAMPLE, '--out', join('없는 폴더', 'r.md')], '보고서 파일을 쓰지 못했어요'],
    ['보고서를 표본 파일에', () => [file('same.csv', readFileSync(EXAMPLE, 'utf8')), '--out', 'same.csv'], '보고서를 읽는 파일과 같은 곳에 쓸 수 없어요'],
  ])('%s → 한 문장 + 종료 코드 1, 보고서를 쓰지 않는다', (_label, args, message) => {
    const result = run(args())
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim().split('\n')).toHaveLength(1)
    expect(result.stderr).toContain(message)
  })

  it('보고서를 표본 파일에 쓰려 하면 표본 파일은 그대로', () => {
    expect(readFileSync(join(dir, 'same.csv'), 'utf8')).toBe(readFileSync(EXAMPLE, 'utf8'))
    expect(existsSync(join(dir, '없는 폴더'))).toBe(false)
  })
})
