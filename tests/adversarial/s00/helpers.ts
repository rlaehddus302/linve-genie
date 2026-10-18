// S00 적대 테스트 공용 도구 (test-domain). 픽스처는 모두 메모리 안에서 만든다(tests/golden을 건드리지 않는다).
// JSON은 YAML 1.2의 부분 집합이라 JSON.stringify 결과를 골든 문서로 그대로 쓸 수 있다.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runGoldenSources, type GoldenCore, type GoldenReport, type GoldenSource } from '@livejjim/core/golden'

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export const B1 = { id: 'b1', date: '2026-10-18', title: '1부' } as const

/** 엔진 시나리오 문서 하나 (빠진 키는 최소 정상값) */
export function scenarioText(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'G-ENG-901',
    title: '적대 테스트',
    refs: ['R-4'],
    broadcasts: [B1],
    events: [],
    expect: {},
    ...fields,
  })
}

export function suiteText(suite: string, cases: readonly { in: string; out: unknown }[], settings?: Record<string, unknown>): string {
  return JSON.stringify({ suite, ...(settings ? { settings } : {}), cases })
}

export function register(no: number, at = '20:00:00'): Record<string, unknown> {
  return { at, type: 'product.register', b: 'b1', no, name: '핑크프릴', price: 10000 }
}

/** 허용 목록 문서 (JSON = YAML) */
export function allowlistText(suites: readonly string[], scenarios: readonly string[]): string {
  return JSON.stringify({ sprint: 'S00', suites, scenarios })
}

export function runSources(files: readonly GoldenSource[] | string, core: GoldenCore, allowlist: string | null = null): GoldenReport {
  const list = typeof files === 'string' ? [{ path: 'fixture.yaml', text: files }] : files
  return runGoldenSources({ files: list, allowlist: { path: 'known-unimplemented.yaml', text: allowlist }, core, goldenLabel: 'adversarial' })
}

/** 저장소 루트에서 node 자식 프로세스를 띄운다 */
export function node(args: readonly string[], env: Readonly<Record<string, string | undefined>> = {}, cwd = ROOT): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60_000 })
}
