// 서버 시험 공통 준비 (AC-Y1-72·91): 실제 구글 주소로 나가는 요청을 막는다. 막힌 요청이 하나라도 있으면 그 시험 파일이 실패한다.
import { afterAll, expect } from 'vitest'
import { blockedRequests, installGoogleBlock } from '../src/youtube/network-guard.ts'

installGoogleBlock()

afterAll(() => {
  expect(blockedRequests.count, '실제 구글 주소로 나가려던 요청').toBe(0)
})
