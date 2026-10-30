// 문자찜·입금 알림 받기 모듈의 공용 모양 (SMS3).
// 네이티브(안드로이드 알림 읽기 서비스·아이폰 단축어 동작)가 알림을 봉투로 만들어 암호화 대기열에 넣고 서버로 보낸다.
// JS는 켜고 끄기·상태 보기·설정 열기·은행 앱 고르기·기기 토큰 넣기·지금 보내기만 한다(뒤에서는 JS 없이 돈다).

/** 어느 기기에서 도는가 */
export type NoticePlatform = 'android' | 'ios' | 'fake'

/**
 * 알림을 읽을 권한
 * - granted: 안드로이드 "알림 읽기" 허용됨
 * - needed: 안드로이드에서 아직 허용 안 됨 → openSettings('notificationAccess')
 * - shortcut: 아이폰 — 권한 대신 판매자가 단축어 자동화를 만든다(앱이 알 수 없다)
 */
export type NoticeAccess = 'granted' | 'needed' | 'shortcut'

/** 마지막 보내기 실패 까닭 */
export type NoticeSendError = 'NETWORK' | 'SERVER' | 'TOKEN'

/** 앱이 보는 상태 */
export interface NoticeState {
  readonly platform: NoticePlatform
  /** 판매자가 켰는가 (꺼져 있으면 알림을 열지 않는다) */
  readonly enabled: boolean
  readonly access: NoticeAccess
  /** 안드로이드: 시스템이 알림 읽기 서비스를 붙였는가. 아이폰은 늘 false */
  readonly connected: boolean
  /** 기기 토큰·서버 주소가 들어 있는가 */
  readonly hasToken: boolean
  /** 서버가 토큰을 받지 않았다(401·403) — 새 토큰을 넣을 때까지 보내지 않는다 */
  readonly tokenRejected: boolean
  /** 아직 못 보낸 건수 (암호화 대기열) */
  readonly pending: number
  /** 보낸 건수 (이 기기에서 켠 뒤 누적) */
  readonly sent: number
  /** 기기에서 거른 건수 (인증번호·광고) */
  readonly filtered: number
  /** 같은 알림 두 번 막은 건수 */
  readonly duplicates: number
  /** 서버가 받지 않은 건수 (봉투가 틀림 — 다시 보내지 않는다) */
  readonly rejected: number
  /** 대기열이 넘쳐 못 담은 건수 */
  readonly dropped: number
  /** 마지막으로 대기열에 넣은 시각 (기기 벽시계 UTC ms) */
  readonly lastQueuedAtMs: number | null
  /** 마지막으로 서버가 받은 시각 */
  readonly lastSentAtMs: number | null
  readonly lastError: NoticeSendError | null
  /** 판매자가 고른 은행 앱 (문자 앱은 늘 포함 — SMS_PACKAGES) */
  readonly bankPackages: readonly string[]
  /** 안드로이드: 배터리 최적화 대상인가(true면 뒤에서 늦거나 멈출 수 있다). 아이폰·모름은 null */
  readonly batteryOptimized: boolean | null
  /** 서버가 내려준 거르기 규칙을 쓰는가 (아니면 기본 규칙) */
  readonly serverRules: boolean
}

/** 설정 화면 */
export type NoticeSettingsTarget = 'notificationAccess' | 'battery' | 'app' | 'shortcuts'

/** 지금 보내기 결과 */
export interface NoticeFlushResult {
  /** 이번에 서버가 받은 건수 */
  readonly sent: number
  /** 남은 건수 */
  readonly pending: number
  /** 다 못 보냈으면 멈춘 까닭 */
  readonly stoppedBy: 'NO_TOKEN' | NoticeSendError | null
}

/** 기기 토큰과 보낼 곳 */
export interface NoticeTokenConfig {
  /** 서버가 이 기기에 준 토큰 (Authorization: Bearer) — 안드로이드 Keystore 암호화·아이폰 키체인에만 둔다 */
  readonly token: string
  /** 라이브지니 서버 주소 (https) — 입구 경로는 contract.ts가 붙인다 */
  readonly serverUrl: string
  readonly deviceId: string
}

export interface NativeEventSubscription {
  remove(): void
}

/** 네이티브가 넘기는 상태(모르는 칸·틀린 값은 JS가 고친다) */
export type NativeNoticeState = { readonly [K in keyof NoticeState]?: unknown }

/** 네이티브 모듈(Expo Modules API, 이름 LivejjimNotice)이 JS에 보이는 모양 — 시험은 이 모양의 가짜를 넣는다 */
export interface NativeNoticeModuleLike {
  start(): Promise<NativeNoticeState>
  stop(): Promise<NativeNoticeState>
  getState(): Promise<NativeNoticeState>
  openSettings(target: NoticeSettingsTarget): Promise<boolean>
  setAllowedPackages(packages: string[]): Promise<NativeNoticeState>
  /** endpoint는 입구 주소 전체(contract.noticeIntakeUrl) */
  setToken(token: string, endpoint: string, deviceId: string): Promise<NativeNoticeState>
  clearToken(): Promise<NativeNoticeState>
  /** 규칙 JSON 배열 글. 빈 글이면 기본 규칙으로 */
  setFilterRules(rulesJson: string): Promise<NativeNoticeState>
  flush(): Promise<{ readonly sent?: unknown; readonly pending?: unknown; readonly stoppedBy?: unknown }>
  addListener(eventName: 'state', listener: (event: NativeNoticeState) => void): NativeEventSubscription
}

export type NoticeStateListener = (state: NoticeState) => void

/** 앱이 쓰는 문자찜·입금 알림 받기 */
export interface NoticeIntake {
  /** 켠다. 안드로이드에서 알림 읽기가 허용되지 않았으면 켠 상태로 두고 access: 'needed'를 돌려준다(허용하면 바로 받는다) */
  start(): Promise<NoticeState>
  /** 끈다. 대기열에 남은 것은 지우지 않고 계속 보낸다 */
  stop(): Promise<NoticeState>
  getState(): Promise<NoticeState>
  /** 상태가 바뀔 때마다 (네이티브 사건) */
  addStateListener(listener: NoticeStateListener): () => void
  /** 설정 화면을 연다. 열지 못하면 false (화면이 안내 문장을 보여 준다) */
  openSettings(target?: NoticeSettingsTarget): Promise<boolean>
  /** 판매자가 고른 은행 앱. 틀린 이름·메신저·문자 앱은 NoticeInputError */
  setAllowedPackages(bankPackages: readonly string[]): Promise<NoticeState>
  /** 기기 토큰을 넣는다(null이면 지운다). 틀린 토큰·http 주소는 NoticeInputError */
  setToken(config: NoticeTokenConfig | null): Promise<NoticeState>
  /** 서버가 내려준 거르기 규칙 (null이면 기본 규칙). 틀린 목록은 NoticeInputError */
  setFilterRules(rules: unknown): Promise<NoticeState>
  /** 대기열을 지금 보낸다 */
  flush(): Promise<NoticeFlushResult>
}
