// 서버 시험 준비 파일 (L1, AC-L1 공통 전제): 시험 중 실제 카카오·네이버 주소(kauth·kapi.kakao.com, nid.naver.com, openapi.naver.com)로 나가는 연결을 막고,
// 그 파일에서 막힌 시도가 하나라도 있으면 그 파일을 실패시킨다. 구글 주소(accounts.google.com·oauth2·openidconnect.googleapis.com)는 setup-network-guard.ts가 막는다.
// 간편 로그인 시험은 가짜 OAuth 서버(127.0.0.1)만 쓴다.
import { afterAll, beforeAll } from 'vitest'
import { installOutboundGuard } from './outbound-guard.ts'

export const SOCIAL_BLOCKED_DOMAINS: readonly string[] = Object.freeze(['kakao.com', 'naver.com'])

const guard = installOutboundGuard('social-login', SOCIAL_BLOCKED_DOMAINS)

beforeAll(() => {
  guard.reset()
})

afterAll(() => {
  const hosts = guard.reset()
  if (hosts.length > 0) throw new Error(`시험 중 실제 카카오·네이버 주소로 나가는 연결 시도 ${String(hosts.length)}번을 막았다 (${[...new Set(hosts)].join(', ')}). 간편 로그인 시험은 가짜 OAuth 서버를 쓴다(D-L1-07).`)
})
