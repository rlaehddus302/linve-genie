// 서버 시험 준비 파일 (N2b-1, AC-N2b-1-04): 시험 파일마다 틱톡·서명 서비스로 나가는 연결 막기 장치를 깔고,
// 그 파일에서 막힌 시도가 하나라도 있으면 그 파일을 실패시킨다. (다른 트랙의 막기 장치와 합칠 때는 오케스트레이터가 이 파일을 합친다.)
import { afterAll, beforeAll } from 'vitest'
import { installOutboundGuard, TIKTOK_BLOCKED_DOMAINS } from './outbound-guard.ts'

const guard = installOutboundGuard('tiktok', TIKTOK_BLOCKED_DOMAINS)

beforeAll(() => {
  guard.reset()
})

afterAll(() => {
  const hosts = guard.reset()
  if (hosts.length > 0) {
    throw new Error(`시험 중 틱톡·서명 서비스로 나가는 연결 시도 ${String(hosts.length)}번을 막았다 (${[...new Set(hosts)].join(', ')}). 실제 틱톡 연결은 시험에서 쓰지 않는다 — 가짜 웹캐스트를 쓴다(D-N2b-1-07).`)
  }
})
