// 음성 추출 정확도 측정 명령 (SPEC §8 4단계, HG-4, D-I4-08, AC-I4-03).
//
//   pnpm --filter @livejjim/voice accuracy <표본 파일> [--dictionary <이름 파일>] [--max-number <1~9999>] [--out <보고서 파일>]
//   예: pnpm --filter @livejjim/voice accuracy packages/voice/samples/accuracy-example.csv
//       (저장소 루트에서. 상대 경로는 명령을 실행한 폴더 기준 — pnpm이 넘기는 INIT_CWD)
//   직접: node packages/voice/scripts/accuracy.ts <표본 파일> … (상대 경로는 지금 폴더 기준)
//
// - 표본 파일: UTF-8 CSV(맨 앞 BOM·CRLF 허용), 첫 줄 정확히 "표본,기대 번호,기대 가격,기대 품종,인식 문장".
// - 표본마다 골든과 같은 extractVoice(인식 문장, { maxNumber, dictionary: 이력 이름 + 기본 사전 })로 뽑아 칸마다 맞음·빈칸·틀림을 매기고
//   쉬운 한국어 마크다운 보고서를 표준 출력에 쓴다(--out이면 그 파일에도). 정확도와 상관없이 종료 코드 0.
// - 잘못된 입력(파일 없음·UTF-8 아님·열 이름 다름·칸 형식·표본 0개·모르는 선택지·범위 밖)은 한 문장을 표준 오류에 쓰고 종료 코드 1, 보고서는 쓰지 않는다.
//   인자 없이 부르면 사용법을 표준 오류에 쓰고 종료 코드 1.
// - 넘긴 파일만 읽고 --out 파일만 쓴다. 네트워크를 쓰지 않는다.
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import {
  parseAccuracyArgs,
  parseAccuracySamples,
  parseDictionaryLines,
  renderAccuracyReport,
  scoreSamples,
  summarizeAccuracy,
  type Parsed,
} from '../src/accuracy.ts'

/** 상대 경로의 기준: pnpm 패키지 스크립트로 불렸으면 명령을 실행한 폴더(INIT_CWD — pnpm은 스크립트를 패키지 폴더에서 돌린다), 아니면 지금 폴더 */
function baseDirectory(): string {
  const initCwd = process.env['INIT_CWD']
  return process.env['npm_lifecycle_event'] === 'accuracy' && initCwd !== undefined && initCwd !== '' ? initCwd : process.cwd()
}

const fromBase = (path: string): string => (isAbsolute(path) ? path : resolve(baseDirectory(), path))

/** UTF-8 글 파일 읽기 (UTF-8이 아니면 오류 — 엑셀 기본 CSV(CP949)를 잘못 읽어 엉뚱한 글자로 채점하지 않게) */
function readText(path: string, what: string): Parsed<string> {
  const full = fromBase(path)
  let bytes: Uint8Array
  try {
    if (statSync(full).isDirectory()) return { ok: false, message: `${what} 자리에 폴더가 있어요: ${path}` }
    bytes = readFileSync(full)
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT'
    return { ok: false, message: missing ? `${what}을 찾지 못했어요: ${path}` : `${what}을 읽지 못했어요: ${path}` }
  }
  try {
    return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { ok: false, message: `${what}이 UTF-8이 아니에요 — 엑셀에서는 "CSV UTF-8(쉼표로 분리)"로 저장해 주세요: ${path}` }
  }
}

/** 같은 파일인가 (심볼릭 링크·/tmp ↔ /private/tmp 같은 다른 이름도 — 장치·아이노드로 본다). 보고서 파일이 아직 없으면 거짓 */
function sameFile(a: string, b: string): boolean {
  try {
    const left = statSync(a)
    const right = statSync(b)
    return left.dev === right.dev && left.ino === right.ino
  } catch {
    return false
  }
}

function main(argv: readonly string[]): number {
  const fail = (message: string): number => {
    process.stderr.write(`${message}\n`)
    return 1
  }
  const args = parseAccuracyArgs(argv)
  if (!args.ok) return fail(args.message)
  const { samples: samplePath, dictionary: dictionaryPath, maxNumber, out } = args.value

  const sampleText = readText(samplePath, '표본 파일')
  if (!sampleText.ok) return fail(sampleText.message)
  const samples = parseAccuracySamples(sampleText.value)
  if (!samples.ok) return fail(samples.message)

  let history: string[] = []
  if (dictionaryPath !== null) {
    const dictionaryText = readText(dictionaryPath, '이름 파일')
    if (!dictionaryText.ok) return fail(dictionaryText.message)
    history = parseDictionaryLines(dictionaryText.value)
  }

  const scored = scoreSamples(samples.value, { maxNumber, history })
  const report = renderAccuracyReport(scored, summarizeAccuracy(scored), { sampleFile: basename(samplePath), maxNumber, historyNames: history.length })

  if (out !== null) {
    const outPath = fromBase(out)
    const inputs = [samplePath, ...(dictionaryPath === null ? [] : [dictionaryPath])].map(fromBase)
    if (inputs.some((input) => sameFile(input, outPath))) return fail(`보고서를 읽는 파일과 같은 곳에 쓸 수 없어요: ${out}`)
    try {
      writeFileSync(outPath, report, 'utf8')
    } catch {
      return fail(`보고서 파일을 쓰지 못했어요(폴더가 있는지 확인해 주세요): ${out}`)
    }
  }
  process.stdout.write(report)
  return 0
}

process.exitCode = main(process.argv.slice(2))
