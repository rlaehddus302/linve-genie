// N2b-1 적대 테스트 (test-domain): 라이브러리 2.1.0의 실제 실패 모양 → 실패 종류 (AC-N2b-1-35, D-N2b-1-05·07).
//
// TD-N2b-1-001 — 틱톡 웹소켓이 403·429로 거부하면 BLOCKED여야 하는데 NETWORK가 된다.
//   tiktok-live-connector 2.1.0 setupWebsocket()은 웹소켓 손잡기 실패를 오류 객체가 아니라 **문자열**로 거부한다:
//     wsClient.on('error', (err) => reject(`Websocket connection failed, ${err}`))
//   ws 8.x는 손잡기 응답이 101이 아니면 Error(`Unexpected server response: ${res.statusCode}`)를 낸다(abortHandshake).
//   그래서 틱톡이 웹소켓을 403(거부)·429(요청 한도)로 막으면 거부 값은
//     'Websocket connection failed, Error: Unexpected server response: 403'
//   이다. AC-N2b-1-35는 "틱톡의 거부(403)·요청 한도(429) → BLOCKED"인데 classifyWebcastFailure는 문자열을 보지 않고 NETWORK로 돌린다.
//   판매자 화면은 "틱톡 연결이 끊겨 다시 연결하는 중이에요"(자동으로 돌아올 듯한 안내)를 보이고,
//   BLOCKED의 "그동안 댓글을 직접 넣어 주세요"(수동 입력 대체)를 보이지 않는다 — 막힌 동안의 찜 댓글을 놓쳐 선착순이 틀어진다.
//   (같은 거부가 HTTP 단계에서 오면 axios 오류의 response.status로 BLOCKED가 된다 — 웹소켓 단계만 빠졌다.)
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installOutboundGuard, TIKTOK_BLOCKED_DOMAINS } from '../../../apps/server/test/outbound-guard.ts'
import {
  checkTikTokTarget,
  classifyWebcastFailure,
  createTikTokConnection,
  FakeTikTokClock,
  flushTikTokTasks,
  libraryWebcast,
  readTikTokSettings,
  type LibraryConnectionConstructor,
  type LibraryConnectionLike,
  type TikTokConnectionStatus,
} from '../../../apps/server/src/tiktok/index.ts'

const guard = installOutboundGuard('tiktok', TIKTOK_BLOCKED_DOMAINS)
const leaks: unknown[] = []
const onLeak = (error: unknown): void => {
  leaks.push(error)
}
beforeEach(() => {
  leaks.length = 0
  guard.reset()
  process.on('unhandledRejection', onLeak)
})
afterEach(() => {
  process.off('unhandledRejection', onLeak)
  expect(leaks).toEqual([])
  expect(guard.reset()).toEqual([])
})

/** 라이브러리 2.1.0 setupWebsocket의 거부 값 (문자열) — ws 8.x 손잡기 실패 메시지를 그대로 넣는다 */
const wsRejection = (status: number): string => `Websocket connection failed, ${String(new Error(`Unexpected server response: ${String(status)}`))}`

describe('TD-N2b-1-001: 틱톡 웹소켓 손잡기 403·429 거부는 BLOCKED (AC-N2b-1-35)', () => {
  it('거부 값의 모양 확인 — 라이브러리가 만드는 문자열 그대로', () => {
    expect(wsRejection(403)).toBe('Websocket connection failed, Error: Unexpected server response: 403')
  })

  it.each([403, 429])('웹소켓 손잡기 %i → BLOCKED', (status) => {
    expect(classifyWebcastFailure(wsRejection(status))).toBe('BLOCKED')
  })

  it('실제 감싸개 경로: 라이브러리 connect()가 웹소켓 403 문자열로 거부 → RETRYING/BLOCKED, 문장은 "직접 넣어 주세요"', async () => {
    class WsForbidden implements LibraryConnectionLike {
      connect(): Promise<unknown> {
        return Promise.reject(wsRejection(403))
      }
      disconnect(): void {}
      on(): unknown {
        return undefined
      }
    }
    const checked = checkTikTokTarget('@seller_kim')
    if (!checked.ok) throw new Error('준비')
    const statuses: TikTokConnectionStatus[] = []
    const conn = createTikTokConnection({
      sellerId: 'seller-1',
      target: checked.target,
      webcast: libraryWebcast({ Connection: WsForbidden as unknown as LibraryConnectionConstructor }),
      onRecord: () => undefined,
      onStatus: (s) => statuses.push(s),
      settings: readTikTokSettings({ LIVEJJIM_TIKTOK_BETA: 'on' }),
      consent: async () => true,
      clock: new FakeTikTokClock(0),
      log: () => undefined,
    })
    conn.start()
    await flushTikTokTasks()
    const s = conn.status()
    expect({ state: s.state, reason: s.reason, lastFailure: s.lastFailure }).toEqual({ state: 'RETRYING', reason: 'BLOCKED', lastFailure: 'BLOCKED' })
    expect(s.message).toBe('틱톡이 연결을 막아 다시 시도하는 중이에요. 그동안 댓글을 직접 넣어 주세요.')
  })
})

describe('N2b-1 실패 종류 회귀 — 문자열·그 밖 모양은 NETWORK 그대로', () => {
  it.each([
    ['웹소켓 응답 없음', 'Websocket not responding'],
    ['웹소켓 손잡기 500', wsRejection(500)],
    ['웹소켓 네트워크 오류', 'Websocket connection failed, Error: getaddrinfo ENOTFOUND webcast16-ws-useast1a.tiktok.com'],
    ['빈 문자열', ''],
  ])('%s → NETWORK', (_label, value) => {
    expect(classifyWebcastFailure(value)).toBe('NETWORK')
  })
})
