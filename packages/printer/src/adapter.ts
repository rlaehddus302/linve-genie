// 프린터 어댑터 계약 (LABEL_RULES L-7·L-12, LBL-06·LBL-12, D-P1-08·D-N1-02) — 프린터 모델과 상관없다.
import type { LabelBitmap, LabelSizeId } from '@livejjim/label'
import type { PrinterResult } from './errors.ts'

/** 연결 상태 4가지 */
export const CONNECTION_STATES = ['DISCONNECTED', 'CONNECTING', 'CONNECTED', 'PRINTING'] as const
export type ConnectionState = (typeof CONNECTION_STATES)[number]

/** 화면 낱말 */
export const CONNECTION_STATE_NAMES: Readonly<Record<ConnectionState, string>> = {
  DISCONNECTED: '끊김',
  CONNECTING: '연결 중',
  CONNECTED: '연결됨',
  PRINTING: '출력 중',
}

/** 연결 방법: Web Bluetooth(기본) · Web Serial(USB, 보조 — NIIMBOT만) */
export type ConnectionMethod = 'bluetooth' | 'serial'

/** 농도 범위 (정수) */
export interface DensityRange {
  readonly min: number
  readonly max: number
  readonly default: number
}

/** 인쇄 방식 (L-12 1 · 프린터 골든 열거값) */
export const PRINTER_PROTOCOLS = ['NIIMBOT_B1', 'MARKLIFE_YXQ2', 'MARKLIFE_YXQ3', 'MARKLIFE_YXQ8', 'MARKLIFE_L11'] as const
export type PrinterProtocol = (typeof PRINTER_PROTOCOLS)[number]

/** 보내기 직전의 돌림: 없음 · 시계 방향 90도(테이프 프린터 — 받은 그림의 왼쪽 끝이 먼저 나온다) */
export type PrinterRotate = 'NONE' | 'CW90'

/**
 * 프로필 표의 한 줄 (L-12 1, 프린터 골든 `profile`의 열두 칸 + ID). 모델 하나를 더하는 일은 이 표에 한 줄을 더하는 것이다 —
 * 바이트·돌림·농도·이름으로 고르기는 이 칸들(데이터)로 정해지고 모델 이름으로 갈라지는 코드가 없다(AC-N1-03).
 */
export interface ModelProfile {
  /** 프로필 ID (`MARKLIFE_P12` 등) */
  readonly id: string
  /** 제조사 (`NIIMBOT` · `Marklife` · `BAUATO`) */
  readonly maker: string
  /** 화면 이름 */
  readonly displayName: string
  readonly protocol: PrinterProtocol
  readonly dpi: number
  /** 인쇄 헤드 점 수 — 보낼 그림(돌린 뒤)이 이보다 넓으면 보내지 않는다 */
  readonly headDots: number
  readonly rotate: PrinterRotate
  /** 쓸 수 있는 라벨 크기 (첫째가 기본) */
  readonly sizes: readonly LabelSizeId[]
  readonly defaultSize: LabelSizeId
  /** 농도 범위. null이면 농도를 받지 않는다(보내지 않는다 — L11·바우아토) */
  readonly density: DensityRange | null
  /** 실기기 확인 전이라 기본 목록에 없고, 부르는 쪽이 일부러 넘길 때만 쓴다 */
  readonly experimental: boolean
  /** 바로 연결할 수 없을 때 그림 파일로 인쇄할 공식 앱 (`Marklife 앱` 등) */
  readonly fallbackApp: string
  /** 블루투스 기기 이름의 앞자리 (대소문자를 가린다). null이면 이름으로 고르지 않는다(B1 — 연결한 뒤 모델 정보로) */
  readonly namePrefix: string | null
}

/** 어댑터 계약이 보이는 프로필 — 어떤 모델이든 이 칸은 있다 */
export interface AdapterProfile {
  readonly displayName: string
  readonly dpi: number
  readonly headDots: number
  /** null이면 농도를 받지 않는다 */
  readonly density: DensityRange | null
}

/** NIIMBOT 프린터 프로필(niimbluelib) — 모델마다 하나. 다른 NIIMBOT 모델은 프로필을 더해 붙인다 (LBL-12) */
export interface PrinterProfile {
  /** niimbluelib 모델 이름 (`B1`) */
  readonly model: string
  /** 화면 이름 */
  readonly displayName: string
  readonly dpi: number
  /** 인쇄 헤드 점 수 — 이보다 넓은 그림은 보내지 않는다 */
  readonly headDots: number
  readonly density: { readonly min: number; readonly max: number; readonly default: number }
  /** niimbluelib 인쇄 방식 이름 (`B1`) */
  readonly printTask: string
  /** 라벨 종류: 간격 있는 라벨 */
  readonly labelType: 'WITH_GAPS'
  /** 인쇄 방향 (niimbluelib 모델 정보와 같다 — B1은 위쪽, 돌리지 않음) */
  readonly printDirection: 'top' | 'left'
  /** 그림 아래에 더해 보낼 흰 줄 수 (B1 마지막 줄 미출력 대응 = 1) */
  readonly extraBlankRows: number
}

/**
 * NIIMBOT B1 (TECH_REVIEW §1.1·1.2): 203dpi, 헤드 384점, 농도 1~5 기본 3, B1 인쇄 방식, 간격 있는 라벨, 마지막 줄 +1행.
 * 프로필 표의 칸(L-12 1 — 크기 50×30·50×20·50×40, 대체 경로 NIIMBOT 앱, 이름 앞자리 없음)도 가진다(N1).
 */
export const B1_PROFILE: PrinterProfile & ModelProfile = Object.freeze({
  id: 'NIIMBOT_B1',
  maker: 'NIIMBOT',
  model: 'B1',
  displayName: 'NIIMBOT B1',
  protocol: 'NIIMBOT_B1',
  dpi: 203,
  headDots: 384,
  rotate: 'NONE',
  sizes: Object.freeze(['50x30', '50x20', '50x40'] as const),
  defaultSize: '50x30',
  density: Object.freeze({ min: 1, max: 5, default: 3 }),
  experimental: false,
  fallbackApp: 'NIIMBOT 앱',
  namePrefix: null,
  printTask: 'B1',
  labelType: 'WITH_GAPS',
  printDirection: 'top',
  extraBlankRows: 1,
})

/** NIIMBOT 어댑터의 켠 프로필은 B1 하나다 (D-P1-08 — N1 뒤에도 그대로). 다른 NIIMBOT 모델은 HG-2 같은 실기기 확인 뒤 여기에 더한다 */
export const ENABLED_PROFILES: readonly PrinterProfile[] = Object.freeze([B1_PROFILE])

export interface PrintOptions {
  /** 농도 — 없으면 프로필 기본값(B1 = 3, Marklife YXQ = 2). 농도를 받지 않는 프로필(L11)은 쓰지 않는다 */
  readonly density?: number
}

/** 주입하는 타이머 (시험은 손으로 돌리는 가짜 타이머를 넣는다) */
export interface PrinterTimer {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const systemTimer: PrinterTimer = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
  },
}

/** 출력 시간 초과 기본값 (ms). 384×241 그림 한 장의 전송 + 인쇄 + 끝 알림을 넉넉히 기다린다 */
export const DEFAULT_PRINT_TIMEOUT_MS = 20_000

/** 모델과 상관없는 프린터 어댑터 계약 (L-7) */
export interface PrinterAdapter {
  /** 연결한 프린터의 프로필 (연결 전에는 기대하는 첫 프로필) */
  readonly profile: AdapterProfile
  readonly state: ConnectionState
  /** 상태가 바뀔 때마다 부른다. 돌려준 함수로 그만 듣는다 */
  onStateChange(listener: (state: ConnectionState) => void): () => void
  /** 이 환경에서 쓸 수 있는 연결 방법 (블루투스가 앞). 없으면 빈 목록 */
  availableMethods(): ConnectionMethod[]
  /** 연결 — 판매자가 누른 동작 안에서만 부른다(자동 연결 없음) */
  connect(method: ConnectionMethod): Promise<PrinterResult>
  disconnect(): Promise<void>
  /** 1비트 그림 한 장 출력. 프린터가 끝났다고 알린 뒤에 끝난다 */
  print(image: LabelBitmap, options?: PrintOptions): Promise<PrinterResult>
}

/** 상태와 알림을 다루는 작은 도우미 */
export class StateBox {
  private value: ConnectionState = 'DISCONNECTED'
  private readonly listeners = new Set<(state: ConnectionState) => void>()

  get state(): ConnectionState {
    return this.value
  }

  set(next: ConnectionState): void {
    if (next === this.value) return
    this.value = next
    for (const listener of [...this.listeners]) listener(next)
  }

  listen(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

/** 그림 아래에 흰 줄을 더한 새 그림 (위 줄들은 받은 그림 그대로) */
export function withBlankRows(image: LabelBitmap, rows: number): LabelBitmap {
  if (rows <= 0) return image
  const data = new Uint8Array(image.data.length + Math.ceil(image.width / 8) * rows)
  data.set(image.data, 0)
  return { width: image.width, height: image.height + rows, data }
}
