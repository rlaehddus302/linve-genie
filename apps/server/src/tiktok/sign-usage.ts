// 틱톡 서명 서비스 무료 한도 계량 (CH-20). 연결 시도 한 번이 서명 요청 한 번 이상이라, 지난 24시간 안의 시도 수를 센다(보수적으로 시도 = 요청 1).
// 한도 값은 설정(LIVEJJIM_TIKTOK_SIGN_DAILY_LIMIT)이다. 한도를 넘어도 연결을 막지 않는다 — 판매자에게 알리고 운영자에게 경고만 한다
// (막으면 방송 중 댓글 수집이 끊겨 판매자에게 더 위험하다). 시계는 부르는 쪽이 넘긴다. 로그엔 수만 남긴다.

/** 기본 하루 한도: 무료 한도 값을 확인하지 못해 낮게 잡았다. 운영자가 설정으로 바꾼다 */
export const TIKTOK_SIGN_DAILY_LIMIT_DEFAULT = 500
/** 한도의 이 비율에 닿으면 "가까워요" 경보 */
export const TIKTOK_SIGN_NEAR_RATIO = 0.8
export const TIKTOK_SIGN_WINDOW_MS = 24 * 60 * 60 * 1000

export type TikTokSignLevel = 'OK' | 'NEAR' | 'OVER'

/** 판매자에게 보이는 문장 (쉬운 한국어, 숫자·영문 없음) */
export const TIKTOK_SIGN_MESSAGES = Object.freeze({
  NEAR: '틱톡 연결 준비 횟수가 하루 한도에 가까워요. 연결이 안 될 수 있으니 댓글을 직접 넣을 준비를 해 주세요.',
  OVER: '틱톡 연결 준비 횟수가 하루 한도를 넘었어요. 연결이 안 되면 댓글을 직접 넣어 주세요.',
})

export interface TikTokSignMeter {
  /** 서명 요청 한 번을 센다. 센 뒤의 수준과 바뀌었는지 */
  record(now: number): { readonly level: TikTokSignLevel; readonly used: number; readonly changed: boolean }
  level(now: number): TikTokSignLevel
  used(now: number): number
  readonly limit: number
}

/** 한도 값을 읽는다: 양의 정수만, 아니면 기본값 */
export function readTikTokSignLimit(raw: string | undefined): number {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!/^[0-9]{1,9}$/.test(text)) return TIKTOK_SIGN_DAILY_LIMIT_DEFAULT
  const value = Number(text)
  return value >= 1 ? value : TIKTOK_SIGN_DAILY_LIMIT_DEFAULT
}

export function createTikTokSignMeter(limit: number = TIKTOK_SIGN_DAILY_LIMIT_DEFAULT, windowMs: number = TIKTOK_SIGN_WINDOW_MS): TikTokSignMeter {
  const max = Math.max(1, Math.floor(limit))
  const near = Math.max(1, Math.ceil(max * TIKTOK_SIGN_NEAR_RATIO))
  let times: number[] = []
  let last: TikTokSignLevel = 'OK'
  const prune = (now: number): void => {
    let drop = 0
    while (drop < times.length && (times[drop] as number) <= now - windowMs) drop += 1
    if (drop > 0) times = times.slice(drop)
  }
  const levelOf = (count: number): TikTokSignLevel => (count > max ? 'OVER' : count >= near ? 'NEAR' : 'OK')
  return {
    limit: max,
    record(now) {
      prune(now)
      times.push(now)
      const level = levelOf(times.length)
      const changed = level !== last
      last = level
      return { level, used: times.length, changed }
    },
    level(now) {
      prune(now)
      const level = levelOf(times.length)
      last = level
      return level
    },
    used(now) {
      prune(now)
      return times.length
    },
  }
}
