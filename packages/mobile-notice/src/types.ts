// 문자찜·입금 알림 받기 모듈의 공용 모양 (SMS3).
// 네이티브(안드로이드 알림 읽기 서비스·아이폰 단축어 동작)가 알림을 봉투로 만들어 암호화 대기열에 넣고 서버로 보낸다.
// JS는 켜고 끄기·상태 보기·설정 열기·받기 토큰 넣기·지금 보내기만 한다(뒤에서는 JS 없이 돈다).
// 무엇을 읽고 거를지는 서버가 C-04 응답으로 주는 filters를 네이티브가 저장해 그대로 쓴다(SPEC ORD-13 C-03).

/** 어느 기기에서 도는가 */
export type NoticePlatform = 'android' | 'ios' | 'fake'

/**
 * 알림을 읽을 권한
 * - granted: 안드로이드 "알림 읽기" 허용됨
 * - needed: 안드로이드에서 아직 허용 안 됨 → openSettings('notificationAccess')
 * - shortcut: 아이폰 — 권한 대신 판매자가 단축어 자동화를 만든다(앱이 알 수 없다)
 */
export type NoticeAccess = 'granted' | 'needed' | 'shortcut'

/** 마지막 보내기 실패 까닭 — BUSY: 서버가 너무 많다고 함(429, 1분 뒤 다시) · OFF: 웹 설정에서 받기가 꺼짐(403, 10분마다 다시 봄) */
export type NoticeSendError = 'NETWORK' | 'SERVER' | 'BUSY' | 'TOKEN' | 'OFF'

/** 앱이 보는 상태 */
export interface NoticeState {
  readonly platform: NoticePlatform
  /** 판매자가 켰는가 (꺼져 있으면 알림을 열지 않는다) */
  readonly enabled: boolean
  readonly access: NoticeAccess
  /** 안드로이드: 시스템이 알림 읽기 서비스를 붙였는가. 아이폰은 늘 false */
  readonly connected: boolean
  /** 받기 토큰·서버 주소가 들어 있는가 */
  readonly hasToken: boolean
  /** 서버가 토큰을 받지 않았다(401) — 새 토큰을 넣을 때까지 보내지 않는다("받기 토큰을 다시 넣어 주세요") */
  readonly tokenRejected: boolean
  /** 웹 설정에서 휴대폰 알림 받기가 꺼져 있다(403 INBOX_OFF) — 대기열·토큰은 그대로, 10분마다·앱을 열 때 다시 본다(D-SMS3-27) */
  readonly inboxOff: boolean
  /** 아직 못 보낸 건수 (암호화 대기열) */
  readonly pending: number
  /** 서버가 받아 처리한 건수 (SAVED, 이 기기 누적) */
  readonly sent: number
  /** 서버가 받았지만 저장하지 않은 건수 (IGNORED — 찜 아님·방송 창 밖 등) */
  readonly ignored: number
  /** 기기에서 거른 건수 (skipWords 문자) */
  readonly filtered: number
  /** 같은 알림 두 번 막은 건수 (기기 + 서버 DUPLICATE) */
  readonly duplicates: number
  /** 서버가 모양이 틀렸다고 한 건수 (400 — 다시 보내지 않는다) */
  readonly rejected: number
  /** 대기열(최대 1,000건)이 넘쳐 오래된 것부터 버린 건수 (풀지 못한 대기열 파일도 센다) — 0보다 크면 noticeDroppedLine을 보인다(D-SMS3-28) */
  readonly dropped: number
  /** 마지막으로 대기열에 넣은 시각 (기기 벽시계 UTC ms) */
  readonly lastQueuedAtMs: number | null
  /** 마지막으로 서버가 받은 시각 */
  readonly lastSentAtMs: number | null
  readonly lastError: NoticeSendError | null
  /** 서버가 준 은행 앱 목록 (filters.bankApps — 이 앱 알림만 읽는다) */
  readonly bankApps: readonly string[]
  /** 안드로이드 기본 문자 앱 패키지 (모르면 null) */
  readonly smsApp: string | null
  /** 안드로이드: 배터리 최적화 대상인가(true면 뒤에서 늦거나 멈출 수 있다). 아이폰·모름은 null */
  readonly batteryOptimized: boolean | null
  /** 서버의 filters를 받아 두었는가 (아니면 문자만 보낸다) */
  readonly hasFilters: boolean
}

/**
 * 문자 직접 받기 (SMS4) — 문자 저장소(SMS·LMS·MMS) 읽기와 새 문자 수신. RCS는 공개 저장소에 없어 기본 문자 앱 알림(알림 읽기)으로만 받는다.
 * - available: 이 빌드에 문자 권한이 들어 있나 (LIVEGENIE_SMS=on 빌드만 true)
 * - permission: 문자 읽기·받기 권한
 * - enabled: 판매자가 문자 연동을 켰나 · active: 지금 읽고 있나(알림 받기 켜짐 + 연동 켬 + 권한 허용)
 */
export interface SmsLinkState {
  readonly available: boolean
  readonly permission: 'granted' | 'needed'
  readonly enabled: boolean
  readonly active: boolean
  /** 마지막으로 문자 저장소를 읽은 시각 */
  readonly lastScanAtMs: number | null
}

/** 네이티브가 넘기는 문자 상태 */
export type NativeSmsState = { readonly [K in keyof SmsLinkState]?: unknown }

/** 앱이 쓰는 문자 연동 */
export interface SmsLink {
  getState(): Promise<SmsLinkState>
  /** 문자 읽기·받기 권한을 묻는다 (이미 허용·이 빌드에 없음이면 묻지 않는다) */
  requestPermission(): Promise<SmsLinkState>
  /** 켜면 바로 따라잡는다(처음이면 최근 24시간만) */
  setEnabled(on: boolean): Promise<SmsLinkState>
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

/** 받기 토큰과 보낼 곳 (SPEC ORD-13 C-02) */
export interface NoticeTokenConfig {
  /** 판매자 설정 "휴대폰 알림 받기"에서 만든 토큰 (Authorization: Bearer) — 안드로이드 Keystore 암호화·아이폰 키체인 키로 암호화해서만 둔다 */
  readonly token: string
  /** 라이브지니 서버 주소 (https) — 입구 경로는 contract.ts가 붙인다 */
  readonly serverUrl: string
  /** 기기 이름 1~30자 (C-04 device — 설정에 "마지막으로 받은 기기"로 보인다) */
  readonly deviceName: string
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
  /** endpoint는 입구 주소 전체(contract.noticeIntakeUrl). 넣으면 곧바로 0건 요청으로 filters를 받아 둔다 */
  setToken(token: string, endpoint: string, deviceName: string): Promise<NativeNoticeState>
  clearToken(): Promise<NativeNoticeState>
  flush(): Promise<{ readonly sent?: unknown; readonly pending?: unknown; readonly stoppedBy?: unknown }>
  addListener(eventName: 'state', listener: (event: NativeNoticeState) => void): NativeEventSubscription
  /** 문자 직접 받기 (SMS4) — 옛 모듈·아이폰에는 없다 */
  getSmsState?(): Promise<NativeSmsState>
  requestSmsPermission?(): Promise<NativeSmsState>
  setSmsEnabled?(on: boolean): Promise<NativeSmsState>
  /** 연락처 접근 묻기 (아이폰 — D-SMS-CONTACT). 옛 모듈·안드로이드에는 없다(안드로이드는 앱이 권한을 묻는다) */
  requestContacts?(): Promise<string>
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
  /** 받기 토큰을 넣는다(null이면 지운다). 틀린 토큰·기기 이름·http 주소는 NoticeInputError */
  setToken(config: NoticeTokenConfig | null): Promise<NoticeState>
  /** 대기열을 지금 보낸다(비었으면 0건 요청으로 filters만 새로 받는다) */
  flush(): Promise<NoticeFlushResult>
  /** 문자 직접 받기 (SMS4) — 네이티브에 없으면(아이폰·옛 모듈) null */
  readonly sms: SmsLink | null
}
