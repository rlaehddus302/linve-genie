// 서버 시험 준비 파일 (BND1, AC-BND1-63): 시험 중 실제 밴드 주소(band.us — auth.band.us·openapi.band.us 포함)로 나가는 연결을 막고,
// 그 파일에서 막힌 시도가 하나라도 있으면 그 파일을 실패시킨다. 밴드 시험은 가짜 밴드 서버(127.0.0.1)만 쓴다(D-BND1-13).
import { afterAll, beforeAll } from 'vitest'
import { installOutboundGuard } from './outbound-guard.ts'

export const BAND_BLOCKED_DOMAINS: readonly string[] = Object.freeze(['band.us'])

const guard = installOutboundGuard('band', BAND_BLOCKED_DOMAINS)

beforeAll(() => {
  guard.reset()
})

afterAll(() => {
  const hosts = guard.reset()
  if (hosts.length > 0) throw new Error(`시험 중 실제 밴드 주소로 나가는 연결 시도 ${String(hosts.length)}번을 막았다 (${[...new Set(hosts)].join(', ')}). 밴드 시험은 가짜 밴드 서버를 쓴다(D-BND1-13).`)
})
