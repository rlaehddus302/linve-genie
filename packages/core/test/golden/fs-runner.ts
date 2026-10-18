// 파일 시스템에서 골든을 읽어 돌린다 (프로그램 API). CLI(pnpm golden)는 항상 고정 경로로 이것을 부른다.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { ALLOWLIST_FILE } from './contract.ts'
import { realCore } from './core-adapter.ts'
import { runGoldenSources, type GoldenSource } from './runner.ts'
import type { GoldenCore, GoldenReport } from './types.ts'

export interface RunGoldenDirOptions {
  /** 골든 폴더 (절대 경로 권장) */
  readonly goldenDir: string
  /**
   * 허용 목록 파일. 생략하면 `<goldenDir>/known-unimplemented.yaml`.
   * `null`이면 허용 목록 없음(빈 목록). 어느 경우든 `<goldenDir>/known-unimplemented.yaml`은 골든으로 읽지 않는다.
   */
  readonly allowlistPath?: string | null
  /** 생략하면 실제 코어 */
  readonly core?: GoldenCore
  /** 보고에 쓰는 경로의 기준 폴더. 생략하면 현재 작업 폴더 */
  readonly displayRoot?: string
}

const toPosix = (path: string): string => path.split(sep).join('/')

/** 하위 폴더까지 모든 `*.yaml`·`*.yml` (예약 파일 제외), 상대 경로의 문자 코드 순서 */
export function listGoldenFiles(goldenDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) {
        if (dir === goldenDir && entry.name === ALLOWLIST_FILE) continue
        out.push(full)
      }
    }
  }
  if (existsSync(goldenDir) && statSync(goldenDir).isDirectory()) walk(goldenDir)
  const key = (file: string): string => toPosix(relative(goldenDir, file))
  return out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
}

export function runGoldenDir(options: RunGoldenDirOptions): GoldenReport {
  const root = options.displayRoot ?? process.cwd()
  const show = (path: string): string => toPosix(relative(root, path)) || '.'
  const files: GoldenSource[] = listGoldenFiles(options.goldenDir).map((file) => ({ path: show(file), text: readFileSync(file, 'utf8') }))
  const allowlistPath = options.allowlistPath === undefined ? join(options.goldenDir, ALLOWLIST_FILE) : options.allowlistPath
  const allowlist =
    allowlistPath === null
      ? { path: '(허용 목록 없음)', text: null }
      : { path: show(allowlistPath), text: existsSync(allowlistPath) ? readFileSync(allowlistPath, 'utf8') : null }
  return runGoldenSources({ files, allowlist, core: options.core ?? realCore, goldenLabel: show(options.goldenDir) })
}
