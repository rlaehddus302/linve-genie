// 휴대폰 알림 받기 모듈을 화면에 잇는 자리 (SMS3 D-SMS3-02·04, AC-SMS3-29).
// 화면이 쓰는 것은 @livejjim/mobile-notice의 NoticeIntake 중 일부뿐이라 같은 모양의 작은 틀만 둔다 — 앱 시작 때
// setNoticeModule(createNoticeIntake(네이티브))로 끼우고(안드로이드·아이폰), 끼우지 않으면 설정 칸이 "이 휴대폰에서는 쓸 수 없어요"다.
// 시험은 가짜를 끼운다.

/** 알림 읽기 권한: granted 허용됨 · needed 안드로이드에서 아직 · shortcut 아이폰(단축어로 보냄) */
export type PhoneNoticeAccess = 'granted' | 'needed' | 'shortcut'

/** 화면이 보는 상태 (NoticeState의 일부) */
export interface PhoneNoticeState {
  readonly platform: 'android' | 'ios' | 'fake'
  readonly enabled: boolean
  readonly access: PhoneNoticeAccess
  readonly hasToken: boolean
  /** 서버가 토큰을 받지 않았다(401) */
  readonly tokenRejected: boolean
  readonly pending: number
  /** 마지막으로 서버가 받은 시각 (기기 벽시계 UTC ms) */
  readonly lastSentAtMs: number | null
}

/** 화면이 부르는 것 (NoticeIntake와 같은 이름·모양) */
export interface PhoneNoticePort {
  start(): Promise<PhoneNoticeState>
  stop(): Promise<PhoneNoticeState>
  getState(): Promise<PhoneNoticeState>
  addStateListener(listener: (state: PhoneNoticeState) => void): () => void
  openSettings(target?: 'notificationAccess' | 'battery' | 'app' | 'shortcuts'): Promise<boolean>
  /** 받기 토큰 넣기(null이면 지운다) */
  setToken(config: { readonly token: string; readonly serverUrl: string; readonly deviceName: string } | null): Promise<PhoneNoticeState>
}

let port: PhoneNoticePort | null = null

/** 앱 시작·시험: 휴대폰 알림 받기 모듈을 끼운다 (null이면 뺀다) */
export function setNoticeModule(next: PhoneNoticePort | null): void {
  port = next
}

/** 끼운 모듈 (없으면 null — 이 빌드·기기에서는 쓸 수 없다) */
export function noticeModule(): PhoneNoticePort | null {
  return port
}
