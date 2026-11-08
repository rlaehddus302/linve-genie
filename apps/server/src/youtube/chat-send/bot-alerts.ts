// 감사 채팅 봇 운영자 문자 알림 (D-YT-SEND-22). 봇 로그인이 풀리거나 막혀도 감사는 다른 계정·공식 API로 이어지지만, 그대로 두면 아무도 모른다 —
// 서버 로그를 지켜보다가 운영자 휴대폰(LIVEJJIM_OPS_ALERT_PHONE)으로 문자 한 통을 보낸다(가입 인증과 같은 SENS).
// - 보는 로그: CHAT_SEND_ACCOUNT_DOWN(auth = 그 계정 로그인 풀림 · rejected = 그 계정이 글을 못 올림(채널 없음 등) · blocked = 서버 막힘), CHAT_SEND_FAILOVER(공식 API로 넘김),
//   YOUTUBE_RECONNECT_NEEDED(공식 API 봇 연결 풀림 — 시스템 판매자만, 판매자 연결은 판매자 화면이 알린다).
// - 같은 일은 정한 시간에 한 번만(계정 로그인 12시간, 막힘·넘김 6시간 — 이 서버 메모리). 문자에는 계정 번호만, 쿠키·채널·판매자 정보는 넣지 않는다.
// - 보내기 실패는 버린다(알림 때문에 감사·로그가 멈추지 않는다). 번호는 로그·오류에 넣지 않는다.
import { SERVICE_NAME } from '../../brand.ts'
import type { LogRecord } from '../../log.ts'
import type { SmsSender } from '../../social/phone.ts'
import { BOT_SELLER_ID } from '../connect.ts'

export const LOGIN_ALERT_MS = 12 * 60 * 60 * 1000
export const ROUTE_ALERT_MS = 6 * 60 * 60 * 1000

export const BOT_ALERT_TEXTS = {
  rejected: (n: number) => `[${SERVICE_NAME}] 감사 채팅 봇 계정 ${String(n)}이 글을 올리지 못해 쉬게 했어요(채널·계정 상태 확인). 그동안은 다른 계정·공식 API로 올려요.`,
  login: (n: number) => `[${SERVICE_NAME}] 감사 채팅 봇 계정 ${String(n)} 로그인이 풀렸어요. 맥에서 다시 로그인해 서버에 올려 주세요. 그동안은 다른 계정·공식 API로 올려요.`,
  blocked: () => `[${SERVICE_NAME}] 유튜브가 서버를 막아 감사 채팅 봇 계정을 모두 잠시 쉬게 했어요. 그동안은 공식 API로 올려요.`,
  failover: () => `[${SERVICE_NAME}] 봇 방식으로 올리지 못한 감사 채팅을 공식 API로 올렸어요. 봇 계정 상태를 확인해 주세요.`,
  official: () => `[${SERVICE_NAME}] 감사 채팅 공식 API 봇 연결이 풀렸어요. 서버에서 youtube-bot connect로 다시 이어 주세요.`,
} as const

export interface BotAlertsOptions {
  readonly sms: SmsSender
  /** 운영자 휴대폰 (숫자만) */
  readonly phone: string
  readonly now: () => number
}

export class BotAlerts {
  readonly #options: BotAlertsOptions
  readonly #lastAt = new Map<string, number>()
  /** 보낸 문자 수 (시험·운영 상태) */
  sent = 0

  constructor(options: BotAlertsOptions) {
    this.#options = options
  }

  /** 로그 한 줄을 본다 (서버 로그 감싸개가 부른다 — 던지지 않는다) */
  observe(record: LogRecord): void {
    if (record.code === 'CHAT_SEND_ACCOUNT_DOWN') {
      if (record.errorKind === 'blocked') this.#send('blocked', ROUTE_ALERT_MS, BOT_ALERT_TEXTS.blocked())
      else if (typeof record.count === 'number' && record.count > 0) {
        if (record.errorKind === 'auth') this.#send(`login:${String(record.count)}`, LOGIN_ALERT_MS, BOT_ALERT_TEXTS.login(record.count))
        else if (record.errorKind === 'rejected') this.#send(`rejected:${String(record.count)}`, LOGIN_ALERT_MS, BOT_ALERT_TEXTS.rejected(record.count))
      }
    } else if (record.code === 'CHAT_SEND_FAILOVER') this.#send('failover', ROUTE_ALERT_MS, BOT_ALERT_TEXTS.failover())
    else if (record.code === 'YOUTUBE_RECONNECT_NEEDED' && record.seller === BOT_SELLER_ID) this.#send('official', LOGIN_ALERT_MS, BOT_ALERT_TEXTS.official())
  }

  #send(key: string, quietMs: number, text: string): void {
    const now = this.#options.now()
    const last = this.#lastAt.get(key)
    if (last !== undefined && now - last < quietMs) return
    this.#lastAt.set(key, now)
    this.sent += 1
    void this.#options.sms.send(this.#options.phone, text).catch(() => {
      // 문자를 못 보내도 감사·로그는 그대로다
    })
  }
}
