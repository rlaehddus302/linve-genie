// 플랫폼 라이브가 끝나면 그 회차를 저절로 끝낸다 (D-LIVE-AUTOEND).
// - 판매자가 [라이브 연결 끊기]를 누른 것과 같은 길(POST /api/broadcasts/:id/end → service.endBroadcast)로 끝낸다 — 같은 이벤트·txHook·커밋 뒤 처리.
// - 요청 번호는 회차마다 정해진 값(live-end-<회차>)이라 두 번 와도(재시도·두 플랫폼) 한 번만 기록된다. 이미 끝낸 회차는 건드리지 않는다.
// - 실제 회차만(리허설·만드는 중 아님). 부르는 쪽은 플랫폼이 "끝났다"고 분명히 알린 때만 부른다(끊김·오류·멈춤·토큰 실패는 부르지 않는다).
// - 같은 회차에 아직 끝나지 않은 다른 플랫폼 연결(유튜브·틱톡·인스타그램·밴드)이 있으면 끝내지 않는다 — 그 플랫폼이 끝날 때 다시 본다.
// - 판매자에게 가장 안전한 쪽: 모르면 끝내지 않는다(판매자가 손으로 끝낼 수 있다). 잘못 끝내면 되돌릴 수 없다.
// - 로그는 정해진 코드와 이유 코드만 (판매자 ID는 서버가 만든 값).
import { latestBandLink } from './band/store.ts'
import type { Db } from './db/database.ts'
import { latestLink as latestInstagramLink } from './instagram/store.ts'
import { errorKind, type LogSink } from './log.ts'
import type { Service } from './service.ts'
import { findBroadcast } from './store.ts'
import type { WriteOutcome } from './writer.ts'
import { activeLink } from './youtube/store.ts'

export type AutoEndPlatform = 'YOUTUBE' | 'TIKTOK'

/** 저절로 끝낼 때 쓰는 요청 번호 — 회차마다 하나 (REQUEST_ID_RE: 영문·숫자·_·- 64자 이하) */
export const autoEndRequestId = (broadcastId: string): string => `live-end-${broadcastId}`.slice(0, 64)

/** 결과 (시험·로그) */
export type AutoEndResult =
  | 'ENDED'
  | 'ALREADY_ENDED'
  | 'NOT_FOUND'
  | 'REHEARSAL'
  | 'DRAFT'
  | 'LINK_CHANGED'
  | 'NOT_STARTED'
  | 'OTHER_LIVE'
  | 'FAILED'

/** 플랫폼이 알린 끝 */
export type AutoEndSignal =
  | { readonly platform: 'TIKTOK' }
  /** 유튜브: 끝난 연결 ID와 그 연결이 실제로 시작했는지(예정 방송이 시작 전에 끝났으면 끝내지 않는다) */
  | { readonly platform: 'YOUTUBE'; readonly linkId: string; readonly started: boolean }

export interface LiveAutoEndOptions {
  readonly db: Db
  /** 판매자가 [라이브 연결 끊기]를 누를 때와 같은 서비스 */
  readonly service: Pick<Service, 'priorResult' | 'endBroadcast'>
  readonly log: LogSink
  /** 그 회차의 틱톡 연결이 아직 방송 중일 수 있는가 (틱톡이 끝났다고 알리지 않았으면 true) */
  readonly tiktokMayBeLive?: (sellerId: string, broadcastId: string) => Promise<boolean>
}

export class LiveAutoEnd {
  readonly #options: LiveAutoEndOptions

  constructor(options: LiveAutoEndOptions) {
    this.#options = options
  }

  /** 플랫폼 라이브가 끝났다 — 조건이 맞으면 회차를 끝낸다. 던지지 않는다 */
  async ended(sellerId: string, broadcastId: string, signal: AutoEndSignal): Promise<AutoEndResult> {
    let result: AutoEndResult
    try {
      result = await this.#ended(sellerId, broadcastId, signal)
    } catch (error) {
      this.#options.log({ level: 'warn', code: 'BROADCAST_AUTO_END_FAILED', seller: sellerId, reason: signal.platform, errorKind: errorKind(error) })
      return 'FAILED'
    }
    if (result === 'ENDED') this.#options.log({ level: 'info', code: 'BROADCAST_AUTO_ENDED', seller: sellerId, reason: signal.platform })
    else if (result !== 'FAILED') this.#options.log({ level: 'info', code: 'BROADCAST_AUTO_END_SKIPPED', seller: sellerId, reason: result })
    return result
  }

  async #ended(sellerId: string, broadcastId: string, signal: AutoEndSignal): Promise<AutoEndResult> {
    const { db, service } = this.#options
    const broadcast = await findBroadcast(db, sellerId, broadcastId)
    if (broadcast === null) return 'NOT_FOUND'
    if (broadcast.rehearsal) return 'REHEARSAL'
    if (broadcast.endedAt !== null) return 'ALREADY_ENDED'
    if (broadcast.openedAt === null) return 'DRAFT'
    const youtube = await activeLink(db, sellerId, broadcastId)
    if (signal.platform === 'YOUTUBE') {
      // 판매자가 그새 끊었거나 다른 영상을 이었으면 이 끝은 이 회차의 것이 아니다
      if (youtube === null || youtube.id !== signal.linkId) return 'LINK_CHANGED'
      if (!signal.started) return 'NOT_STARTED'
    } else if (youtube !== null && youtube.chatEndedAt === null) {
      return 'OTHER_LIVE'
    }
    if (signal.platform !== 'TIKTOK' && (await this.#options.tiktokMayBeLive?.(sellerId, broadcastId)) === true) return 'OTHER_LIVE'
    const instagram = await latestInstagramLink(db, sellerId, broadcastId)
    if (instagram !== null && (instagram.state === 'WAITING' || instagram.state === 'LINKED')) return 'OTHER_LIVE'
    const band = await latestBandLink(db, sellerId, broadcastId)
    if (band !== null && band.state !== 'FINISHED') return 'OTHER_LIVE'

    // 판매자가 누를 때와 같은 길 (POST /api/broadcasts/:id/end): 같은 요청 번호면 처음 결과, 아니면 끝내기 기록
    const requestId = autoEndRequestId(broadcastId)
    if ((await service.priorResult(sellerId, requestId)) !== null) return 'ALREADY_ENDED'
    const outcome: WriteOutcome = await service.endBroadcast(sellerId, { kind: 'server' }, requestId, broadcastId)
    if (outcome.kind === 'ok') return outcome.records.some((record) => record.changed) ? 'ENDED' : 'ALREADY_ENDED'
    if (outcome.kind === 'duplicate' || outcome.kind === 'empty') return 'ALREADY_ENDED'
    this.#options.log({ level: 'warn', code: 'BROADCAST_AUTO_END_FAILED', seller: sellerId, reason: outcome.kind === 'rejected' ? outcome.rejection.code : outcome.kind })
    return 'FAILED'
  }
}
