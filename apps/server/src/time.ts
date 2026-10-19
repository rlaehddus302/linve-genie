// 서버 시계와 시각 표시 (NFR-07, D-026).
// - 시각은 UTC 밀리초로 다룬다. 응답에는 UTC ISO 8601(`Z`)로 낸다.
// - KST(UTC+9, 서머타임 없음)는 날짜 기본값·받은 시각 기본값 계산에만 쓴다. 실행 환경 시간대(TZ)와 상관없이 같은 결과다.

/** 서버 시계. 시험에서 바꿔 끼운다 */
export interface Clock {
  /** 지금 시각 (UTC 밀리초) */
  now(): number
}

export const systemClock: Clock = { now: () => Date.now() }

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/** UTC 밀리초 → KST 날짜 YYYY-MM-DD */
export function kstDate(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** UTC 밀리초 → KST 시각 HH:MM:SS */
export function kstTime(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

/** UTC 밀리초 → ISO 8601 (`Z`) */
export function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** 응답에서 ISO로 바꾸는 코어 조회 결과의 시각 필드 (UTC 밀리초) */
const TIME_KEYS: ReadonlySet<string> = new Set(['at', 'endedAt', 'rankTime'])

/**
 * 코어 조회 결과의 시각 필드(at·endedAt·rankTime, UTC 밀리초)를 ISO 8601 문자열로 바꾼 사본. 그 밖의 값은 그대로다.
 * (API는 시각을 ISO로 낸다 — AC-S04-52. 값 자체는 코어 조회 함수의 결과와 같다.)
 */
export function withIsoTimes<T>(value: T): T {
  return convert(value) as T
}

function convert(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(convert)
  if (typeof value !== 'object' || value === null) return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    // 키가 신뢰할 수 없는 문자열(`__proto__` 등)이어도 자기 속성으로 둔다
    Object.defineProperty(out, key, {
      value: TIME_KEYS.has(key) && typeof item === 'number' && Number.isFinite(item) ? iso(item) : convert(item),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return out
}
