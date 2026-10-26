// 출력 화면 낱말·문장 (D-088에 D-I1-08을 더함, LABEL_RULES L-7·L-8·L-11, AC-I1-24·34·60·61). 영어 상태값·코드는 화면에 보이지 않는다.
import { LABEL_MESSAGES, buyerText, doesNotFitMessage, formatLabelDate, type LabelBuyer } from '@livejjim/label'
import { PRINTER_MESSAGES, type PrinterErrorCode } from '@livejjim/printer'
import type { JobReason, JobView, LabelData, LabelView, QueueSummary } from '../api/print-types.ts'
import { kstHm } from './kst.ts'
import { saleOptionWords } from './sale-line.ts'
import { SERVICE_NAME } from '../brand.ts'

/** 알림 띠 낱말 (D-I1-08) */
export const PRINT_ALERT_WORD = {
  paused: '출력 멈춤',
  discard: '버릴 라벨',
} as const

/** 만든 까닭 */
export const REASON_WORD: Readonly<Record<JobReason, string>> = {
  auto: '자동',
  manual: '손으로',
  reprint: '다시 출력',
  packing: '포장',
}

/** 라벨 종류 */
export const KIND_WORD: Readonly<Record<'product' | 'packing', string>> = {
  product: '상품',
  packing: '포장',
}

/** 조치 낱말 (D-I1-08) */
export const PRINT_ACTION = {
  reconnect: '다시 연결',
  restart: '다시 시작',
  start: '출력 시작',
  pause: '출력 멈추기',
  release: '출력 그만하기',
  print: '라벨 출력',
  reprint: '다시 출력',
  discarded: '버렸어요',
  thisDevice: '이 기기에서 출력',
} as const

export const REHEARSAL_NO_LABELS = '리허설 방송은 라벨을 출력하지 않아요.'
export const KEEP_SCREEN_ON = '출력하는 동안 이 화면을 켜 두세요.'
export const TEST_QUESTION = '테스트 라벨의 네 변 테두리와 한글이 모두 또렷하게 보이나요?'
export const SETTING_NEXT_BROADCAST = '다음에 시작하는 방송부터 적용돼요.'
export const NO_WINNER_LABEL = '1등이 없어 출력할 라벨이 없어요.'
/** 라벨 기능을 끈 판매자의 라벨 자리 안내 (L-13 9, D-N4a-05) — 라벨 화면·상품 자세히·정산 자세히·Alt+P */
export const LABELS_OFF_NOTE = '라벨 쓰지 않음 — 설정에서 켤 수 있어요.'

/**
 * 콘솔 알림 띠 "출력 멈춤 · …"의 뒤 문장 (QL2 D-QL2-09 ②, 순수 함수): 판매자 멈춤(SELLER)만 까닭·할 일을 쓴다 —
 * 쌓인 라벨 멈춤이면 "쌓인 라벨 n장이 기다려요. 눌러서 '출력 시작'을 골라 주세요.", 판매자가 멈췄으면 "'출력 멈추기'를 눌러 멈췄어요. 눌러서 '다시 시작'을 골라 주세요."
 * 끊김·프린터 오류·라벨 오류는 서버의 까닭 문장(L-8) 그대로. 라벨 화면 멈춤 띠의 문장은 바뀌지 않는다
 */
export function pauseAlertMessage(pause: Pick<NonNullable<QueueSummary['pause']>, 'reason' | 'message' | 'backlog'>, waiting: number): string {
  if (pause.reason !== 'SELLER') return pause.message
  if (pause.backlog) return `쌓인 라벨 ${String(waiting)}장이 기다려요. 눌러서 '${PRINT_ACTION.start}'을 골라 주세요.`
  return `'${PRINT_ACTION.pause}'를 눌러 멈췄어요. 눌러서 '${PRINT_ACTION.restart}'을 골라 주세요.`
}

/** 라벨 대기열 "빼기" 확인 창 (QL2 D-QL2-09 ③) */
export const CANCEL_JOB_TITLE = '라벨 빼기'
export const cancelJobQuestion = (what: string): string => `${what} 라벨을 뺄까요? 뺀 라벨은 출력하지 않아요(기록은 남아요).`

/** 쌓인 라벨 안내 (L-11 10) */
export function backlogMessage(count: number): string {
  return `대기 중인 라벨 ${String(count)}장이 있어요. 출력 시작을 누르면 먼저 들어온 것부터 출력해요.`
}

/** 다른 기기에서 보는 출력 기기 안내 (AC-I1-23 → MOB1 D-MOB1-08, L-11 10): 이름을 괄호에 넣어 조사가 늘 "기기" 뒤 — 받침과 상관없다 */
export const deviceLostMessage = (name: string): string => `출력 기기('${name}')가 연결되어 있지 않아요. 그 기기에서 ${SERVICE_NAME}를 열고 화면을 켜 두세요.`
/** 짧은 문장의 기기 이름 낱자 수 상한 (QL3R1 D-QL3R1-04 (1)) — 넘으면 앞 10낱자 + "…" */
export const DEVICE_SHORT_NAME_MAX = 10
/** 휴대폰 접힌 알림 띠의 출력 기기 끊김 짧은 문장 (QL3R1 D-QL3R1-04 (1)) — 펼친 띠·PC·라벨 화면은 deviceLostMessage 그대로 */
export function deviceLostShortMessage(name: string): string {
  const letters = Array.from(name)
  const shown = letters.length > DEVICE_SHORT_NAME_MAX ? `${letters.slice(0, DEVICE_SHORT_NAME_MAX).join('')}…` : name
  return `라벨이 안 나가요 · '${shown}' 화면을 켜 주세요`
}
/** 출력 기기가 없고 대기 라벨이 쌓일 때 콘솔 알림 띠 맨 앞 항목 (D-MOB1-08 → QL2 D-QL2-09 ①: 없는 단추를 먼저 누르라고 하지 않는다 — 프린터 연결이 먼저) */
export const NO_STATION_PILING = "출력 기기가 아직 없어 라벨이 쌓이고 있어요. 출력할 기기의 라벨 화면에서 프린터를 연결한 뒤 '이 기기에서 출력'을 눌러 주세요."
export interface StationLeadInput {
  /** 라벨 기능 켬(true)·끔(false)·모름(null) */
  readonly labelsOn: boolean | null
  readonly rehearsal: boolean
  /** 끝난 방송·봉인 날짜 */
  readonly ended: boolean
  /** 출력 기록 요약 (모르면 null) */
  readonly queue: Pick<QueueSummary, 'device' | 'waiting'> | null
  /** 이 기기가 출력 기기인가 */
  readonly mine: boolean
}

/**
 * 콘솔 알림 띠 맨 앞 출력 기기 항목의 문장 (MOB1 D-MOB1-08, AC-MOB1-13 — 순수 함수). 없으면 null.
 * 라벨 켜짐·실제 방송·끝나지 않음·이 기기가 출력 기기가 아닐 때만: 출력 기기가 끊겼으면 deviceLostMessage, 출력 기기가 없고 대기 라벨이 있으면 NO_STATION_PILING
 */
export function stationLeadText({ labelsOn, rehearsal, ended, queue, mine }: StationLeadInput): string | null {
  if (labelsOn !== true || rehearsal || ended || mine || queue === null) return null
  if (queue.device === null) return queue.waiting > 0 ? NO_STATION_PILING : null
  return queue.device.live ? null : deviceLostMessage(queue.device.name)
}
/**
 * 출력 기기가 없고 대기 라벨이 쌓일 때 휴대폰 접힌 띠의 짧은 문장 (QL3R2 D-QL3R2-03) — 펼친 띠·PC·라벨 화면은 NO_STATION_PILING 그대로.
 * MOB2 D-MOB2-17: 글자 150% 휴대폰(글 폭 323px)에서도 두 줄 이하가 되게 짧게. 누르면 라벨 화면으로 가는 것은 그대로
 */
export const NO_STATION_SHORT = '라벨이 안 나가요 · 프린터를 연결해 주세요'
/**
 * stationLeadText의 휴대폰 접힌 띠 짧은 문장 (QL3R1 D-QL3R1-04 · QL3R2 D-QL3R2-03): 출력 기기 끊김이면 deviceLostShortMessage,
 * 출력 기기가 없고 대기 라벨이 있으면 NO_STATION_SHORT. 그 밖(정상·대기 0·리허설·끝남·이 기기·라벨 끔)은 null — stationLeadText가 null인 때와 같다
 */
export function stationLeadShortText(input: StationLeadInput): string | null {
  const { labelsOn, rehearsal, ended, queue, mine } = input
  if (labelsOn !== true || rehearsal || ended || mine || queue === null) return null
  if (queue.device === null) return queue.waiting > 0 ? NO_STATION_SHORT : null
  return queue.device.live ? null : deviceLostShortMessage(queue.device.name)
}
export const reconnectThereMessage = (name: string): string => `출력 기기 '${name}'에서 다시 연결해 주세요.`
/** 출력 기기 자신의 멈춤 띠: 저절로 다시 잇는 동안 (QL2 D-QL2-04 (1), L-11 8) — n = 기다리거나 하는 중인 시도의 차례 */
export const autoReconnectingMessage = (attempt: number, total: number): string => `프린터에 다시 잇고 있어요. (${String(attempt)}/${String(total)})`
/** 출력 기기 자신의 멈춤 띠: 저절로 다시 잇기가 그친 뒤 (QL2 D-QL2-04 (2)) — 아래에 해볼 일 목록과 "다시 연결" */
export const AUTO_RECONNECT_GAVE_UP = "저절로 다시 잇지 못했어요. 아래를 해 본 뒤 '다시 연결'을 눌러 주세요."
export const replaceQuestion = (name: string): string => `지금은 다른 기기 '${name}'에서 출력하고 있어요. 이 기기로 바꿀까요?`

/** 라벨의 구매자 표시 (유튜브 닉네임, 문자찜은 `문자찜`) */
export function buyerWord(buyer: LabelBuyer): string {
  return buyerText(buyer)
}

/** 출력 오류 코드의 문장 (L-7 표 · 라벨 패키지 문장) */
export function printErrorMessage(error: { readonly code: string; readonly item: string | null }): string {
  if (Object.hasOwn(PRINTER_MESSAGES, error.code)) return PRINTER_MESSAGES[error.code as PrinterErrorCode]
  switch (error.code) {
    case 'DOES_NOT_FIT':
      return doesNotFitMessage(error.item ?? '')
    case 'INVALID_DATA':
      return `${LABEL_MESSAGES.invalidDataPrefix}${LABEL_MESSAGES.labelData}`
    case 'INVALID_TEMPLATE':
      return LABEL_MESSAGES.invalidTemplate
    case 'MIXED_SIZES':
      return LABEL_MESSAGES.mixedSizes
    case 'NO_LABELS':
      return LABEL_MESSAGES.noLabels
    case 'INVALID_IMAGE':
      return LABEL_MESSAGES.invalidImage
    default:
      return PRINTER_MESSAGES.PRINT_FAILED
  }
}

/** 작업의 번호 표시: 상품 `15번`, 포장 `포장 1/2쪽` */
export function jobNumberWord(job: Pick<JobView, 'kind' | 'label' | 'data' | 'page' | 'pages'>): string {
  if (job.kind === 'packing') return job.page === null || job.pages === null ? '포장' : `포장 ${String(job.page)}/${String(job.pages)}쪽`
  const no = job.data !== null && 'no' in job.data ? job.data.no : job.label.no
  return no === null ? '' : `${String(no)}번`
}

/**
 * 상품 라벨의 옵션 글·수량 덧붙임 (LBL-01, D-O4-07·D-O4-10): " L 2개", " M", 수량만 " 3개", 옵션 없는 수량 1이면 빈 글.
 * 판매 줄 한 모양(sale-line) — 품종을 보이는 줄은 품종 뒤에, 보이지 않는 줄은 번호 뒤에 붙인다. 값은 서버 라벨 데이터(L-3) 그대로.
 */
export function labelOptionWords(data: LabelData | null): string {
  if (data === null || !('no' in data)) return ''
  return saleOptionWords({ variant: data.variant ?? null, qty: data.qty ?? 1 })
}

/** 작업의 품종 (상품, 지금 데이터 — 없으면 빈 글) */
export function jobNameWord(job: Pick<JobView, 'kind' | 'data'>): string {
  if (job.kind !== 'product' || job.data === null || !('name' in job.data)) return ''
  return job.data.name.trim() === '' ? '품종 미입력' : job.data.name
}

/** 버릴 라벨 안내 "15번 · 우주천사 · 26.10.18 라벨을 버려 주세요" (AC-I1-24) */
export function discardWord(job: Pick<JobView, 'kind' | 'label' | 'data' | 'page' | 'pages' | 'date'>): string {
  return `${jobNumberWord(job)}${job.kind === 'product' ? labelOptionWords(job.data) : ''} · ${buyerWord(job.label.buyer)} · ${formatLabelDate(job.date)} 라벨을 버려 주세요`
}

/** 출력 이력 "2번 출력 · 20:01 휴대폰 · 20:15 PC" (AC-I1-31) */
export function historyWord(label: Pick<LabelView, 'printed' | 'history'>): string {
  if (label.printed === 0) return '아직 출력하지 않았어요'
  return [`${String(label.printed)}번 출력`, ...label.history.map((item) => `${kstHm(item.at)} ${item.device}`)].join(' · ')
}

/** 프린터 상태 한 줄 (AC-I1-34): "프린터 PC · 연결됨 · 대기 2장" / "출력 기기 없음 · 대기 3장" / "출력 멈춤 · 대기 5장" */
export function printerStatusWord(queue: QueueSummary | null): string {
  if (queue === null) return '출력 기기 없음'
  const waiting = `대기 ${String(queue.waiting)}장`
  if (queue.pause !== null) return `${PRINT_ALERT_WORD.paused} · ${waiting}`
  if (queue.device === null) return queue.waiting === 0 && queue.printing === 0 ? '출력 기기 없음' : `출력 기기 없음 · ${waiting}`
  const connected = queue.device.live && queue.device.printerConnected
  return `프린터 ${queue.device.name} · ${connected ? '연결됨' : '끊김'} · ${waiting}`
}

/** 다른 기기에서 보는 출력 기기 "출력 기기: PC · 연결됨" */
export function deviceWord(queue: QueueSummary): string {
  if (queue.device === null) return '출력 기기 없음'
  return `출력 기기: ${queue.device.name} · ${queue.device.live ? '연결됨' : '끊김'}`
}

// ── 프린터 연결 실패의 해볼 일 (FB1 D-FB1-09, LABEL_RULES L-7 "해볼 일", AC-FB1-38) ─────────

/** 해볼 일 목록 제목 */
export const CONNECT_TIPS_TITLE = '해볼 일'

export interface ConnectTipEnv {
  /** 윈도우 (사용자 에이전트에 `Windows`) */
  readonly windows: boolean
  /** 이 브라우저에 USB 연결(Web Serial)이 있다 */
  readonly serial: boolean
  /** 안드로이드 (사용자 에이전트에 `Android`) — ⑤ "안드로이드 폰으로"는 안드로이드가 아닐 때만 (D-FB1-17). 없으면 안드로이드 아님 */
  readonly android?: boolean
  /** Marklife·바우아토 연결 (NIIMBOT 앱 → 프린터 앱, B1 → 프린터) */
  readonly marklife?: boolean
}

/** 해볼 일을 보이는 오류 코드 */
export function showsConnectTips(code: string): boolean {
  return code === 'CONNECT_FAILED' || code === 'DISCONNECTED'
}

/** L-7 ①~⑤ 가운데 그 환경에 맞는 것만, 차례대로 (FB1 D-FB1-17: 옛 ⑥ 아이폰·아이패드 줄은 뺐다, ⑤는 안드로이드가 아닐 때만) */
export function connectTips(env: ConnectTipEnv): string[] {
  const app = env.marklife === true ? '프린터 앱' : 'NIIMBOT 앱'
  const printer = env.marklife === true ? '프린터를' : 'B1을'
  return [
    "프린터 전원을 껐다 켠 뒤 '다시 연결'을 눌러 주세요.",
    `휴대폰의 ${app}이 프린터에 이어져 있으면 앱을 닫아 주세요. 프린터는 한 기기에만 이어져요.`,
    ...(env.windows
      ? [`윈도우 설정 → 블루투스 및 장치에서 ${printer} '장치 제거'한 뒤 여기서 '다시 연결'을 눌러 목록에서 ${printer} 골라 주세요. 윈도우에서 미리 연결(페어링)하지 않아도 돼요.`]
      : []),
    ...(env.serial ? ['USB 선이 있으면 USB 연결로 해 보세요.'] : []),
    ...(env.android === true
      ? []
      : [`그래도 안 되면 안드로이드 폰의 크롬에서 ${SERVICE_NAME}에 로그인해 프린터를 연결하고 '이 기기에서 출력'을 눌러 주세요. 컴퓨터에서 만든 라벨도 그 폰이 찍어요.`]),
  ]
}

/** 이 브라우저가 안드로이드인가 (D-FB1-17) */
export function isAndroid(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return userAgent.includes('Android')
}

/** 이 브라우저의 터치 지점 수 (없으면 0) */
function touchPointCount(): number {
  try {
    return typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints
  } catch {
    return 0
  }
}

/**
 * 이 브라우저가 아이폰·아이패드인가 (MOB1 D-MOB1-11 → QL2 D-QL2-07, 순수 함수 — 기본값은 navigator).
 * 사용자 에이전트에 iPhone·iPad·iPod이 있거나, Macintosh이면서 터치 지점이 2개 이상(터치 맥 = iPadOS 사파리). 터치 없는 맥은 PC
 */
export function isIphone(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent, touchPoints: number = touchPointCount()): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)
}

/** 아이폰에서 시험용 프린터 바로 아래 한 줄 (D-MOB1-11, AC-MOB1-20) */
export const IPHONE_TEST_PRINTER = '실제 아이폰에선 프린터에 바로 연결할 수 없어요. 라벨 그림을 저장해 출력해 주세요.'

/** 이 브라우저가 윈도우인가 */
export function isWindows(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return userAgent.includes('Windows')
}
