// 서버 시험 준비 파일 (A1, AC-A1 공통 전제·AC-A1-11): 시험 중 실제 Anthropic 주소(api.anthropic.com·anthropic.com)로 나가는 연결을 막고,
// 그 파일에서 막힌 시도가 하나라도 있으면 그 파일을 실패시킨다. AI 제안 시험은 가짜 LLM 서버(127.0.0.1)만 쓴다(D-A1-08).
import { afterAll, beforeAll } from 'vitest'
import { installOutboundGuard } from './outbound-guard.ts'

export const ASSIST_BLOCKED_DOMAINS: readonly string[] = Object.freeze(['anthropic.com'])

const guard = installOutboundGuard('assist', ASSIST_BLOCKED_DOMAINS)

beforeAll(() => {
  guard.reset()
})

afterAll(() => {
  const hosts = guard.reset()
  if (hosts.length > 0) throw new Error(`시험 중 실제 Anthropic 주소로 나가는 연결 시도 ${String(hosts.length)}번을 막았다 (${[...new Set(hosts)].join(', ')}). AI 제안 시험은 가짜 LLM 서버를 쓴다(D-A1-08).`)
})
