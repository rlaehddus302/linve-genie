// AC-V1-05 정확도 측정 스크립트의 문자찜 줄 (D-V1-11, D-I4-08, HG-4).
// 선택 열(종류·기대 끝자리·기대 이름)이 없는 표는 지금과 똑같이 읽는다 — accuracy.test.ts(AC-I4-03)가 그대로 통과하는 것이 그 확인이다.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ACCURACY_HEADER,
  ACCURACY_OPTIONAL_HEADER,
  parseAccuracySamples,
  renderAccuracyReport,
  scoreSamples,
  summarizeAccuracy,
  summarizeSmsAccuracy,
  type AccuracySample,
} from '../src/accuracy.ts'

const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url))
const SCRIPT = join(PACKAGE_DIR, 'scripts', 'accuracy.ts')
const EXAMPLE = join(PACKAGE_DIR, 'samples', 'accuracy-example.csv')
const SMS_EXAMPLE = join(PACKAGE_DIR, 'samples', 'accuracy-example-sms.csv')
const HEADER = [...ACCURACY_HEADER, ...ACCURACY_OPTIONAL_HEADER].join(',')

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

describe('AC-V1-05 선택 열 읽기', () => {
  it('선택 열이 없으면 표본 모양이 지금과 같다 (새 칸 없음)', () => {
    const [sample] = samplesOf(`${ACCURACY_HEADER.join(',')}\n예,15,15000,라울,15번 라울 만오천 원\n`)
    expect(Object.keys(sample as object)).toEqual(['line', 'label', 'expectedNo', 'expectedPrice', 'expectedName', 'text'])
  })

  it('선택 열은 기본 다섯 열 뒤에 아무 순서로, 필요한 것만', () => {
    expect(samplesOf(`${ACCURACY_HEADER.join(',')},기대 이름,종류\n예,15,,,김민지님 15번 문자찜,김민지,문자찜\n`)).toEqual([
      { line: 2, label: '예', expectedNo: 15, expectedPrice: null, expectedName: null, text: '김민지님 15번 문자찜', kind: '문자찜', expectedNos: [15], expectedLast4: null, expectedPerson: '김민지' },
    ])
    expect(samplesOf(`${ACCURACY_HEADER.join(',')},종류\n예,15,15000,라울,15번 라울 만오천 원,\n`)[0]).toMatchObject({ kind: '등록', expectedNos: [15], expectedNo: 15, expectedPrice: 15000 })
  })

  it('문자찜 줄: 기대 번호 목록(띄어 여러 개), 기대 가격·품종은 보지 않는다', () => {
    const [sample] = samplesOf(`${HEADER}\n예,15  28 15,아무거나,아무거나,15번 28번 문자찜,문자찜,0042,\n`)
    expect(sample).toMatchObject({ kind: '문자찜', expectedNos: [15, 28], expectedNo: null, expectedPrice: null, expectedName: null, expectedLast4: '0042', expectedPerson: null })
  })

  it.each([
    [`${HEADER}\n예,15,,,15번 문자찜,문짐,,\n`, '2번째 줄: 종류는 "등록"이나 "문자찜"이나 빈칸이어야 해요(적힌 값 "문짐").'],
    [`${HEADER}\n예,15,,,15번 문자찜,문자찜,123,\n`, '2번째 줄: 기대 끝자리는 숫자 4개나 빈칸이어야 해요(적힌 값 "123"'],
    [`${HEADER}\n예,15,,,15번 문자찜,문자찜,12a4,\n`, '2번째 줄: 기대 끝자리는 숫자 4개나 빈칸이어야 해요'],
    [`${HEADER}\n\n예,15,,,15번 문자찜,문자찜,１２３４,\n`, '3번째 줄: 기대 끝자리는 숫자 4개나 빈칸이어야 해요'],
    [`${HEADER}\n예,15 x,,,15번 문자찜,문자찜,,\n`, '2번째 줄: 문자찜의 기대 번호는 1~9999 정수(여러 개면 띄어서)나 빈칸이어야 해요'],
    [`${HEADER}\n예,15 28,,,15번 문자찜,등록,,\n`, '2번째 줄: 기대 번호는 1~9999 정수나 빈칸이어야 해요'],
    [`${HEADER}\n예,15,,,15번 문자찜,문자찜\n`, '2번째 줄의 칸이 6개예요 — 8개(표본·기대 번호·기대 가격·기대 품종·인식 문장·종류·기대 끝자리·기대 이름)여야 해요.'],
  ])('잘못된 칸 → 몇 번째 줄 + 한 문장: %#', (text, message) => {
    expect(errorOf(text)).toContain(message)
  })

  it('열 이름: 모르는 선택 열·겹친 선택 열·순서가 바뀐 기본 열은 안 된다', () => {
    expect(errorOf(`${ACCURACY_HEADER.join(',')},종류,종류\na,1,,,x,등록,등록`)).toBe(
      '첫 줄의 열 이름은 "표본,기대 번호,기대 가격,기대 품종,인식 문장" 뒤에 "종류", "기대 끝자리", "기대 이름" 중 필요한 것만 한 번씩 더해야 해요.',
    )
    expect(errorOf(`${ACCURACY_HEADER.join(',')},종류,비고\na,1,,,x,등록,`)).toContain('중 필요한 것만 한 번씩 더해야 해요')
    expect(errorOf(`종류,${ACCURACY_HEADER.join(',')}\n등록,a,1,,,x`)).toBe('첫 줄의 열 이름은 정확히 "표본,기대 번호,기대 가격,기대 품종,인식 문장"이어야 해요.')
  })
})

describe('AC-V1-05 채점', () => {
  const scoreOf = (row: string) => scoreSamples(samplesOf(`${HEADER}\n${row}\n`))[0]

  it('문자찜 줄: 번호 목록·끝자리·이름을 맞음/빈칸/틀림으로, 등록 칸은 채점 안 함', () => {
    expect(scoreOf('예,165,,,165번 문자찜 끝자리 1234,문자찜,1234,')).toMatchObject({ smsNo: '맞음', smsLast4: '맞음', smsPerson: '맞음', no: '채점 안 함', price: '채점 안 함', name: '채점 안 함', smsAutoWrong: false })
    expect(scoreOf('예,165,,,165번 문자찜,문자찜,1234,김민지')).toMatchObject({ smsNo: '맞음', smsLast4: '빈칸', smsPerson: '빈칸' })
    expect(scoreOf('예,,,,165번 문자찜 끝자리 1234 김민지님,문자찜,,')).toMatchObject({ smsNo: '틀림', smsLast4: '틀림', smsPerson: '틀림', smsAutoWrong: true })
    expect(scoreOf('예,15 28,,,28번 15번 문자찜,문자찜,,')).toMatchObject({ smsNo: '틀림', smsAutoWrong: false })
  })

  it('세 위험 수: 문자찜이 아닌데 문자찜으로 읽음·문자찜인데 못 읽음·다른 번호·끝자리로 저절로 넣을 문장', () => {
    expect(scoreOf('예,165,,,165번 문자 짐,문자찜,,')).toMatchObject({ missedSms: true, smsNo: '빈칸', smsAutoWrong: false })
    expect(scoreOf('예,12,,,12번 문자 찜하신 분,등록,,')).toMatchObject({ falseSms: true, smsAutoWrong: true, no: '맞음' })
    expect(scoreOf('예,,,,문자찜 얘기예요,등록,,')).toMatchObject({ falseSms: true, smsAutoWrong: false })
    // 번호가 둘 이상이면 저절로 넣지 않는다 — 틀려도 자동 넣기 위험은 아니다
    expect(scoreOf('예,15,,,15번 16번 문자찜,문자찜,,')).toMatchObject({ smsNo: '틀림', smsAutoWrong: false })
    // 최대 번호는 문자찜에도
    expect(scoreSamples(samplesOf(`${HEADER}\n예,201,,,201번 문자찜,문자찜,,\n`), { maxNumber: 200 })[0]).toMatchObject({ smsNo: '빈칸' })
  })
})

describe('AC-V1-05 문자찜 예시 표본 (packages/voice/samples/accuracy-example-sms.csv)', () => {
  const samples = samplesOf(readFileSync(SMS_EXAMPLE, 'utf8'))
  const scored = scoreSamples(samples)

  it('문자찜 12행("예시-문자찜-01"…) + 등록 3행 — 만든 문장임을 이름으로 알 수 있다', () => {
    const sms = samples.filter((item) => item.kind === '문자찜').map((item) => item.label)
    expect(sms).toEqual(Array.from({ length: 12 }, (_, i) => `예시-문자찜-${String(i + 1).padStart(2, '0')}`))
    expect(samples.filter((item) => item.kind === '등록').map((item) => item.label)).toEqual(['예시-등록-01', '예시-등록-02', '예시-등록-03'])
  })

  it('표본별 결과 (손으로 계산: R-21 — 번호·끝자리·이름, 위험 표시)', () => {
    // [번호, 끝자리, 이름, 못 읽음, 저절로 틀림]
    const want: [string, string, string, boolean, boolean][] = [
      ['맞음', '맞음', '맞음', false, false], // 01 165번 문자찜 되었습니다
      ['맞음', '맞음', '맞음', false, false], // 02 끝자리 1234
      ['맞음', '맞음', '맞음', false, false], // 03 김민지님
      ['맞음', '맞음', '맞음', false, false], // 04 15번 28번 — 눌러야
      ['맞음', '맞음', '맞음', false, false], // 05 백육십오번
      ['빈칸', '맞음', '맞음', false, false], // 06 1 5번 — 끊어 말한 번호, 넣지 않음
      ['빈칸', '빈칸', '맞음', false, false], // 07 끝자리 12 34 — 넣지 않음
      ['맞음', '맞음', '맞음', false, false], // 08 문자 찜
      ['빈칸', '맞음', '맞음', true, false], // 09 문자 짐 — 문자찜으로 못 읽음
      ['틀림', '맞음', '맞음', false, true], // 10 175번으로 들림 — 저절로 넣을 위험
      ['맞음', '틀림', '맞음', false, true], // 11 1243으로 들림 — 저절로 넣을 위험
      ['맞음', '맞음', '맞음', false, false], // 12 시각
    ]
    expect(scored.filter((item) => item.kind === '문자찜').map((item) => [item.smsNo, item.smsLast4, item.smsPerson, item.missedSms, item.smsAutoWrong])).toEqual(want)
  })

  it('요약 (손으로 센 값)', () => {
    expect(summarizeSmsAccuracy(scored)).toEqual({ samples: 12, read: 11, noCorrect: 8, last4Correct: 10, personCorrect: 12, falseSms: 2, missedSms: 1, autoWrong: 3 })
    expect(summarizeAccuracy(scored)).toMatchObject({ samples: 3, noCorrect: 3, priceCorrect: 3 })
  })

  it('보고서: 문자찜 요약 줄·문자찜 표·살펴볼 표본, 영어 상태값 없음', () => {
    const report = renderAccuracyReport(scored, summarizeAccuracy(scored), { sampleFile: 'accuracy-example-sms.csv', maxNumber: 999, historyNames: 0 })
    const lines = report.split('\n')
    for (const line of [
      '- 표본 수: 15 (상품 등록 3 · 문자찜 12)',
      '- 문자찜 표본 수: 12',
      '- 문자찜 번호 맞음: 8/12 (66.7%)',
      '- 문자찜 끝자리 맞음: 10/12 (83.3%)',
      '- 문자찜 이름 맞음: 12/12 (100.0%)',
      '- 문자찜이 아닌데 문자찜으로 읽음: 2',
      '- 문자찜인데 문자찜으로 못 읽음: 1',
      '- 다른 번호·끝자리로 저절로 넣을 문장: 3',
      '| 예시-문자찜-07 | 165번 문자찜 끝자리 12 34 | 165번 · 끝자리 1234 · 이름 없음 | 넣지 않음(끝자리를 못 알아들음) | 넣지 않음 | 빈칸 | 빈칸 | 맞음 |',
      '| 예시-문자찜-04 | 15번 28번 문자찜 끝자리 1234 | 15번 28번 · 끝자리 1234 · 이름 없음 | 15번 28번 · 끝자리 1234 · 이름 없음 | 눌러야 | 맞음 | 맞음 | 맞음 |',
    ]) {
      expect(lines).toContain(line)
    }
    expect(lines.filter((line) => line.startsWith('| 예시-문자찜-'))).toHaveLength(12)
    expect(lines.filter((line) => line.startsWith('| 예시-등록-'))).toHaveLength(3)
    const section = report.slice(report.indexOf('## 살펴볼 표본'), report.indexOf('## 표본별 결과'))
    expect(section.split('\n').filter((line) => line.startsWith('- ')).map((line) => line.slice(2, line.indexOf(' (')))).toEqual(['예시-문자찜-09', '예시-문자찜-10', '예시-문자찜-11', '예시-등록-02', '예시-등록-03'])
    expect(report).not.toMatch(/HIGH|LOW|null|undefined|NaN|true|false|OPEN|CONFIRMED|UNCLEAR|CANCEL|SENT/)
  })

  it('지금 예시(문자찜 열 없음) 보고서에도 문자찜 요약은 0으로 보이고 표본별 표는 그대로 20행', () => {
    const old = scoreSamples(samplesOf(readFileSync(EXAMPLE, 'utf8')))
    const report = renderAccuracyReport(old, summarizeAccuracy(old), { sampleFile: 'accuracy-example.csv', maxNumber: 999, historyNames: 0 })
    expect(report.split('\n')).toContain('- 표본 수: 20')
    expect(report.split('\n')).toContain('- 다른 번호·끝자리로 저절로 넣을 문장: 0')
    expect(report.split('\n').filter((line) => line.startsWith('| 예시-'))).toHaveLength(20)
  })
})

describe('AC-V1-05 명령', () => {
  const dir = mkdtempSync(join(tmpdir(), 'livejjim-accuracy-sms-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const env = { ...process.env }
  delete env['npm_lifecycle_event']
  delete env['INIT_CWD']
  const run = (args: readonly string[]) => {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, env, encoding: 'utf8', timeout: 30_000 })
    return { code: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  const file = (name: string, content: string): string => {
    const path = join(dir, name)
    writeFileSync(path, content)
    return path
  }

  it('문자찜 예시 → 종료 코드 0, 세 위험 수가 따로 나온다', () => {
    const result = run([SMS_EXAMPLE])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('- 문자찜이 아닌데 문자찜으로 읽음: 2\n')
    expect(result.stdout).toContain('- 문자찜인데 문자찜으로 못 읽음: 1\n')
    expect(result.stdout).toContain('- 다른 번호·끝자리로 저절로 넣을 문장: 3\n')
  })

  it.each([
    ['잘못된 종류', `${HEADER}\n예,15,,,15번 문자찜,찜,,\n`, '2번째 줄: 종류는 "등록"이나 "문자찜"이나 빈칸이어야 해요'],
    ['끝자리가 숫자 4개가 아님', `${HEADER}\n예,15,,,15번 문자찜,문자찜,42,\n`, '2번째 줄: 기대 끝자리는 숫자 4개나 빈칸이어야 해요'],
  ])('%s → 한 문장 + 종료 코드 1, 보고서를 쓰지 않는다', (_label, content, message) => {
    const result = run([file('bad.csv', content)])
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim().split('\n')).toHaveLength(1)
    expect(result.stderr).toContain(message)
  })
})
