// 플랫폼 공통 어댑터 모양의 인스타그램 구현 (AC-N2-04, D-N2-12): 댓글 원천(라이브 찾기)·감사 보내기.
// 틱톡 구현은 없다(D-904 결정 대기) — 라이브 연결이 PLATFORM_NOT_SUPPORTED로 막고 어떤 외부 주소도 부르지 않는다.
import type { LogSink } from '../log.ts'
import type { LiveSource, PlatformFailure, ThanksSender, ThanksSendResult } from '../platform.ts'
import type { InstagramConnections } from './connection.ts'
import type { MetaClient } from './meta.ts'

/** 인스타그램 라이브 찾기 (live_media). 토큰 무효면 연결을 "다시 연결 필요"로 바꾼다 */
export function instagramLiveSource(connections: InstagramConnections, meta: MetaClient | null, log: LogSink): LiveSource {
  return {
    platform: 'INSTAGRAM',
    liveNow: async (sellerId) => {
      const api = await connections.api(sellerId)
      if (!api.ok) return { ok: false, failure: api.failure }
      if (meta === null) return { ok: false, failure: 'NOT_CONFIGURED' }
      const result = await meta.liveMedia(api.conn)
      if (result.ok) return { ok: true, lives: result.value }
      log({ level: 'warn', code: 'IG_META_FAILED', errorKind: result.failure })
      if (result.failure === 'TOKEN_INVALID') {
        await connections.markReconnect(sellerId)
        return { ok: false, failure: 'RECONNECT_NEEDED' satisfies PlatformFailure }
      }
      return { ok: false, failure: 'UNAVAILABLE' satisfies PlatformFailure }
    },
  }
}

/**
 * 인스타그램 감사 보내기: 받는 곳 = 댓글 ID(개인 답장), 확인 = 그 사람(IGSID)과의 대화 조회.
 * 토큰 무효면 연결을 "다시 연결 필요"로 바꾼다. 대화 조회가 실패하면 'FAILED'(보냈는지 모름)
 */
export function instagramThanksSender(connections: InstagramConnections, meta: MetaClient | null, log: LogSink): ThanksSender {
  return {
    platform: 'INSTAGRAM',
    send: async (sellerId, recipient, text): Promise<ThanksSendResult> => {
      const api = await connections.api(sellerId)
      if (!api.ok || meta === null) return { ok: false, kind: !api.ok && api.failure === 'RECONNECT_NEEDED' ? 'TOKEN_INVALID' : 'REJECTED' }
      const result = await meta.privateReply(api.conn, recipient, text)
      if (result.ok) return { ok: true, messageId: result.value }
      if (result.failure !== 'TIMEOUT') log({ level: 'warn', code: 'IG_META_FAILED', errorKind: result.failure })
      if (result.failure === 'TOKEN_INVALID') await connections.markReconnect(sellerId)
      return { ok: false, kind: result.failure }
    },
    confirm: async (sellerId, person, text, since) => {
      const api = await connections.api(sellerId)
      if (!api.ok || meta === null) return 'FAILED'
      const result = await meta.conversation(api.conn, person)
      if (!result.ok) {
        log({ level: 'warn', code: 'IG_META_FAILED', errorKind: result.failure })
        if (result.failure === 'TOKEN_INVALID') await connections.markReconnect(sellerId)
        return 'FAILED'
      }
      const ours = new Set([api.conn.accountId, ...(api.conn.pageId === null ? [] : [api.conn.pageId])])
      return result.value.find((message) => ours.has(message.fromId) && message.text === text && message.createdAt !== null && message.createdAt >= since)?.id ?? null
    },
  }
}
