// 틱톡 연결 설정: 운영자 전체 끄기·서명 서비스 키·라이브러리 옵션 (D-904, D-N2b-1-06, AC-N2b-1-03·40·42).
// 서버 시작 때 한 번 읽는 함수다(바꾸면 다시 시작). 서버 시작에 잇는 것은 N2b-2 몫이다.
// 돌려주는 값·경고에 환경 변수 값을 담지 않는다. 서명 키는 가린 상자에 넣어 문자열·JSON·검사 출력 어디에도 보이지 않게 한다.

/** 이상한 스위치 값을 끔으로 봤다는 경고 코드 (log.ts에 같은 코드가 있다) */
export type TikTokSettingsWarning = 'TIKTOK_BETA_INVALID'

const HIDDEN = '[가림]'
const keys = new WeakMap<TikTokSignKey, string>()

/** 서명 서비스 키를 가린 상자. 값은 감싸개가 라이브러리 옵션을 만들 때만 꺼낸다 */
export class TikTokSignKey {
  toString(): string {
    return HIDDEN
  }
  toJSON(): string {
    return HIDDEN
  }
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return HIDDEN
  }
}

function signKeyOf(value: string): TikTokSignKey {
  const key = Object.freeze(new TikTokSignKey())
  keys.set(key, value)
  return key
}

export interface TikTokSettings {
  /** 운영자 스위치 — `LIVEJJIM_TIKTOK_BETA`가 (다듬고 소문자로) `on`일 때만 true */
  readonly beta: boolean
  /** 스위치 값이 on·off·빈 값이 아니었으면 경고 코드 (값은 담지 않는다) */
  readonly warning: TikTokSettingsWarning | null
  /** 선택 서명 서비스 키 `LIVEJJIM_TIKTOK_SIGN_API_KEY` (다듬어 빈 값이면 없음) */
  readonly signKey: TikTokSignKey | null
}

/** 환경 변수에서 틱톡 설정을 읽는다. 없음·빈 값·off → 끔, on → 켬, 그 밖 → 끔 + 경고 */
export function readTikTokSettings(env: Readonly<Record<string, string | undefined>>): TikTokSettings {
  const raw = env['LIVEJJIM_TIKTOK_BETA']
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  const beta = value === 'on'
  const warning: TikTokSettingsWarning | null = value === '' || value === 'on' || value === 'off' ? null : 'TIKTOK_BETA_INVALID'
  const key = env['LIVEJJIM_TIKTOK_SIGN_API_KEY']
  const trimmedKey = typeof key === 'string' ? key.trim() : ''
  return Object.freeze({ beta, warning, signKey: trimmedKey === '' ? null : signKeyOf(trimmedKey) })
}

/** 켜지 않은 설정 (연결 객체의 기본값) */
export const TIKTOK_SETTINGS_OFF: TikTokSettings = Object.freeze({ beta: false, warning: null, signKey: null })

/**
 * 라이브러리 생성자에 넘기는 옵션 (허용 목록 — AC-N2b-1-03). 그 밖의 키는 넘기지 않는다:
 * 세션·쿠키·인증·로그인·프록시 관련 키와 HTTP·웹소켓 머리글 덮어쓰기는 어떤 경우에도 없다.
 */
export interface TikTokLibraryOptions {
  /** 연결 전 최근 댓글 묶음을 받지 않는다 (D-N2b-1-04) */
  readonly processInitialData: false
  /** 연결할 때 방 정보를 받아 방송 중인지 본다 (방송 전 → NOT_LIVE) */
  readonly fetchRoomInfoOnConnect: true
  readonly enableExtendedGiftInfo: false
  /** 서명 서비스 키 — 설정했을 때만 */
  readonly signApiKey?: string
}

export const TIKTOK_LIBRARY_OPTION_KEYS: readonly string[] = Object.freeze(['processInitialData', 'fetchRoomInfoOnConnect', 'enableExtendedGiftInfo', 'signApiKey'])

/** 연결 시도마다 새 옵션 객체를 만든다. 설정 객체에 다른 키가 섞여 있어도 signKey 말고는 읽지 않는다 */
export function libraryOptions(settings: TikTokSettings): TikTokLibraryOptions {
  const signKey: unknown = settings.signKey
  const key = signKey instanceof TikTokSignKey ? keys.get(signKey) : undefined
  const base = { processInitialData: false, fetchRoomInfoOnConnect: true, enableExtendedGiftInfo: false } as const
  return Object.freeze(key === undefined ? { ...base } : { ...base, signApiKey: key })
}
