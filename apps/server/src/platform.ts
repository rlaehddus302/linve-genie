// 플랫폼 공통 연결 (PLT-03, D-N2-02·D-N2-05·D-N2-12·D-N2-15).
// - 플랫폼은 YOUTUBE·INSTAGRAM·TIKTOK. 채팅 구매자(채널) 키·메시지 ID의 접두어로 플랫폼을 안다:
//   `ig:` 인스타그램, `tt:` 틱톡(예약), `sms:` 문자 구매자(플랫폼 없음), 그 밖 유튜브(리허설 가짜 채널 `sim_…`도 — D-082).
// - 엔진은 바꾸지 않는다(구매자 종류 youtube = 채팅 구매자). 화면·문서는 이 함수 하나로 플랫폼 이름을 정한다.
// - 댓글 원천(라이브 찾기)과 감사 보내기는 플랫폼 공통 어댑터 모양이고 인스타그램이 첫 구현이다.
// - 틱톡(N2b-2, D-904·D-N2b-2-05): 비공식 웹캐스트 연결(tiktok-live/)로 댓글을 읽기만 한다. 감사는 보내지 않는다.
// - 한 회차에 플랫폼마다 연결 하나(동시 송출, D-N2b-2-01). 플랫폼 이름은 PLATFORM_NAMES로 판매자 문장에 넣는다.
// - 밴드(BND1, D-BND1-02): 공식 밴드 Open API로 내 글의 댓글을 읽기만 한다(band/). `band:` 접두어 — 감사는 보내지 않는다.

export const PLATFORMS = ['YOUTUBE', 'INSTAGRAM', 'TIKTOK', 'BAND'] as const
export type Platform = (typeof PLATFORMS)[number]

export const INSTAGRAM_PREFIX = 'ig:'
export const TIKTOK_PREFIX = 'tt:'
/** 밴드 글 댓글 (BND1, D-BND1-02) — 소문자만 접두어다(`BAND:`는 유튜브로 본다) */
export const BAND_PREFIX = 'band:'
export const SMS_PREFIX = 'sms:'
/** 접두어를 붙인 키·메시지 ID의 길이 상한 (수집 함수 메시지 ID 상한과 같다) */
export const PLATFORM_KEY_MAX = 256

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value)
}

/** 구매자(채널) 키·메시지 ID → 플랫폼. 문자 구매자면 null */
export function platformOfKey(key: string): Platform | null {
  if (key.startsWith(INSTAGRAM_PREFIX)) return 'INSTAGRAM'
  if (key.startsWith(TIKTOK_PREFIX)) return 'TIKTOK'
  if (key.startsWith(BAND_PREFIX)) return 'BAND'
  if (key.startsWith(SMS_PREFIX)) return null
  return 'YOUTUBE'
}

/**
 * 플랫폼이 준 값에 접두어를 붙인 키. 값은 자르거나 바꾸지 않는다(AC-N2-01).
 * 문자열이 아니거나 비었거나 접두어를 붙여 256자를 넘으면 null — 그 댓글은 기록하지 않고 형식 틀린 변경으로 센다
 */
export function prefixedKey(prefix: string, raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null
  const key = prefix + raw
  return key.length > PLATFORM_KEY_MAX ? null : key
}

/** 실시간 감사 방식: 공개 채팅 / 댓글마다 DM 한 번 / 없음 */
export type ThanksMode = 'PUBLIC_CHAT' | 'DM_PER_COMMENT' | 'NONE'

/** 플랫폼마다 할 수 있는 것 (GET /api/platforms, AC-N2-02). reasons는 쓸 수 없는 것마다 판매자에게 보일 문장 */
export interface PlatformCapability {
  readonly platform: Platform
  /** 이 서버에서 지금 연결(잇기)할 수 있는지 */
  readonly ready: boolean
  /** 실제 시각순(RECEIVED_TIME)을 쓸 수 있는지 */
  readonly receivedTime: boolean
  readonly thanks: ThanksMode
  /** 영상 댓글·방송 후 요약 */
  readonly videoComment: boolean
  readonly reasons: { readonly ready?: string; readonly receivedTime?: string; readonly thanks?: string; readonly videoComment?: string }
}

/** 판매자 문장에 넣는 플랫폼 이름 */
export const PLATFORM_NAMES: Readonly<Record<Platform, string>> = { YOUTUBE: '유튜브', INSTAGRAM: '인스타그램', TIKTOK: '틱톡', BAND: '밴드' }

/** 같은 플랫폼 라이브가 이미 이어져 있음 (AC-N2b-2-01 — 플랫폼마다 같은 모양) */
export function alreadyLinkedMessage(platform: Platform): string {
  return `이 방송에는 이미 ${PLATFORM_NAMES[platform]} 라이브가 이어져 있어요. 먼저 연결을 끊어 주세요.`
}

export const PLATFORM_MESSAGES = {
  youtubeNotReady: '유튜브 라이브는 아직 이 서버에서 이을 수 없어요.',
  instagramNotConfigured: '인스타그램 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요.',
  instagramReceivedTime: '인스타그램 라이브는 댓글마다의 시각이 없어 실제 시각순으로 판정할 수 없어요.',
  instagramVideoComment: '인스타그램에는 공개 댓글로 감사를 남길 수 없어요.',
} as const

/**
 * 플랫폼 능력 표. YOUTUBE.ready = 유튜브 연동 설정이 있는지, INSTAGRAM.ready = 인스타그램 설정이 있는지(AC-N2-17),
 * TIKTOK은 틱톡 연결(tiktok-live/live.ts capability — 운영자 스위치, AC-N2b-2-04)이 준다
 */
export function platformCapabilities(ready: { readonly youtube: boolean; readonly instagram: boolean }, tiktok: PlatformCapability, band?: PlatformCapability): PlatformCapability[] {
  return [
    {
      platform: 'YOUTUBE',
      ready: ready.youtube,
      receivedTime: true,
      thanks: 'PUBLIC_CHAT',
      videoComment: true,
      reasons: ready.youtube ? {} : { ready: PLATFORM_MESSAGES.youtubeNotReady },
    },
    {
      platform: 'INSTAGRAM',
      ready: ready.instagram,
      receivedTime: false,
      thanks: 'DM_PER_COMMENT',
      videoComment: false,
      reasons: {
        ...(ready.instagram ? {} : { ready: PLATFORM_MESSAGES.instagramNotConfigured }),
        receivedTime: PLATFORM_MESSAGES.instagramReceivedTime,
        videoComment: PLATFORM_MESSAGES.instagramVideoComment,
      },
    },
    tiktok,
    ...(band === undefined ? [] : [band]),
  ]
}

// ── 플랫폼 공통 어댑터 모양 (AC-N2-04) ───────────────────────────────────
// 인스타그램이 첫 구현이다(instagram/). 틱톡은 라이브 찾기가 없다(아이디 하나에 방송 하나 — 잇기 = 바로 연결, D-N2b-2-05).

/** 진행 중 라이브 하나 */
export interface LiveItem {
  /** 라이브 ID (인스타그램 미디어 ID) */
  readonly id: string
  /** 시작 시각 (UTC 밀리초, 플랫폼이 주지 않으면 null) */
  readonly startedAt: number | null
}

/** 외부 호출 결과의 실패 종류 (플랫폼 공통) */
export type PlatformFailure = 'NOT_CONFIGURED' | 'NOT_CONNECTED' | 'RECONNECT_NEEDED' | 'UNAVAILABLE'

/** 댓글 원천 — 라이브 찾기 (댓글 받기는 플랫폼이 밀어 주는 웹훅이 수집 함수로 넘긴다) */
export interface LiveSource {
  readonly platform: Platform
  /** 그 판매자가 연결한 계정의 진행 중 라이브 */
  liveNow(sellerId: string): Promise<{ readonly ok: true; readonly lives: readonly LiveItem[] } | { readonly ok: false; readonly failure: PlatformFailure }>
}

/** 감사 보내기 결과 (플랫폼 공통 분류) */
export type ThanksSendResult =
  | { readonly ok: true; readonly messageId: string }
  | { readonly ok: false; readonly kind: 'TIMEOUT' | 'RETRY' | 'TOKEN_INVALID' | 'LIVE_ENDED' | 'NO_PERMISSION' | 'ONE_REPLY' | 'REJECTED' }

/** 감사 보내기 — 받는 곳(인스타그램: 댓글 ID)과 글. 보냈는지 모를 때(타임아웃) 확인하는 길도 같은 어댑터에 둔다 */
export interface ThanksSender {
  readonly platform: Platform
  send(sellerId: string, recipient: string, text: string): Promise<ThanksSendResult>
  /** 그 사람에게 우리 계정이 since(UTC 밀리초) 뒤에 보낸 같은 글의 메시지 ID. 없으면 null, 확인하지 못하면 'FAILED' */
  confirm(sellerId: string, person: string, text: string, since: number): Promise<string | null | 'FAILED'>
}
