// 러너 자체 테스트용 도구 (테스트 파일 아님). 픽스처는 tests/golden 밖에서 만든다.
import { stringify } from 'yaml'
import { createFakeCore, type FakeCoreOptions } from './fake-core.ts'
import { runGoldenSources, type GoldenSource } from './runner.ts'
import type { GoldenCore, GoldenReport } from './types.ts'

export const B1 = { id: 'b1', date: '2026-10-18', title: '1부' }

/** 시나리오 문서 하나를 YAML로 만든다. 빠진 키는 최소 정상값. */
export function scenario(fields: Record<string, unknown> = {}): string {
  return stringify({
    id: 'G-ENG-901',
    title: '러너 자체 테스트',
    refs: ['R-4'],
    broadcasts: [B1],
    events: [],
    expect: {},
    ...fields,
  })
}

/** 여러 YAML 문서를 `---`로 잇는다. */
export function docs(...texts: string[]): string {
  return texts.join('---\n')
}

export function suiteDoc(suite: string, cases: readonly { in: string; out: unknown }[], settings?: Record<string, unknown>): string {
  return stringify({ suite, ...(settings ? { settings } : {}), cases })
}

export interface RunOptions {
  readonly allowlist?: string | null
  readonly core?: GoldenCore
  readonly fake?: FakeCoreOptions
}

export function run(files: readonly GoldenSource[] | string, options: RunOptions = {}): GoldenReport {
  const list = typeof files === 'string' ? [{ path: 'fixture.yaml', text: files }] : files
  return runGoldenSources({
    files: list,
    allowlist: { path: 'known-unimplemented.yaml', text: options.allowlist === undefined ? null : options.allowlist },
    core: options.core ?? createFakeCore(options.fake),
    goldenLabel: 'fixtures',
  })
}
