// I4 적대 테스트 (test-domain): 정확도 측정 스크립트 (AC-I4-03, D-I4-08, HG-4). 통과한 공격을 회귀로 남긴다.
// CSV(BOM·CRLF·따옴표 안 쉼표·줄바꿈·""), 잘못된 입력의 종료 코드 1, 보고서 표 깨기, 요약 수를 손으로 다시 세기.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAccuracySamples, renderAccuracyReport, scoreSamples, summarizeAccuracy } from '@livejjim/voice/accuracy'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '../../..')
const SCRIPT = join(ROOT, 'packages/voice/scripts/accuracy.ts')
const HEADER = '표본,기대 번호,기대 가격,기대 품종,인식 문장'
const dir = mkdtempSync(join(tmpdir(), 'livejjim-i4-accuracy-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function file(name: string, text: string | Uint8Array): string {
  const path = join(dir, name)
  writeFileSync(path, text)
  return path
}
function run(...args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, npm_lifecycle_event: '' } })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

// 손으로 센 표본 (사전 = 기본 사전, maxNumber 999)
//  a: 15번·핑크프릴·15,000 HIGH — 셋 다 맞음
//  b: 기대 번호 빈칸인데 뽑음(16) → 번호 틀림 → 틀린 값을 채움. LOW(가격 없음) → 확실한데 틀림 아님. 가격 빈칸·빈칸 → 맞음
//  c: 17번 라울 만원 HIGH, 기대 품종 블루엘프 → 품종만 틀림 → 확실한데 틀림(번호·가격은 맞음 → 틀린 값을 채움 아님)
//  d: `1 8번` — V3 D-V3-54 앞 수와 합치기로 18번(숫자 한 개 둘 → 두 자리) → 번호·가격·품종 맞음, 카드 있음 (I4 때는 끊어 말한 번호로 빈칸·카드 없음)
//  e: 잡담 — 기대 모두 빈칸, 품종 채점 안 함, 카드 없음
//  f: 따옴표 안 줄바꿈·쉼표·"" 가 든 문장 `19번 라울, "진짜" 만원` → 19·라울·10,000 HIGH 맞음
const SAMPLE = [
  `\uFEFF${HEADER}`,
  'a,15,"15,000",핑크프릴,15번 핑크프릴 만오천 원',
  'b,,,,16번 핑크푸릴',
  'c,17,10000,블루엘프,17번 라울 만원',
  'd,18,10000,라울,1 8번 라울 만원',
  '',
  ',,,,',
  'e,,,,안녕하세요 여러분',
  'f,19,10000,라울,"19번 라울, ""진짜""\r\n만원"',
].join('\r\n')

describe('AC-I4-03 요약 수 손 계산', () => {
  it('맞음·틀린 값을 채움·확실한데 틀림·카드 수', () => {
    const parsed = parseAccuracySamples(SAMPLE)
    if (!parsed.ok) throw new Error(parsed.message)
    expect(parsed.value.map((sample) => [sample.label, sample.line])).toEqual([
      ['a', 2],
      ['b', 3],
      ['c', 4],
      ['d', 5],
      ['e', 8],
      ['f', 9],
    ])
    expect(parsed.value[5]?.text).toBe('19번 라울, "진짜"\r\n만원')
    const scored = scoreSamples(parsed.value)
    expect(scored.map((item) => [item.no, item.price, item.name])).toEqual([
      ['맞음', '맞음', '맞음'],
      ['틀림', '맞음', '채점 안 함'],
      ['맞음', '맞음', '틀림'],
      ['맞음', '맞음', '맞음'], // d: D-V3-54
      ['맞음', '맞음', '채점 안 함'],
      ['맞음', '맞음', '맞음'],
    ])
    expect(summarizeAccuracy(scored)).toEqual({
      samples: 6,
      noCorrect: 5,
      priceCorrect: 6,
      bothCorrect: 5,
      nameCorrect: 3,
      nameScored: 4,
      filledWrong: 1,
      confidentWrong: 1,
      cardWorthy: 5,
    })
    const report = renderAccuracyReport(scored, summarizeAccuracy(scored), { sampleFile: 'x.csv', maxNumber: 999, historyNames: 0 })
    expect(report).toContain('- 번호 맞음: 5/6 (83.3%)')
    expect(report).toContain('- 품종 맞음: 3/4 (75.0%)')
    expect(report).not.toMatch(/HIGH|LOW|null|undefined|NaN/)
  })
})

describe('AC-I4-03 명령', () => {
  it('정상 파일 → 종료 코드 0, 보고서는 표준 출력', () => {
    const result = run(file('ok.csv', SAMPLE))
    expect(result.code).toBe(0)
    expect(result.err).toBe('')
    expect(result.out).toContain('- 틀린 값을 채움: 1')
  })

  it('보고서 표: | 와 줄바꿈과 HTML이 표를 깨지 않는다 (표의 모든 줄의 칸 수가 같다)', () => {
    const csv = `${HEADER}\n"a|b",15,15000,라울,"15번 | 라울 <img src=x onerror=alert(1)>\n만오천 원"\n`
    const result = run(file('pipe.csv', csv))
    expect(result.code).toBe(0)
    const table = result.out.split('\n').filter((line) => line.startsWith('|'))
    const cells = (line: string) => line.replace(/\\\|/g, '').split('|').length
    expect(new Set(table.map(cells)).size).toBe(1)
    expect(result.out).not.toContain('<img')
  })

  it.each([
    ['열 순서 바뀜', '표본,기대 가격,기대 번호,기대 품종,인식 문장\na,15000,15,라울,x\n'],
    ['칸 수가 다른 줄', `${HEADER}\na,15,15000,라울\n`],
    ['기대 가격 1,0000', `${HEADER}\na,15,"1,0000",라울,x\n`],
    ['기대 가격 50', `${HEADER}\na,15,50,라울,x\n`],
    ['기대 가격 -100', `${HEADER}\na,15,-100,라울,x\n`],
    ['기대 번호 15번', `${HEADER}\na,15번,15000,라울,x\n`],
    ['닫히지 않은 따옴표', `${HEADER}\na,15,15000,라울,"x\n`],
    ['표본 0개', `${HEADER}\n\n,,,,\n`],
  ])('잘못된 입력(%s) → 한 문장 + 종료 코드 1, 보고서 없음', (_, csv) => {
    const out = join(dir, `report-${String(Math.random()).slice(2)}.md`)
    const result = run(file('bad.csv', csv), '--out', out)
    expect(result.code).toBe(1)
    expect(result.out).toBe('')
    expect(result.err.trim().split('\n')).toHaveLength(1)
    expect(existsSync(out)).toBe(false)
  })

  it('UTF-8이 아닌 파일(엑셀 CP949) → 종료 코드 1', () => {
    const cp949 = Uint8Array.from([0xc7, 0xa5, 0xba, 0xbb, 0x0a])
    expect(run(file('cp949.csv', cp949)).code).toBe(1)
  })

  it('없는 파일·폴더·인자 없음·모르는 선택지·범위 밖 최대 번호 → 종료 코드 1', () => {
    expect(run(join(dir, 'none.csv')).code).toBe(1)
    expect(run(dir).code).toBe(1)
    const usage = run()
    expect(usage.code).toBe(1)
    expect(usage.err).toContain('사용법')
    const ok = file('ok2.csv', SAMPLE)
    expect(run(ok, '--bogus').code).toBe(1)
    expect(run(ok, '--max-number', '0').code).toBe(1)
    expect(run(ok, '--max-number', '10000').code).toBe(1)
  })

  it('--out이 표본 파일 자신이면 거절하고 표본을 지우지 않는다', () => {
    const path = file('self.csv', SAMPLE)
    expect(run(path, '--out', path).code).toBe(1)
    expect(readFileSync(path, 'utf8')).toBe(SAMPLE)
  })
})
